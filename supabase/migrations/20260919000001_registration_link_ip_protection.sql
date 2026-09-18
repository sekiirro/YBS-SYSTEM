-- ============================================================
-- YBS SYSTEM: REGISTRATION LINK IP PROTECTION
-- Migration: 20260919000001_registration_link_ip_protection.sql
--
-- Scope: protect package registration links against repeated use from
-- the SAME IP address for the SAME link only.
--
--   Same link + same IP  -> reject second account registration.
--   Different link + same IP -> allowed (different registration_link_id).
--   Different workspace link + same IP -> allowed.
--
-- IP is captured SERVER-SIDE (from the Edge Function request, via the
-- trusted Supabase Edge runtime headers) and passed into these SECURITY
-- DEFINER RPCs. It is NEVER trusted from a browser-supplied request body.
--
-- Design:
--   1. registration_link_ip_reservations — a ledger of (link_id, ip).
--      Rows are inserted (reserved) before account creation and only
--      finalized (user_id set) on success. A UNIQUE (link_id, ip) index
--      is the authoritative concurrency guard — concurrent requests for
--      the same pair can never both succeed.
--   2. reserve_registration_link_ip(p_link_id, p_ip) — atomically
--      reserve-or-reject. Returns { reserved: true } on success,
--      { reserved: false, reason: 'taken' } when already claimed.
--   3. finalize_registration_reservation(p_link_id, p_ip, p_user_id) —
--      binds the reservation to the newly-created user, making it
--      permanent (no TTL expiry after finalization).
--   4. release_registration_link_ip(p_link_id, p_ip) — releases a
--      reservation if account creation failed, so a server crash can
--      never permanently burn an IP/link pair.
--   5. A pg_cron job reaps abandoned reservations (no user_id, older than
--      the TTL) for safe cleanup.
-- ============================================================

-- ============================================================
-- 1. RESERVATION LEDGER
-- ============================================================
CREATE TABLE IF NOT EXISTS public.registration_link_ip_reservations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_link_id UUID NOT NULL REFERENCES public.workspace_registration_links(id) ON DELETE CASCADE,
    ip_address           INET NOT NULL,
    user_id              UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    status               TEXT NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved', 'finalized', 'released')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at           TIMESTAMPTZ NOT NULL,
    finalized_at         TIMESTAMPTZ,
    released_at          TIMESTAMPTZ
);

COMMENT ON TABLE public.registration_link_ip_reservations IS
    'Server-side IP reservation ledger for package registration links. UNIQUE(registration_link_id, ip_address) prevents the same IP from registering twice through the same link. Abandoned reservations (status=reserved, no user_id) expire and are reaped by pg_cron.';

COMMENT ON COLUMN public.registration_link_ip_reservations.ip_address IS
    'The caller IP as captured server-side by the Edge Function from the trusted Supabase runtime request headers (x-forwarded-for / cf-connecting-ip). Never supplied by the browser body.';

-- ============================================================
-- 2. CONSTRAINTS & INDEXES
-- ============================================================

-- Authoritative guard: same link + same IP can only be reserved once, and a
-- finalized reservation keeps blocking permanently. Released rows leave the
-- index so a failed attempt can be retried.
DROP INDEX IF EXISTS uq_reg_link_ip;
CREATE UNIQUE INDEX uq_reg_link_ip
  ON public.registration_link_ip_reservations (registration_link_id, ip_address)
  WHERE status IN ('reserved', 'finalized');

-- Lookups by IP (for audit/inspection) and by reservation age (for TTL reaping).
CREATE INDEX IF NOT EXISTS idx_reg_link_ip_ip
  ON public.registration_link_ip_reservations (ip_address);

CREATE INDEX IF NOT EXISTS idx_reg_link_ip_expires
  ON public.registration_link_ip_reservations (expires_at)
  WHERE status = 'reserved' AND user_id IS NULL;

-- RLS: reads are admin/workspace-owner scoped; all writes go through RPCs.
ALTER TABLE public.registration_link_ip_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "registration_link_ip_reservations_select"
  ON public.registration_link_ip_reservations;
CREATE POLICY "registration_link_ip_reservations_select"
  ON public.registration_link_ip_reservations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_registration_links l
      JOIN public.workspaces w ON w.id = l.workspace_id
      WHERE l.id = registration_link_id
        AND (public.is_platform_owner() OR public.is_workspace_owner(w.id))
    )
  );

-- No direct INSERT/UPDATE/DELETE from the app; all writes go through RPCs.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.registration_link_ip_reservations FROM anon, authenticated;
GRANT SELECT ON public.registration_link_ip_reservations TO authenticated;

-- ============================================================
-- 3. SECURITY DEFINER RPCs
-- ============================================================

-- ------------------------------------------------------------
-- reserve_registration_link_ip
--   Atomically attempt to reserve a (link_id, ip) pair.
--   Returns { reserved: true } on success, or { reserved: false, reason: ... }.
--   The UNIQUE index is the real gate; the function is idempotent-retry-safe.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_registration_link_ip(
    p_link_id UUID,
    p_ip_address INET
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_link_rec RECORD;
    v_reservation_id UUID;
    v_ttl INTERVAL := INTERVAL '15 minutes';
    v_ip TEXT;
BEGIN
    IF p_link_id IS NULL OR p_ip_address IS NULL THEN
        RETURN jsonb_build_object('reserved', false, 'reason', 'invalid_input');
    END IF;

    v_ip := p_ip_address::TEXT;

    -- Validate the link is active and eligible for registration.
    SELECT id, is_active
      INTO v_link_rec
    FROM public.workspace_registration_links
    WHERE id = p_link_id;

    IF v_link_rec.id IS NULL THEN
        RETURN jsonb_build_object('reserved', false, 'reason', 'link_not_found');
    END IF;

    IF v_link_rec.is_active = false THEN
        RETURN jsonb_build_object('reserved', false, 'reason', 'link_inactive');
    END IF;

    -- Attempt the reservation. The UNIQUE index on (link_id, ip) WHERE
    -- status='reserved' is the authoritative guard — concurrent callers
    -- for the same pair collide here.
    BEGIN
        INSERT INTO public.registration_link_ip_reservations (
            registration_link_id,
            ip_address,
            expires_at
        )
        VALUES (
            p_link_id,
            p_ip_address,
            now() + v_ttl
        )
        RETURNING id INTO v_reservation_id;
    EXCEPTION
        WHEN unique_violation THEN
            -- Someone else already holds this link+IP pair.
            -- Confirm whether it is finalized (permanent) or just reserved (TTL).
            IF EXISTS (
                SELECT 1 FROM public.registration_link_ip_reservations
                WHERE registration_link_id = p_link_id
                  AND ip_address = p_ip_address
                  AND status = 'finalized'
            ) THEN
                RETURN jsonb_build_object('reserved', false, 'reason', 'ip_taken_finalized');
            ELSE
                RETURN jsonb_build_object('reserved', false, 'reason', 'ip_taken_reserved');
            END IF;
    END;

    RETURN jsonb_build_object(
        'reserved', true,
        'reservation_id', v_reservation_id,
        'link_id', p_link_id,
        'ip_address', v_ip,
        'expires_at', (now() + v_ttl)
    );
END;
$$;

-- ------------------------------------------------------------
-- finalize_registration_reservation
--   Binds a reservation to the user created from it. Makes the
--   reservation permanent (status='finalized', no TTL expiry).
--   Safe to call after the Edge Function has created the user.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_registration_reservation(
    p_link_id UUID,
    p_ip_address INET,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    IF p_link_id IS NULL OR p_ip_address IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'reason', 'invalid_input');
    END IF;

    UPDATE public.registration_link_ip_reservations
    SET status = 'finalized',
        user_id = p_user_id,
        finalized_at = now(),
        updated_at = now()
    WHERE registration_link_id = p_link_id
      AND ip_address = p_ip_address
      AND status = 'reserved'
      AND user_id IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 0 THEN
        RETURN jsonb_build_object('success', false, 'reason', 'reservation_not_found_or_already_finalized');
    END IF;

    RETURN jsonb_build_object('success', true, 'finalized', true);
END;
$$;

-- ------------------------------------------------------------
-- release_registration_link_ip
--   Releases a reservation when account creation failed, so a
--   server crash or race never permanently burns an IP/link pair.
--   Idempotent: no-op if the reservation is already gone or finalized.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_registration_link_ip(
    p_link_id UUID,
    p_ip_address INET
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    IF p_link_id IS NULL OR p_ip_address IS NULL THEN
        RETURN jsonb_build_object('released', false, 'reason', 'invalid_input');
    END IF;

    UPDATE public.registration_link_ip_reservations
    SET status = 'released',
        released_at = now(),
        updated_at = now()
    WHERE registration_link_id = p_link_id
      AND ip_address = p_ip_address
      AND status = 'reserved'
      AND user_id IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    RETURN jsonb_build_object('released', v_updated > 0);
END;
$$;

-- ------------------------------------------------------------
-- Reap abandoned reservations (TTL cleanup).
-- Run hourly via pg_cron. Idempotent and safe to run concurrently.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reap_abandoned_registration_reservations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_removed INTEGER;
BEGIN
    DELETE FROM public.registration_link_ip_reservations
    WHERE status = 'reserved'
      AND user_id IS NULL
      AND expires_at <= now();

    GET DIAGNOSTICS v_removed = ROW_COUNT;
    RETURN v_removed;
END;
$$;

-- Schedule the cleanup job (idempotent: checks before scheduling).
DO $cron_body$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ybs-reg-link-ip-cleanup') THEN
        PERFORM cron.schedule(
            'ybs-reg-link-ip-cleanup',
            '17 * * * *',
            $cron$SELECT public.reap_abandoned_registration_reservations();$cron$
        );
    END IF;
END;
$cron_body$;

-- ============================================================
-- GRANTS
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.reserve_registration_link_ip FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_registration_link_ip TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.finalize_registration_reservation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_registration_reservation TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.release_registration_link_ip FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_registration_link_ip TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.reap_abandoned_registration_reservations FROM PUBLIC;
-- reap is internal: called only by the cron job (system role).

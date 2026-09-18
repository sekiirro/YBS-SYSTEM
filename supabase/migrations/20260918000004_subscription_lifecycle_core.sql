-- ============================================================
-- YBS SYSTEM: SUBSCRIPTION LIFECYCLE REBUILD — PART 1 (CORE SCHEMA)
-- Migration: 20260918000004_subscription_lifecycle_core.sql
--
-- SCOPE (additive + idempotent; no historical migration modified):
--
-- 1. workout_plans.delivered_at (+ delivered_at_source) — the missing
--    historical "workout delivered" timestamp. Nutrition already stores
--    its delivery instant in nutrition_plans.activated_at.
--    A BEFORE trigger stamps it exactly ONCE, on the first transition
--    into the state YBS already treats as a delivered client workout
--    plan (client_id NOT NULL, is_template = false, is_archived = false).
--    Later edits never overwrite it.
--
-- 2. subscription_freezes — auditable freeze history. One row per freeze,
--    including remaining_days_at_freeze (the paused countdown snapshot),
--    previous/extended end dates, resume instant and close/cancel data.
--    A partial unique index makes overlapping ACTIVE freezes impossible
--    at the database level.
--
-- 3. subscriptions.manually_adjusted / manual_adjusted_by /
--    manual_adjusted_at — audit trail for the System Owner manual
--    subscription-date override.
--
-- 4. Canonical read helpers:
--      current_subscription_id(client)   -> the live cycle
--      subscription_remaining_days(sub)  -> freeze-aware countdown
--      client_days_remaining(client)
--
-- 5. CURRENT vs HISTORICAL package separation:
--      * subscriptions.package_name / price / features stay the frozen
--        HISTORICAL snapshot of that cycle (never rewritten).
--      * clients.package_name + clients.subscription_end_date are kept
--        in sync with the CURRENT cycle's LIVE packages row, through
--        triggers. Every existing "current package" display therefore
--        follows a package rename automatically, with no N+1 queries
--        and no frontend changes.
--      * Workspace packages remain independent clones of the global
--        templates (unchanged) — a workspace package never inherits
--        later edits of the global template.
--
-- 6. subscriptions write RLS tightened to the System Owner
--    (platform_owner) only. Workspace Owners / Trainers keep READ.
--    All lifecycle writes go through SECURITY DEFINER RPCs
--    (migration 20260918000005), which re-check authorization
--    server-side.
-- ============================================================

-- ============================================================
-- 1. WORKOUT DELIVERY TIMESTAMP
-- ============================================================
ALTER TABLE public.workout_plans
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Provenance marker: an exact delivery event is never confused with a
-- reconstructed (backfilled) value. See migration 20260918000006.
ALTER TABLE public.workout_plans
  ADD COLUMN IF NOT EXISTS delivered_at_source TEXT;

COMMENT ON COLUMN public.workout_plans.delivered_at IS
  'Instant the workout plan first became a delivered client plan (client_id set, not template, not archived). Set once by trigger; never overwritten by later edits.';
COMMENT ON COLUMN public.workout_plans.delivered_at_source IS
  'delivery_event = exact trigger timestamp; backfill_* = reconstructed during migration 20260918000006 (never exact).';

CREATE OR REPLACE FUNCTION public.set_workout_delivered_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- First transition into the delivered state only.
  IF NEW.client_id IS NOT NULL
     AND NEW.is_template = false
     AND NEW.is_archived = false
     AND NEW.delivered_at IS NULL
  THEN
    NEW.delivered_at := now();
    NEW.delivered_at_source := 'delivery_event';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_workout_delivered_at() FROM PUBLIC;

-- NOTE: delivered_at is deliberately NOT part of the UPDATE OF list, so a
-- bare backfill write of the column can never re-stamp it with now().
DROP TRIGGER IF EXISTS trg_set_workout_delivered_at ON public.workout_plans;
CREATE TRIGGER trg_set_workout_delivered_at
  BEFORE INSERT OR UPDATE OF client_id, is_template, is_archived
  ON public.workout_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.set_workout_delivered_at();

CREATE INDEX IF NOT EXISTS idx_workout_plans_delivered_at
  ON public.workout_plans (client_id, delivered_at)
  WHERE delivered_at IS NOT NULL;

-- ============================================================
-- 2. PLAN-DELIVERY PREDICATES (single canonical definition)
-- ============================================================
CREATE OR REPLACE FUNCTION public.client_has_delivered_nutrition(p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.nutrition_plans
    WHERE client_id = p_client_id
      AND status = 'active'
      AND is_archived = false
  );
$$;

CREATE OR REPLACE FUNCTION public.client_has_delivered_workout(p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workout_plans
    WHERE client_id = p_client_id
      AND is_template = false
      AND is_archived = false
  );
$$;

REVOKE EXECUTE ON FUNCTION public.client_has_delivered_nutrition(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.client_has_delivered_workout(UUID) FROM PUBLIC;

-- ============================================================
-- 3. MANUAL SUBSCRIPTION-DATE OVERRIDE TRAIL
-- ============================================================
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS manually_adjusted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS manual_adjusted_by UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS manual_adjusted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.subscriptions.manually_adjusted IS
  'True when a System Owner explicitly overrode the subscription start/end dates (see override_subscription_dates).';

-- ============================================================
-- 4. FREEZE HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subscription_freezes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    freeze_days INTEGER NOT NULL CHECK (freeze_days > 0),
    freeze_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    freeze_end TIMESTAMPTZ NOT NULL,          -- scheduled automatic resume instant
    resume_date DATE NOT NULL,                -- freeze_end::date (display)
    remaining_days_at_freeze INTEGER NOT NULL CHECK (remaining_days_at_freeze >= 0),
    previous_end_date DATE NOT NULL,          -- end date BEFORE the freeze extension
    extended_end_date DATE NOT NULL,          -- end date AFTER the freeze extension
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'completed', 'cancelled')),
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    close_reason TEXT
);

COMMENT ON TABLE public.subscription_freezes IS
  'Auditable freeze history. remaining_days_at_freeze preserves the paused countdown so Days Remaining stays constant during a freeze and resume is exact for sequential freezes.';
COMMENT ON COLUMN public.subscription_freezes.status IS
  'active = countdown paused; completed = resumed automatically or closed by a renewal; cancelled = reversed by a System Owner.';

-- Overlapping ACTIVE freezes on the same subscription are impossible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_freezes_active
  ON public.subscription_freezes (subscription_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_subscription_freezes_resume
  ON public.subscription_freezes (status, freeze_end);

CREATE INDEX IF NOT EXISTS idx_subscription_freezes_client
  ON public.subscription_freezes (client_id, created_at DESC);

ALTER TABLE public.subscription_freezes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscription_freezes_select" ON public.subscription_freezes;
CREATE POLICY "subscription_freezes_select" ON public.subscription_freezes
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR public.is_client_self(client_id)
);

-- Reads only: every write goes through the SECURITY DEFINER RPCs.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.subscription_freezes FROM anon, authenticated;
GRANT SELECT ON public.subscription_freezes TO authenticated;

-- ============================================================
-- 5. CANONICAL READ HELPERS
-- ============================================================
-- The client's CURRENT cycle: the newest non-renewed subscription,
-- preferring a live state (active > frozen > pending > expired).
CREATE OR REPLACE FUNCTION public.current_subscription_id(p_client_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id
  FROM public.subscriptions s
  WHERE s.client_id = p_client_id
    AND s.status <> 'renewed'
  ORDER BY
    CASE s.status
      WHEN 'active'  THEN 0
      WHEN 'frozen'  THEN 1
      WHEN 'pending' THEN 2
      WHEN 'expired' THEN 3
      ELSE 4
    END,
    s.start_date DESC NULLS LAST,
    s.created_at DESC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.current_subscription_id(UUID) FROM PUBLIC;

-- Freeze-aware countdown.
--   * pre-activation / closed cycles  -> NULL (no countdown is running)
--   * while frozen                    -> the preserved remaining_days_at_freeze
--   * otherwise                       -> end_date - CURRENT_DATE (floored at 0)
-- Because the freeze extends end_date by exactly freeze_days, the normal
-- formula yields the preserved value again the moment the freeze resumes,
-- which keeps sequential freezes exact.
CREATE OR REPLACE FUNCTION public.subscription_remaining_days(p_subscription_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_frozen INTEGER;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id;
  IF v_sub.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_sub.status IN ('pending', 'renewed', 'cancelled') THEN
    RETURN NULL;
  END IF;

  SELECT f.remaining_days_at_freeze INTO v_frozen
  FROM public.subscription_freezes f
  WHERE f.subscription_id = v_sub.id
    AND f.status = 'active'
  ORDER BY f.freeze_start DESC
  LIMIT 1;

  IF v_frozen IS NOT NULL THEN
    RETURN v_frozen;
  END IF;

  RETURN GREATEST(0, (v_sub.end_date - CURRENT_DATE)::int);
END;
$$;

CREATE OR REPLACE FUNCTION public.client_days_remaining(p_client_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.subscription_remaining_days(public.current_subscription_id(p_client_id));
$$;

REVOKE EXECUTE ON FUNCTION public.subscription_remaining_days(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.client_days_remaining(UUID) FROM PUBLIC;

-- ============================================================
-- 6. CURRENT PACKAGE DISPLAY SYNC (CURRENT vs HISTORICAL)
-- ============================================================
-- clients.package_name / clients.subscription_end_date are CURRENT
-- display values. They are re-derived from the current subscription and
-- its LIVE packages row. subscriptions.package_name / price / features
-- are never touched: they remain the historical snapshot of that cycle.
CREATE OR REPLACE FUNCTION public.sync_client_current_package(p_client_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub_id UUID;
  v_name TEXT;
  v_end DATE;
BEGIN
  IF p_client_id IS NULL THEN
    RETURN;
  END IF;

  v_sub_id := public.current_subscription_id(p_client_id);
  IF v_sub_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(p.name, s.package_name), s.end_date
    INTO v_name, v_end
  FROM public.subscriptions s
  LEFT JOIN public.packages p ON p.id = s.package_id
  WHERE s.id = v_sub_id;

  UPDATE public.clients c
  SET package_name = COALESCE(v_name, c.package_name),
      subscription_end_date = COALESCE(v_end, c.subscription_end_date),
      updated_at = now()
  WHERE c.id = p_client_id
    AND (
      c.package_name IS DISTINCT FROM COALESCE(v_name, c.package_name)
      OR c.subscription_end_date IS DISTINCT FROM COALESCE(v_end, c.subscription_end_date)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_client_current_package(UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.trg_sync_client_package_from_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_client_current_package(COALESCE(NEW.client_id, OLD.client_id));
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_sync_client_package_from_subscription() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sync_client_package_from_subscription ON public.subscriptions;
CREATE TRIGGER trg_sync_client_package_from_subscription
  AFTER INSERT OR UPDATE OF package_id, package_name, status, start_date, end_date
  ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_client_package_from_subscription();

-- A package RENAME (or re-activation) propagates to every client whose
-- CURRENT cycle uses it — the workspace package row itself stays an
-- independent clone of the global template.
CREATE OR REPLACE FUNCTION public.trg_sync_clients_on_package_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
  THEN
    FOR r IN
      SELECT DISTINCT s.client_id
      FROM public.subscriptions s
      WHERE s.package_id = NEW.id
        AND s.client_id IS NOT NULL
    LOOP
      PERFORM public.sync_client_current_package(r.client_id);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_sync_clients_on_package_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sync_clients_on_package_change ON public.packages;
CREATE TRIGGER trg_sync_clients_on_package_change
  AFTER UPDATE OF name, is_active ON public.packages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_clients_on_package_change();

-- One-time reconciliation of the CURRENT display columns for every
-- client that already has a subscription (no historical row is read
-- or written).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT s.client_id
    FROM public.subscriptions s
    WHERE s.client_id IS NOT NULL
  LOOP
    PERFORM public.sync_client_current_package(r.client_id);
  END LOOP;
END $$;

-- ============================================================
-- 7. SUBSCRIPTION WRITE RLS: SYSTEM OWNER ONLY
-- ============================================================
-- Direct table writes (REST/RPC) are restricted to the System Owner.
-- Workspace Owners and Trainers keep the existing READ policies
-- (subscriptions_select). Lifecycle writes happen exclusively through
-- the SECURITY DEFINER RPCs created in 20260918000005.
DROP POLICY IF EXISTS "subscriptions_manage" ON public.subscriptions;
CREATE POLICY "subscriptions_manage" ON public.subscriptions
FOR ALL TO authenticated
USING (
  public.is_platform_owner()
)
WITH CHECK (
  public.is_platform_owner()
);

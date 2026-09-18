-- ============================================================
-- YBS SYSTEM: RELEASE REGISTRATION-IP RESERVATION ON REJECTION
-- Migration: 20260919000003_release_ip_reservation_on_rejection.sql
--
-- Scope: when the Platform Owner rejects a client application,
-- any registration-link IP reservation finalized for that applicant
-- must be released so the same (link, IP) pair can be reserved again
-- by a legitimate re-registration attempt.
--
-- Background:
--   The existing release_registration_link_ip(p_link_id, p_ip) RPC
--   only releases rows with status='reserved' AND user_id IS NULL
--   (the account-creation-failure recovery path). A rejected client's
--   reservation was already FINALIZED (status='finalized', user_id
--   bound) by finalize_registration_reservation, so that RPC is a
--   permanent no-op for them — rejection would otherwise burn the
--   (link, ip) pair forever.
--
-- Design:
--   1. release_registration_link_ip_reservations_for_user(p_user_id)
--      — a SECURITY DEFINER RPC that marks every reservation bound to
--        the user (across any link) as 'released'. Setting status to
--        'released' removes the row from the partial UNIQUE index
--        uq_reg_link_ip (it only covers 'reserved'/'finalized'), so
--        the pair becomes re-reservable. Idempotent and resilient to:
--          * no reservation row exists            -> released: 0
--          * multiple rows across different links -> all released
--          * missing / NULL user                  -> invalid_input
--          * already-released rows                -> untouched (no-op)
--        Gate: platform owner, or the user releasing their own rows.
--   2. reject_client_application(p_application_id, p_reason) is
--      redefined to invoke that RPC for v_app.user_id as part of the
--      canonical rejection workflow. The release is wrapped in a
--      BEGIN/EXCEPTION block so a release hiccup can never roll back
--      the rejection itself.
-- ============================================================

-- ------------------------------------------------------------
-- 1. USER-SCOPED RELEASE RPC
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_registration_link_ip_reservations_for_user(
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_released INTEGER;
BEGIN
    IF NOT (public.is_platform_owner() OR auth.uid() = p_user_id) THEN
        RAISE EXCEPTION 'Not authorized to release registration reservations';
    END IF;

    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('released', 0, 'reason', 'invalid_input');
    END IF;

    UPDATE public.registration_link_ip_reservations
    SET status = 'released',
        released_at = now(),
        updated_at = now()
    WHERE user_id = p_user_id
      AND status IN ('reserved', 'finalized');

    GET DIAGNOSTICS v_released = ROW_COUNT;

    RETURN jsonb_build_object(
        'released', v_released > 0,
        'count', v_released
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_registration_link_ip_reservations_for_user FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_registration_link_ip_reservations_for_user TO authenticated;

-- ------------------------------------------------------------
-- 2. REJECTION WORKFLOW — release the applicant's reservation(s)
--    as part of the canonical rejection path.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_client_application(
  p_application_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app RECORD;
  v_release JSONB;
BEGIN
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Only the Platform Owner can reject client applications';
  END IF;

  SELECT * INTO v_app FROM public.client_applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  UPDATE public.profiles
  SET account_status = 'rejected',
      updated_at = now()
  WHERE id = v_app.user_id;

  UPDATE public.client_applications
  SET status = 'rejected',
      rejection_reason = p_reason,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      updated_at = now()
  WHERE id = p_application_id;

  -- Release every registration-link IP reservation finalized for this
  -- applicant so the (link, IP) pair becomes available for a legitimate
  -- re-registration. Best-effort: a failure here must never roll back
  -- the rejection decision.
  BEGIN
    v_release := public.release_registration_link_ip_reservations_for_user(v_app.user_id);
  EXCEPTION
    WHEN OTHERS THEN
      v_release := jsonb_build_object('released', false, 'count', 0, 'error', SQLERRM);
  END;

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, metadata
  )
  VALUES (
    auth.uid(), 'Platform Owner', 'platform_owner', 'client_application_rejected',
    'client_application', p_application_id::text, v_app.applicant_name,
    jsonb_build_object(
      'reason', p_reason,
      'ip_reservations_released', v_release
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'ip_reservations_released', v_release
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_client_application FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_client_application TO authenticated;
-- ============================================================
-- YBS SYSTEM: REJECTED-ACCOUNT LIFECYCLE
-- Migration: 20260920000001_rejected_account_lifecycle.sql
--
-- Scope: after the Platform Owner rejects a client application, the
-- applicant's phone AND email must become eligible for a fresh
-- registration through the public registration-link form again,
-- while the rejected application row and its audit history are
-- preserved intact.
--
-- Background (four uniqueness layers block a re-registration):
--   1. auth.users.email   (users_email_partial_key)
--   2. auth.users.phone   (users_phone_key)   -- edge fn stores phone here too
--   3. auth.identities    (provider_id = email, provider = 'email')
--   4. profiles.email / profiles.phone UNIQUE cols, plus
--      resolve_phone_identifier() returning found:true for ANY profile
--      row, including account_status='rejected'.
-- A rejected applicant keeps all four layers occupied, so neither the
-- phone pre-flight (resolve_phone_identifier -> phone_taken) nor the
-- auth-account creation (admin.createUser -> email_taken) can succeed.
--
-- Lifecycle decision:
--   Rejection is a TERMINAL state (there is no un-reject path, and
--   PendingApproval treats it as final). The rejected AUTH ACCOUNT is
--   therefore REMOVED as part of the rejection workflow, which frees
--   all four uniqueness layers at once. History is NOT lost because:
--     * client_applications already snapshots applicant_name / phone /
--       email + rejection_reason / reviewed_at / reviewed_by, and the
--       app row is repointed to survive (user_id FK -> nullable
--       ON DELETE SET NULL).
--     * a client_application_rejected audit row is written BEFORE the
--       account is removed, attributed to the Platform Owner.
--     * the applicant has no clients / timeline rows (only approved
--       applicants do), so nothing else is touched.
-- Safety nets:
--   * Approved applications can never be rejected (guard).
--   * Only non-onboarded applicant accounts (platform_role='none' and
--     account_status IN ('pending_approval','rejected')) are removed;
--     an active/suspended/deactivated or staff/owner profile is never
--     deleted even if its application is somehow rejected.
--   * Repeated rejection is idempotent: no duplicate audit, no error;
--     legacy rejected accounts (pre-migration) are ALSO removed
--     retro-fit when their already-rejected application is rejected
--     again, so historical rejections stop blocking re-registration.
--   * resolve_phone_identifier / global uniqueness / the frontend
--     "already registered" message are NOT weakened in any way.
-- ============================================================

-- ------------------------------------------------------------
-- 1. REPOINT client_applications.user_id so application history
--    survives the applicant's account removal.
-- ------------------------------------------------------------
ALTER TABLE public.client_applications
    ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.client_applications
    DROP CONSTRAINT IF EXISTS client_applications_user_id_fkey;

ALTER TABLE public.client_applications
    ADD CONSTRAINT client_applications_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 2. REDEFINED REJECTION WORKFLOW
--    Reject -> (a) release IP reservations, (b) mark application +
--    profile rejected, (c) audit, (d) remove the terminal account.
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
  v_reason TEXT;
  v_applicant UUID;
  v_eligible_for_removal BOOLEAN;
  v_account_removed BOOLEAN := false;
BEGIN
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Only the Platform Owner can reject client applications';
  END IF;

  SELECT * INTO v_app FROM public.client_applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  IF v_app.status = 'approved' THEN
    RAISE EXCEPTION 'Approved applications cannot be rejected';
  END IF;

  v_reason    := COALESCE(NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'No reason provided.');
  v_applicant := v_app.user_id;

  -- A profile is only removable when it still belongs to a non-onboarded
  -- applicant (evaluated from ORIGINAL state, before any UPDATE below).
  v_eligible_for_removal := v_applicant IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_applicant
      AND p.platform_role = 'none'
      AND p.account_status IN ('pending_approval', 'rejected')
  );

  -- Release every registration-link IP reservation finalized for this
  -- applicant (idempotent). Best-effort: never rolls back the rejection.
  BEGIN
    v_release := public.release_registration_link_ip_reservations_for_user(v_applicant);
  EXCEPTION
    WHEN OTHERS THEN
      v_release := jsonb_build_object('released', false, 'count', 0, 'error', SQLERRM);
  END;

  IF v_app.status <> 'rejected' THEN
    -- ---- first-time rejection -----------------------------------
    IF v_applicant IS NOT NULL THEN
      UPDATE public.profiles
      SET account_status = 'rejected',
          updated_at = now()
      WHERE id = v_applicant;
    END IF;

    UPDATE public.client_applications
    SET status = 'rejected',
        rejection_reason = v_reason,
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        updated_at = now()
    WHERE id = p_application_id;

    -- Audit BEFORE account removal so the decision is always recorded.
    INSERT INTO public.audit_logs (
      actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, metadata
    )
    VALUES (
      auth.uid(), 'Platform Owner', 'platform_owner', 'client_application_rejected',
      'client_application', p_application_id::text, v_app.applicant_name,
      jsonb_build_object(
        'reason', v_reason,
        'ip_reservations_released', v_release
      )
    );

    -- Terminal lifecycle: remove the rejected applicant's account so the
    -- phone/email become recyclable at every uniqueness layer. The app row
    -- survives via ON DELETE SET NULL.
    IF v_eligible_for_removal THEN
      DELETE FROM auth.users WHERE id = v_applicant;
      v_account_removed := true;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'ip_reservations_released', v_release,
      'account_removed', v_account_removed,
      'application_id', p_application_id
    );
  END IF;

  -- ---- repeated rejection: idempotent retro-fit ------------------
  -- Legacy rejected accounts (rejected before this migration) still
  -- occupy the applicant's phone/email. Rejecting an already-rejected
  -- application again releases them too, without duplicating history.
  IF v_eligible_for_removal THEN
    DELETE FROM auth.users WHERE id = v_applicant;
    v_account_removed := true;

    INSERT INTO public.audit_logs (
      actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, metadata
    )
    VALUES (
      auth.uid(), 'Platform Owner', 'platform_owner', 'client_application_rejected',
      'client_application', p_application_id::text, v_app.applicant_name,
      jsonb_build_object(
        'reason', v_app.rejection_reason,
        'ip_reservations_released', v_release,
        'retroactive_account_removal', true
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_rejected', true,
    'ip_reservations_released', v_release,
    'account_removed', v_account_removed,
    'application_id', p_application_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_client_application FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_client_application TO authenticated;
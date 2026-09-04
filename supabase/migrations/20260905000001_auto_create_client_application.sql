-- ============================================================
-- YBS SYSTEM: MIGRATION 09 — AUTO-CREATE CLIENT APPLICATIONS
-- FOR SELF-REGISTERING TRAINEES
-- ============================================================
--
-- PROBLEM:
--   Production Supabase has email confirmation enabled
--   (mailer_autoconfirm = false), so supabase.auth.signUp() returns
--   a user but no authenticated session. The frontend's INSERT into
--   public.client_applications (src/pages/ClientSignup.jsx) therefore
--   runs as the `anon` role. The RLS policy on client_applications
--   only permits INSERT for `authenticated` (no anon INSERT policy),
--   so the insert fails with 42501 / "new row violates row-level
--   security policy" and no application row is ever created.
--
-- FIX:
--   Extend the existing handle_new_user() trigger (SECURITY DEFINER,
--   SET search_path = public) which already creates public.profiles
--   on auth.users INSERT, so that it ALSO creates the initial
--   client_applications row for self-registered trainees. This runs
--   server-side in the same transaction as user creation, so no
--   authenticated session is required. The existing security model
--   (no anon INSERT RLS policy) is preserved.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT;
  v_full_name TEXT;
  v_platform_role TEXT;
  v_account_status TEXT;
BEGIN
  v_phone := NEW.raw_user_meta_data->>'phone';

  v_full_name :=
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.email
    );

  v_platform_role :=
    COALESCE(
      NEW.raw_app_meta_data->>'platform_role',
      'none'
    );

  v_account_status :=
    COALESCE(
      NEW.raw_app_meta_data->>'account_status',
      'pending_approval'
    );

  IF v_platform_role NOT IN (
    'platform_owner',
    'platform_trainer',
    'none'
  ) THEN
    v_platform_role := 'none';
  END IF;

  -- 1. Upsert the linked profile (unchanged from migration 06)
  INSERT INTO public.profiles (
    id,
    email,
    phone,
    full_name,
    platform_role,
    account_status
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_phone,
    v_full_name,
    v_platform_role,
    v_account_status
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    updated_at = now();

  -- 2. Auto-create a pending client application for self-registered trainees.
  --    Self-registration resolves to platform_role 'none' (raw_user_meta_data
  --    can never grant elevated platform privileges). Trusted platform-level
  --    accounts, supplied through the server-side raw_app_meta_data channel,
  --    yield a platform_role of 'platform_owner'/'platform_trainer' and are
  --    skipped. COALESCE(v_phone, '') guards the applicant_phone NOT NULL
  --    constraint.
  IF
    v_platform_role = 'none'
    AND v_account_status = 'pending_approval'
    AND NOT EXISTS (
      SELECT 1
      FROM public.client_applications ca
      WHERE ca.user_id = NEW.id
        AND ca.status IN (
          'pending',
          'under_review',
          'more_info_required'
        )
    )
  THEN
    INSERT INTO public.client_applications (
      user_id,
      applicant_name,
      applicant_phone,
      applicant_email,
      status
    )
    VALUES (
      NEW.id,
      v_full_name,
      COALESCE(v_phone, ''),
      NEW.email,
      'pending'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Reinstall trigger (idempotent) to keep the binding definition in sync
-- with the migration style used by migrations 05/06.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- DEFENSIVE PARTIAL UNIQUE INDEX
-- Prevents one user from accumulating multiple OPEN applications
-- (pending / under_review / more_info_required). It intentionally
-- does NOT cover 'approved' / 'rejected' so a user may re-apply
-- after an application has reached a terminal state.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_applications_unique_open
  ON public.client_applications (user_id)
  WHERE status IN (
    'pending',
    'under_review',
    'more_info_required'
  );

-- ============================================================
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
-- ============================================================
SELECT tgname, tgenabled, tgrelid::regclass AS table_name
FROM   pg_trigger
WHERE  tgname = 'on_auth_user_created';

SELECT proname, proowner::regrole, prosecdef
FROM   pg_proc
WHERE  proname = 'handle_new_user';

SELECT indexname, indexdef
FROM   pg_indexes
WHERE  indexname = 'idx_client_applications_unique_open';

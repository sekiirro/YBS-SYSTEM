-- ============================================================
-- YBS SYSTEM: SUPABASE DATABASE ARCHITECTURE (MIGRATION 05)
-- SUPABASE AUTH INTEGRATION, TRIGGERS & TRANSACTIONAL APPROVAL
-- ============================================================

-- 1. Automatic Profile Creation on Supabase Auth Signup
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
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);
  v_platform_role := COALESCE(NEW.raw_app_meta_data->>'platform_role', 'none');
  v_account_status := COALESCE(NEW.raw_app_meta_data->>'account_status', 'pending_approval');

  -- Ensure platform_role is valid
  IF v_platform_role NOT IN ('platform_owner', 'platform_trainer', 'none') THEN
    v_platform_role := 'none';
  END IF;

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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Safe Phone Identifier Resolution for Login (Does not leak emails unnecessarily)
CREATE OR REPLACE FUNCTION public.resolve_phone_identifier(p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw TEXT;
  v_normalized TEXT;
  v_digits TEXT;
  v_profile RECORD;
BEGIN
  v_raw := trim(COALESCE(p_phone, ''));
  IF v_raw = '' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- Remove common formatting
  v_normalized := regexp_replace(v_raw, '[\s\-().]', '', 'g');
  v_digits := regexp_replace(v_raw, '\D', '', 'g');

  -- Match exact phone, international + variant, or suffix
  SELECT id, email, account_status, platform_role INTO v_profile
  FROM public.profiles
  WHERE phone = v_raw
     OR phone = v_normalized
     OR phone = ('+' || regexp_replace(v_normalized, '^\+', ''))
     OR (length(v_digits) >= 9 AND regexp_replace(phone, '\D', '', 'g') LIKE ('%' || v_digits))
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- If account is not active, return status without proceeding
  IF v_profile.account_status != 'active' AND v_profile.platform_role != 'platform_owner' THEN
    RETURN jsonb_build_object(
      'found', true,
      'account_status', v_profile.account_status
    );
  END IF;

  -- Active account: return email identifier for Supabase Auth login
  RETURN jsonb_build_object(
    'found', true,
    'account_status', v_profile.account_status,
    'email', v_profile.email
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_phone_identifier FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_phone_identifier TO anon, authenticated;

-- 3. Atomic Server-Side Client Approval Workflow
CREATE OR REPLACE FUNCTION public.approve_client_application(
  p_application_id UUID,
  p_workspace_id UUID,
  p_trainer_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app RECORD;
  v_client_id UUID;
  v_code TEXT;
  v_random INT;
  v_count INT;
BEGIN
  -- Verify caller is Platform Owner
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Only the Platform Owner can approve client applications';
  END IF;

  -- Verify target workspace exists
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = p_workspace_id AND status = 'active') THEN
    RAISE EXCEPTION 'Target workspace does not exist or is not active';
  END IF;

  -- If trainer specified, verify trainer
  IF p_trainer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_trainer_id AND platform_role = 'platform_trainer'
  ) THEN
    RAISE EXCEPTION 'Target trainer does not exist or is not a verified YBS coach';
  END IF;

  -- Fetch application
  SELECT * INTO v_app FROM public.client_applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  IF v_app.status = 'approved' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Already approved', 'client_id', v_app.created_client_id);
  END IF;

  -- Generate unique client code YBS-XXXX
  LOOP
    v_random := 1000 + floor(random() * 9000)::int;
    v_code := 'YBS-' || v_random::text;
    SELECT count(*) INTO v_count FROM public.clients WHERE client_code = v_code;
    EXIT WHEN v_count = 0;
  END LOOP;

  -- 1. Create client record
  INSERT INTO public.clients (
    workspace_id,
    user_id,
    client_code,
    full_name,
    email,
    phone,
    assigned_ybs_coach_id,
    join_date,
    status,
    subscription_status
  )
  VALUES (
    p_workspace_id,
    v_app.user_id,
    v_code,
    v_app.applicant_name,
    v_app.applicant_email,
    v_app.applicant_phone,
    p_trainer_id,
    CURRENT_DATE,
    'active',
    'no_subscription'
  )
  RETURNING id INTO v_client_id;

  -- 2. Create workspace membership for client
  INSERT INTO public.workspace_memberships (
    workspace_id,
    user_id,
    workspace_role,
    status
  )
  VALUES (
    p_workspace_id,
    v_app.user_id,
    'client',
    'active'
  )
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET status = 'active';

  -- 3. If trainer assigned, record allocation history
  IF p_trainer_id IS NOT NULL THEN
    INSERT INTO public.client_ybs_trainer_assignments (
      client_id,
      trainer_id,
      assigned_by,
      assigned_at,
      is_active
    )
    VALUES (
      v_client_id,
      p_trainer_id,
      auth.uid(),
      now(),
      true
    );
  END IF;

  -- 4. Activate user profile and bind active workspace
  UPDATE public.profiles
  SET account_status = 'active',
      active_workspace_id = p_workspace_id,
      updated_at = now()
  WHERE id = v_app.user_id;

  -- 5. Mark application approved
  UPDATE public.client_applications
  SET status = 'approved',
      assigned_workspace_id = p_workspace_id,
      assigned_ybs_trainer_id = p_trainer_id,
      created_client_id = v_client_id,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      updated_at = now()
  WHERE id = p_application_id;

  -- 6. Immutable audit log
  INSERT INTO public.audit_logs (
    actor_id,
    actor_name,
    actor_role,
    action,
    entity_type,
    entity_id,
    entity_name,
    workspace_id,
    metadata
  )
  VALUES (
    auth.uid(),
    'Platform Owner',
    'platform_owner',
    'client_application_approved',
    'client_application',
    p_application_id::text,
    v_app.applicant_name,
    p_workspace_id,
    jsonb_build_object(
      'client_id', v_client_id,
      'client_code', v_code,
      'trainer_id', p_trainer_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'client_id', v_client_id,
    'client_code', v_code
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_client_application FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_client_application TO authenticated;

-- 4. Rejection Workflow
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

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, metadata
  )
  VALUES (
    auth.uid(), 'Platform Owner', 'platform_owner', 'client_application_rejected',
    'client_application', p_application_id::text, v_app.applicant_name,
    jsonb_build_object('reason', p_reason)
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_client_application FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_client_application TO authenticated;

-- 5. Platform Owner Provisioning / Role Confirmation
CREATE OR REPLACE FUNCTION public.ensure_platform_owner(p_email TEXT, p_phone TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
BEGIN
  -- Look up user in auth.users by email
  SELECT id, email INTO v_user FROM auth.users WHERE email = lower(trim(p_email));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'No auth.users record found for email: ' || p_email || '. User must be registered in Supabase Auth first.');
  END IF;

  -- Upsert profile with platform_owner role and active status
  INSERT INTO public.profiles (
    id, email, phone, full_name, platform_role, account_status
  )
  VALUES (
    v_user.id,
    v_user.email,
    p_phone,
    'Platform Owner',
    'platform_owner',
    'active'
  )
  ON CONFLICT (id) DO UPDATE SET
    platform_role = 'platform_owner',
    account_status = 'active',
    phone = COALESCE(p_phone, public.profiles.phone),
    updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user.id,
    'email', v_user.email,
    'platform_role', 'platform_owner',
    'account_status', 'active'
  );
END;
$$;

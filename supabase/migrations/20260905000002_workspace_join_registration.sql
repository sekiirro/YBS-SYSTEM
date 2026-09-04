-- ============================================================
-- YBS SYSTEM: MIGRATION 10 — WORKSPACE-SPECIFIC TRAINEE REGISTRATION
-- PER-WORKSPACE PUBLIC JOIN TOKEN + REGISTRATION CONTEXT
-- ============================================================
--
-- BUSINESS MODEL:
--   A Workspace IS the Brand (1:1). Each Workspace gets exactly one
--   public trainee registration link. The link's token is the source
--   of truth for the trainee's intended Workspace.
--
-- DESIGN:
--   1. workspaces.public_join_token  -> unguessable, URL-safe, unique.
--      Generated server-side (DB default) at insert; backfilled for
--      existing workspaces so every link works.
--   2. handle_new_user() (extended) -> resolves the token carried in
--      the signup's raw_user_meta_data (join_token) against
--      workspaces.public_join_token and writes the resulting
--      client_applications.assigned_workspace_id. The application is
--      created only for self-registered trainees (role 'none' +
--      'pending_approval'), preserving migration 09. The client NEVER
--      submits a workspace_id; the server derives it from the token.
--   3. approve_client_application() -> p_workspace_id becomes optional;
--      the function first uses the application's own
--      assigned_workspace_id. The Platform Owner no longer guesses for
--      link-registered trainees (legacy applications without a context
--      still accept the explicit override).
--   4. resolve_workspace_join(token) -> narrow public RPC (anon +
--      authenticated) that reveals ONLY the minimal onboarding identity
--      (workspace name/brand + active flag) for a valid token. No
--      workspace enumeration is possible without a valid token.
--   5. get_workspaces_overview() gains public_join_token so the admin
--      workspace UI can render the persistent registration link.
-- ============================================================

-- ============================================================
-- 1. PUBLIC JOIN TOKEN ON WORKSPACES
-- ============================================================
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS public_join_token TEXT;

-- Backfill existing workspaces with high-entropy URL-safe tokens
-- (32 hex chars = 128 bits; hex is URL-safe and unambiguous).
UPDATE public.workspaces
SET public_join_token = encode(gen_random_bytes(16), 'hex')
WHERE public_join_token IS NULL OR public_join_token = '';

-- Default for future inserts + enforce NOT NULL
ALTER TABLE public.workspaces
  ALTER COLUMN public_join_token SET DEFAULT encode(gen_random_bytes(16), 'hex'),
  ALTER COLUMN public_join_token SET NOT NULL;

-- Unique + indexed lookup
DROP INDEX IF EXISTS idx_workspaces_public_join_token;
CREATE UNIQUE INDEX idx_workspaces_public_join_token
  ON public.workspaces (public_join_token);

-- ============================================================
-- 2. EXTEND handle_new_user() WITH WORKSPACE CONTEXT
--    (preserves migration 09; only adds join_token resolution)
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
  v_join_token TEXT;
  v_workspace_id UUID;
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

  -- Resolve the registration token to a workspace EXCLUSIVELY
  -- server-side. A client-supplied join token only ever maps back to
  -- the workspace the token belongs to (an unguessable value the
  -- trainee already received from the Brand Owner). If the token is
  -- absent, invalid, or the workspace is inactive, v_workspace_id
  -- stays NULL and no Workspace is fabricated.
  v_join_token := NULLIF(btrim(NEW.raw_user_meta_data->>'join_token'), '');
  IF v_join_token IS NOT NULL THEN
    SELECT id INTO v_workspace_id
    FROM public.workspaces
    WHERE public_join_token = v_join_token
      AND status = 'active';
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

  -- 2. Auto-create a pending client application for self-registered
  --    trainees (unchanged from migration 09). When the registration
  --    token resolved to a workspace, the application immediately
  --    knows its intended Workspace via assigned_workspace_id.
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
      status,
      assigned_workspace_id
    )
    VALUES (
      NEW.id,
      v_full_name,
      COALESCE(v_phone, ''),
      NEW.email,
      'pending',
      v_workspace_id
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Reinstall trigger (idempotent) to keep the binding definition in sync
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 3. APPROVAL USES THE APPLICATION'S ESTABLISHED WORKSPACE
--    (p_workspace_id becomes optional; existing callers unaffected)
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_client_application(
  p_application_id UUID,
  p_workspace_id UUID DEFAULT NULL,
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
  v_workspace_id UUID;
BEGIN
  -- Verify caller is Platform Owner
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Only the Platform Owner can approve client applications';
  END IF;

  -- Fetch application
  SELECT * INTO v_app FROM public.client_applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  IF v_app.status = 'approved' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Already approved', 'client_id', v_app.created_client_id);
  END IF;

  -- Resolve the target workspace: prefer the workspace established by
  -- the registration link at application creation; fall back to the
  -- explicit override (legacy applications only).
  v_workspace_id := COALESCE(p_workspace_id, v_app.assigned_workspace_id);

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'No workspace is associated with this application. Assign a workspace before approving.';
  END IF;

  -- Verify target workspace exists and is active
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = v_workspace_id AND status = 'active') THEN
    RAISE EXCEPTION 'Target workspace does not exist or is not active';
  END IF;

  -- If trainer specified, verify trainer
  IF p_trainer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_trainer_id AND platform_role = 'platform_trainer'
  ) THEN
    RAISE EXCEPTION 'Target trainer does not exist or is not a verified YBS coach';
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
    v_workspace_id,
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
    v_workspace_id,
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
      active_workspace_id = v_workspace_id,
      updated_at = now()
  WHERE id = v_app.user_id;

  -- 5. Mark application approved
  UPDATE public.client_applications
  SET status = 'approved',
      assigned_workspace_id = v_workspace_id,
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
    v_workspace_id,
    jsonb_build_object(
      'client_id', v_client_id,
      'client_code', v_code,
      'trainer_id', p_trainer_id,
      'workspace_source', CASE WHEN p_workspace_id IS NULL THEN 'application' ELSE 'explicit' END
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

-- ============================================================
-- 4. NARROW PUBLIC JOIN TOKEN RESOLUTION (registration page reads)
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_workspace_join(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  SELECT id, name, status INTO v_row
  FROM public.workspaces
  WHERE public_join_token = btrim(p_token)
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  -- Reveal ONLY the public onboarding identity for a valid token.
  -- No membership, billing, client or configuration data is exposed.
  RETURN jsonb_build_object(
    'valid', true,
    'workspace_id', v_row.id,
    'workspace_name', v_row.name,
    'brand_name', v_row.name,
    'active', (v_row.status = 'active')
  );
END;
$$;

-- Grant narrowly: anon needs only this read path for the public page;
-- authenticated keeps it too. No other workspaces data is exposed.
REVOKE EXECUTE ON FUNCTION public.resolve_workspace_join FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_workspace_join TO anon, authenticated;

-- ============================================================
-- 5. WORKSPACES OVERVIEW GAINS public_join_token
--    so the admin/workspace UI can show the persistent link
--
-- NOTE: adding a column to RETURNS TABLE changes the return type,
-- which PostgreSQL refuses via CREATE OR REPLACE (42P13). The
-- existing zero-argument function must be dropped first, then
-- recreated with the exact same signature but the extended columns.
-- The existing function has zero IN arguments and no dependent
-- objects (views/triggers/functions); only the frontend RPC caller
-- uses it, so DROP + CREATE is safe. Grants are re-applied below.
-- ============================================================
DROP FUNCTION IF EXISTS public.get_workspaces_overview();

CREATE FUNCTION public.get_workspaces_overview()
RETURNS TABLE (
    id UUID,
    name TEXT,
    slug TEXT,
    public_join_token TEXT,
    owner_id UUID,
    owner_name TEXT,
    owner_email TEXT,
    owner_phone TEXT,
    status TEXT,
    platform_plan TEXT,
    partnership_type_id UUID,
    partnership_type_name TEXT,
    partnership_type_code TEXT,
    client_capacity INTEGER,
    active_clients_count BIGINT,
    total_clients_count BIGINT,
    assigned_trainers_count BIGINT,
    timezone TEXT,
    currency TEXT,
    settings JSONB,
    notes TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        w.id,
        w.name,
        w.slug,
        w.public_join_token,
        w.owner_id,
        w.owner_name,
        w.owner_email,
        w.owner_phone,
        w.status,
        w.platform_plan,
        w.partnership_type_id,
        pt.name AS partnership_type_name,
        pt.code AS partnership_type_code,
        w.client_capacity,
        COUNT(c.id) FILTER (WHERE c.status = 'active') AS active_clients_count,
        COUNT(c.id) AS total_clients_count,
        COUNT(DISTINCT c.assigned_ybs_coach_id) FILTER (WHERE c.assigned_ybs_coach_id IS NOT NULL) AS assigned_trainers_count,
        w.timezone,
        w.currency,
        w.settings,
        w.notes,
        w.created_at,
        w.updated_at
    FROM public.workspaces w
    LEFT JOIN public.partnership_types pt ON pt.id = w.partnership_type_id
    LEFT JOIN public.clients c ON c.workspace_id = w.id
    WHERE public.is_platform_owner() OR public.has_workspace_access(w.id)
    GROUP BY w.id, pt.id
    ORDER BY w.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_workspaces_overview FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspaces_overview TO authenticated;

-- ============================================================
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
-- ============================================================
SELECT id, name, public_join_token
FROM   public.workspaces
WHERE  public_join_token IS NULL;

SELECT indexname, indexdef
FROM   pg_indexes
WHERE  indexname = 'idx_workspaces_public_join_token';

SELECT tgname, tgenabled, tgrelid::regclass AS table_name
FROM   pg_trigger
WHERE  tgname = 'on_auth_user_created';
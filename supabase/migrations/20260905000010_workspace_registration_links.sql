-- ============================================================
-- YBS SYSTEM: MIGRATION 13 — TRAINER CLIENT REGISTRATION LINKS
-- FOUR PER-WORKSPACE PACKAGE-SCOPED CLIENT REGISTRATION LINKS
-- ============================================================
--
-- BUSINESS MODEL:
--   Each Workspace (Brand) offers exactly four persistent client
--   registration links, one per standard package:
--       Silver — 1 Month, Silver — 3 Months, Gold — 1 Month, Gold — 3 Months
--   Each link is permanently scoped to:
--       * Workspace
--       * Trainer/Coach (workspaces.assigned_coach_id, a YBS platform trainer)
--       * Package tier (silver | gold)
--       * Package duration (1 month | 3 months)
--   The link's token is the ONLY thing a trainee ever carries. All
--   workspace / coach / package values are resolved SERVER-SIDE from
--   the workspace_registration_links row, so no browser-provided value
--   can redirect a registration.
--
-- DESIGN (reuses existing architecture, no parallel systems):
--   1. workspaces.assigned_coach_id      -> the workspace's YBS trainer
--      (profiles.platform_role = 'platform_trainer'). Matches the
--      existing clients.assigned_ybs_coach_id relationship used across
--      the app for coach scoping.
--   2. workspace_registration_links      -> one row per (workspace,
--      tier, duration). Token is DB-generated (replace(gen_random_uuid()::text,'-',''))
--      exactly like workspaces.public_join_token (migration 10).
--      package_id references the WORKSPACE-OWNED package cloned from
--      the global defaults (migration 05 clone_default_packages_for_workspace).
--   3. provision_workspace_registration_links(p_workspace_id)
--      -> idempotent AFTER INSERT trigger on workspaces; also used to
--      re-bake coach/package changes and to backfill existing workspaces.
--   4. resolve_registration_link(token)  -> narrow public RPC (anon +
--      authenticated) exposing ONLY the onboarding identity + the chosen
--      package/tier for the page header. No enumeration.
--   5. handle_new_user()  -> extends registration context with
--      link_token resolution; sets client_applications.assigned_workspace_id,
--      assigned_ybs_trainer_id and assigned_package_id server-side.
--   6. approve_client_application()      -> COALESCE's the resolved
--      trainer/package from the application, creates the subscription
--      and denormalized client package fields, keeping the existing
--      approval flow intact (legacy p_workspace_id override retained).
-- ============================================================

-- ============================================================
-- 1. WORKSPACE TRAINER/COACH (reuses the existing YBS coach model)
-- ============================================================
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS assigned_coach_id UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workspaces_assigned_coach_id
  ON public.workspaces(assigned_coach_id);

-- ============================================================
-- 2. WORKSPACE REGISTRATION LINKS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workspace_registration_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    coach_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    package_id UUID REFERENCES public.packages(id) ON DELETE SET NULL,
    tier TEXT NOT NULL CHECK (tier IN ('silver', 'gold')),
    duration_months INTEGER NOT NULL CHECK (duration_months IN (1, 3)),
    label TEXT NOT NULL,
    token TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, tier, duration_months)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_registration_links_token
  ON public.workspace_registration_links (token);

CREATE INDEX IF NOT EXISTS idx_workspace_registration_links_workspace
  ON public.workspace_registration_links (workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_registration_links_coach
  ON public.workspace_registration_links (coach_id);

-- RLS: the table is READ by the admin/workspace-owner UI through the
-- get_workspace_registration_links RPC and WRITTEN exclusively through
-- SECURITY DEFINER functions (trigger + assign_workspace_coach). A
-- SELECT policy is added for defense in depth; no direct writes exist.
ALTER TABLE public.workspace_registration_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_registration_links_select" ON public.workspace_registration_links;
CREATE POLICY "workspace_registration_links_select" ON public.workspace_registration_links
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
);

-- ============================================================
-- 3. PROVISION THE FOUR LINKS (idempotent, reused by trigger/RPC/backfill)
-- ============================================================
CREATE OR REPLACE FUNCTION public.provision_workspace_registration_links(p_workspace_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provisioned INTEGER := 0;
  v_coach_id UUID;
  v_pkg_id UUID;
  v_link RECORD;
BEGIN
  IF p_workspace_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Reuse the existing package provisioning so every workspace owns its
  -- own copies of the standard package catalog (idempotent by design).
  PERFORM public.clone_default_packages_for_workspace(p_workspace_id);

  SELECT assigned_coach_id INTO v_coach_id
  FROM public.workspaces
  WHERE id = p_workspace_id;

  FOR v_link IN
    SELECT 'silver'::text AS tier, 1::integer AS duration_months
    UNION ALL SELECT 'silver', 3
    UNION ALL SELECT 'gold', 1
    UNION ALL SELECT 'gold', 3
  LOOP
    SELECT id INTO v_pkg_id
    FROM public.packages
    WHERE workspace_id = p_workspace_id
      AND tier = v_link.tier
      AND duration = v_link.duration_months
      AND duration_unit = 'months'
      AND is_active = true
    LIMIT 1;

    INSERT INTO public.workspace_registration_links (
      workspace_id,
      coach_id,
      package_id,
      tier,
      duration_months,
      label,
      is_active
    )
    VALUES (
      p_workspace_id,
      v_coach_id,
      v_pkg_id,
      v_link.tier,
      v_link.duration_months,
      (CASE WHEN v_link.tier = 'silver' THEN 'Silver' ELSE 'Gold' END)
        || ' — ' || v_link.duration_months
        || ' Month' || CASE WHEN v_link.duration_months > 1 THEN 's' ELSE '' END,
      true
    )
    ON CONFLICT (workspace_id, tier, duration_months) DO UPDATE SET
      coach_id = EXCLUDED.coach_id,
      package_id = EXCLUDED.package_id,
      label = EXCLUDED.label,
      is_active = true,
      updated_at = now();

    v_provisioned := v_provisioned + 1;
  END LOOP;

  RETURN v_provisioned;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.provision_workspace_registration_links FROM PUBLIC;

-- Trigger body: AFTER INSERT on workspaces (runs AFTER the default
-- package provisioning trigger because it first calls the idempotent
-- clone helper, and registration links must exist the moment a
-- workspace row is returned to the creator).
CREATE OR REPLACE FUNCTION public.provision_workspace_registration_links_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.provision_workspace_registration_links(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.provision_workspace_registration_links_trigger FROM PUBLIC;

DROP TRIGGER IF EXISTS trigger_provision_workspace_registration_links ON public.workspaces;
CREATE TRIGGER trigger_provision_workspace_registration_links
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.provision_workspace_registration_links_trigger();

-- Backfill every existing workspace (idempotent) so all current brands
-- immediately get their four links without any manual step.
DO $$
DECLARE
  r RECORD;
  v_count INTEGER;
BEGIN
  FOR r IN SELECT id FROM public.workspaces LOOP
    SELECT public.provision_workspace_registration_links(r.id) INTO v_count;
  END LOOP;
END $$;

-- ============================================================
-- 4. NARROW PUBLIC RESOLUTION (registration page)
--    Reveals ONLY onboarding identity + the chosen package for a valid
--    token — a superset of resolve_workspace_join(join_token) fields.
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_registration_link(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link RECORD;
  v_ws_status TEXT;
  v_ws_name TEXT;
  v_reg_enabled BOOLEAN;
  v_pkg_name TEXT;
  v_coach_name TEXT;
BEGIN
  SELECT id, workspace_id, coach_id, package_id, tier, duration_months, is_active
    INTO v_link
  FROM public.workspace_registration_links
  WHERE token = btrim(p_token)
  LIMIT 1;

  IF v_link.id IS NULL THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  SELECT w.status, w.name,
         COALESCE((w.settings->>'registration_enabled')::boolean, true)
    INTO v_ws_status, v_ws_name, v_reg_enabled
  FROM public.workspaces w
  WHERE w.id = v_link.workspace_id;

  IF v_ws_status IS NULL THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  SELECT name INTO v_pkg_name
  FROM public.packages
  WHERE id = v_link.package_id AND is_active = true;

  SELECT full_name INTO v_coach_name
  FROM public.profiles
  WHERE id = v_link.coach_id
    AND platform_role = 'platform_trainer'
    AND account_status = 'active';

  RETURN jsonb_build_object(
    'valid', true,
    'link_id', v_link.id,
    'workspace_id', v_link.workspace_id,
    'workspace_name', v_ws_name,
    'brand_name', v_ws_name,
    'coach_id', v_link.coach_id,
    'coach_name', v_coach_name,
    'package_id', v_link.package_id,
    'package_name', v_pkg_name,
    'package_tier', v_link.tier,
    'package_duration', v_link.duration_months,
    'package_duration_unit', 'months',
    'active', (v_ws_status = 'active' AND v_link.is_active),
    'registration_enabled', v_reg_enabled
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_registration_link FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_registration_link TO anon, authenticated;

-- ============================================================
-- 5. ADMIN / WORKSPACE-OWNER READ RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_workspace_registration_links(p_workspace_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_links JSONB;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'A workspace is required';
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_workspace_owner(p_workspace_id)) THEN
    RAISE EXCEPTION 'Not authorized to view registration links for this workspace.';
  END IF;

  -- Ensure the four links exist (covers any old or partially-provisioned
  -- workspace) without rotating existing tokens.
  PERFORM public.provision_workspace_registration_links(p_workspace_id);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'token', l.token,
        'tier', l.tier,
        'duration_months', l.duration_months,
        'label', l.label,
        'is_active', l.is_active,
        'coach_id', l.coach_id,
        'coach_name', pc.full_name,
        'coach_email', pc.email,
        'package_id', l.package_id,
        'package_name', pkg.name,
        'package_price', pkg.price,
        'package_currency', pkg.currency
      )
      ORDER BY l.tier, l.duration_months
    ),
    '[]'::jsonb
  ) INTO v_links
  FROM public.workspace_registration_links l
  LEFT JOIN public.profiles pc ON pc.id = l.coach_id
  LEFT JOIN public.packages pkg ON pkg.id = l.package_id
  WHERE l.workspace_id = p_workspace_id;

  RETURN v_links;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_workspace_registration_links FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspace_registration_links TO authenticated;

-- ============================================================
-- 6. ASSIGN / CHANGE THE WORKSPACE COACH (re-bakes the four links)
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_workspace_coach(p_workspace_id UUID, p_coach_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'A workspace is required';
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_workspace_owner(p_workspace_id)) THEN
    RAISE EXCEPTION 'Not authorized to assign a coach to this workspace.';
  END IF;

  IF p_coach_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_coach_id
      AND platform_role = 'platform_trainer'
      AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'The selected coach is not an active YBS platform trainer.';
  END IF;

  UPDATE public.workspaces
  SET assigned_coach_id = p_coach_id,
      updated_at = now()
  WHERE id = p_workspace_id;

  PERFORM public.provision_workspace_registration_links(p_workspace_id);

  RETURN jsonb_build_object('success', true, 'workspace_id', p_workspace_id, 'coach_id', p_coach_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_workspace_coach FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_workspace_coach TO authenticated;

-- ============================================================
-- 7. CLIENT APPLICATION GAINS THE RESOLVED PACKAGE
-- ============================================================
ALTER TABLE public.client_applications
  ADD COLUMN IF NOT EXISTS assigned_package_id UUID
    REFERENCES public.packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_applications_assigned_package_id
  ON public.client_applications(assigned_package_id);

-- Client-initiated inserts may not carry server-assigned scoping fields.
DROP POLICY IF EXISTS "applications_insert" ON public.client_applications;
CREATE POLICY "applications_insert" ON public.client_applications
FOR INSERT TO authenticated
WITH CHECK (
  user_id = (select auth.uid())
  AND status = 'pending'
  AND assigned_workspace_id IS NULL
  AND assigned_ybs_trainer_id IS NULL
  AND assigned_package_id IS NULL
  AND created_client_id IS NULL
);

-- Applicants may only respond to more-info requests; scoping fields stay locked.
DROP POLICY IF EXISTS "applications_update_applicant" ON public.client_applications;
CREATE POLICY "applications_update_applicant" ON public.client_applications
FOR UPDATE TO authenticated
USING (
  user_id = (select auth.uid())
  AND status = 'more_info_required'
)
WITH CHECK (
  user_id = (select auth.uid())
  AND status IN ('under_review', 'more_info_required')
  AND assigned_workspace_id IS NULL
  AND assigned_ybs_trainer_id IS NULL
  AND assigned_package_id IS NULL
  AND created_client_id IS NULL
);

-- ============================================================
-- 8. handle_new_user(): server-side link resolution
--    (superset of migration 12 — adds link_token resolution to the
--    existing join_token path; both resolve ONLY against trusted DB rows)
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
  v_link_token TEXT;
  v_workspace_id UUID;
  v_coach_id UUID;
  v_package_id UUID;
  v_link RECORD;
  v_is_provisioned BOOLEAN;
  v_invite RECORD;
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

  -- Trusted server-side invite lookup (unchanged from migration 12).
  SELECT ir.id, ir.role INTO v_invite
  FROM public.platform_invites ir
  WHERE lower(btrim(ir.email)) = lower(btrim(NEW.email))
    AND ir.status <> 'revoked'
  ORDER BY ir.created_at DESC
  LIMIT 1;

  IF v_invite.id IS NOT NULL THEN
    v_platform_role := v_invite.role;
    v_account_status := 'active';

    UPDATE public.platform_invites
    SET status = 'accepted', updated_at = now()
    WHERE id = v_invite.id;
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

  -- ================================================================
  -- Registration context resolution — EXCLUSIVELY server-side, from the
  -- trusted DB configuration. A browser/client can only ever supply a
  -- token; workspace, coach and package are derived from the matching
  -- workspace_registration_links row (or legacy workspaces token).
  -- ================================================================
  v_link_token := NULLIF(btrim(NEW.raw_user_meta_data->>'link_token'), '');
  IF v_link_token IS NOT NULL THEN
    -- New style: registration link row = workspace + coach + package.
    SELECT l.workspace_id, l.coach_id, l.package_id
      INTO v_workspace_id, v_coach_id, v_package_id
    FROM public.workspace_registration_links l
    JOIN public.workspaces w ON w.id = l.workspace_id
    WHERE l.token = v_link_token
      AND l.is_active = true
      AND w.status = 'active'
      AND COALESCE((w.settings->>'registration_enabled')::boolean, true) = true;
  END IF;

  IF v_link_token IS NULL AND v_workspace_id IS NULL THEN
    -- Legacy style: single workspace join token (workspace only).
    v_join_token := NULLIF(btrim(NEW.raw_user_meta_data->>'join_token'), '');
    IF v_join_token IS NOT NULL THEN
      SELECT id INTO v_workspace_id
      FROM public.workspaces
      WHERE public_join_token = v_join_token
        AND status = 'active'
        AND COALESCE((settings->>'registration_enabled')::boolean, true) = true;
    END IF;
  END IF;

  -- ================================================================
  -- ADMIN-PROVISIONED ACCOUNT DETECTION (unchanged from migration 12)
  -- ================================================================
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_memberships wm
    WHERE wm.user_id = NEW.id
      AND wm.status = 'active'
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = NEW.id
      AND p.platform_role IN ('platform_owner', 'platform_trainer')
  ) OR EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE lower(btrim(w.owner_email)) = lower(btrim(NEW.email))
  ) OR (v_invite.id IS NOT NULL)
  INTO v_is_provisioned;

  -- 2. Auto-create a pending client application for genuine trainees
  --    carrying the server-resolved workspace / coach / package.
  IF
    v_platform_role = 'none'
    AND v_account_status = 'pending_approval'
    AND NOT v_is_provisioned
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
      assigned_workspace_id,
      assigned_ybs_trainer_id,
      assigned_package_id
    )
    VALUES (
      NEW.id,
      v_full_name,
      COALESCE(v_phone, ''),
      NEW.email,
      'pending',
      v_workspace_id,
      v_coach_id,
      v_package_id
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Reinstall trigger (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 9. APPROVAL USES THE RESOLVED TRAINER + PACKAGE
--    (p_workspace_id/p_trainer_id remain backward compatible; a new
--     optional p_package_id lets the admin adjust a link-assigned package)
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_client_application(
  p_application_id UUID,
  p_workspace_id UUID DEFAULT NULL,
  p_trainer_id UUID DEFAULT NULL,
  p_package_id UUID DEFAULT NULL
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
  v_trainer_id UUID;
  v_package_id UUID;
  v_pkg RECORD;
  v_start_date DATE;
  v_end_date DATE;
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

  -- Resolve target workspace: prefer the workspace established by the
  -- registration link at application creation; fall back to the explicit
  -- override (legacy applications only).
  v_workspace_id := COALESCE(p_workspace_id, v_app.assigned_workspace_id);

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'No workspace is associated with this application. Assign a workspace before approving.';
  END IF;

  -- Verify target workspace exists and is active
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = v_workspace_id AND status = 'active') THEN
    RAISE EXCEPTION 'Target workspace does not exist or is not active';
  END IF;

  -- Trainer: explicit admin choice wins, otherwise the coach the trainee
  -- registered through (server-resolved link configuration) is used.
  v_trainer_id := COALESCE(p_trainer_id, v_app.assigned_ybs_trainer_id);

  IF v_trainer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_trainer_id
      AND platform_role = 'platform_trainer'
      AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Target trainer does not exist or is not an active YBS coach';
  END IF;

  -- Package: explicit admin choice wins, otherwise the package the
  -- trainee's registration link resolved to (server-side).
  v_package_id := COALESCE(p_package_id, v_app.assigned_package_id);

  IF v_package_id IS NOT NULL THEN
    SELECT * INTO v_pkg FROM public.packages
    WHERE id = v_package_id
      AND workspace_id = v_workspace_id
      AND is_active = true;

    IF v_pkg.id IS NULL THEN
      RAISE EXCEPTION 'The selected package does not belong to this workspace or is not active.';
    END IF;

    v_start_date := CURRENT_DATE;
    v_end_date := v_start_date + CASE v_pkg.duration_unit
      WHEN 'days' THEN make_interval(days => v_pkg.duration)
      WHEN 'weeks' THEN make_interval(weeks => v_pkg.duration)
      ELSE make_interval(months => v_pkg.duration)
    END;
  END IF;

  -- Generate unique client code YBS-XXXX
  LOOP
    v_random := 1000 + floor(random() * 9000)::int;
    v_code := 'YBS-' || v_random::text;
    SELECT count(*) INTO v_count FROM public.clients WHERE client_code = v_code;
    EXIT WHEN v_count = 0;
  END LOOP;

  -- 1. Create client record (package denormalized when a package is linked)
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
    subscription_status,
    subscription_end_date,
    package_name
  )
  VALUES (
    v_workspace_id,
    v_app.user_id,
    v_code,
    v_app.applicant_name,
    v_app.applicant_email,
    v_app.applicant_phone,
    v_trainer_id,
    CURRENT_DATE,
    'active',
    CASE WHEN v_package_id IS NOT NULL THEN 'active' ELSE 'no_subscription' END,
    v_end_date,
    v_pkg.name
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

  -- 3. Create the subscription ledger row for package-scoped links.
  --    Keeps the existing subscriptions table as the single source of
  --    truth for billing/expiry (columns + conventions preserved).
  IF v_package_id IS NOT NULL THEN
    INSERT INTO public.subscriptions (
      workspace_id,
      client_id,
      package_id,
      package_name,
      price,
      currency,
      payment_status,
      start_date,
      end_date,
      status
    )
    VALUES (
      v_workspace_id,
      v_client_id,
      v_package_id,
      v_pkg.name,
      v_pkg.price,
      v_pkg.currency,
      'unpaid',
      v_start_date,
      v_end_date,
      'active'
    );
  END IF;

  -- 4. If trainer assigned (link coach or admin choice), record allocation history
  IF v_trainer_id IS NOT NULL THEN
    INSERT INTO public.client_ybs_trainer_assignments (
      client_id,
      trainer_id,
      assigned_by,
      assigned_at,
      is_active
    )
    VALUES (
      v_client_id,
      v_trainer_id,
      auth.uid(),
      now(),
      true
    );
  END IF;

  -- 5. Activate user profile and bind active workspace
  UPDATE public.profiles
  SET account_status = 'active',
      active_workspace_id = v_workspace_id,
      updated_at = now()
  WHERE id = v_app.user_id;

  -- 6. Mark application approved
  UPDATE public.client_applications
  SET status = 'approved',
      assigned_workspace_id = v_workspace_id,
      assigned_ybs_trainer_id = v_trainer_id,
      assigned_package_id = v_package_id,
      created_client_id = v_client_id,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      updated_at = now()
  WHERE id = p_application_id;

  -- 7. Immutable audit log
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
      'trainer_id', v_trainer_id,
      'package_id', v_package_id,
      'workspace_source', CASE WHEN p_workspace_id IS NULL THEN 'application' ELSE 'explicit' END,
      'trainer_source', CASE WHEN p_trainer_id IS NULL THEN 'application' ELSE 'explicit' END,
      'package_source', CASE WHEN p_package_id IS NULL THEN 'application' ELSE 'explicit' END
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'client_id', v_client_id,
    'client_code', v_code
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_client_application(UUID, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_client_application(UUID, UUID, UUID, UUID) TO authenticated;

-- ============================================================
-- 10. WORKSPACES OVERVIEW GAINS THE ASSIGNED COACH
--     (DROP + CREATE required: RETURNS TABLE changed signatures)
--
--     NOTE: existing function has zero IN arguments and no dependent
--     objects; only the frontend RPC caller uses it, so DROP + CREATE
--     is safe (same pattern as migration 10).
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
    assigned_coach_id UUID,
    assigned_coach_name TEXT,
    assigned_coach_email TEXT,
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
        w.assigned_coach_id,
        ac.full_name AS assigned_coach_name,
        ac.email AS assigned_coach_email,
        w.timezone,
        w.currency,
        w.settings,
        w.notes,
        w.created_at,
        w.updated_at
    FROM public.workspaces w
    LEFT JOIN public.partnership_types pt ON pt.id = w.partnership_type_id
    LEFT JOIN public.clients c ON c.workspace_id = w.id
    LEFT JOIN public.profiles ac ON ac.id = w.assigned_coach_id
    WHERE public.is_platform_owner() OR public.has_workspace_access(w.id)
    GROUP BY w.id, pt.id, ac.id
    ORDER BY w.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_workspaces_overview FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspaces_overview TO authenticated;

-- ============================================================
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
-- ============================================================
SELECT w.name AS workspace_name,
       l.tier,
       l.duration_months,
       l.label,
       l.package_id,
       l.coach_id
FROM   public.workspace_registration_links l
JOIN   public.workspaces w ON w.id = l.workspace_id
ORDER  BY w.name, l.tier, l.duration_months;

SELECT w.name AS workspace_name, w.assigned_coach_id
FROM   public.workspaces w
WHERE  w.assigned_coach_id IS NOT NULL;

SELECT tgname, tgenabled, tgrelid::regclass AS table_name
FROM   pg_trigger
WHERE  tgname IN ('trigger_provision_workspace_registration_links', 'on_auth_user_created');

SELECT proname, proowner::regrole, prosecdef
FROM   pg_proc
WHERE  proname IN ('provision_workspace_registration_links', 'resolve_registration_link', 'get_workspace_registration_links', 'assign_workspace_coach');
-- ============================================================
-- Migration 20260906000002: Workspace roles, active-workspace RLS
-- isolation, approval-vs-activation lifecycle, role default
-- permissions, and automatic intake assignment on approval.
--
-- This is the PASS 1 backend for the "Workspace Roles & Lifecycle"
-- batch. It does NOT rewrite the existing RLS helper functions'
-- signatures or the approve_client_application() body; lifecycle
-- changes ride on a guarded AFTER trigger instead so the approval
-- RPC keeps its exact contract.
-- ============================================================

-- ============================================================
-- SECTION A: WORKSPACE ROLES (trainer / sales)
-- ============================================================
-- workspace_memberships.workspace_role currently only allows
-- ('workspace_owner', 'client'). Workspace-scoped staff (YBS
-- trainers attached to a workspace, sales representatives) need
-- first-class roles that carry their own permission sets.
ALTER TABLE public.workspace_memberships
  DROP CONSTRAINT IF EXISTS workspace_memberships_workspace_role_check;

ALTER TABLE public.workspace_memberships
  ADD CONSTRAINT workspace_memberships_workspace_role_check
  CHECK (workspace_role IN ('workspace_owner', 'trainer', 'sales', 'client'));

-- ============================================================
-- SECTION B: ACTIVE-WORKSPACE RLS ISOLATION
-- ============================================================
-- The Workspace Switcher persists the member's CURRENT workspace in
-- profiles.active_workspace_id. Data access for membership-based
-- roles is performed against the caller's ACTIVE workspace only:
-- a trainer / sales rep / client who belongs to several workspaces
-- can never see rows from a workspace they are not currently
-- switched into. Workspace OWNERS and the Platform Owner keep their
-- existing multi-workspace visibility (owner-global admin views).

-- 1. Backfill: give every active member a stable active_workspace_id
--    (first active membership) so the NEW gating never hides their data.
UPDATE public.profiles p
SET active_workspace_id = (
  SELECT wm.workspace_id
  FROM public.workspace_memberships wm
  WHERE wm.user_id = p.id
    AND wm.status = 'active'
  ORDER BY wm.created_at ASC
  LIMIT 1
)
WHERE p.active_workspace_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    WHERE wm.user_id = p.id
      AND wm.status = 'active'
  );

-- 2. New helper: caller is an ACTIVE member of ws_id AND ws_id is
--    their currently-active workspace.
CREATE OR REPLACE FUNCTION public.is_active_workspace_member(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_memberships wm
    JOIN public.profiles p ON p.id = wm.user_id
    WHERE wm.workspace_id = ws_id
      AND wm.user_id = (select auth.uid())
      AND wm.status = 'active'
      AND p.active_workspace_id = ws_id
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_active_workspace_member FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_workspace_member TO authenticated;

-- 3. Rebuild has_workspace_access so membership-based access (used by
--    packages, templates, foods, exercises and plan template SELECTs)
--    is gated by both an active membership AND the caller's current
--    active workspace. The workspace-owner path passes unconditionally
--    (owner visibility is already intentional), and a new 'staff'
--    min_role covers trainer/sales members.
CREATE OR REPLACE FUNCTION public.has_workspace_access(ws_id UUID, min_role TEXT DEFAULT 'client')
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_memberships wm
    JOIN public.workspaces w ON w.id = wm.workspace_id
    JOIN public.profiles p ON p.id = wm.user_id
    WHERE wm.user_id = (select auth.uid())
      AND wm.workspace_id = ws_id
      AND wm.status = 'active'
      AND w.status = 'active'
      AND (
        wm.workspace_role = 'workspace_owner'
        OR (
          p.active_workspace_id = ws_id
          AND (
            min_role = 'client'
            OR (min_role = 'staff' AND wm.workspace_role IN ('trainer', 'sales'))
            OR (min_role = 'owner' AND wm.workspace_role = 'workspace_owner')
          )
        )
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_workspace_access FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_workspace_access TO authenticated;

-- ============================================================
-- SECTION C: ROLE DEFAULT PERMISSIONS
-- ============================================================
-- Canonical default permission lists per workspace role. These are
-- applied automatically when a membership is created (or when a
-- member is promoted/demoted) with an empty permission array, so the
-- new trainer/sales roles are immediately usable and existing roles
-- stay consistent.
CREATE OR REPLACE FUNCTION public.default_role_permissions(p_role TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_role
    WHEN 'workspace_owner' THEN ARRAY[
      'clients.view', 'clients.create', 'clients.update', 'clients.delete', 'clients.assign', 'clients.reassign',
      'subscriptions.view', 'subscriptions.create', 'subscriptions.update', 'subscriptions.freeze', 'subscriptions.cancel',
      'assessments.view', 'assessments.create', 'assessments.update', 'assessments.review', 'assessments.assign',
      'metrics.view', 'metrics.update', 'nutrition.view', 'nutrition.create', 'nutrition.update', 'nutrition.fooddb',
      'workouts.view', 'workouts.create', 'workouts.update', 'workouts.exercise', 'team.view', 'team.manage',
      'team.permissions', 'financials.view', 'financials.manage', 'exports.create', 'settings.manage'
    ]
    WHEN 'trainer' THEN ARRAY[
      'clients.view', 'clients.assign', 'clients.reassign',
      'assessments.view', 'assessments.create', 'assessments.update', 'assessments.review', 'assessments.assign',
      'metrics.view', 'metrics.update',
      'nutrition.view', 'nutrition.create', 'nutrition.update', 'nutrition.fooddb',
      'workouts.view', 'workouts.create', 'workouts.update', 'workouts.exercise',
      'templates.create'
    ]
    WHEN 'sales' THEN ARRAY[
      'clients.view', 'clients.create', 'clients.update',
      'subscriptions.view',
      'applications.view'
    ]
    ELSE ARRAY[]::text[]
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.default_role_permissions FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.default_role_permissions TO authenticated;

CREATE OR REPLACE FUNCTION public.fill_default_membership_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.permissions IS NULL OR cardinality(NEW.permissions) = 0 THEN
    NEW.permissions := public.default_role_permissions(NEW.workspace_role);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_fill_default_membership_permissions ON public.workspace_memberships;
CREATE TRIGGER trigger_fill_default_membership_permissions
  BEFORE INSERT OR UPDATE OF workspace_role ON public.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION public.fill_default_membership_permissions();

-- ============================================================
-- SECTION D: APPROVAL-VS-ACTIVATION LIFECYCLE
-- ============================================================
-- Distinguish "approved" (application accepted, account can log in)
-- from "activated" (the client's package subscription is confirmed
-- and coaching starts). Until activation a client row sits in the
-- NEW 'pending' status and does NOT consume active-client capacity.

-- 1. clients.approved_at — set when the application is approved.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- 2. Extend status domains. 'pending' means approved-but-not-activated.
ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_status_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_status_check
  CHECK (status IN ('active', 'inactive', 'paused', 'archived', 'pending'));

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'expired', 'renewed', 'frozen', 'cancelled', 'pending'));

-- 3. Backfill approved_at for all pre-existing clients (they predate
--    the lifecycle; treat their creation as approval time).
UPDATE public.clients
SET approved_at = created_at
WHERE approved_at IS NULL;

-- 4. AFTER trigger on applications: whenever an application flips to
--    'approved', downgrade the freshly created client + subscription to
--    'pending' and auto-assign the master intake assessment. Rooted in
--    the server-side approve RPC (and any future approval path), so no
--    client-role RLS is involved. Idempotent via the WHEN guard.
CREATE OR REPLACE FUNCTION public.on_client_application_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intake_id CONSTANT UUID := '00000000-0000-0000-0000-000000000101';
  v_snapshot JSONB;
  v_workspace_id UUID;
BEGIN
  -- Client: approved -> pending (never downgrade an already-live client,
  -- and never touch non-application-created clients).
  UPDATE public.clients c
  SET status = 'pending',
      approved_at = now(),
      subscription_status = CASE
        WHEN EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.client_id = c.id AND s.status = 'pending')
        THEN 'no_subscription'
        ELSE c.subscription_status
      END,
      updated_at = now()
  WHERE c.id = NEW.created_client_id
    AND c.status = 'active';

  SELECT workspace_id INTO v_workspace_id
  FROM public.clients
  WHERE id = NEW.created_client_id;

  -- Subscription: approved -> pending (waiting on confirmation/activation).
  UPDATE public.subscriptions s
  SET status = 'pending',
      updated_at = now()
  WHERE s.client_id = NEW.created_client_id
    AND s.status = 'active';

  -- Auto-assign the master intake template (snapshot its questions) once.
  IF v_workspace_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.assessment_templates t2 WHERE t2.id = v_intake_id AND t2.is_active = true)
     AND NOT EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.client_id = NEW.created_client_id
      AND a.template_id = v_intake_id
  ) THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'sort_order', q.sort_order,
        'question_type', q.question_type,
        'label', q.label,
        'description', q.description,
        'required', q.required,
        'options', q.options,
        'conditional_rules', q.conditional_rules
      ) ORDER BY q.sort_order
    ), '[]'::jsonb)
    INTO v_snapshot
    FROM public.assessment_questions q
    JOIN public.assessment_templates t ON t.id = q.template_id
    WHERE t.id = v_intake_id
      AND t.is_active = true;

    INSERT INTO public.assessments (
      workspace_id,
      client_id,
      template_id,
      name,
      assigned_ybs_coach_id,
      submission_status,
      questions_snapshot
    )
    VALUES (
      v_workspace_id,
      NEW.created_client_id,
      v_intake_id,
      (SELECT name FROM public.assessment_templates WHERE id = v_intake_id),
      NEW.assigned_ybs_trainer_id,
      'pending',
      v_snapshot
    );

    INSERT INTO public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, workspace_id, metadata)
    VALUES (
      auth.uid(),
      COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Platform'),
      CASE WHEN public.is_platform_owner() THEN 'platform_owner' ELSE 'system' END,
      'intake_form_assigned',
      'assessment',
      (SELECT id FROM public.assessments WHERE client_id = NEW.created_client_id AND template_id = v_intake_id LIMIT 1)::text,
      NEW.applicant_name,
      v_workspace_id,
      jsonb_build_object('client_id', NEW.created_client_id, 'template_id', v_intake_id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_intake_on_client_approval ON public.client_applications;
CREATE TRIGGER trigger_auto_intake_on_client_approval
  AFTER UPDATE OF status ON public.client_applications
  FOR EACH ROW
  WHEN (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved')
  EXECUTE FUNCTION public.on_client_application_approved();

-- ============================================================
-- SECTION E: ACTIVATE CLIENT PACKAGE RPC
-- ============================================================
-- Platform Owner or the Workspace Owner of the subscription's
-- workspace confirms the client's package: subscription becomes
-- 'active' (paid), client becomes 'active' (capacity counts), and
-- the package fields are denormalized onto the client row. Fully
-- idempotent — safe to call repeatedly from the pending-approvals
-- page and the client subscription tab.
CREATE OR REPLACE FUNCTION public.activate_client_package(p_subscription_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_ws_status TEXT;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription % not found.', p_subscription_id;
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_workspace_owner(v_sub.workspace_id)) THEN
    RAISE EXCEPTION 'Only Platform Owners and Workspace Owners can activate client packages.';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = v_sub.client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client % not found.', v_sub.client_id;
  END IF;

  SELECT status INTO v_ws_status FROM public.workspaces WHERE id = v_sub.workspace_id;
  IF v_ws_status IS NULL OR v_ws_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot activate a package in a suspended or archived workspace.';
  END IF;

  -- Idempotent fast path.
  IF v_sub.status = 'active' AND v_client.status = 'active' THEN
    RETURN jsonb_build_object(
      'success', true,
      'client_id', v_client.id,
      'subscription_id', v_sub.id,
      'client_code', v_client.client_code
    );
  END IF;

  UPDATE public.subscriptions
  SET status = 'active',
      payment_status = CASE WHEN payment_status = 'unpaid' THEN 'paid' ELSE payment_status END,
      updated_at = now()
  WHERE id = v_sub.id;

  UPDATE public.clients
  SET status = 'active',
      subscription_status = 'active',
      subscription_end_date = v_sub.end_date,
      package_name = v_sub.package_name,
      approved_at = COALESCE(approved_at, now()),
      updated_at = now()
  WHERE id = v_client.id;

  INSERT INTO public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, workspace_id, metadata)
  VALUES (
    auth.uid(),
    COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
    CASE WHEN public.is_platform_owner() THEN 'platform_owner' ELSE 'workspace_owner' END,
    'client_package_activated',
    'subscription',
    v_sub.id::text,
    v_client.full_name,
    v_sub.workspace_id,
    jsonb_build_object(
      'client_id', v_client.id,
      'package_name', v_sub.package_name,
      'start_date', v_sub.start_date::text,
      'end_date', v_sub.end_date::text
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'client_id', v_client.id,
    'subscription_id', v_sub.id,
    'client_code', v_client.client_code
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_client_package FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_client_package TO authenticated;
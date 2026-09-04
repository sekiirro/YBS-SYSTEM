-- ============================================================
-- YBS SYSTEM: WORKSPACE EXPANSION MIGRATION
-- Additive changes only — no destructive modifications.
--
-- Sections:
--   A. form_template_workspace_assignment table + select RLS
--   B. Restrict master template/question visibility (assignment-gated)
--   C. assign_form_template / unassign_form_template RPCs (platform owner only)
--   D. workout_exercises.working_sets column + legacy backfill
--   E. packages BEFORE UPDATE trigger: workspace owners -> name/price only
--   F. registration_enabled flag (handle_new_user + resolve_workspace_join)
-- ============================================================

-- ============================================================
-- SECTION A: FORM TEMPLATE TO WORKSPACE ASSIGNMENT
-- ============================================================
-- The platform owner assigns GLOBAL master templates (workspace_id IS NULL)
-- to individual workspaces. A workspace's visibility of a master template
-- is determined exclusively by the rows in this table. Writes are RPC-only;
-- no direct INSERT/UPDATE/DELETE policies exist. SELECT is scoped to the
-- platform owner or members of the assigned workspace.
CREATE TABLE IF NOT EXISTS public.form_template_workspace_assignment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES public.assessment_templates(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (template_id, workspace_id)
);

ALTER TABLE public.form_template_workspace_assignment ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ftwa_template ON public.form_template_workspace_assignment(template_id);
CREATE INDEX IF NOT EXISTS idx_ftwa_workspace ON public.form_template_workspace_assignment(workspace_id);

-- DROP-first so the whole file is safe to re-run even if a previous
-- attempt partially persisted (e.g. this policy was created before the
-- later section failed).
DROP POLICY IF EXISTS "ftwa_select" ON public.form_template_workspace_assignment;
CREATE POLICY "ftwa_select" ON public.form_template_workspace_assignment
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR public.has_workspace_access(workspace_id)
);

-- ============================================================
-- SECTION B: ASSIGNMENT-GATED MASTER TEMPLATE VISIBILITY
-- ============================================================
-- Replaces the "any authenticated user sees every global template" policy.
-- Global master templates are now visible to:
--   * the platform owner,
--   * platform trainers (preserves internal coach workflows),
--   * the template creator,
--   * authenticated users with an ACTIVE membership in a workspace the
--     template has been assigned to.
-- Workspace-local templates remain visible via has_workspace_access().

DROP POLICY IF EXISTS "templates_select" ON public.assessment_templates;

CREATE POLICY "templates_select" ON public.assessment_templates
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_ybs_trainer()
  OR created_by = (select auth.uid())
  OR (
    workspace_id IS NOT NULL
    AND public.has_workspace_access(workspace_id)
  )
  OR (
    workspace_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      JOIN public.form_template_workspace_assignment fta
        ON fta.workspace_id = wm.workspace_id
       AND fta.template_id = public.assessment_templates.id
      WHERE wm.user_id = (select auth.uid())
        AND wm.status = 'active'
    )
  )
);

DROP POLICY IF EXISTS "questions_select" ON public.assessment_questions;

CREATE POLICY "questions_select" ON public.assessment_questions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.assessment_templates t
    WHERE t.id = template_id
      AND (
        public.is_platform_owner()
        OR public.is_ybs_trainer()
        OR t.created_by = (select auth.uid())
        OR (
          t.workspace_id IS NOT NULL
          AND public.has_workspace_access(t.workspace_id)
        )
        OR (
          t.workspace_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM public.workspace_memberships wm
            JOIN public.form_template_workspace_assignment fta
              ON fta.workspace_id = wm.workspace_id
             AND fta.template_id = t.id
            WHERE wm.user_id = (select auth.uid())
              AND wm.status = 'active'
          )
        )
      )
  )
);

-- ============================================================
-- SECTION C: ASSIGN / UNASSIGN RPCS (PLATFORM OWNER ONLY)
-- ============================================================

CREATE OR REPLACE FUNCTION public.assign_form_template(p_template_id UUID, p_workspace_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template_ws UUID;
  v_workspace_status TEXT;
BEGIN
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Only the Platform Owner can assign master templates to workspaces.';
  END IF;

  SELECT workspace_id INTO v_template_ws
  FROM public.assessment_templates
  WHERE id = p_template_id;

  IF v_template_ws IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.assessment_templates WHERE id = p_template_id
  ) THEN
    RAISE EXCEPTION 'Template % does not exist.', p_template_id;
  END IF;

  IF v_template_ws IS NOT NULL THEN
    RAISE EXCEPTION 'Only global master templates (workspace_id null) can be assigned to workspaces.';
  END IF;

  SELECT status INTO v_workspace_status
  FROM public.workspaces
  WHERE id = p_workspace_id;

  IF v_workspace_status IS NULL THEN
    RAISE EXCEPTION 'Workspace % does not exist.', p_workspace_id;
  END IF;

  IF v_workspace_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot assign master templates to a suspended workspace.';
  END IF;

  INSERT INTO public.form_template_workspace_assignment (template_id, workspace_id, assigned_by)
  VALUES (p_template_id, p_workspace_id, (select auth.uid()))
  ON CONFLICT (template_id, workspace_id) DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.unassign_form_template(p_template_id UUID, p_workspace_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Only the Platform Owner can manage master template assignments.';
  END IF;

  DELETE FROM public.form_template_workspace_assignment
  WHERE template_id = p_template_id
    AND workspace_id = p_workspace_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_form_template FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_form_template TO authenticated;

REVOKE EXECUTE ON FUNCTION public.unassign_form_template FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unassign_form_template TO authenticated;

-- ============================================================
-- SECTION D: workout_exercises.working_sets
-- ============================================================
-- workout_exercises has NO warmup_sets column. Warm-up is represented
-- exclusively by the whole-exercise `warmup` BOOLEAN (see migration 01,
-- workout_exercises definition). Per-set warm-up only exists at EXECUTION
-- time in workout_set_logs.is_warmup (migration 08) — never as a
-- programming-time set count on workout_exercises. Therefore the original
-- "sets - warmup_sets" formula was invalid SQL (42703: does not exist).
--
-- Working sets are derived from the ONLY existing warm-up representation:
--   warmup = true  -> the entire exercise is a warm-up  -> working_sets = 0
--   warmup = false -> all programmed sets are working   -> working_sets = sets
--
-- This EXACTLY matches the app's own legacy derivation:
--   * calculateWorkoutVolume():  isWarmup ? 0 : (sets - warmup)
--     where the warmup set count was never storable, i.e. 0
--   * WorkoutPlanBuilder legacy migration: warmup ? 0 : Number(ex.sets)
--   * ClientWorkoutTracker header: if (ex.warmup) skip; else count sets
--   * Migration 08 design: warmup BOOLEAN at row level (all-or-nothing)
ALTER TABLE public.workout_exercises
  ADD COLUMN IF NOT EXISTS working_sets INTEGER NOT NULL DEFAULT 0
    CHECK (working_sets >= 0);

-- Backfill using the warmup BOOLEAN. Idempotent: guarded to rows still at
-- the default, and the CASE is deterministic (warmup rows recompute to 0,
-- non-warmup rows to sets) so re-running never corrupts prior state.
UPDATE public.workout_exercises
SET working_sets = CASE WHEN warmup THEN 0 ELSE sets END
WHERE working_sets = 0
  AND sets > 0;

-- ============================================================
-- SECTION E: PACKAGES - WORKSPACE OWNER EDIT SCOPE (name/price only)
-- ============================================================
-- RLS already restricts updates to the platform owner or the owning
-- workspace owner. This trigger additionally enforces the COLUMN scope:
-- non-platform-owner updates may only touch name and price (plus the
-- standard updated_at bookkeeping); every other column must be unchanged.
CREATE OR REPLACE FUNCTION public.enforce_package_edit_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_platform_owner() THEN
    RETURN NEW;
  END IF;

  IF OLD.workspace_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.workspace_memberships wm
    WHERE wm.user_id = (select auth.uid())
      AND wm.workspace_id = OLD.workspace_id
      AND wm.workspace_role = 'workspace_owner'
      AND wm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Workspace owners may only edit packages belonging to their own workspace.';
  END IF;

  IF
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
    NEW.tier IS DISTINCT FROM OLD.tier OR
    NEW.duration IS DISTINCT FROM OLD.duration OR
    NEW.duration_unit IS DISTINCT FROM OLD.duration_unit OR
    NEW.currency IS DISTINCT FROM OLD.currency OR
    NEW.description IS DISTINCT FROM OLD.description OR
    NEW.features IS DISTINCT FROM OLD.features OR
    NEW.is_active IS DISTINCT FROM OLD.is_active OR
    NEW.is_custom IS DISTINCT FROM OLD.is_custom OR
    NEW.max_capacity IS DISTINCT FROM OLD.max_capacity OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Workspace owners may only edit package name and price.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_package_edit_scope ON public.packages;
CREATE TRIGGER trigger_enforce_package_edit_scope
  BEFORE UPDATE ON public.packages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_package_edit_scope();

REVOKE EXECUTE ON FUNCTION public.enforce_package_edit_scope FROM PUBLIC;
-- ============================================================
-- SECTION F: WORKSPACE REGISTRATION ENABLE / DISABLE
-- ============================================================
-- 1. Public resolution now also reports registration_enabled so the
--    /join/:token page can show a "registration closed" state.
--    Same JSONB return type -> safe with CREATE OR REPLACE (no 42P13).
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
  SELECT id, name, status, settings INTO v_row
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
    'active', (v_row.status = 'active'),
    'registration_enabled', COALESCE((v_row.settings->>'registration_enabled')::boolean, true)
  );
END;
$$;

-- Grants unchanged (already scoped to anon + authenticated in migration 10).

-- 2. handle_new_user(): honor registration_enabled when resolving the
--    join token. Identical to migration 11's implementation except the
--    token resolution additionally requires registration_enabled <> false.
--    When registration is closed for the target workspace, the token is
--    treated as unresolved and the applicant falls through to the generic
--    platform approval queue.
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

  -- Trusted server-side invite lookup (written by invite_team_member,
  -- never by client code). If an ACTIVE invite exists for this email,
  -- the platform role comes from the DB ledger - NOT from metadata the
  -- user can control. This is what excludes Platform Trainer / Platform
  -- Owner invites from the approval queue.
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

  -- Resolve the registration token to a workspace EXCLUSIVELY
  -- server-side. NEW: the workspace must also have registration enabled
  -- (settings->>'registration_enabled' <> 'false'); otherwise the token
  -- is treated as unresolved and the applicant goes to the platform queue.
  v_join_token := NULLIF(btrim(NEW.raw_user_meta_data->>'join_token'), '');
  IF v_join_token IS NOT NULL THEN
    SELECT id INTO v_workspace_id
    FROM public.workspaces
    WHERE public_join_token = v_join_token
      AND status = 'active'
      AND COALESCE((settings->>'registration_enabled')::boolean, true) = true;
  END IF;

  -- ================================================================
  -- ADMIN-PROVISIONED ACCOUNT DETECTION (trusted, server-side only):
  --   * workspace_memberships covers Brand Owner provisioning
  --     (sync_brand_owner_to_workspaces fired on the profile upsert
  --     above, BEFORE this statement runs) - all statements inside
  --     this function execute top-down, so the membership already
  --     exists before this guard executes.
  --   * profiles.platform_role covers platform owner / trainer
  --     (now sourced from the trusted platform_invites ledger, or
  --     from server-set raw_app_meta_data).
  --   * workspaces.owner_email mirrors the same email relationship
  --     the owner sync trigger itself uses.
  --   * platform_invites covers an invite whose profile upsert/trigger
  --     ordering could not have materialized a membership yet.
  -- None of this is derived from client-submitted metadata.
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

  -- 2. Auto-create a pending client application for genuine
  --    self-registered trainees (migration 09 behavior, unchanged):
  --    platform_role 'none' + pending_approval + not provisioned.
  --    COALESCE(v_phone, '') guards the applicant_phone NOT NULL
  --    constraint.
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

-- Reinstall trigger (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
-- ============================================================
SELECT policyname, tablename FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('assessment_templates', 'assessment_questions', 'form_template_workspace_assignment');

SELECT tgname AS trigger_name, tgrelid::regclass AS table_name
FROM   pg_trigger
WHERE  tgname IN ('trigger_enforce_package_edit_scope', 'on_auth_user_created');

SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name = 'workout_exercises'
  AND  column_name = 'working_sets';

-- ============================================================
-- Migration 20260906000003: Deletion scoping, package feature
-- edits, client remove/delete RPCs, and server-side plan search.
--
-- PASS 1/2 backend continuation of the feature batch.
-- ============================================================

-- ============================================================
-- SECTION A: PACKAGES — WORKSPACE OWNER FEATURE EDITS
-- ============================================================
-- Replaces the migration 04 §E trigger that restricted workspace
-- owners to name/price only. Owners may now also edit the FEATURES
-- list and toggle is_active (hide/show the package for their
-- workspace) while tier/duration/duration_unit/currency/description
-- and the identity columns stay protected.
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
    NEW.is_custom IS DISTINCT FROM OLD.is_custom OR
    NEW.max_capacity IS DISTINCT FROM OLD.max_capacity OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Workspace owners may only edit package name, price, features, and availability.';
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
-- SECTION B: DELETION SCOPING (assessments, metrics, templates)
-- ============================================================
-- Assessments: only Platform Owners and the owning workspace's owner
-- may delete entire assessment records. Coaches keep lifecycle
-- privileges (assign/review/update) but cannot hard-delete forms.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'assessments_delete' AND tablename = 'assessments') THEN
    CREATE POLICY "assessments_delete" ON public.assessments
    FOR DELETE TO authenticated
    USING (
      public.is_platform_owner()
      OR public.is_workspace_owner(workspace_id)
    );
  END IF;
END
$$;

-- Metrics: Platform Owners, the workspace owner, and the assigned
-- coach may delete metric entries (coach is scoped to their own
-- assigned clients only). Clients cannot delete their own metrics.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'metrics_delete' AND tablename = 'metrics') THEN
    CREATE POLICY "metrics_delete" ON public.metrics
    FOR DELETE TO authenticated
    USING (
      public.is_platform_owner()
      OR public.is_workspace_owner(workspace_id)
      OR assigned_ybs_coach_id = (select auth.uid())
    );
  END IF;
END
$$;

-- Assessment TEMPLATE deletion is ALREADY correctly scoped by the
-- existing "templates_manage" FOR ALL policy (platform owner, or the
-- workspace owner for the template's own workspace_id only) and by
-- form_template_workspace_assignment references (global master
-- templates cannot be deleted while a workspace is assigned).
-- No change required; responses cascade from their assessment.

-- ============================================================
-- SECTION C: CLIENT REMOVE / PERMANENT DELETE RPCs
-- ============================================================
-- remove_client_from_workspace: soft-archive (status='archived'),
-- cancels open subscriptions, ends coach allocations, and audits.
-- Workspace owners can archive clients in their own workspace; the
-- Platform Owner can archive anywhere.
CREATE OR REPLACE FUNCTION public.remove_client_from_workspace(p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_ws_status TEXT;
BEGIN
  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client % not found.', p_client_id;
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_workspace_owner(v_client.workspace_id)) THEN
    RAISE EXCEPTION 'Only Platform Owners and Workspace Owners can remove clients.';
  END IF;

  SELECT status INTO v_ws_status FROM public.workspaces WHERE id = v_client.workspace_id;
  IF v_ws_status IS NULL OR v_ws_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot remove clients from a suspended or archived workspace.';
  END IF;

  IF v_client.status = 'archived' THEN
    RETURN jsonb_build_object('success', true, 'client_id', v_client.id, 'client_code', v_client.client_code);
  END IF;

  UPDATE public.clients
  SET status = 'archived',
      updated_at = now()
  WHERE id = v_client.id;

  UPDATE public.subscriptions
  SET status = 'cancelled',
      updated_at = now()
  WHERE client_id = v_client.id
    AND status IN ('active', 'pending', 'frozen');

  UPDATE public.client_ybs_trainer_assignments
  SET is_active = false,
      ended_at = now()
  WHERE client_id = v_client.id
    AND is_active = true;

  INSERT INTO public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, workspace_id, metadata)
  VALUES (
    auth.uid(),
    COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
    CASE WHEN public.is_platform_owner() THEN 'platform_owner' ELSE 'workspace_owner' END,
    'client_removed_from_workspace',
    'client',
    v_client.id::text,
    v_client.full_name,
    v_client.workspace_id,
    jsonb_build_object('client_code', v_client.client_code, 'mode', 'archive')
  );

  RETURN jsonb_build_object('success', true, 'client_id', v_client.id, 'client_code', v_client.client_code);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_client_from_workspace FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_client_from_workspace TO authenticated;

-- delete_client_permanently: TRUE hard delete, Platform Owner ONLY.
-- Requires the client to be archived first (archive-first, then
-- confirm). Child rows (subscriptions, metrics, photos, assessments,
-- responses, trainer assignments, plans, logs, timeline) all cascade
-- via their ON DELETE CASCADE foreign keys; applications keep their
-- created_client_id (SET NULL).
CREATE OR REPLACE FUNCTION public.delete_client_permanently(p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
BEGIN
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Only Platform Owners can permanently delete client records.';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client % not found.', p_client_id;
  END IF;

  IF v_client.status <> 'archived' THEN
    RAISE EXCEPTION 'Client must be archived first (use remove_client_from_workspace) before permanent deletion.';
  END IF;

  INSERT INTO public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, workspace_id, metadata)
  VALUES (
    auth.uid(),
    COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
    'platform_owner',
    'client_permanently_deleted',
    'client',
    v_client.id::text,
    v_client.full_name,
    v_client.workspace_id,
    jsonb_build_object('client_code', v_client.client_code)
  );

  DELETE FROM public.clients WHERE id = v_client.id;

  RETURN jsonb_build_object('success', true, 'client_id', v_client.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_client_permanently FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_client_permanently TO authenticated;

-- ============================================================
-- SECTION D: SERVER-SIDE PLAN TEMPLATE SEARCH (Load Plan)
-- ============================================================
-- Debounced, server-side search across nutrition + workout TEMPLATES
-- for the ClientDetail "Load Plan" expeditors. Returns only templates
-- the caller may read: global templates when the caller is an active
-- member of the given workspace, workspace-local templates via
-- has_workspace_access, and everything for Platform Owners.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_nutrition_plans_template_name_trgm
  ON public.nutrition_plans USING gin (lower(name) gin_trgm_ops)
  WHERE is_template = true;

CREATE INDEX IF NOT EXISTS idx_workout_plans_template_name_trgm
  ON public.workout_plans USING gin (lower(name) gin_trgm_ops)
  WHERE is_template = true;

CREATE OR REPLACE FUNCTION public.search_plan_templates(
  p_query TEXT DEFAULT '',
  p_source TEXT DEFAULT 'nutrition', -- 'nutrition' | 'workout' | 'any'
  p_workspace_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  source TEXT,
  workspace_id UUID,
  daily_calories NUMERIC,
  meals_count INTEGER,
  split_type TEXT,
  split_name TEXT,
  working_sets INTEGER,
  days_count INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 50 THEN
    p_limit := 20;
  END IF;

  IF p_source IN ('nutrition', 'any') THEN
    RETURN QUERY
      SELECT
        n.id,
        n.name,
        'nutrition'::text,
        n.workspace_id,
        n.daily_calories,
        (SELECT count(*)::int FROM public.nutrition_meals m WHERE m.nutrition_plan_id = n.id) AS meals_count,
        NULL::text AS split_type,
        NULL::text AS split_name,
        NULL::int AS working_sets,
        0::int AS days_count
      FROM public.nutrition_plans n
      WHERE n.is_template = true
        AND lower(n.name) LIKE '%' || lower(p_query) || '%'
        AND (
          public.is_platform_owner()
          OR (n.workspace_id IS NULL AND p_workspace_id IS NOT NULL AND public.is_active_workspace_member(p_workspace_id))
          OR (n.workspace_id IS NOT NULL AND public.has_workspace_access(n.workspace_id))
        )
      ORDER BY n.name ASC
      LIMIT p_limit;
  END IF;

  IF p_source IN ('workout', 'any') THEN
    RETURN QUERY
      SELECT
        w.id,
        w.name,
        'workout'::text,
        w.workspace_id,
        0::numeric AS daily_calories,
        0::int AS meals_count,
        w.split_type,
        w.custom_split_name,
        (SELECT COALESCE(SUM(we.working_sets), 0)::int
         FROM public.workout_days d
         JOIN public.workout_exercises we ON we.workout_day_id = d.id
         WHERE d.workout_plan_id = w.id) AS working_sets,
        (SELECT count(*)::int FROM public.workout_days d WHERE d.workout_plan_id = w.id) AS days_count
      FROM public.workout_plans w
      WHERE w.is_template = true
        AND lower(w.name) LIKE '%' || lower(p_query) || '%'
        AND (
          public.is_platform_owner()
          OR (w.workspace_id IS NULL AND p_workspace_id IS NOT NULL AND public.is_active_workspace_member(p_workspace_id))
          OR (w.workspace_id IS NOT NULL AND public.has_workspace_access(w.workspace_id))
        )
      ORDER BY w.name ASC
      LIMIT p_limit;
  END IF;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_plan_templates FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_plan_templates TO authenticated;
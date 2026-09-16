-- ============================================================
-- YBS SYSTEM: GLOBAL TEMPLATE VISIBILITY
-- Migration: 20260918000003_global_template_visibility.sql
--
-- Business rule: EVERY nutrition/workout TEMPLATE is visible and
-- usable by every authorized staff member, no matter which workspace
-- created it. A template created in Workspace A is readable from
-- Workspace B, C, ... One shared template record — no per-workspace
-- duplicates.
--
-- What changes:
--   1. New helper is_template_library_reader() — platform owner,
--      platform trainer, or an active staff membership in ANY
--      workspace (roles workspace_owner / trainer / sales). Clients
--      are NOT template readers.
--   2. The template branch of the SELECT policies on
--      nutrition_plans / nutrition_meals / nutrition_items and
--      workout_plans / workout_days / workout_exercises drops the
--      `has_workspace_access(workspace_id)` restriction and uses the
--      helper instead. YBS Global templates (workspace_id IS NULL)
--      stay readable by all authenticated users (unchanged).
--   3. resolve_exercise_versions_for_plan() permission check is
--      updated to the same template predicate, so a foreign-workspace
--      shared template can still be resolved. The target-workspace
--      gate and the resolution logic itself are UNCHANGED — the
--      template is global, the exercise/video mapping stays
--      workspace-aware.
--   4. search_plan_templates() visibility is made global for the
--      same readers.
--
-- Everything else — assigned client plans, write policies, the
-- exercise versioning tables/RPCs, form templates — is untouched.
-- ============================================================

-- ============================================================
-- 1. Template-library reader helper (staff only, any workspace)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_template_library_reader()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_platform_owner()
      OR public.is_ybs_trainer()
      OR EXISTS (
        SELECT 1
        FROM public.workspace_memberships wm
        JOIN public.workspaces w ON w.id = wm.workspace_id
        JOIN public.profiles p ON p.id = wm.user_id
        WHERE wm.user_id = (select auth.uid())
          AND wm.status = 'active'
          AND w.status = 'active'
          AND wm.workspace_role IN ('workspace_owner', 'trainer', 'sales')
          AND p.account_status = 'active'
      );
$$;

ALTER FUNCTION public.is_template_library_reader() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.is_template_library_reader() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_template_library_reader() TO authenticated;

-- ============================================================
-- 2. NUTRITION PLANS / MEALS / ITEMS (SELECT)
--    Base = 20260916000002, only the template branch changes.
-- ============================================================
DROP POLICY IF EXISTS "nutrition_plans_select" ON public.nutrition_plans;

CREATE POLICY "nutrition_plans_select" ON public.nutrition_plans
FOR SELECT TO authenticated
USING (
  (is_template AND (workspace_id IS NULL OR public.is_template_library_reader()))
  OR public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
  OR (
    client_id IS NOT NULL
    AND public.is_client_self(client_id)
    AND status = 'active'
  )
  OR (client_id IS NOT NULL AND public.is_assigned_ybs_coach(client_id))
);

DROP POLICY IF EXISTS "nutrition_meals_select" ON public.nutrition_meals;

CREATE POLICY "nutrition_meals_select" ON public.nutrition_meals
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.nutrition_plans np
    WHERE np.id = nutrition_plan_id
      AND (
        (np.is_template AND (np.workspace_id IS NULL OR public.is_template_library_reader()))
        OR public.is_platform_owner()
        OR public.is_workspace_owner(np.workspace_id)
        OR np.assigned_ybs_coach_id = (select auth.uid())
        OR (
          np.client_id IS NOT NULL
          AND public.is_client_self(np.client_id)
          AND np.status = 'active'
        )
        OR (np.client_id IS NOT NULL AND public.is_assigned_ybs_coach(np.client_id))
      )
  )
);

DROP POLICY IF EXISTS "nutrition_items_select" ON public.nutrition_items;

CREATE POLICY "nutrition_items_select" ON public.nutrition_items
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.nutrition_meals nm
    JOIN public.nutrition_plans np ON np.id = nm.nutrition_plan_id
    WHERE nm.id = meal_id
      AND (
        (np.is_template AND (np.workspace_id IS NULL OR public.is_template_library_reader()))
        OR public.is_platform_owner()
        OR public.is_workspace_owner(np.workspace_id)
        OR np.assigned_ybs_coach_id = (select auth.uid())
        OR (
          np.client_id IS NOT NULL
          AND public.is_client_self(np.client_id)
          AND np.status = 'active'
        )
        OR (np.client_id IS NOT NULL AND public.is_assigned_ybs_coach(np.client_id))
      )
  )
);

-- ============================================================
-- 3. WORKOUT PLANS / DAYS / EXERCISES (SELECT)
--    Base = 20260916000002, only the template branch changes.
-- ============================================================
DROP POLICY IF EXISTS "workout_plans_select" ON public.workout_plans;

CREATE POLICY "workout_plans_select" ON public.workout_plans
FOR SELECT TO authenticated
USING (
  (is_template AND (workspace_id IS NULL OR public.is_template_library_reader()))
  OR public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
  OR (client_id IS NOT NULL AND public.is_client_self(client_id))
  OR (client_id IS NOT NULL AND public.is_assigned_ybs_coach(client_id))
);

DROP POLICY IF EXISTS "workout_days_select" ON public.workout_days;

CREATE POLICY "workout_days_select" ON public.workout_days
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.workout_plans wp
    WHERE wp.id = workout_plan_id
      AND (
        (wp.is_template AND (wp.workspace_id IS NULL OR public.is_template_library_reader()))
        OR public.is_platform_owner()
        OR public.is_workspace_owner(wp.workspace_id)
        OR wp.assigned_ybs_coach_id = (select auth.uid())
        OR (wp.client_id IS NOT NULL AND public.is_client_self(wp.client_id))
        OR (wp.client_id IS NOT NULL AND public.is_assigned_ybs_coach(wp.client_id))
      )
  )
);

DROP POLICY IF EXISTS "workout_exercises_select" ON public.workout_exercises;

CREATE POLICY "workout_exercises_select" ON public.workout_exercises
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.workout_days wd
    JOIN public.workout_plans wp ON wp.id = wd.workout_plan_id
    WHERE wd.id = workout_day_id
      AND (
        (wp.is_template AND (wp.workspace_id IS NULL OR public.is_template_library_reader()))
        OR public.is_platform_owner()
        OR public.is_workspace_owner(wp.workspace_id)
        OR wp.assigned_ybs_coach_id = (select auth.uid())
        OR (wp.client_id IS NOT NULL AND public.is_client_self(wp.client_id))
        OR (wp.client_id IS NOT NULL AND public.is_assigned_ybs_coach(wp.client_id))
      )
  )
);

-- ============================================================
-- 4. EXERCISE RESOLUTION — keep workspace-aware resolution, widen
--    only the template read gate so shared templates can be resolved.
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_exercise_versions_for_plan(
  p_plan_id UUID,
  p_target_workspace_id UUID
)
RETURNS TABLE (
  workout_exercise_id UUID,
  original_exercise_id UUID,
  resolved_exercise_id UUID,
  canonical_exercise_id UUID,
  linked BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Caller must be able to READ the plan (mirrors workout_plans_select).
  IF NOT EXISTS (
    SELECT 1 FROM public.workout_plans wp
    WHERE wp.id = p_plan_id
      AND (
        (wp.is_template AND (wp.workspace_id IS NULL OR public.is_template_library_reader()))
        OR public.is_platform_owner()
        OR public.is_workspace_owner(wp.workspace_id)
        OR wp.assigned_ybs_coach_id = auth.uid()
        OR (wp.client_id IS NOT NULL AND public.is_client_self(wp.client_id))
      )
  ) THEN
    RAISE EXCEPTION 'permission denied: no read access to plan %', p_plan_id;
  END IF;

  -- Target workspace must be the caller's own (unless the caller is the
  -- platform owner, who may resolve against any workspace).
  IF p_target_workspace_id IS NOT NULL
     AND NOT (public.is_platform_owner() OR public.has_workspace_access(p_target_workspace_id)) THEN
    RAISE EXCEPTION 'permission denied: no access to target workspace %', p_target_workspace_id;
  END IF;

  RETURN QUERY
    SELECT
      we.id                                            AS workout_exercise_id,
      we.exercise_id                                   AS original_exercise_id,
      COALESCE(m_target.exercise_id, m_global.exercise_id, we.exercise_id) AS resolved_exercise_id,
      c.id                                             AS canonical_exercise_id,
      (m_target.exercise_id IS NOT NULL OR m_global.exercise_id IS NOT NULL) AS linked
    FROM public.workout_days wd
    JOIN public.workout_exercises we ON we.workout_day_id = wd.id
    LEFT JOIN public.exercise_mappings m_source
      ON m_source.exercise_id = we.exercise_id
    LEFT JOIN public.canonical_exercises c
      ON c.id = m_source.canonical_exercise_id
    LEFT JOIN public.exercise_mappings m_target
      ON m_target.canonical_exercise_id = c.id
     AND m_target.workspace_id IS NOT DISTINCT FROM p_target_workspace_id
    LEFT JOIN public.exercise_mappings m_global
      ON m_global.canonical_exercise_id = c.id
     AND m_global.workspace_id IS NULL
    WHERE wd.workout_plan_id = p_plan_id
      AND we.exercise_id IS NOT NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_exercise_versions_for_plan FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_exercise_versions_for_plan TO authenticated;

-- ============================================================
-- 5. TEMPLATE SEARCH — global visibility for the same readers.
--    Base = 20260913000003.
-- ============================================================
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
        AND n.is_archived = false
        AND lower(n.name) LIKE '%' || lower(p_query) || '%'
        AND (n.workspace_id IS NULL OR public.is_template_library_reader())
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
        AND w.is_archived = false
        AND lower(w.name) LIKE '%' || lower(p_query) || '%'
        AND (w.workspace_id IS NULL OR public.is_template_library_reader())
      ORDER BY w.name ASC
      LIMIT p_limit;
  END IF;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_plan_templates FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_plan_templates TO authenticated;

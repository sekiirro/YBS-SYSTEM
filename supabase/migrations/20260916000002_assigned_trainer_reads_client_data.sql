-- ============================================================
-- Migration 20260916000002: Assigned YBS trainer can READ the
-- existing Forms / Nutrition / Workout data of their assigned
-- clients
--
-- ROOT CAUSE (diagnosed):
--   Each associated table (assessments, nutrition_plans,
--   workout_plans and their children) scoped trainer access to the
--   ROW'S OWN snapshot `assigned_ybs_coach_id`, which still points
--   to the previous/assigning coach after the client has been
--   reassigned through clients.assigned_ybs_coach_id. A newly
--   assigned trainer could see the client row (clients_select reads
--   the client column) but none of the client's existing data.
--
-- FIX:
--   Add a READ grant to the SELECT-family policies (and the Forms
--   delivery RPC) based on the AUTHORITATIVE CURRENT assignment:
--   when the client carrying the row is assigned to the current
--   authenticated trainer via the existing helper
--   public.is_assigned_ybs_coach(client_id).
--
--   * existing Platform Owner / Workspace Owner / snapshot-coach /
--     client-self branches are preserved unchanged
--   * all *manage / write policies are untouched
--   * no data is copied, reassigned, or rewritten
--   * no new tables/fields/helpers; helper already exists and is
--     SECURITY DEFINER (no recursion, no weakening of RLS)
-- ============================================================

-- ------------------------------------------------------------
-- 1. FORMS / ASSESSMENTS
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "assessments_select" ON public.assessments;

CREATE POLICY "assessments_select" ON public.assessments
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
  OR public.is_client_self(client_id)
  OR (client_id IS NOT NULL AND public.is_assigned_ybs_coach(client_id))
);

-- ------------------------------------------------------------
-- 2. ASSESSMENT RESPONSES (READ)
--    Inclusive of inherited client-assigned assessments. The
--    responses_write policies are intentionally NOT broadened —
--    client access to their own responses keeps working via
--    public.is_client_self() and trainer response editing on
--    inherited forms is not part of this change.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "responses_select" ON public.assessment_responses;

CREATE POLICY "responses_select" ON public.assessment_responses
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.id = assessment_id
      AND (
        public.is_platform_owner()
        OR public.is_workspace_owner(a.workspace_id)
        OR a.assigned_ybs_coach_id = (select auth.uid())
        OR public.is_client_self(a.client_id)
        OR (a.client_id IS NOT NULL AND public.is_assigned_ybs_coach(a.client_id))
      )
  )
);

-- ------------------------------------------------------------
-- 3. FORMS DELIVERY RPC (used by the Forms page)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_forms_with_delivery()
RETURNS TABLE (
  id UUID,
  workspace_id UUID,
  client_id UUID,
  template_id UUID,
  name TEXT,
  assigned_ybs_coach_id UUID,
  due_date DATE,
  submission_status TEXT,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  questions_snapshot JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  response_count BIGINT,
  assigned_client_name TEXT,
  workspace_name TEXT,
  nutrition_delivered BOOLEAN,
  workout_delivered BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.workspace_id,
    a.client_id,
    a.template_id,
    a.name,
    a.assigned_ybs_coach_id,
    a.due_date,
    a.submission_status,
    a.submitted_at,
    a.reviewed_at,
    a.questions_snapshot,
    a.created_at,
    a.updated_at,
    (SELECT count(*)::bigint FROM public.assessment_responses r WHERE r.assessment_id = a.id),
    cl.full_name,
    w.name,
    EXISTS (
      SELECT 1 FROM public.nutrition_plans np
      WHERE np.client_id = a.client_id AND np.status = 'active' AND np.is_archived = false
    ),
    EXISTS (
      SELECT 1 FROM public.workout_plans wp
      WHERE wp.client_id = a.client_id AND wp.is_template = false AND wp.is_archived = false
    )
  FROM public.assessments a
  LEFT JOIN public.clients cl ON cl.id = a.client_id
  LEFT JOIN public.workspaces w ON w.id = a.workspace_id
  WHERE public.is_platform_owner()
     OR public.is_workspace_owner(a.workspace_id)
     OR a.assigned_ybs_coach_id = auth.uid()
     OR public.is_client_self(a.client_id)
     OR (a.client_id IS NOT NULL AND public.is_assigned_ybs_coach(a.client_id))
  ORDER BY a.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_forms_with_delivery() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_forms_with_delivery() TO authenticated;

-- ------------------------------------------------------------
-- 4. NUTRITION PLANS / MEALS / ITEMS (SELECT)
--
-- NOTE: nutrition_plans_select / meals / items were LAST redefined by
-- 20260910000003_nutrition_plan_draft_lifecycle.sql, which caps the
-- client-self branch at status = 'active'. Those latest definitions
-- are reproduced below with ONLY the assigned-trainer branch added.
-- The trainer branch intentionally has no status filter (trainers are
-- staff; the existing snapshot-coach branch has none either), so a
-- newly assigned trainer can read their client's existing plans
-- including drafts. The client branch keeps its active-only cap.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "nutrition_plans_select" ON public.nutrition_plans;

CREATE POLICY "nutrition_plans_select" ON public.nutrition_plans
FOR SELECT TO authenticated
USING (
  (is_template AND (workspace_id IS NULL OR public.has_workspace_access(workspace_id)))
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
        (np.is_template AND (np.workspace_id IS NULL OR public.has_workspace_access(np.workspace_id)))
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
        (np.is_template AND (np.workspace_id IS NULL OR public.has_workspace_access(np.workspace_id)))
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

-- ------------------------------------------------------------
-- 5. WORKOUT PLANS / DAYS / EXERCISES (SELECT)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "workout_plans_select" ON public.workout_plans;

CREATE POLICY "workout_plans_select" ON public.workout_plans
FOR SELECT TO authenticated
USING (
  (is_template AND (workspace_id IS NULL OR public.has_workspace_access(workspace_id)))
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
        (wp.is_template AND (wp.workspace_id IS NULL OR public.has_workspace_access(wp.workspace_id)))
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
        (wp.is_template AND (wp.workspace_id IS NULL OR public.has_workspace_access(wp.workspace_id)))
        OR public.is_platform_owner()
        OR public.is_workspace_owner(wp.workspace_id)
        OR wp.assigned_ybs_coach_id = (select auth.uid())
        OR (wp.client_id IS NOT NULL AND public.is_client_self(wp.client_id))
        OR (wp.client_id IS NOT NULL AND public.is_assigned_ybs_coach(wp.client_id))
      )
  )
);
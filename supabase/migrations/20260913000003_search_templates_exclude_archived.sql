-- Reconcile search_plan_templates with soft-delete semantics.
-- WorkoutsService/NutritionService list already default to is_archived = false
-- and their ClientDetail "load templates" paths use those services, but the
-- RPC behind the NutritionPlans/WorkoutPlans "Or Build from Existing Template"
-- search never excluded archived rows — so a template archived from the
-- list page could keep appearing in the template search modal. Add the same
-- filter to both branches.

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
        AND w.is_archived = false
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
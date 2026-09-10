-- ============================================================
-- YBS SYSTEM: WORKOUT PLAN EXERCISE LIBRARY SOURCE
-- Migration: 20260910000006_workout_plan_exercise_library_source.sql
-- Additive only — preserves all existing tables and data
-- ============================================================

-- 1. Persistent exercise-library workspace pointer on workout_plans.
--    NULL means "use the plan's own workspace" (the historical behavior),
--    which the application layer and the guard trigger both normalize.
ALTER TABLE public.workout_plans
  ADD COLUMN IF NOT EXISTS exercise_library_workspace_id UUID
    REFERENCES public.workspaces(id) ON DELETE SET NULL;

-- 2. Backfill: every existing plan keeps browsing exactly the library it had
--    before this migration (plan.workspace_id). No plan's available
--    exercises change.
UPDATE public.workout_plans
   SET exercise_library_workspace_id = workspace_id
 WHERE exercise_library_workspace_id IS NULL;

-- 3. Index the new foreign key for joins / lookups.
CREATE INDEX IF NOT EXISTS idx_workout_plans_exercise_library_workspace_id
  ON public.workout_plans(exercise_library_workspace_id);

-- 4. Server-side authorization guard (defense in depth on top of RLS).
--    A plan may only browse another workspace's exercise library when the
--    writer is the Platform Owner or the WORKSPACE OWNER of the SOURCE
--    workspace. Writing the plan's own workspace (or NULL, meaning "own
--    workspace") is always permitted — that is the case for every coach /
--    workspace owner / platform staff member today.
--
--    RLS stays unchanged: workout_plans is already only writable by platform
--    owners, workspace owners, and assigned coaches (workout_plans_manage).
CREATE OR REPLACE FUNCTION public.guard_workout_plan_library_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Normalize: NULL -> the plan's own workspace, on insert AND on update.
  IF NEW.exercise_library_workspace_id IS NULL THEN
    NEW.exercise_library_workspace_id := NEW.workspace_id;
  END IF;

  -- The plan's own workspace as the library source is always allowed.
  IF NEW.exercise_library_workspace_id = NEW.workspace_id THEN
    RETURN NEW;
  END IF;

  -- Anything else requires Platform Owner OR Workspace Owner of the SOURCE.
  IF public.is_platform_owner()
     OR public.is_workspace_owner(NEW.exercise_library_workspace_id) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'permission denied: workspace % is not an authorized exercise library source for this plan',
    NEW.exercise_library_workspace_id;
END;
$$;

DROP TRIGGER IF EXISTS trg_workout_plan_library_source ON public.workout_plans;
CREATE TRIGGER trg_workout_plan_library_source
  BEFORE INSERT OR UPDATE OF exercise_library_workspace_id ON public.workout_plans
  FOR EACH ROW EXECUTE FUNCTION public.guard_workout_plan_library_source();
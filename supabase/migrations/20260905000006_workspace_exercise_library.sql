-- ============================================================
-- YBS SYSTEM: WORKSPACE EXERCISE LIBRARY
-- Migration: 20260905000006_workspace_exercise_library.sql
--
-- Exercises ALREADY carry workspace ownership (workspace_id,
-- NULL = global shared library) with an index and RLS from the
-- core schema. This migration only:
--   1. Adds exercises.updated_at so the edit flow can timestamp
--      changes (mirrors other mutable tables like workout_plans).
--   2. Makes the exercise write-scope explicit with a WITH CHECK
--      clause (idempotent re-creation of the existing policy).
--
-- No exercise records are imported, seeded or modified here.
-- ============================================================

-- 1. exercises.updated_at (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'exercises'
      AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.exercises
      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;

-- 2. Explicit write-scope on exercises (platform owner, or the
--    Workspace Owner of the row's own workspace). WITH CHECK mirrors
--    USING so INSERT/UPDATE can never assign an exercise to a workspace
--    the caller does not own (workspace_id can only be set to a
--    workspace the caller owns; platform owner may use any value,
--    including NULL for the shared global library).
DROP POLICY IF EXISTS "exercises_manage" ON public.exercises;
CREATE POLICY "exercises_manage" ON public.exercises
FOR ALL TO authenticated
USING (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
)
WITH CHECK (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
);

-- ============================================================
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
-- ============================================================
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name = 'exercises'
  AND  column_name IN ('workspace_id', 'updated_at')
ORDER  BY column_name;

SELECT schemaname, policyname
FROM   pg_policies
WHERE  tablename = 'exercises'
ORDER  BY policyname;
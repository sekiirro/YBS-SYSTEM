-- ============================================================
-- YBS SYSTEM: GLOBAL EXERCISE LIBRARY
-- Migration: 20260915000002_global_exercise_library.sql
--
-- Turns the existing workspace_id IS NULL convention (already used
-- by packages / foods / assessment_templates and already allowed
-- by the exercises_select RLS policy) into a TRUE global scope for
-- exercises, without duplicating ownership columns and without
-- changing any existing exercise IDs.
--
-- WHAT CHANGES
--  1. Adds public.exercises.is_global as a STORED GENERATED flag:
--       is_global = (workspace_id IS NULL)
--     Single source of truth (no divergence risk); gives the app an
--     explicit, indexable global-scope flag instead of hardcoded
--     workspace IDs. Future libraries can extend this pattern.
--  2. Drops the exercises_no_global_active_check constraint from
--     migration 20260905000007, which forbade active global rows.
--  3. Migrates every exercise owned by the workspace named exactly
--     'YBS Default Workspace' to the global scope
--     (workspace_id = NULL) via UPDATE — IDs, video URLs,
--     thumbnails/metadata, and all workout_exercises.exercise_id
--     references are preserved (FK is on id, not workspace_id).
--     KENDO / Drbahaa / future workspace rows are untouched.
--  4. Adds indexes supporting the planner query
--       WHERE workspace_id = <ws> OR is_global = true
--  5. Replaces the single FOR ALL exercises_manage policy with
--     explicit SELECT / INSERT / UPDATE / DELETE policies:
--       SELECT: own workspace + global (all authenticated members)
--       INSERT: workspace users create workspace-owned rows only;
--               global (NULL) inserts are platform-owner only
--       UPDATE/DELETE: workspace users manage own rows only;
--               global mutation is platform-owner only
--
-- IDEMPOTENT: safe to re-run (IF NOT EXISTS guards + UPDATE is a
-- fixed-point once YBS Default rows are already NULL).
-- ============================================================

-- 1. Explicit global-scope flag (generated, single source of truth)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'exercises'
      AND column_name = 'is_global'
  ) THEN
    ALTER TABLE public.exercises
      ADD COLUMN is_global BOOLEAN
      GENERATED ALWAYS AS (workspace_id IS NULL) STORED;
  END IF;
END $$;

COMMENT ON COLUMN public.exercises.is_global IS
  'True global scope flag: true when workspace_id IS NULL (YBS Global Library). Generated — never written directly.';

-- 2. Remove the constraint that forbade active global exercises
--    (added by 20260905000007_purge_legacy_global_exercises.sql).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exercises_no_global_active_check'
      AND conrelid = 'public.exercises'::regclass
  ) THEN
    ALTER TABLE public.exercises
      DROP CONSTRAINT exercises_no_global_active_check;
  END IF;
END $$;

-- 3. Migrate YBS Default Workspace exercises -> global scope.
--    UPDATE preserves every id; only workspace_id changes to NULL.
--    Aborts safely if the workspace name is ambiguous (0 rows match
--    -> no-op with NOTICE; >1 match -> exception, nothing migrated).
DO $$
DECLARE
  v_ws_count  INTEGER;
  v_ws_id     UUID;
  v_migrated  INTEGER;
BEGIN
  SELECT count(*) INTO v_ws_count
  FROM public.workspaces WHERE name = 'YBS Default Workspace';

  IF v_ws_count = 0 THEN
    RAISE NOTICE 'Global library migration: no workspace named "YBS Default Workspace" — nothing to migrate.';
    RETURN;
  ELSIF v_ws_count > 1 THEN
    RAISE EXCEPTION 'Global library migration ABORTED: more than one workspace named "YBS Default Workspace". Resolve manually.';
  END IF;

  SELECT id INTO v_ws_id
  FROM public.workspaces WHERE name = 'YBS Default Workspace';

  UPDATE public.exercises
     SET workspace_id = NULL
   WHERE workspace_id = v_ws_id;
  GET DIAGNOSTICS v_migrated = ROW_COUNT;

  RAISE NOTICE 'Global library migration: % exercise(s) moved from "YBS Default Workspace" (%) to global scope (IDs preserved).',
    v_migrated, v_ws_id;
END $$;

-- 4. Indexes for the planner query
--    WHERE workspace_id = <ws> OR is_global = true (+ is_archived = false)
CREATE INDEX IF NOT EXISTS idx_exercises_global_active
  ON public.exercises(is_global)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_exercises_workspace_active
  ON public.exercises(workspace_id)
  WHERE is_archived = false;

-- 5. Explicit RLS: global read for all members, global write for
--    platform owner only. Workspace isolation for non-global rows
--    is unchanged (has_workspace_access / is_workspace_owner).
DROP POLICY IF EXISTS "exercises_manage" ON public.exercises;
DROP POLICY IF EXISTS "exercises_select" ON public.exercises;
DROP POLICY IF EXISTS "exercises_insert" ON public.exercises;
DROP POLICY IF EXISTS "exercises_update" ON public.exercises;
DROP POLICY IF EXISTS "exercises_delete" ON public.exercises;

-- SELECT: own workspace exercises + YBS global exercises.
-- (has_workspace_access(NULL) is false, so global rows are covered
-- exclusively by the workspace_id IS NULL clause.)
CREATE POLICY "exercises_select" ON public.exercises
FOR SELECT TO authenticated
USING (
  workspace_id IS NULL
  OR public.is_platform_owner()
  OR public.has_workspace_access(workspace_id)
);

-- INSERT: workspace users create workspace-owned rows only.
-- Global (NULL) inserts require the platform owner.
CREATE POLICY "exercises_insert" ON public.exercises
FOR INSERT TO authenticated
WITH CHECK (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
);

-- UPDATE: workspace users update own rows only (and can never move a
-- row into/out of global scope); platform owner manages global rows.
CREATE POLICY "exercises_update" ON public.exercises
FOR UPDATE TO authenticated
USING (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
)
WITH CHECK (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
);

-- DELETE: same scope as UPDATE (app uses soft-archive via UPDATE,
-- but hard deletes stay under the same authorization).
CREATE POLICY "exercises_delete" ON public.exercises
FOR DELETE TO authenticated
USING (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
);

-- ============================================================
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
--
-- 1. Global scope populated, IDs preserved:
--      SELECT count(*) AS global_active
--      FROM public.exercises
--      WHERE workspace_id IS NULL AND is_global = true
--        AND is_archived = false;
--
-- 2. YBS Default Workspace owns nothing anymore:
--      SELECT count(*) AS ybs_default_remaining
--      FROM public.exercises e
--      JOIN public.workspaces w ON w.id = e.workspace_id
--      WHERE w.name = 'YBS Default Workspace';
--
-- 3. KENDO / Drbahaa rows untouched (counts unchanged vs pre-migration).
--
-- 4. No dangling workout references (FK is on id; UPDATE kept ids):
--      SELECT count(*) AS orphan_refs
--      FROM public.workout_exercises we
--      LEFT JOIN public.exercises e ON e.id = we.exercise_id
--      WHERE we.exercise_id IS NOT NULL AND e.id IS NULL;
--    (expected 0 new orphans)
--
-- 5. Policies present:
--      SELECT policyname FROM pg_policies
--      WHERE tablename = 'exercises' ORDER BY policyname;
--    (expected: exercises_delete, exercises_insert,
--     exercises_select, exercises_update)
-- ============================================================

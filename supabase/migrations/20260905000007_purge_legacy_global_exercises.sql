-- ============================================================
-- YBS SYSTEM: PURGE LEGACY GLOBAL EXERCISE LIBRARY
-- Migration: 20260905000007_purge_legacy_global_exercises.sql
--
-- Removes every exercise with workspace_id IS NULL (the placeholder
-- legacy seeds from migration 04 and any other global rows). YBS has
-- NO Global/Shared Exercise Library by design. Every exercise must be
-- owned by a specific Workspace.
--
-- References to the removed rows are safe: workout_exercises.exercise_id
-- (and the migration-08 exercise reference) are ON DELETE SET NULL, so
-- existing workout plans keep their exercise_name/video snapshots.
--
-- This is a PERMANENT DELETE. The 10 legacy seed rows (Barbell Bench
-- Press, Incline Dumbbell Press, Barbell Back Squat, Romanian Deadlift,
-- Lat Pulldown, Barbell Bent-Over Row, Dumbbell Overhead Shoulder Press,
-- Lateral Raises, Barbell Bicep Curl, Tricep Rope Pushdown) are removed
-- and NOT copied into any workspace.
-- ============================================================

-- 1. Count, delete and verify in one auditable step.
--    RAISE NOTICE reports the exact runtime counts (expected found=10).
DO $$
DECLARE
  v_found INTEGER;
  v_deleted INTEGER;
  v_remaining INTEGER;
BEGIN
  SELECT count(*) INTO v_found FROM public.exercises WHERE workspace_id IS NULL;

  DELETE FROM public.exercises WHERE workspace_id IS NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  SELECT count(*) INTO v_remaining FROM public.exercises WHERE workspace_id IS NULL;

  RAISE NOTICE 'Global exercise purge: found=%, deleted=%, remaining_after=%',
    v_found, v_deleted, v_remaining;

  IF v_remaining > 0 THEN
    RAISE WARNING 'CRITICAL: % active/global exercises remain with workspace_id IS NULL', v_remaining;
  END IF;
END $$;

-- 2. Constraint: no ACTIVE exercise may ever exist without a Workspace.
--    Archived rows are exempt (they represent intentionally removed items),
--    but active rows must always belong to a specific Workspace. This
--    closes the door on both the app and any SQL that tries to insert a
--    new global/active exercise with workspace_id = NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exercises_no_global_active_check'
      AND conrelid = 'public.exercises'::regclass
  ) THEN
    ALTER TABLE public.exercises
      ADD CONSTRAINT exercises_no_global_active_check
      CHECK (is_archived = true OR workspace_id IS NOT NULL);
  END IF;
END $$;

-- ============================================================
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
-- Expected result #1: global_total = 0, global_active = 0.
-- ============================================================
SELECT
  (SELECT count(*) FROM public.exercises WHERE workspace_id IS NULL)                  AS global_total,
  (SELECT count(*) FROM public.exercises WHERE workspace_id IS NULL AND is_archived = false) AS global_active;

-- Expected result #2: one row per workspace with its OWN exercise count
-- (YBS Default Workspace, Kendo, etc. — each showing workspace-owned
-- exercises only; no "global" bucket).
SELECT w.name AS workspace_name,
       count(e.id) AS workspace_exercises
FROM public.workspaces w
LEFT JOIN public.exercises e ON e.workspace_id = w.id
GROUP BY w.id, w.name
ORDER BY w.created_at ASC;
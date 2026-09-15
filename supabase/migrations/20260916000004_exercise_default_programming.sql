-- ============================================================
-- YBS SYSTEM: EXERCISE LIBRARY DEFAULT PROGRAMMING
-- Migration: 20260916000004_exercise_default_programming.sql
--
-- Adds per-exercise DEFAULT PROGRAMMING to the Exercise Library so the
-- Exercise Planner / Workout Plan Builder can prefill NEW exercise rows
-- from the library defaults:
--   default_rest_seconds  — default rest between working sets (sec)
--   default_rep_min       — default rep range lower bound
--   default_rep_max       — default rep range upper bound
--   default_warmup_sets   — default warm-up set count
--
-- These are DEFAULTS ONLY: they are consumed when a NEW planner row is
-- created. Existing workout_plans / workout_exercises prescriptions are
-- never touched, and editing a plan row never writes back here.
--
-- Backward compatible: ADD COLUMN IF NOT EXISTS (idempotent); existing
-- exercise rows receive the project-standard defaults (90s / 8-12 / 1)
-- through the column DEFAULT — there is no separate backfill needed and
-- no intentional per-exercise data existed before this migration.
-- ============================================================

ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS default_rest_seconds INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS default_rep_min INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS default_rep_max INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS default_warmup_sets INTEGER NOT NULL DEFAULT 1;
-- ============================================================
-- YBS SYSTEM: FIX DUPLICATE WORKOUT-PLAN ASSIGNMENTS
-- Migration: 20260913000002_fix_workout_plan_duplicate_assignment.sql
--
-- Background
-- ----------
-- The workout builder's "Assign Workout Plan to Client" action performed an
-- unconditional INSERT per click with no in-flight guard, and the client
-- picker stayed open for the whole (slow) save. Re-clicking an assignment
-- target within a few seconds therefore created additional full, content-
-- identical workout_plans rows (each with its own workout_days and
-- workout_exercises). Application fix: synchronous re-entrancy guard in
-- WorkoutsService's caller + disabled picker rows.
--
-- This migration only cleans up the confirmed accidental duplicates that
-- already exist, by ARCHIVING (is_archived = true) the non-canonical copies.
-- Soft-archive, not delete: preserves every workout_days / workout_exercises
-- / workout_logs / form-assignment row and is fully reversible.
--
-- Canonical row selection per duplicate group:
--   * Ahmed Gahzy  (YBS-9544)  -> keep 315e4990-... (row the builder kept
--     editing: updated_at > created_at)
--   * Ahmedkhaled  (YBS-9750)  -> keep c1c547d6-... (same rationale)
--   * Mohammed Elkazaz (YBS-7712) -> keep c2b4f91d-... (only row with
--     workout_logs — the live program)
-- Content within each group was verified identical day-by-day at the
-- exercise level before cleanup.
-- ============================================================

BEGIN;

-- Duplicate group 1 - Ahmed Gahzy (YBS-9544) "PPLUL (default library)  (Template)"
UPDATE public.workout_plans
   SET is_archived = true, updated_at = now()
 WHERE id = '95c2e213-be53-47c8-aef0-5173da7a8235';

-- Duplicate group 2 - Ahmedkhaled (YBS-9750) "TORSO LIMBS CHEST FOCUSED"
UPDATE public.workout_plans
   SET is_archived = true, updated_at = now()
 WHERE id = '4f0333d5-efe2-42f2-9039-5da9e232ecbb';

-- Duplicate group 3 - Mohammed Elkazaz (YBS-7712)
-- "TORSO LIMBS CHEST FOCUSED (default library) (SHOULDERS&CHEST FOCUSED)"
UPDATE public.workout_plans
   SET is_archived = true, updated_at = now()
 WHERE id IN ('c1d63777-0b8f-4efd-bf47-495f168cbee0',
              '0c244266-ccdf-41a5-8d5e-8379d26d2317');

COMMIT;
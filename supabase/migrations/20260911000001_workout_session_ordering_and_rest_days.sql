-- ============================================================
-- YBS SYSTEM: WORKOUT SESSION ORDERING & REST DAY ITEMS
-- Migration: 20260911000001_workout_session_ordering_and_rest_days.sql
-- Additive only — preserves all existing tables and data
-- ============================================================

-- 1. Add day_type column to workout_days to formally model program item types
ALTER TABLE public.workout_days
  ADD COLUMN IF NOT EXISTS day_type TEXT NOT NULL DEFAULT 'session'
  CHECK (day_type IN ('session', 'rest_day'));

-- 2. Backfill existing records: any day flagged as rest_day receives day_type = 'rest_day'
UPDATE public.workout_days
SET day_type = 'rest_day'
WHERE rest_day = true AND day_type <> 'rest_day';

UPDATE public.workout_days
SET day_type = 'session'
WHERE (rest_day = false OR rest_day IS NULL) AND day_type <> 'session';

-- 3. Bi-directional sync trigger between day_type and legacy rest_day boolean
CREATE OR REPLACE FUNCTION public.sync_workout_day_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- If day_type was explicitly updated or set
  IF NEW.day_type = 'rest_day' THEN
    NEW.rest_day := true;
  ELSIF NEW.day_type = 'session' THEN
    NEW.rest_day := false;
  -- If rest_day was changed but day_type wasn't
  ELSIF NEW.rest_day = true THEN
    NEW.day_type := 'rest_day';
  ELSE
    NEW.day_type := 'session';
    NEW.rest_day := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_workout_day_type ON public.workout_days;

CREATE TRIGGER trg_sync_workout_day_type
BEFORE INSERT OR UPDATE ON public.workout_days
FOR EACH ROW
EXECUTE FUNCTION public.sync_workout_day_type();

-- 4. Composite index for fast ordered queries by plan
CREATE INDEX IF NOT EXISTS idx_workout_days_plan_sort
  ON public.workout_days (workout_plan_id, sort_order ASC);

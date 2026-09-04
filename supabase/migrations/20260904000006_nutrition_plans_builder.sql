-- ============================================================
-- YBS SYSTEM: NUTRITION PLANS BUILDER (MIGRATION 20260904000006)
-- Additive only — no destructive changes
-- ============================================================

-- 1. Add day_number column with check constraint (defaults to 1 for all existing and new meals)
ALTER TABLE public.nutrition_meals
  ADD COLUMN IF NOT EXISTS day_number INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nutrition_meals_day_number_check'
  ) THEN
    ALTER TABLE public.nutrition_meals
      ADD CONSTRAINT nutrition_meals_day_number_check
      CHECK (day_number >= 1);
  END IF;
END $$;

-- 2. Index for plan and day lookups (supports single-day and future multi-day queries)
CREATE INDEX IF NOT EXISTS idx_nutrition_meals_plan_day
  ON public.nutrition_meals(nutrition_plan_id, day_number);

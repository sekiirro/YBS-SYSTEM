-- ============================================================
-- YBS SYSTEM: FOOD DATABASE EXTENSION (MIGRATION 20260904000001)
-- Extends public.foods to support a large, useful nutrition database
-- including Arabic names, aliases, brands, source attribution and
-- duplicate prevention for imported records.
--
-- Backward compatible: only ADDs columns/constraints/indexes.
-- Does NOT modify or reset existing food rows.
-- ============================================================

-- 1. Add supporting columns (idempotent)
ALTER TABLE public.foods
    ADD COLUMN IF NOT EXISTS name_ar TEXT,
    ADD COLUMN IF NOT EXISTS brand TEXT,
    ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS micronutrients JSONB,
    ADD COLUMN IF NOT EXISTS source TEXT,
    ADD COLUMN IF NOT EXISTS external_id TEXT,
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Partial unique index to prevent duplicate imported records.
--    source + external_id must be unique together. We ignore rows where
--    either is NULL (manual foods) so multiple manual foods can share the
--    same name without being blocked.
CREATE UNIQUE INDEX IF NOT EXISTS idx_foods_source_external_unique
    ON public.foods (source, external_id)
    WHERE source IS NOT NULL AND external_id IS NOT NULL;

-- 3. Indexes to support fast active-food search by name/aliases/brand.
CREATE INDEX IF NOT EXISTS idx_foods_name ON public.foods (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_foods_name_ar ON public.foods (LOWER(name_ar));
CREATE INDEX IF NOT EXISTS idx_foods_brand ON public.foods (LOWER(brand))
    WHERE brand IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_foods_category ON public.foods (category);

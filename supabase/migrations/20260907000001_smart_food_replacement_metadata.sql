-- ============================================================
-- YBS SYSTEM: SMART FOOD REPLACEMENT METADATA FOUNDATION
-- Migration: 20260907000001_smart_food_replacement_metadata.sql
--
-- Additive only. Builds the data/model foundation for the future
-- deterministic Smart Food Replacement engine.
--
-- Adds:
--   * food_roles                      (global lookup: functional role)
--   * foods.food_role_id              (FK -> food_roles)
--   * foods.dietary_flags             (TEXT[])
--   * food_allergens                  (global lookup: major allergens)
--   * food_allergen_links             (foods <-> allergens junction)
--   * food_substitution_groups        (global + workspace-scoped groups)
--   * food_substitution_members       (groups <-> foods junction)
--
-- Design rules:
--   * Existing category column is untouched (backward compatible).
--   * food_role is a RANKING SIGNAL, NOT a hard substitution rule.
--   * No existing macros, names, categories, or serving data change.
--   * No foods are created, deleted, or duplicated.
--   * RLS follows the existing YBS workspace/global-food access model.
-- ============================================================

-- ============================================================
-- 1. FOOD ROLES (global lookup table)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.food_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.food_roles ENABLE ROW LEVEL SECURITY;

INSERT INTO public.food_roles (slug, name, description, sort_order) VALUES
    ('lean_protein',       'Lean Protein',       'Low-fat protein-dominant source (poultry breast, lean fish, egg whites).', 10),
    ('fatty_protein',      'Fatty Protein',      'Protein source with a meaningful fat contribution (eggs, thighs, oily fish, lamb).', 20),
    ('plant_protein',      'Plant Protein',      'Legume / plant-based protein source (lentils, beans, chickpeas).', 30),
    ('carb',               'Carbohydrate',       'Primary starchy carbohydrate source without heavy fiber (rice, pasta, bread).', 40),
    ('high_fiber_carb',    'High-Fiber Carb',    'Carbohydrate source that is notably rich in fiber (oats, whole grains).', 50),
    ('fruit',              'Fruit',              'Whole fruit source (fresh or dried).', 60),
    ('vegetable',          'Vegetable',          'Non-starchy vegetable, generally low calorie.', 70),
    ('starchy_vegetable',  'Starchy Vegetable',  'Vegetable that primarily contributes complex carbohydrates (potato, sweet potato).', 80),
    ('fat_source',         'Fat Source',         'Concentrated fat source (oils, nuts, seeds, butters, avocado).', 90),
    ('dairy',              'Dairy',              'Milk and milk-derived products (milk, yogurt, cheese, labneh).', 100),
    ('mixed',              'Mixed / Condiment',  'Processed or composite item without a single dominant functional role (condiments, spreads).', 110)
ON CONFLICT (slug) DO NOTHING;

-- 2. ADD food_role_id + dietary_flags TO foods
ALTER TABLE public.foods
    ADD COLUMN IF NOT EXISTS food_role_id UUID REFERENCES public.food_roles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS dietary_flags TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_foods_food_role_id ON public.foods (food_role_id);
CREATE INDEX IF NOT EXISTS idx_foods_dietary_flags ON public.foods USING GIN (dietary_flags);

-- ============================================================
-- 3. FOOD ALLERGENS (global lookup table)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.food_allergens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    common_alternatives TEXT[]
);

ALTER TABLE public.food_allergens ENABLE ROW LEVEL SECURITY;

INSERT INTO public.food_allergens (slug, name, common_alternatives) VALUES
    ('gluten',      'Gluten',      ARRAY['wheat', 'barley', 'rye', 'spelt', 'semolina']),
    ('dairy',       'Dairy',       ARRAY['milk', 'cheese', 'yogurt', 'butter', 'cream', 'whey']),
    ('eggs',        'Eggs',        ARRAY['egg white', 'egg yolk', 'albumen']),
    ('fish',        'Fish',        ARRAY['tuna', 'salmon', 'tilapia', 'mackerel', 'cod']),
    ('shellfish',   'Shellfish',   ARRAY['shrimp', 'prawn', 'crab', 'lobster']),
    ('tree_nuts',   'Tree Nuts',   ARRAY['almonds', 'walnuts', 'cashews', 'pistachios', 'hazelnuts']),
    ('peanuts',     'Peanuts',     ARRAY['peanut', 'groundnut']),
    ('soy',         'Soy',         ARRAY['soybean', 'tofu', 'edamame', 'soy sauce']),
    ('sesame',      'Sesame',      ARRAY['tahini', 'sesame oil', 'sesame seeds']),
    ('sulfites',    'Sulfites',    ARRAY['preserved', 'dried fruit', 'wine']),
    ('mustard',     'Mustard',     ARRAY['mustard seeds', 'mustard powder']),
    ('celery',      'Celery',      ARRAY['celeriac', 'celery seed']),
    ('lupin',       'Lupin',       ARRAY['lupin flour', 'lupin seeds']),
    ('mollusks',    'Mollusks',    ARRAY['mussels', 'oysters', 'clams', 'squid'])
ON CONFLICT (slug) DO NOTHING;

-- 4. FOOD <-> ALLERGEN JUNCTION
CREATE TABLE IF NOT EXISTS public.food_allergen_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    food_id UUID NOT NULL REFERENCES public.foods(id) ON DELETE CASCADE,
    allergen_id UUID NOT NULL REFERENCES public.food_allergens(id) ON DELETE CASCADE,
    CONSTRAINT uq_food_allergen UNIQUE (food_id, allergen_id)
);

CREATE INDEX IF NOT EXISTS idx_food_allergen_links_food_id ON public.food_allergen_links (food_id);
CREATE INDEX IF NOT EXISTS idx_food_allergen_links_allergen_id ON public.food_allergen_links (allergen_id);

ALTER TABLE public.food_allergen_links ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. FOOD SUBSTITUTION GROUPS (global + workspace-scoped)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.food_substitution_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE -- NULL = global group
);

CREATE INDEX IF NOT EXISTS idx_food_substitution_groups_workspace_id ON public.food_substitution_groups (workspace_id);

ALTER TABLE public.food_substitution_groups ENABLE ROW LEVEL SECURITY;

-- 6. GROUP <-> FOOD JUNCTION
CREATE TABLE IF NOT EXISTS public.food_substitution_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES public.food_substitution_groups(id) ON DELETE CASCADE,
    food_id UUID NOT NULL REFERENCES public.foods(id) ON DELETE CASCADE,
    is_preferred BOOLEAN NOT NULL DEFAULT false,
    priority INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_substitution_group_food UNIQUE (group_id, food_id)
);

CREATE INDEX IF NOT EXISTS idx_food_substitution_members_food_id ON public.food_substitution_members (food_id);
CREATE INDEX IF NOT EXISTS idx_food_substitution_members_group_id ON public.food_substitution_members (group_id);

ALTER TABLE public.food_substitution_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. CLASSIFY EXISTING FOODS (role + dietary flags)
--    Matches exclusively on the seeded global foods (workspace_id IS NULL).
--    Organ/liver meats are intentionally left without a role rather
--    than receiving a misleading one.
-- ============================================================

-- ---- lean_protein ----
UPDATE public.foods SET food_role_id = (SELECT id FROM public.food_roles WHERE slug = 'lean_protein') WHERE workspace_id IS NULL AND name IN (
    'Chicken Breast — Cooked, Skinless',
    'Beef — Sirloin, Cooked',
    'Veal — Cooked',
    'Chicken Gizzards — Cooked',
    'Egg White — Raw',
    'Tuna — Canned in Water',
    'Tilapia — Cooked',
    'Mullet — Cooked',
    'Sea Bass — Cooked',
    'Shrimp — Cooked',
    'Beef — 90% Lean Ground, Raw'
);

-- ---- fatty_protein ----
UPDATE public.foods SET food_role_id = (SELECT id FROM public.food_roles WHERE slug = 'fatty_protein') WHERE workspace_id IS NULL AND name IN (
    'Chicken Thigh — Cooked',
    'Beef — Ground 80/20, Cooked',
    'Lamb — Cooked',
    'Egg — Whole, Boiled',
    'Egg — Whole, Raw',
    'Sardines — Canned in Oil',
    'Salmon — Atlantic, Cooked'
);

-- ---- plant_protein ----
UPDATE public.foods SET food_role_id = (SELECT id FROM public.food_roles WHERE slug = 'plant_protein') WHERE workspace_id IS NULL AND name IN (
    'Lentils — Cooked',
    'Fava Beans — Cooked (Ful)',
    'Chickpeas — Cooked',
    'Kidney Beans — Cooked',
    'White Beans — Cooked',
    'Black Beans — Cooked'
);

-- ---- carb ----
UPDATE public.foods SET food_role_id = (SELECT id FROM public.food_roles WHERE slug = 'carb') WHERE workspace_id IS NULL AND name IN (
    'White Rice — Cooked',
    'Basmati Rice — Cooked',
    'Brown Rice — Cooked',
    'Pasta — Cooked',
    'Couscous — Cooked',
    'White Bread / Toast',
    'Baladi Bread (Egyptian Flatbread)',
    'Rice Flour — White',
    'Pasta — Dry, Enriched',
    'Corn Tortilla',
    'Rice Cakes — Brown Rice, Plain',
    'Whole Wheat Bread',
    'Dates — Medjool'
);

-- ---- high_fiber_carb ----
UPDATE public.foods SET food_role_id = (SELECT id FROM public.food_roles WHERE slug = 'high_fiber_carb') WHERE workspace_id IS NULL AND name IN (
    'Oats — Dry Rolled'
);

-- ---- fruit ----
UPDATE public.foods SET food_role_id = (SELECT id FROM public.food_roles WHERE slug = 'fruit') WHERE workspace_id IS NULL AND name IN (
    'Banana — Raw',
    'Apple — Raw, with Skin',
    'Orange — Navel, Raw',
    'Strawberries — Raw'
);

-- ---- vegetable ----
UPDATE public.foods SET food_role_id = (SELECT id FROM public.food_roles WHERE slug = 'vegetable') WHERE workspace_id IS NULL AND name IN (
    'Corn — Sweet Yellow, Cooked',
    'Green Peas — Cooked',
    'Carrot — Raw',
    'Tomato — Raw',
    'Cucumber — Raw',
    'Onion — Raw',
    'Garlic — Raw',
    'Bell Pepper — Green, Raw',
    'Spinach — Raw',
    'Broccoli — Raw',
    'Zucchini — Raw',
    'Eggplant — Raw'
);

-- ---- starchy_vegetable ----
UPDATE public.foods SET food_role_id = (SELECT id FROM public.food_roles WHERE slug = 'starchy_vegetable') WHERE workspace_id IS NULL AND name IN (
    'Potato — Boiled',
    'Sweet Potato — Baked'
);

-- ---- fat_source ----
UPDATE public.foods SET food_role_id = (SELECT id FROM public.food_roles WHERE slug = 'fat_source') WHERE workspace_id IS NULL AND name IN (
    'Avocado — California, Raw',
    'Chia Seeds — Dried',
    'Almonds — Raw',
    'Walnuts — Raw',
    'Peanuts — Raw',
    'Sunflower Seeds — Dried',
    'Peanut Butter — Smooth',
    'Olive Oil'
);

-- ---- dairy ----
UPDATE public.foods SET food_role_id = (SELECT id FROM public.food_roles WHERE slug = 'dairy') WHERE workspace_id IS NULL AND name IN (
    'Milk — Full Fat (Whole)',
    'Milk — Low Fat (1%)',
    'Milk — Skim (Nonfat)',
    'Yogurt — Plain Whole',
    'Greek Yogurt — Plain Nonfat',
    'Cottage Cheese — 2% Fat',
    'Labneh (Strained Yogurt)',
    'Feta Cheese',
    'Cheddar Cheese',
    'Mozzarella Cheese',
    'Romani Cheese (Egyptian Hard Cheese)',
    'Mozzarella Cheese — Part Skim (Light)',
    'Cottage Cheese — Low Fat (1%)',
    'Juhayna Greek Yogurt 0.2%',
    'HiPro Spoonable Plain',
    'Juhayna Full Cream Milk',
    'Juhayna Low Fat Milk',
    'Juhayna Plain Yogurt'
);

-- ---- mixed (processed/condiment items) ----
UPDATE public.foods SET food_role_id = (SELECT id FROM public.food_roles WHERE slug = 'mixed') WHERE workspace_id IS NULL AND name IN (
    'Strawberry Jam / Preserves',
    'Honey',
    'Ketchup',
    'Yellow Mustard — Prepared',
    'BBQ Sauce',
    'Mayonnaise — Light (Reduced Fat)',
    'Heinz Ketchup',
    'Heinz Light Mayonnaise',
    'Tang Orange Drink Mix — Powder'
);

-- NOTE: Organ meats (Chicken Liver — Cooked, Beef Liver — Cooked) receive no
-- role (the 11-role set has no organ-meat role). Nothing forces a misleading tag.

-- ============================================================
-- 8. DIETARY FLAGS (conservative assignment)
--    halal/kosher only where inherently satisfied by the food type
--    (whole plant foods, scaled fish, eggs, plain milk/yogurt).
--    NOT applied to red meat/poultry (slaughter certification) or
--    cheese (rennet) or processed/branded items.
-- ============================================================

-- 8a. Whole plant foods (grains, legumes, vegetables, fruits, nuts, seeds, oils)
UPDATE public.foods SET dietary_flags = ARRAY['vegetarian', 'vegan', 'gluten_free', 'dairy_free', 'halal', 'kosher']
WHERE workspace_id IS NULL AND name IN (
    'White Rice — Cooked',
    'Basmati Rice — Cooked',
    'Brown Rice — Cooked',
    'Potato — Boiled',
    'Sweet Potato — Baked',
    'Lentils — Cooked',
    'Fava Beans — Cooked (Ful)',
    'Chickpeas — Cooked',
    'Kidney Beans — Cooked',
    'White Beans — Cooked',
    'Black Beans — Cooked',
    'Corn — Sweet Yellow, Cooked',
    'Green Peas — Cooked',
    'Carrot — Raw',
    'Tomato — Raw',
    'Cucumber — Raw',
    'Onion — Raw',
    'Garlic — Raw',
    'Bell Pepper — Green, Raw',
    'Spinach — Raw',
    'Broccoli — Raw',
    'Zucchini — Raw',
    'Eggplant — Raw',
    'Banana — Raw',
    'Apple — Raw, with Skin',
    'Orange — Navel, Raw',
    'Strawberries — Raw',
    'Dates — Medjool',
    'Avocado — California, Raw',
    'Chia Seeds — Dried',
    'Almonds — Raw',
    'Walnuts — Raw',
    'Peanuts — Raw',
    'Sunflower Seeds — Dried',
    'Peanut Butter — Smooth',
    'Olive Oil',
    'Rice Flour — White',
    'Corn Tortilla',
    'Rice Cakes — Brown Rice, Plain'
);

-- Oats: vegetarian/vegan/dairy-free, but NOT flagged gluten_free (cross-contamination risk)
UPDATE public.foods SET dietary_flags = ARRAY['vegetarian', 'vegan', 'dairy_free', 'halal', 'kosher']
WHERE workspace_id IS NULL AND name = 'Oats — Dry Rolled';

-- Wheat-derived carb items: vegetarian/vegan/dairy-free, gluten NOT excluded
UPDATE public.foods SET dietary_flags = ARRAY['vegetarian', 'vegan', 'dairy_free', 'halal', 'kosher']
WHERE workspace_id IS NULL AND name IN (
    'Pasta — Cooked',
    'Couscous — Cooked',
    'White Bread / Toast',
    'Baladi Bread (Egyptian Flatbread)',
    'Pasta — Dry, Enriched',
    'Whole Wheat Bread'
);

-- 8b. Poultry / red meat (halal/kosher OFF — slaughter certification not in data)
UPDATE public.foods SET dietary_flags = ARRAY['gluten_free', 'dairy_free']
WHERE workspace_id IS NULL AND name IN (
    'Chicken Breast — Cooked, Skinless',
    'Chicken Thigh — Cooked',
    'Chicken Gizzards — Cooked',
    'Beef — Ground 80/20, Cooked',
    'Beef — Sirloin, Cooked',
    'Veal — Cooked',
    'Lamb — Cooked',
    'Beef — 90% Lean Ground, Raw'
);

-- 8c. Eggs (halal/kosher inherent, vegetarian, gluten/dairy-free; NOT vegan)
UPDATE public.foods SET dietary_flags = ARRAY['vegetarian', 'gluten_free', 'dairy_free', 'halal', 'kosher']
WHERE workspace_id IS NULL AND name IN (
    'Egg — Whole, Boiled',
    'Egg — Whole, Raw',
    'Egg White — Raw'
);

-- 8d. Fish with scales (halal/kosher inherent, gluten/dairy-free)
UPDATE public.foods SET dietary_flags = ARRAY['gluten_free', 'dairy_free', 'halal', 'kosher']
WHERE workspace_id IS NULL AND name IN (
    'Tuna — Canned in Water',
    'Tilapia — Cooked',
    'Mullet — Cooked',
    'Sea Bass — Cooked',
    'Sardines — Canned in Oil',
    'Salmon — Atlantic, Cooked'
);

-- Shellfish (gluten/dairy-free only; kosher OFF — not a scaled fish; halal left OFF)
UPDATE public.foods SET dietary_flags = ARRAY['gluten_free', 'dairy_free']
WHERE workspace_id IS NULL AND name IN (
    'Shrimp — Cooked'
);

-- 8e. Plain milk & yogurt (vegetarian, gluten-free; rennet-free fermented dairy)
UPDATE public.foods SET dietary_flags = ARRAY['vegetarian', 'gluten_free', 'halal', 'kosher']
WHERE workspace_id IS NULL AND name IN (
    'Milk — Full Fat (Whole)',
    'Milk — Low Fat (1%)',
    'Milk — Skim (Nonfat)',
    'Yogurt — Plain Whole',
    'Greek Yogurt — Plain Nonfat'
);

-- 8f. Cheese & branded dairy (vegetarian per microbial rennet assumption, gluten-free;
--     kosher/halal OFF for rennet/processing uncertainty)
UPDATE public.foods SET dietary_flags = ARRAY['vegetarian', 'gluten_free']
WHERE workspace_id IS NULL AND name IN (
    'Cottage Cheese — 2% Fat',
    'Labneh (Strained Yogurt)',
    'Feta Cheese',
    'Cheddar Cheese',
    'Mozzarella Cheese',
    'Romani Cheese (Egyptian Hard Cheese)',
    'Mozzarella Cheese — Part Skim (Light)',
    'Cottage Cheese — Low Fat (1%)',
    'Juhayna Greek Yogurt 0.2%',
    'HiPro Spoonable Plain',
    'Juhayna Full Cream Milk',
    'Juhayna Low Fat Milk',
    'Juhayna Plain Yogurt'
);

-- 8g. Organ meats (gluten/dairy-free only — no other flag supported)
UPDATE public.foods SET dietary_flags = ARRAY['gluten_free', 'dairy_free']
WHERE workspace_id IS NULL AND name IN (
    'Chicken Liver — Cooked',
    'Beef Liver — Cooked'
);

-- 8h. Processed / condiment items (conservative: no halal/kosher; gluten status varies)
UPDATE public.foods SET dietary_flags = ARRAY['vegetarian', 'vegan', 'dairy_free']
WHERE workspace_id IS NULL AND name IN (
    'Strawberry Jam / Preserves',
    'Ketchup',
    'Heinz Ketchup',
    'Tang Orange Drink Mix — Powder'
);

-- Honey: vegetarian, gluten/dairy-free, halal/kosher; NOT vegan
UPDATE public.foods SET dietary_flags = ARRAY['vegetarian', 'gluten_free', 'dairy_free', 'halal', 'kosher']
WHERE workspace_id IS NULL AND name = 'Honey';

-- Yellow Mustard: vegetarian/vegan, gluten-free (+mustard allergen), dairy-free
UPDATE public.foods SET dietary_flags = ARRAY['vegetarian', 'vegan', 'gluten_free', 'dairy_free']
WHERE workspace_id IS NULL AND name = 'Yellow Mustard — Prepared';

-- Egg-based mayonnaise: vegetarian, gluten/dairy-free; NOT vegan
UPDATE public.foods SET dietary_flags = ARRAY['vegetarian', 'gluten_free', 'dairy_free']
WHERE workspace_id IS NULL AND name IN (
    'Mayonnaise — Light (Reduced Fat)',
    'Heinz Light Mayonnaise'
);

-- BBQ sauce: no dietary flag confidently supported by the label data
UPDATE public.foods SET dietary_flags = ARRAY[]::TEXT[]
WHERE workspace_id IS NULL AND name = 'BBQ Sauce';

-- ============================================================
-- 9. ALLERGEN LINKS (only where the allergen is clearly present)
-- ============================================================

-- Gluten (wheat-derived)
INSERT INTO public.food_allergen_links (food_id, allergen_id)
SELECT f.id, a.id FROM public.foods f, public.food_allergens a
WHERE f.workspace_id IS NULL AND a.slug = 'gluten' AND f.name IN (
    'Pasta — Cooked',
    'Couscous — Cooked',
    'White Bread / Toast',
    'Baladi Bread (Egyptian Flatbread)',
    'Pasta — Dry, Enriched',
    'Whole Wheat Bread'
)
ON CONFLICT (food_id, allergen_id) DO NOTHING;

-- Dairy
INSERT INTO public.food_allergen_links (food_id, allergen_id)
SELECT f.id, a.id FROM public.foods f, public.food_allergens a
WHERE f.workspace_id IS NULL AND a.slug = 'dairy' AND f.name IN (
    'Milk — Full Fat (Whole)',
    'Milk — Low Fat (1%)',
    'Milk — Skim (Nonfat)',
    'Yogurt — Plain Whole',
    'Greek Yogurt — Plain Nonfat',
    'Cottage Cheese — 2% Fat',
    'Labneh (Strained Yogurt)',
    'Feta Cheese',
    'Cheddar Cheese',
    'Mozzarella Cheese',
    'Romani Cheese (Egyptian Hard Cheese)',
    'Mozzarella Cheese — Part Skim (Light)',
    'Cottage Cheese — Low Fat (1%)',
    'Juhayna Greek Yogurt 0.2%',
    'HiPro Spoonable Plain',
    'Juhayna Full Cream Milk',
    'Juhayna Low Fat Milk',
    'Juhayna Plain Yogurt'
)
ON CONFLICT (food_id, allergen_id) DO NOTHING;

-- Eggs
INSERT INTO public.food_allergen_links (food_id, allergen_id)
SELECT f.id, a.id FROM public.foods f, public.food_allergens a
WHERE f.workspace_id IS NULL AND a.slug = 'eggs' AND f.name IN (
    'Egg — Whole, Boiled',
    'Egg — Whole, Raw',
    'Egg White — Raw',
    'Mayonnaise — Light (Reduced Fat)',
    'Heinz Light Mayonnaise'
)
ON CONFLICT (food_id, allergen_id) DO NOTHING;

-- Fish
INSERT INTO public.food_allergen_links (food_id, allergen_id)
SELECT f.id, a.id FROM public.foods f, public.food_allergens a
WHERE f.workspace_id IS NULL AND a.slug = 'fish' AND f.name IN (
    'Tuna — Canned in Water',
    'Sardines — Canned in Oil',
    'Salmon — Atlantic, Cooked',
    'Tilapia — Cooked',
    'Mullet — Cooked',
    'Sea Bass — Cooked'
)
ON CONFLICT (food_id, allergen_id) DO NOTHING;

-- Shellfish
INSERT INTO public.food_allergen_links (food_id, allergen_id)
SELECT f.id, a.id FROM public.foods f, public.food_allergens a
WHERE f.workspace_id IS NULL AND a.slug = 'shellfish' AND f.name = 'Shrimp — Cooked'
ON CONFLICT (food_id, allergen_id) DO NOTHING;

-- Tree nuts
INSERT INTO public.food_allergen_links (food_id, allergen_id)
SELECT f.id, a.id FROM public.foods f, public.food_allergens a
WHERE f.workspace_id IS NULL AND a.slug = 'tree_nuts' AND f.name IN (
    'Almonds — Raw',
    'Walnuts — Raw'
)
ON CONFLICT (food_id, allergen_id) DO NOTHING;

-- Peanuts
INSERT INTO public.food_allergen_links (food_id, allergen_id)
SELECT f.id, a.id FROM public.foods f, public.food_allergens a
WHERE f.workspace_id IS NULL AND a.slug = 'peanuts' AND f.name IN (
    'Peanuts — Raw',
    'Peanut Butter — Smooth'
)
ON CONFLICT (food_id, allergen_id) DO NOTHING;

-- Mustard
INSERT INTO public.food_allergen_links (food_id, allergen_id)
SELECT f.id, a.id FROM public.foods f, public.food_allergens a
WHERE f.workspace_id IS NULL AND a.slug = 'mustard' AND f.name = 'Yellow Mustard — Prepared'
ON CONFLICT (food_id, allergen_id) DO NOTHING;

-- ============================================================
-- 10. INITIAL GLOBAL SUBSTITUTION GROUPS
--    Created only where the current food database has enough
--    genuine candidates. priority/is_preferred express coach
--    preferences; membership is a RANKING signal, not a rule.
-- ============================================================

-- 10a. Lean protein sources
INSERT INTO public.food_substitution_groups (name, description, workspace_id)
SELECT 'lean_protein_sources', 'Low-fat, protein-dominant foods suitable for lean-protein contexts.', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.food_substitution_groups WHERE name = 'lean_protein_sources' AND workspace_id IS NULL);

INSERT INTO public.food_substitution_members (group_id, food_id, is_preferred, priority)
SELECT g.id, f.id, CASE WHEN f.name IN ('Chicken Breast — Cooked, Skinless', 'Tuna — Canned in Water') THEN true ELSE false END,
       CASE f.name
           WHEN 'Chicken Breast — Cooked, Skinless' THEN 1
           WHEN 'Tuna — Canned in Water' THEN 2
           WHEN 'Tilapia — Cooked' THEN 3
           WHEN 'Veal — Cooked' THEN 4
           WHEN 'Beef — Sirloin, Cooked' THEN 5
           WHEN 'Mullet — Cooked' THEN 6
           WHEN 'Sea Bass — Cooked' THEN 7
           WHEN 'Cottage Cheese — 2% Fat' THEN 8
           WHEN 'Beef — 90% Lean Ground, Raw' THEN 9
           WHEN 'Egg White — Raw' THEN 10
           WHEN 'Cottage Cheese — Low Fat (1%)' THEN 11
           WHEN 'Chicken Gizzards — Cooked' THEN 12
           ELSE 99
       END
FROM public.food_substitution_groups g, public.foods f
WHERE g.name = 'lean_protein_sources' AND g.workspace_id IS NULL
  AND f.workspace_id IS NULL AND f.name IN (
    'Chicken Breast — Cooked, Skinless',
    'Tuna — Canned in Water',
    'Tilapia — Cooked',
    'Veal — Cooked',
    'Beef — Sirloin, Cooked',
    'Mullet — Cooked',
    'Sea Bass — Cooked',
    'Cottage Cheese — 2% Fat',
    'Beef — 90% Lean Ground, Raw',
    'Egg White — Raw',
    'Cottage Cheese — Low Fat (1%)',
    'Chicken Gizzards — Cooked'
)
ON CONFLICT (group_id, food_id) DO NOTHING;

-- 10b. Whole egg sources
INSERT INTO public.food_substitution_groups (name, description, workspace_id)
SELECT 'whole_egg_sources', 'Whole-egg products interchangeable as-is in meal context.', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.food_substitution_groups WHERE name = 'whole_egg_sources' AND workspace_id IS NULL);

INSERT INTO public.food_substitution_members (group_id, food_id, is_preferred, priority)
SELECT g.id, f.id, true,
       CASE f.name WHEN 'Egg — Whole, Boiled' THEN 1 WHEN 'Egg — Whole, Raw' THEN 2 ELSE 99 END
FROM public.food_substitution_groups g, public.foods f
WHERE g.name = 'whole_egg_sources' AND g.workspace_id IS NULL
  AND f.workspace_id IS NULL AND f.name IN ('Egg — Whole, Boiled', 'Egg — Whole, Raw')
ON CONFLICT (group_id, food_id) DO NOTHING;

-- 10c. Rice & grain sources
INSERT INTO public.food_substitution_groups (name, description, workspace_id)
SELECT 'rice_grain_sources', 'Cooked rice and grain alternatives for starchy-carb contexts.', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.food_substitution_groups WHERE name = 'rice_grain_sources' AND workspace_id IS NULL);

INSERT INTO public.food_substitution_members (group_id, food_id, is_preferred, priority)
SELECT g.id, f.id, CASE WHEN f.name = 'White Rice — Cooked' THEN true ELSE false END,
       CASE f.name
           WHEN 'White Rice — Cooked' THEN 1
           WHEN 'Basmati Rice — Cooked' THEN 2
           WHEN 'Brown Rice — Cooked' THEN 3
           WHEN 'Couscous — Cooked' THEN 4
           WHEN 'Rice Cakes — Brown Rice, Plain' THEN 5
           ELSE 99
       END
FROM public.food_substitution_groups g, public.foods f
WHERE g.name = 'rice_grain_sources' AND g.workspace_id IS NULL
  AND f.workspace_id IS NULL AND f.name IN (
    'White Rice — Cooked',
    'Basmati Rice — Cooked',
    'Brown Rice — Cooked',
    'Couscous — Cooked',
    'Rice Cakes — Brown Rice, Plain'
)
ON CONFLICT (group_id, food_id) DO NOTHING;

-- 10d. Starchy / potato sources
INSERT INTO public.food_substitution_groups (name, description, workspace_id)
SELECT 'potato_starchy_sources', 'Root/starchy vegetables substitutable for potatoes.', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.food_substitution_groups WHERE name = 'potato_starchy_sources' AND workspace_id IS NULL);

INSERT INTO public.food_substitution_members (group_id, food_id, is_preferred, priority)
SELECT g.id, f.id, CASE WHEN f.name = 'Potato — Boiled' THEN true ELSE false END,
       CASE f.name WHEN 'Potato — Boiled' THEN 1 WHEN 'Sweet Potato — Baked' THEN 2 ELSE 99 END
FROM public.food_substitution_groups g, public.foods f
WHERE g.name = 'potato_starchy_sources' AND g.workspace_id IS NULL
  AND f.workspace_id IS NULL AND f.name IN ('Potato — Boiled', 'Sweet Potato — Baked')
ON CONFLICT (group_id, food_id) DO NOTHING;

-- 10e. Fruit sources
INSERT INTO public.food_substitution_groups (name, description, workspace_id)
SELECT 'fruit_sources', 'Whole-fruit sources for snack/dessert carb contexts.', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.food_substitution_groups WHERE name = 'fruit_sources' AND workspace_id IS NULL);

INSERT INTO public.food_substitution_members (group_id, food_id, is_preferred, priority)
SELECT g.id, f.id, CASE WHEN f.name = 'Banana — Raw' THEN true ELSE false END,
       CASE f.name
           WHEN 'Apple — Raw, with Skin' THEN 1
           WHEN 'Banana — Raw' THEN 2
           WHEN 'Orange — Navel, Raw' THEN 3
           WHEN 'Strawberries — Raw' THEN 4
           WHEN 'Dates — Medjool' THEN 5
           ELSE 99
       END
FROM public.food_substitution_groups g, public.foods f
WHERE g.name = 'fruit_sources' AND g.workspace_id IS NULL
  AND f.workspace_id IS NULL AND f.name IN (
    'Apple — Raw, with Skin',
    'Banana — Raw',
    'Orange — Navel, Raw',
    'Strawberries — Raw',
    'Dates — Medjool'
)
ON CONFLICT (group_id, food_id) DO NOTHING;

-- 10f. Vegetable sources
INSERT INTO public.food_substitution_groups (name, description, workspace_id)
SELECT 'vegetable_sources', 'Non-starchy vegetables for volume and micronutrients.', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.food_substitution_groups WHERE name = 'vegetable_sources' AND workspace_id IS NULL);

INSERT INTO public.food_substitution_members (group_id, food_id, is_preferred, priority)
SELECT g.id, f.id, CASE WHEN f.name IN ('Broccoli — Raw', 'Spinach — Raw') THEN true ELSE false END,
       CASE f.name
           WHEN 'Broccoli — Raw' THEN 1
           WHEN 'Spinach — Raw' THEN 2
           WHEN 'Zucchini — Raw' THEN 3
           WHEN 'Cucumber — Raw' THEN 4
           WHEN 'Bell Pepper — Green, Raw' THEN 5
           WHEN 'Tomato — Raw' THEN 6
           WHEN 'Carrot — Raw' THEN 7
           WHEN 'Eggplant — Raw' THEN 8
           WHEN 'Green Peas — Cooked' THEN 9
           WHEN 'Corn — Sweet Yellow, Cooked' THEN 10
           WHEN 'Onion — Raw' THEN 11
           WHEN 'Garlic — Raw' THEN 12
           ELSE 99
       END
FROM public.food_substitution_groups g, public.foods f
WHERE g.name = 'vegetable_sources' AND g.workspace_id IS NULL
  AND f.workspace_id IS NULL AND f.name IN (
    'Broccoli — Raw',
    'Spinach — Raw',
    'Zucchini — Raw',
    'Cucumber — Raw',
    'Bell Pepper — Green, Raw',
    'Tomato — Raw',
    'Carrot — Raw',
    'Eggplant — Raw',
    'Green Peas — Cooked',
    'Corn — Sweet Yellow, Cooked',
    'Onion — Raw',
    'Garlic — Raw'
)
ON CONFLICT (group_id, food_id) DO NOTHING;

-- 10g. Healthy fat sources
INSERT INTO public.food_substitution_groups (name, description, workspace_id)
SELECT 'healthy_fat_sources', 'Nuts, seeds, oils, and butters as concentrated fat sources.', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.food_substitution_groups WHERE name = 'healthy_fat_sources' AND workspace_id IS NULL);

INSERT INTO public.food_substitution_members (group_id, food_id, is_preferred, priority)
SELECT g.id, f.id, CASE WHEN f.name IN ('Olive Oil', 'Almonds — Raw') THEN true ELSE false END,
       CASE f.name
           WHEN 'Olive Oil' THEN 1
           WHEN 'Almonds — Raw' THEN 2
           WHEN 'Avocado — California, Raw' THEN 3
           WHEN 'Walnuts — Raw' THEN 4
           WHEN 'Peanut Butter — Smooth' THEN 5
           WHEN 'Chia Seeds — Dried' THEN 6
           WHEN 'Sunflower Seeds — Dried' THEN 7
           WHEN 'Peanuts — Raw' THEN 8
           ELSE 99
       END
FROM public.food_substitution_groups g, public.foods f
WHERE g.name = 'healthy_fat_sources' AND g.workspace_id IS NULL
  AND f.workspace_id IS NULL AND f.name IN (
    'Olive Oil',
    'Almonds — Raw',
    'Avocado — California, Raw',
    'Walnuts — Raw',
    'Peanut Butter — Smooth',
    'Chia Seeds — Dried',
    'Sunflower Seeds — Dried',
    'Peanuts — Raw'
)
ON CONFLICT (group_id, food_id) DO NOTHING;

-- 10h. Plant protein sources
INSERT INTO public.food_substitution_groups (name, description, workspace_id)
SELECT 'plant_protein_sources', 'Legume-based proteins: an alternative when an animal protein is not an option.', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.food_substitution_groups WHERE name = 'plant_protein_sources' AND workspace_id IS NULL);

INSERT INTO public.food_substitution_members (group_id, food_id, is_preferred, priority)
SELECT g.id, f.id, CASE WHEN f.name = 'Chickpeas — Cooked' THEN true ELSE false END,
       CASE f.name
           WHEN 'Lentils — Cooked' THEN 1
           WHEN 'Chickpeas — Cooked' THEN 2
           WHEN 'Fava Beans — Cooked (Ful)' THEN 3
           WHEN 'Kidney Beans — Cooked' THEN 4
           WHEN 'White Beans — Cooked' THEN 5
           WHEN 'Black Beans — Cooked' THEN 6
           ELSE 99
       END
FROM public.food_substitution_groups g, public.foods f
WHERE g.name = 'plant_protein_sources' AND g.workspace_id IS NULL
  AND f.workspace_id IS NULL AND f.name IN (
    'Lentils — Cooked',
    'Chickpeas — Cooked',
    'Fava Beans — Cooked (Ful)',
    'Kidney Beans — Cooked',
    'White Beans — Cooked',
    'Black Beans — Cooked'
)
ON CONFLICT (group_id, food_id) DO NOTHING;

-- 10i. Dairy sources
INSERT INTO public.food_substitution_groups (name, description, workspace_id)
SELECT 'dairy_sources', 'Milk, yogurt, and fresh cheese alternatives in similar macro roles.', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.food_substitution_groups WHERE name = 'dairy_sources' AND workspace_id IS NULL);

INSERT INTO public.food_substitution_members (group_id, food_id, is_preferred, priority)
SELECT g.id, f.id, CASE WHEN f.name = 'Greek Yogurt — Plain Nonfat' THEN true ELSE false END,
       CASE f.name
           WHEN 'Milk — Skim (Nonfat)' THEN 1
           WHEN 'Greek Yogurt — Plain Nonfat' THEN 2
           WHEN 'Yogurt — Plain Whole' THEN 3
           WHEN 'Milk — Low Fat (1%)' THEN 4
           WHEN 'Cottage Cheese — 2% Fat' THEN 5
           WHEN 'Cottage Cheese — Low Fat (1%)' THEN 6
           WHEN 'Milk — Full Fat (Whole)' THEN 7
           WHEN 'Juhayna Greek Yogurt 0.2%' THEN 8
           WHEN 'HiPro Spoonable Plain' THEN 9
           WHEN 'Labneh (Strained Yogurt)' THEN 10
           ELSE 99
       END
FROM public.food_substitution_groups g, public.foods f
WHERE g.name = 'dairy_sources' AND g.workspace_id IS NULL
  AND f.workspace_id IS NULL AND f.name IN (
    'Milk — Skim (Nonfat)',
    'Greek Yogurt — Plain Nonfat',
    'Yogurt — Plain Whole',
    'Milk — Low Fat (1%)',
    'Cottage Cheese — 2% Fat',
    'Cottage Cheese — Low Fat (1%)',
    'Milk — Full Fat (Whole)',
    'Juhayna Greek Yogurt 0.2%',
    'HiPro Spoonable Plain',
    'Labneh (Strained Yogurt)'
)
ON CONFLICT (group_id, food_id) DO NOTHING;

-- ============================================================
-- 11. ROW LEVEL SECURITY
--     Follows the existing YBS foods access model exactly.
-- ============================================================

-- ---- food_roles (global lookup: readable by all authenticated, writable by platform owner) ----
CREATE POLICY "food_roles_select" ON public.food_roles
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "food_roles_manage" ON public.food_roles
FOR ALL TO authenticated
USING (public.is_platform_owner())
WITH CHECK (public.is_platform_owner());

-- ---- food_allergens (global lookup: readable by all authenticated, writable by platform owner) ----
CREATE POLICY "food_allergens_select" ON public.food_allergens
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "food_allergens_manage" ON public.food_allergens
FOR ALL TO authenticated
USING (public.is_platform_owner())
WITH CHECK (public.is_platform_owner());

-- ---- food_allergen_links (scoped through the food's own workspace access) ----
CREATE POLICY "food_allergen_links_select" ON public.food_allergen_links
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.foods f
    WHERE f.id = food_id
      AND (f.workspace_id IS NULL
           OR public.is_platform_owner()
           OR public.has_workspace_access(f.workspace_id))
  )
);

CREATE POLICY "food_allergen_links_manage" ON public.food_allergen_links
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.foods f
    WHERE f.id = food_id
      AND (public.is_platform_owner()
           OR (f.workspace_id IS NOT NULL AND public.is_workspace_owner(f.workspace_id))
           OR (f.workspace_id IS NOT NULL AND public.has_workspace_permission(f.workspace_id, 'nutrition.fooddb')))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.foods f
    WHERE f.id = food_id
      AND (public.is_platform_owner()
           OR (f.workspace_id IS NOT NULL AND public.is_workspace_owner(f.workspace_id))
           OR (f.workspace_id IS NOT NULL AND public.has_workspace_permission(f.workspace_id, 'nutrition.fooddb')))
  )
);

-- ---- food_substitution_groups (global groups readable as the food DB; workspace groups owner-scoped) ----
CREATE POLICY "food_substitution_groups_select" ON public.food_substitution_groups
FOR SELECT TO authenticated
USING (
  workspace_id IS NULL
  OR public.is_platform_owner()
  OR public.has_workspace_access(workspace_id)
);

CREATE POLICY "food_substitution_groups_manage" ON public.food_substitution_groups
FOR ALL TO authenticated
USING (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
)
WITH CHECK (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
);

-- ---- food_substitution_members (scoped through the group's workspace) ----
CREATE POLICY "food_substitution_members_select" ON public.food_substitution_members
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.food_substitution_groups g
    WHERE g.id = group_id
      AND (g.workspace_id IS NULL
           OR public.is_platform_owner()
           OR public.has_workspace_access(g.workspace_id))
  )
);

CREATE POLICY "food_substitution_members_manage" ON public.food_substitution_members
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.food_substitution_groups g
    WHERE g.id = group_id
      AND (public.is_platform_owner()
           OR (g.workspace_id IS NOT NULL AND public.is_workspace_owner(g.workspace_id)))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.food_substitution_groups g
    WHERE g.id = group_id
      AND (public.is_platform_owner()
           OR (g.workspace_id IS NOT NULL AND public.is_workspace_owner(g.workspace_id)))
  )
);

-- Restrict function execution to authenticated (mirrors other RLS helpers)
REVOKE EXECUTE ON FUNCTION public.has_workspace_permission(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_workspace_permission(UUID, TEXT) TO authenticated;
-- ============================================================
-- YBS SYSTEM: CURATED FOOD DATASET (MIGRATION 20260904000002)
-- A curated initial set of foods commonly used in Egypt (global library,
-- workspace_id IS NULL). Backward compatible: only INSERTS new rows and
-- never touches existing foods.
--
-- NUTRITION VALUES
--  * Generic whole foods use widely-published public USDA / USDA FoodData
--    Central standard reference values (source = 'usda_fdc'), per 100 g.
--  * Egyptian-specific items not covered by USDA (baladi bread, labneh)
--    are flagged source = 'manual' (value manually curated).
--  * Branded packaged products use widely-published on-label values
--    (source = 'manual'), kept distinct from the generic food.
--
-- This is an idempotent seed: guarded by WHERE NOT EXISTS on (name,
-- workspace_id IS NULL), and by the source+external_id unique index for
-- imported rows.
-- ============================================================

-- ============================================================
-- CARBOHYDRATES
-- ============================================================

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'White Rice — Cooked', 'أرز أبيض مطبوخ', '100g', 100, 130, 2.7, 28.2, 0.3, 0.4, 0.05, 'carbs', 'usda_fdc', 'USDA-20045', ARRAY['rice', 'أرز أبيض']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'White Rice — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Basmati Rice — Cooked', 'أرز بسمتي مطبوخ', '100g', 100, 121, 3.5, 25.2, 0.5, 0.7, 0.05, 'carbs', 'usda_fdc', 'USDA-20044', ARRAY['basmati', 'أرز بسمتي']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Basmati Rice — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Brown Rice — Cooked', 'أرز بني مطبوخ', '100g', 100, 123, 2.7, 25.6, 1.0, 1.6, 0.2, 'carbs', 'usda_fdc', 'USDA-20037', ARRAY['brown rice', 'أرز أسمر']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Brown Rice — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Potato — Boiled', 'بطاطس مسلوقة', '100g', 100, 87, 1.9, 20.1, 0.1, 1.8, 0.9, 'carbs', 'usda_fdc', 'USDA-11353', ARRAY['potatoes', 'بطاطس']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Potato — Boiled' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Sweet Potato — Baked', 'بطاطا حلوة مشوية', '100g', 100, 90, 2.0, 20.7, 0.15, 3.3, 6.5, 'carbs', 'usda_fdc', 'USDA-11508', ARRAY['sweet potato', 'بطاطا']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Sweet Potato — Baked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Oats — Dry Rolled', 'شوفان', '100g', 100, 389, 16.9, 66.3, 6.9, 10.6, 0.99, 'carbs', 'usda_fdc', 'USDA-8120', ARRAY['oatmeal', 'شوفان']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Oats — Dry Rolled' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Pasta — Cooked', 'مكرونة مطبوخة', '100g', 100, 158, 5.8, 30.9, 0.9, 1.8, 0.6, 'carbs', 'usda_fdc', 'USDA-20421', ARRAY['spaghetti', 'ماكاروني']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Pasta — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Couscous — Cooked', 'كسكسي مطبوخ', '100g', 100, 112, 3.8, 23.2, 0.2, 1.4, 0.1, 'carbs', 'usda_fdc', 'USDA-20029', ARRAY['couscous', 'كسكسي']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Couscous — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Corn — Sweet Yellow, Cooked', 'ذرة صفراء مسلوقة', '100g', 100, 96, 3.4, 21.0, 1.5, 2.4, 4.5, 'carbs', 'usda_fdc', 'USDA-11167', ARRAY['corn', 'ذرة']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Corn — Sweet Yellow, Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'White Bread / Toast', 'خبز أبيض / توست', '100g', 100, 266, 8.9, 49.4, 3.3, 2.7, 5.0, 'carbs', 'usda_fdc', 'USDA-18069', ARRAY['toast', 'white bread', 'توست']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'White Bread / Toast' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Baladi Bread (Egyptian Flatbread)', 'عيش بلدي', '100g', 100, 245, 9.0, 48.0, 1.8, 4.0, 1.5, 'carbs', 'manual', NULL, ARRAY['aish baladi', 'عيش', 'flatbread']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Baladi Bread (Egyptian Flatbread)' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Lentils — Cooked', 'عدس مطبوخ', '100g', 100, 116, 9.0, 20.1, 0.4, 7.9, 1.8, 'carbs', 'usda_fdc', 'USDA-16070', ARRAY['lentil', 'عدس']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Lentils — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Fava Beans — Cooked (Ful)', 'فول مدمس', '100g', 100, 110, 7.6, 19.7, 0.4, 5.4, 1.8, 'carbs', 'usda_fdc', 'USDA-16059', ARRAY['ful medames', 'فول']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Fava Beans — Cooked (Ful)' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Chickpeas — Cooked', 'حمص مطبوخ', '100g', 100, 164, 8.9, 27.4, 2.6, 7.6, 4.8, 'carbs', 'usda_fdc', 'USDA-16057', ARRAY['garbanzo', 'حمص']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Chickpeas — Cooked' AND workspace_id IS NULL);

-- ============================================================
-- PROTEIN
-- ============================================================

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Chicken Breast — Cooked, Skinless', 'صدر دجاج مطبوخ', '100g', 100, 165, 31.0, 0, 3.6, 0, 0, 'protein', 'usda_fdc', 'USDA-5062', ARRAY['chicken', 'صدور دجاج']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Chicken Breast — Cooked, Skinless' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Chicken Thigh — Cooked', 'فخذ دجاج مطبوخ', '100g', 100, 209, 26.0, 0, 11.0, 0, 0, 'protein', 'usda_fdc', 'USDA-5096', ARRAY['chicken thigh', 'أفخاذ دجاج']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Chicken Thigh — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Chicken Liver — Cooked', 'كبدة دجاج', '100g', 100, 167, 24.5, 0.9, 6.4, 0, 0, 'protein', 'usda_fdc', 'USDA-5027', ARRAY['liver', 'كبدة']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Chicken Liver — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Chicken Gizzards — Cooked', 'قوانص دجاج', '100g', 100, 154, 30.4, 0, 2.7, 0, 0, 'protein', 'usda_fdc', 'USDA-5228', ARRAY['gizzard', 'قوانص']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Chicken Gizzards — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Beef — Ground 80/20, Cooked', 'لحم مفروم مطبوخ', '100g', 100, 254, 25.7, 0, 16.4, 0, 0, 'protein', 'usda_fdc', 'USDA-23564', ARRAY['minced beef', 'لحمة مفرومة']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Beef — Ground 80/20, Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Beef — Sirloin, Cooked', 'لحم بفتيك مطبوخ', '100g', 100, 217, 29.8, 0, 10.1, 0, 0, 'protein', 'usda_fdc', 'USDA-13939', ARRAY['beef', 'لحمة']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Beef — Sirloin, Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Beef Liver — Cooked', 'كبدة بقري', '100g', 100, 191, 29.1, 5.1, 5.3, 0, 0, 'protein', 'usda_fdc', 'USDA-13329', ARRAY['liver', 'كبدة']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Beef Liver — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Veal — Cooked', 'لحم بتلو مطبوخ', '100g', 100, 231, 22.9, 0, 15.2, 0, 0, 'protein', 'usda_fdc', 'USDA-17331', ARRAY['veal', 'بتلو']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Veal — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Lamb — Cooked', 'لحم ضأن / خروف مطبوخ', '100g', 100, 294, 24.5, 0, 20.9, 0, 0, 'protein', 'usda_fdc', 'USDA-17435', ARRAY['lamb', 'خروف']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Lamb — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Egg — Whole, Boiled', 'بيض مسلوق', '100g', 100, 155, 12.6, 1.1, 10.6, 0, 1.1, 'protein', 'usda_fdc', 'USDA-1129', ARRAY['hard boiled egg', 'بيضة مسلوقة']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Egg — Whole, Boiled' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Egg — Whole, Raw', 'بيض خام', '100g', 100, 143, 12.6, 0.7, 9.5, 0, 0.4, 'protein', 'usda_fdc', 'USDA-1123', ARRAY['eggs', 'بيض']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Egg — Whole, Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Egg White — Raw', 'بياض البيض', '100g', 100, 52, 10.9, 0.7, 0.2, 0, 0.7, 'protein', 'usda_fdc', 'USDA-1124', ARRAY['egg white', 'بياض البيض']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Egg White — Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Tuna — Canned in Water', 'تونة معلبة بالماء', '100g', 100, 116, 25.5, 0, 0.8, 0, 0, 'protein', 'usda_fdc', 'USDA-15121', ARRAY['tuna', 'تونة']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Tuna — Canned in Water' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Sardines — Canned in Oil', 'سردين معلب بالزيت', '100g', 100, 208, 24.6, 0, 11.5, 0, 0, 'protein', 'usda_fdc', 'USDA-15087', ARRAY['sardine', 'سردين']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Sardines — Canned in Oil' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Salmon — Atlantic, Cooked', 'سلمون مطبوخ', '100g', 100, 206, 22.1, 0, 12.4, 0, 0, 'protein', 'usda_fdc', 'USDA-15261', ARRAY['salmon', 'سلمون']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Salmon — Atlantic, Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Tilapia — Cooked', 'بلطي مطبوخ', '100g', 100, 128, 26.2, 0, 2.7, 0, 0, 'protein', 'usda_fdc', 'FDC-175172', ARRAY['tilapia', 'سمك بلطي']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Tilapia — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Mullet — Cooked', 'بوري مطبوخ', '100g', 100, 150, 24.0, 0, 4.8, 0, 0, 'protein', 'usda_fdc', 'USDA-15168', ARRAY['mullet', 'سمك بوري']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Mullet — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Sea Bass — Cooked', 'قاروص مطبوخ', '100g', 100, 124, 23.0, 0, 3.2, 0, 0, 'protein', 'usda_fdc', 'USDA-15122', ARRAY['sea bass', 'سمك قاروص']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Sea Bass — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Shrimp — Cooked', 'جمبري مطبوخ', '100g', 100, 99, 23.9, 0.2, 0.3, 0, 0, 'protein', 'usda_fdc', 'USDA-15149', ARRAY['prawn', 'روبيان']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Shrimp — Cooked' AND workspace_id IS NULL);

-- ============================================================
-- DAIRY
-- ============================================================

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Milk — Full Fat (Whole)', 'حليب كامل الدسم', '100ml', 100, 61, 3.2, 4.8, 3.3, 0, 4.8, 'dairy', 'usda_fdc', 'USDA-1077', ARRAY['whole milk', 'لبن']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Milk — Full Fat (Whole)' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Milk — Low Fat (1%)', 'حليب قليل الدسم', '100ml', 100, 42, 3.4, 5.0, 1.0, 0, 5.0, 'dairy', 'usda_fdc', 'USDA-1082', ARRAY['low fat milk', 'لبن قليل الدسم']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Milk — Low Fat (1%)' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Milk — Skim (Nonfat)', 'حليب منزوع الدسم', '100ml', 100, 34, 3.4, 5.0, 0.1, 0, 5.0, 'dairy', 'usda_fdc', 'USDA-1085', ARRAY['skim milk', 'لبن خالي الدسم']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Milk — Skim (Nonfat)' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Yogurt — Plain Whole', 'زبادي كامل الدسم', '100g', 100, 61, 3.5, 4.7, 3.3, 0, 4.7, 'dairy', 'usda_fdc', 'USDA-1116', ARRAY['yogurt', 'زبادي']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Yogurt — Plain Whole' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Greek Yogurt — Plain Nonfat', 'زبادي يوناني خالي الدسم', '100g', 100, 59, 10.2, 3.6, 0.4, 0, 3.2, 'dairy', 'usda_fdc', 'USDA-01256', ARRAY['greek yogurt', 'زبادي يوناني']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Greek Yogurt — Plain Nonfat' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Cottage Cheese — 2% Fat', 'جبنة قريش', '100g', 100, 84, 11.1, 4.3, 2.3, 0, 4.3, 'dairy', 'usda_fdc', 'USDA-1012', ARRAY['cottage', 'جبنة بيضاء']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Cottage Cheese — 2% Fat' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Labneh (Strained Yogurt)', 'لبنة', '100g', 100, 118, 7.4, 4.5, 7.9, 0, 4.5, 'dairy', 'manual', NULL, ARRAY['labneh', 'لبنة']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Labneh (Strained Yogurt)' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Feta Cheese', 'جبنة فيتا', '100g', 100, 264, 14.2, 4.1, 21.3, 0, 4.1, 'dairy', 'usda_fdc', 'USDA-1019', ARRAY['feta', 'فيتا']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Feta Cheese' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Cheddar Cheese', 'جبنة شيدر', '100g', 100, 403, 24.9, 1.3, 33.1, 0, 0.5, 'dairy', 'usda_fdc', 'USDA-1009', ARRAY['cheddar', 'شيدر']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Cheddar Cheese' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Mozzarella Cheese', 'جبنة موزاريلا', '100g', 100, 280, 28.1, 3.1, 17.1, 0, 1.0, 'dairy', 'usda_fdc', 'USDA-1026', ARRAY['mozzarella', 'موزاريلا']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Mozzarella Cheese' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Romani Cheese (Egyptian Hard Cheese)', 'جبنة رومي', '100g', 100, 387, 24.0, 3.5, 31.0, 0, 3.0, 'dairy', 'manual', NULL, ARRAY['romi', 'جبنة رومي']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Romani Cheese (Egyptian Hard Cheese)' AND workspace_id IS NULL);

-- ============================================================
-- EGYPTIAN / LOCALLY AVAILABLE BRANDED PACKAGED PRODUCTS
-- (generic food vs. branded product kept as distinct records)
-- ============================================================

INSERT INTO public.foods
    (workspace_id, name, name_ar, brand, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Juhayna Full Cream Milk', 'حليب جهينة كامل الدسم', 'Juhayna', '100ml', 100, 60, 3.0, 4.8, 3.2, 0, 4.7, 'dairy', 'manual', NULL, ARRAY['juhayna milk', 'جهينة لبن']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Juhayna Full Cream Milk' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, brand, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Juhayna Low Fat Milk', 'حليب جهينة قليل الدسم', 'Juhayna', '100ml', 100, 46, 3.3, 4.7, 1.5, 0, 4.7, 'dairy', 'manual', NULL, ARRAY['juhayna low fat', 'جهينة قليل الدسم']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Juhayna Low Fat Milk' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, brand, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Juhayna Plain Yogurt', 'زبادي جهينة', 'Juhayna', '100g', 100, 62, 3.5, 4.5, 3.4, 0, 4.5, 'dairy', 'manual', NULL, ARRAY['juhayna yogurt', 'زبادي جهينة']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Juhayna Plain Yogurt' AND workspace_id IS NULL);

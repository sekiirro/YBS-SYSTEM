-- ============================================================
-- YBS SYSTEM: SECOND CURATED FOOD BATCH (MIGRATION 20260904000005)
-- A second additive, idempotent seed of commonly used foods
-- (global library, workspace_id IS NULL). Extends the existing
-- curated dataset from migration 20260904000002.
--
-- Backward compatible: only INSERTS new rows, never touches existing.
--
-- NUTRITION VALUES
--  * Generic whole foods use USDA FoodData Central standard
--    reference values (source = 'usda_fdc'), per 100 g.
--  * Generic condiments/processed items also use USDA FDC values.
--  * Branded packaged products use on-label values where an
--    authoritative source was found (source = 'manual' for label-
--    based entries lacking a USDA FDC id; source = 'usda_fdc' for
--    those with a USDA branded food entry).
--
-- Idempotency: guided by WHERE NOT EXISTS on (name, workspace_id IS
-- NULL) and by the (source, external_id) unique index.
-- ============================================================

-- ============================================================
-- CARBOHYDRATES (grains, flours, breads, snacks)
-- ============================================================

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Rice Flour — White', 'دقيق أرز أبيض', '100g', 100, 366, 6.0, 80.1, 1.4, 2.4, 0.1, 'carbs', 'usda_fdc', 'FDC-169714', ARRAY['rice flour', 'دقيق أرز']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Rice Flour — White' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Pasta — Dry, Enriched', 'مكرونة جافة', '100g', 100, 371, 13.0, 74.7, 1.5, 3.2, 2.7, 'carbs', 'usda_fdc', 'FDC-169736', ARRAY['dry pasta', 'مكرونة نيئة']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Pasta — Dry, Enriched' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Corn Tortilla', 'تورتييا ذرة', '100g', 100, 218, 5.7, 44.6, 2.9, 6.3, 0.9, 'carbs', 'usda_fdc', 'FDC-175036', ARRAY['tortilla', 'تورتييا']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Corn Tortilla' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Rice Cakes — Brown Rice, Plain', 'قرص أرز بني', '100g', 100, 387, 8.2, 81.5, 2.8, 4.2, 0.9, 'carbs', 'usda_fdc', 'FDC-170250', ARRAY['rice cake', 'خبز أرز']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Rice Cakes — Brown Rice, Plain' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Whole Wheat Bread', 'خبز أسمر / قمح كامل', '100g', 100, 252, 12.4, 42.7, 3.5, 6.0, 4.3, 'carbs', 'usda_fdc', 'FDC-172688', ARRAY['brown bread', 'خبز قمح كامل']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Whole Wheat Bread' AND workspace_id IS NULL);

-- ============================================================
-- LEGUMES / VEGETABLES
-- ============================================================

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Kidney Beans — Cooked', 'فاصوليا حمراء مطبوخة', '100g', 100, 127, 8.7, 22.8, 0.5, 6.4, 0.3, 'vegetables', 'usda_fdc', 'FDC-173740', ARRAY['red beans', 'فاصوليا']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Kidney Beans — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'White Beans — Cooked', 'فاصوليا بيضاء مطبوخة', '100g', 100, 139, 9.7, 25.1, 0.4, 6.3, 0.3, 'vegetables', 'usda_fdc', 'FDC-175203', ARRAY['white beans', 'لوبيا بيضاء']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'White Beans — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Black Beans — Cooked', 'فاصوليا سوداء مطبوخة', '100g', 100, 132, 8.9, 23.7, 0.5, 8.7, 0.3, 'vegetables', 'usda_fdc', 'FDC-173735', ARRAY['black beans', 'فاصوليا سوداء']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Black Beans — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Green Peas — Cooked', 'بسلة مطبوخة', '100g', 100, 84, 5.4, 15.6, 0.2, 5.5, 5.9, 'vegetables', 'usda_fdc', 'FDC-170420', ARRAY['peas', 'بسلة']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Green Peas — Cooked' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Carrot — Raw', 'جزر خام', '100g', 100, 41, 0.9, 9.6, 0.2, 2.8, 4.7, 'vegetables', 'usda_fdc', 'FDC-170393', ARRAY['carrots', 'جزر']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Carrot — Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Tomato — Raw', 'طماطم خام', '100g', 100, 18, 0.9, 3.9, 0.2, 1.2, 2.6, 'vegetables', 'usda_fdc', 'FDC-170457', ARRAY['tomatoes', 'طماطم']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Tomato — Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Cucumber — Raw', 'خيار خام', '100g', 100, 15, 0.7, 3.6, 0.1, 0.5, 1.7, 'vegetables', 'usda_fdc', 'FDC-168409', ARRAY['cucumber', 'خيار']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Cucumber — Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Onion — Raw', 'بصل خام', '100g', 100, 40, 1.1, 9.3, 0.1, 1.7, 4.2, 'vegetables', 'usda_fdc', 'FDC-170000', ARRAY['onions', 'بصل']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Onion — Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Garlic — Raw', 'ثوم خام', '100g', 100, 149, 6.4, 33.1, 0.5, 2.1, 1.0, 'vegetables', 'usda_fdc', 'FDC-169230', ARRAY['garlic', 'ثوم']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Garlic — Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Bell Pepper — Green, Raw', 'فلفل أخضر رومي خام', '100g', 100, 20, 0.9, 4.6, 0.2, 1.7, 2.4, 'vegetables', 'usda_fdc', 'FDC-170446', ARRAY['green pepper', 'فلفل أخضر']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Bell Pepper — Green, Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Spinach — Raw', 'سبانخ خام', '100g', 100, 23, 2.9, 3.6, 0.4, 2.2, 0.4, 'vegetables', 'usda_fdc', 'FDC-168462', ARRAY['spinach', 'سبانخ']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Spinach — Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Broccoli — Raw', 'بروكلي خام', '100g', 100, 34, 2.8, 6.6, 0.4, 2.6, 1.7, 'vegetables', 'usda_fdc', 'FDC-170379', ARRAY['broccoli', 'بروكلي']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Broccoli — Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Zucchini — Raw', 'كوسة خام', '100g', 100, 17, 1.2, 3.1, 0.3, 1.0, 2.5, 'vegetables', 'usda_fdc', 'FDC-169291', ARRAY['courgette', 'كوسا']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Zucchini — Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Eggplant — Raw', 'باذنجان خام', '100g', 100, 25, 1.0, 5.9, 0.2, 3.0, 3.5, 'vegetables', 'usda_fdc', 'FDC-169228', ARRAY['aubergine', 'باذنجان']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Eggplant — Raw' AND workspace_id IS NULL);

-- ============================================================
-- FRUITS
-- ============================================================

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Banana — Raw', 'موز خام', '100g', 100, 89, 1.1, 22.8, 0.3, 2.6, 12.2, 'fruits', 'usda_fdc', 'FDC-173944', ARRAY['bananas', 'موز']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Banana — Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Apple — Raw, with Skin', 'تفاح خام بقشرته', '100g', 100, 52, 0.3, 13.8, 0.2, 2.4, 10.4, 'fruits', 'usda_fdc', 'FDC-171688', ARRAY['apples', 'تفاح']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Apple — Raw, with Skin' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Orange — Navel, Raw', 'برتقال خام', '100g', 100, 49, 0.9, 12.5, 0.2, 2.2, 8.5, 'fruits', 'usda_fdc', 'FDC-169917', ARRAY['oranges', 'برتقال']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Orange — Navel, Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Strawberries — Raw', 'فراولة خام', '100g', 100, 32, 0.7, 7.7, 0.3, 2.0, 4.9, 'fruits', 'usda_fdc', 'FDC-167762', ARRAY['strawberry', 'فراولة']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Strawberries — Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Dates — Medjool', 'تمر مجهول', '100g', 100, 277, 1.8, 75.0, 0.2, 6.7, 66.5, 'fruits', 'usda_fdc', 'FDC-168191', ARRAY['date', 'تمر']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Dates — Medjool' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Avocado — California, Raw', 'أفوكادو خام', '100g', 100, 167, 2.0, 8.6, 15.4, 6.8, 0.3, 'fruits', 'usda_fdc', 'FDC-171706', ARRAY['avocado', 'أفوكادو']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Avocado — California, Raw' AND workspace_id IS NULL);

-- ============================================================
-- FATS (nuts, seeds, oils, spreads)
-- ============================================================

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Chia Seeds — Dried', 'بذور الشيا', '100g', 100, 486, 16.5, 42.1, 30.7, 34.4, 0.0, 'fats', 'usda_fdc', 'FDC-170554', ARRAY['chia', 'شيا']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Chia Seeds — Dried' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Almonds — Raw', 'لوز خام', '100g', 100, 579, 21.1, 21.6, 49.9, 12.5, 4.3, 'fats', 'usda_fdc', 'FDC-170567', ARRAY['almond', 'لوز']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Almonds — Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Walnuts — Raw', 'جوز خام', '100g', 100, 654, 15.2, 13.7, 65.2, 6.7, 2.6, 'fats', 'usda_fdc', 'FDC-170187', ARRAY['walnut', 'عين جمل']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Walnuts — Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Peanuts — Raw', 'فول سوداني خام', '100g', 100, 567, 25.8, 16.1, 49.2, 8.5, 4.7, 'fats', 'usda_fdc', 'FDC-172430', ARRAY['peanut', 'سوداني']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Peanuts — Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Sunflower Seeds — Dried', 'بذور دوار الشمس', '100g', 100, 584, 20.8, 20.0, 51.5, 8.6, 2.6, 'fats', 'usda_fdc', 'FDC-170562', ARRAY['sunflower', 'لب عباد الشمس']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Sunflower Seeds — Dried' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Peanut Butter — Smooth', 'زبدة فول سوداني', '100g', 100, 588, 21.9, 24.0, 49.5, 5.7, 6.5, 'fats', 'usda_fdc', 'FDC-174294', ARRAY['peanut butter', 'زبدة سوداني']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Peanut Butter — Smooth' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Olive Oil', 'زيت زيتون', '100ml', 100, 884, 0.0, 0.0, 100.0, 0.0, 0.0, 'fats', 'usda_fdc', 'FDC-171413', ARRAY['olive oil', 'زيت زيتون']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Olive Oil' AND workspace_id IS NULL);

-- ============================================================
-- PROTEIN / DAIRY (additional lean + light variants)
-- ============================================================

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Beef — 90% Lean Ground, Raw', 'لحم مفروم 10% دهون', '100g', 100, 176, 20.0, 0.0, 10.0, 0.0, 0.0, 'protein', 'usda_fdc', 'FDC-174030', ARRAY['lean beef', 'لحمة قليلة الدهون']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Beef — 90% Lean Ground, Raw' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Mozzarella Cheese — Part Skim (Light)', 'موزاريلا خفيفة', '100g', 100, 295, 23.8, 5.6, 19.8, 0.0, 1.9, 'dairy', 'usda_fdc', 'FDC-171244', ARRAY['mozzarella light', 'موزاريلا جافة']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Mozzarella Cheese — Part Skim (Light)' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Cottage Cheese — Low Fat (1%)', 'جبنة قريش قليلة الدسم', '100g', 100, 72, 12.4, 2.7, 1.0, 0.0, 2.7, 'dairy', 'usda_fdc', 'FDC-173417', ARRAY['cottage low fat', 'جبنة قريش قليلة الدسم']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Cottage Cheese — Low Fat (1%)' AND workspace_id IS NULL);

-- ============================================================
-- OTHER (sweet spreads, condiments)
-- ============================================================

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Strawberry Jam / Preserves', 'مربى فراولة', '100g', 100, 278, 0.9, 68.9, 0.1, 0.0, 58.8, 'other', 'usda_fdc', 'FDC-168527', ARRAY['strawberry jam', 'مربى']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Strawberry Jam / Preserves' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Honey', 'عسل', '100g', 100, 304, 0.3, 82.4, 0.0, 0.2, 82.1, 'other', 'usda_fdc', 'FDC-169640', ARRAY['honey', 'عسل']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Honey' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Ketchup', 'كاتشب', '100g', 100, 101, 1.0, 27.4, 0.1, 0.3, 21.3, 'other', 'usda_fdc', 'FDC-168556', ARRAY['catsup', 'كاتشب']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Ketchup' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Yellow Mustard — Prepared', 'خردل أصفر', '100g', 100, 60, 3.7, 5.8, 3.3, 4.0, 0.9, 'other', 'usda_fdc', 'FDC-172234', ARRAY['mustard', 'خردل']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Yellow Mustard — Prepared' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'BBQ Sauce', 'صلصة باربكيو', '100g', 100, 172, 0.8, 40.8, 0.6, 0.9, 33.2, 'other', 'usda_fdc', 'FDC-174523', ARRAY['barbecue sauce', 'باربكيو']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'BBQ Sauce' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Mayonnaise — Light (Reduced Fat)', 'مايونيز لايت', '100g', 100, 238, 0.4, 9.2, 22.2, 0.0, 3.6, 'other', 'usda_fdc', 'FDC-173594', ARRAY['light mayo', 'مايونيز قليل الدسم']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Mayonnaise — Light (Reduced Fat)' AND workspace_id IS NULL);

-- ============================================================
-- BEVERAGES / BRANDED PACKAGED PRODUCTS
-- ============================================================

INSERT INTO public.foods
    (workspace_id, name, name_ar, brand, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Tang Orange Drink Mix — Powder', 'تانج برتقال بودرة', 'Tang', '100g', 100, 368, 0.0, 97.4, 0.0, 0.0, 89.5, 'beverages', 'usda_fdc', 'FDC-2565831', ARRAY['tang', 'تانج']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Tang Orange Drink Mix — Powder' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, brand, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Heinz Ketchup', 'كاتشب هاينز', 'Heinz', '100g', 100, 118, 0.0, 23.5, 0.0, 0.0, 17.65, 'other', 'usda_fdc', 'FDC-1332704', ARRAY['heinz ketchup', 'كاتشب هاينز']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Heinz Ketchup' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, brand, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Heinz Light Mayonnaise', 'مايونيز هاينز لايت', 'Heinz', '100g', 100, 266, 0.6, 8.0, 26.0, 0.0, 3.0, 'other', 'manual', NULL, ARRAY['heinz light mayo', 'مايونيز لايت هاينز']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Heinz Light Mayonnaise' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, brand, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'Juhayna Greek Yogurt 0.2%', 'زبادي يوناني جهينة قليل الدسم', 'Juhayna', '100g', 100, 50, 8.3, 3.6, 0.2, 0.0, 3.6, 'dairy', 'manual', NULL, ARRAY['juhayna greek', 'جهينة يوناني']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'Juhayna Greek Yogurt 0.2%' AND workspace_id IS NULL);

INSERT INTO public.foods
    (workspace_id, name, name_ar, brand, serving_unit, serving_size, calories, protein, carbs, fat, fiber, sugar, category, source, external_id, aliases)
SELECT NULL, 'HiPro Spoonable Plain', 'هي برو زبادي سادة', 'Danone HiPro', '100g', 100, 59, 9.0, 4.83, 0.41, 0.0, 0.0, 'dairy', 'manual', NULL, ARRAY['hipro', 'هي برو']
WHERE NOT EXISTS (SELECT 1 FROM public.foods WHERE name = 'HiPro Spoonable Plain' AND workspace_id IS NULL);

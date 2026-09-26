SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('nutrition_plans', 'workout_plans', 'workout_days', 'nutrition_meals')
ORDER BY table_name, ordinal_position;
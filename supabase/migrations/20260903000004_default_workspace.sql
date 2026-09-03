-- ============================================================
-- YBS SYSTEM: SUPABASE DATABASE ARCHITECTURE (MIGRATION 04)
-- YBS DEFAULT WORKSPACE & GLOBAL SHARED CATALOG SEED
-- AUDITED & IDEMPOTENT (NO DUPLICATES ON RE-RUN)
-- ============================================================

-- 1. Create YBS Default Workspace (idempotent)
INSERT INTO public.workspaces (
    id,
    name,
    slug,
    owner_name,
    owner_email,
    owner_phone,
    status,
    platform_plan,
    country,
    city,
    settings,
    notes
)
SELECT
    '00000000-0000-0000-0000-000000000001'::uuid,
    'YBS Default Workspace',
    'ybs-default',
    'Platform Owner',
    'admin@ybs.local',
    '+201000000000',
    'active',
    'enterprise',
    'Egypt',
    'Cairo',
    '{"currency": "EGP", "timezone": "Africa/Cairo", "default_follow_up_day": "saturday"}'::jsonb,
    'Default workspace for legacy and unassigned clients/subscriptions'
WHERE NOT EXISTS (
    SELECT 1 FROM public.workspaces WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
);

-- 2. Seed Agreed Global Standard Packages (workspace_id IS NULL)
-- Structure: Silver 1M, Silver 3M, Gold 1M, Gold 3M (Platinum removed)

-- Silver — 1 Month
INSERT INTO public.packages (name, tier, duration, duration_unit, price, currency, description, features, is_active, is_custom)
SELECT 
    'Silver — 1 Month', 
    'silver', 
    1, 
    'months', 
    1500.00, 
    'EGP', 
    'Monthly standard coaching program', 
    ARRAY['Personalized Workout Plan', 'Custom Nutrition Plan', 'Weekly Check-in'],
    true,
    false
WHERE NOT EXISTS (
    SELECT 1 FROM public.packages WHERE name = 'Silver — 1 Month' AND workspace_id IS NULL
);

-- Silver — 3 Months
INSERT INTO public.packages (name, tier, duration, duration_unit, price, currency, description, features, is_active, is_custom)
SELECT 
    'Silver — 3 Months', 
    'silver', 
    3, 
    'months', 
    3800.00, 
    'EGP', 
    'Quarterly standard coaching program', 
    ARRAY['Personalized Workout Plan', 'Custom Nutrition Plan', 'Weekly Check-in', 'Progress Tracking'],
    true,
    false
WHERE NOT EXISTS (
    SELECT 1 FROM public.packages WHERE name = 'Silver — 3 Months' AND workspace_id IS NULL
);

-- Gold — 1 Month
INSERT INTO public.packages (name, tier, duration, duration_unit, price, currency, description, features, is_active, is_custom)
SELECT 
    'Gold — 1 Month', 
    'gold', 
    1, 
    'months', 
    2500.00, 
    'EGP', 
    'Monthly premium coaching with form reviews', 
    ARRAY['Advanced Workout Periodization', 'Metabolic Nutrition Plan', 'Weekly Check-in', 'Video Form Review', 'Priority Support'],
    true,
    false
WHERE NOT EXISTS (
    SELECT 1 FROM public.packages WHERE name = 'Gold — 1 Month' AND workspace_id IS NULL
);

-- Gold — 3 Months
INSERT INTO public.packages (name, tier, duration, duration_unit, price, currency, description, features, is_active, is_custom)
SELECT 
    'Gold — 3 Months', 
    'gold', 
    3, 
    'months', 
    6500.00, 
    'EGP', 
    'Quarterly comprehensive transformation coaching', 
    ARRAY['Advanced Periodization', 'Metabolic Nutrition Plan', 'Weekly Video Check-in', 'Form Analysis', '24/7 Priority Support'],
    true,
    false
WHERE NOT EXISTS (
    SELECT 1 FROM public.packages WHERE name = 'Gold — 3 Months' AND workspace_id IS NULL
);

-- 3. Seed Core Exercises Library (workspace_id IS NULL, strictly idempotent)
INSERT INTO public.exercises (name, category, muscle_group, equipment, instructions)
SELECT 'Barbell Bench Press', 'chest', 'Pectoralis Major', 'Barbell, Bench', 'Lie on bench, grip bar slightly wider than shoulder width. Lower bar to mid-chest, press back up.'
WHERE NOT EXISTS (SELECT 1 FROM public.exercises WHERE name = 'Barbell Bench Press' AND workspace_id IS NULL);

INSERT INTO public.exercises (name, category, muscle_group, equipment, instructions)
SELECT 'Incline Dumbbell Press', 'chest', 'Upper Chest', 'Dumbbells, Incline Bench', 'Set bench to 30 degrees. Press dumbbells upward with controlled tempo.'
WHERE NOT EXISTS (SELECT 1 FROM public.exercises WHERE name = 'Incline Dumbbell Press' AND workspace_id IS NULL);

INSERT INTO public.exercises (name, category, muscle_group, equipment, instructions)
SELECT 'Barbell Back Squat', 'legs', 'Quadriceps, Glutes', 'Barbell, Squat Rack', 'Rest bar on upper traps. Squat down until thighs are parallel to ground, drive through heels.'
WHERE NOT EXISTS (SELECT 1 FROM public.exercises WHERE name = 'Barbell Back Squat' AND workspace_id IS NULL);

INSERT INTO public.exercises (name, category, muscle_group, equipment, instructions)
SELECT 'Romanian Deadlift', 'legs', 'Hamstrings, Glutes', 'Barbell or Dumbbells', 'Hinge at the hips, keeping back flat and slight bend in knees. Lower to mid-shin level.'
WHERE NOT EXISTS (SELECT 1 FROM public.exercises WHERE name = 'Romanian Deadlift' AND workspace_id IS NULL);

INSERT INTO public.exercises (name, category, muscle_group, equipment, instructions)
SELECT 'Lat Pulldown', 'back', 'Latissimus Dorsi', 'Cable Machine', 'Grip bar wide, pull down toward upper chest while driving elbows down and back.'
WHERE NOT EXISTS (SELECT 1 FROM public.exercises WHERE name = 'Lat Pulldown' AND workspace_id IS NULL);

INSERT INTO public.exercises (name, category, muscle_group, equipment, instructions)
SELECT 'Barbell Bent-Over Row', 'back', 'Upper & Mid Back', 'Barbell', 'Hinge torso at 45 degrees, row bar to lower chest keeping core tight.'
WHERE NOT EXISTS (SELECT 1 FROM public.exercises WHERE name = 'Barbell Bent-Over Row' AND workspace_id IS NULL);

INSERT INTO public.exercises (name, category, muscle_group, equipment, instructions)
SELECT 'Dumbbell Overhead Shoulder Press', 'shoulders', 'Deltoids', 'Dumbbells', 'Press dumbbells overhead from shoulder height until arms are extended.'
WHERE NOT EXISTS (SELECT 1 FROM public.exercises WHERE name = 'Dumbbell Overhead Shoulder Press' AND workspace_id IS NULL);

INSERT INTO public.exercises (name, category, muscle_group, equipment, instructions)
SELECT 'Lateral Raises', 'shoulders', 'Lateral Deltoids', 'Dumbbells', 'Raise dumbbells out to the sides until parallel with floor with slight bend in elbows.'
WHERE NOT EXISTS (SELECT 1 FROM public.exercises WHERE name = 'Lateral Raises' AND workspace_id IS NULL);

INSERT INTO public.exercises (name, category, muscle_group, equipment, instructions)
SELECT 'Barbell Bicep Curl', 'arms', 'Biceps', 'Barbell or EZ-Bar', 'Curl bar upward keeping elbows pinned to your sides.'
WHERE NOT EXISTS (SELECT 1 FROM public.exercises WHERE name = 'Barbell Bicep Curl' AND workspace_id IS NULL);

INSERT INTO public.exercises (name, category, muscle_group, equipment, instructions)
SELECT 'Tricep Rope Pushdown', 'arms', 'Triceps', 'Cable Machine', 'Push rope attachment downward, spreading ends apart at the bottom.'
WHERE NOT EXISTS (SELECT 1 FROM public.exercises WHERE name = 'Tricep Rope Pushdown' AND workspace_id IS NULL);

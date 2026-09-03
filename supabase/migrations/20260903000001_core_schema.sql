-- ============================================================
-- YBS SYSTEM: SUPABASE DATABASE ARCHITECTURE (MIGRATION 01)
-- CORE SCHEMA: TABLES, FOREIGN KEYS, CONSTRAINTS & INDEXES
-- AUDITED & HARDENED FOR PRODUCTION
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Profiles (linked 1:1 to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    phone TEXT UNIQUE,
    full_name TEXT NOT NULL,
    avatar_url TEXT,
    platform_role TEXT NOT NULL DEFAULT 'none' 
        CHECK (platform_role IN ('platform_owner', 'platform_trainer', 'none')),
    account_status TEXT NOT NULL DEFAULT 'active' 
        CHECK (account_status IN ('pending_approval', 'active', 'suspended', 'rejected', 'deactivated')),
    active_workspace_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Workspaces (Exclusively created by Platform Owner)
CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    owner_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    owner_name TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    owner_phone TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'suspended', 'archived')),
    platform_plan TEXT NOT NULL DEFAULT 'starter' CHECK (platform_plan IN ('starter', 'growth', 'scale', 'enterprise', 'trial', 'custom')),
    country TEXT,
    city TEXT,
    settings JSONB NOT NULL DEFAULT '{"currency": "EGP", "timezone": "Africa/Cairo", "default_follow_up_day": "saturday"}'::jsonb,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add active_workspace_id constraint to profiles
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_profiles_active_workspace'
    ) THEN
        ALTER TABLE public.profiles 
            ADD CONSTRAINT fk_profiles_active_workspace 
            FOREIGN KEY (active_workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 3. Workspace Memberships (Defines user access within a brand workspace)
CREATE TABLE IF NOT EXISTS public.workspace_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    workspace_role TEXT NOT NULL CHECK (workspace_role IN ('workspace_owner', 'client')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'invited')),
    permissions TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);

-- 4. Clients (The central coached athlete record)
CREATE TABLE IF NOT EXISTS public.clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
    user_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
    client_code TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT NOT NULL,
    date_of_birth DATE,
    gender TEXT CHECK (gender IN ('male', 'female', 'other')),
    height NUMERIC(5,2),
    current_weight NUMERIC(5,2),
    assigned_ybs_coach_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    join_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'paused', 'archived')),
    subscription_status TEXT NOT NULL DEFAULT 'no_subscription' 
        CHECK (subscription_status IN ('active', 'expiring_soon', 'expired', 'frozen', 'cancelled', 'no_subscription')),
    subscription_end_date DATE,
    package_name TEXT,
    follow_up_day TEXT DEFAULT 'saturday' 
        CHECK (follow_up_day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Client Applications (Public self-registration review queue)
CREATE TABLE IF NOT EXISTS public.client_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    applicant_name TEXT NOT NULL,
    applicant_phone TEXT NOT NULL,
    applicant_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'under_review', 'more_info_required', 'approved', 'rejected')),
    assigned_workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
    assigned_ybs_trainer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    more_info_request TEXT,
    more_info_response TEXT,
    more_info_responded_at TIMESTAMPTZ,
    rejection_reason TEXT,
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Client YBS Trainer Assignments (Audit history of coach allocations)
CREATE TABLE IF NOT EXISTS public.client_ybs_trainer_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    trainer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT
);

-- 7. Packages (Global catalog or workspace-custom tiers)
CREATE TABLE IF NOT EXISTS public.packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE, -- NULL means global shared template
    name TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('silver', 'gold', 'custom')),
    duration INTEGER NOT NULL,
    duration_unit TEXT NOT NULL CHECK (duration_unit IN ('days', 'weeks', 'months')),
    price NUMERIC(10,2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EGP',
    description TEXT,
    features TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_custom BOOLEAN NOT NULL DEFAULT false,
    max_capacity INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Subscriptions (Financial and membership ledger)
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    package_id UUID REFERENCES public.packages(id) ON DELETE SET NULL,
    package_name TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EGP',
    payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('paid', 'unpaid', 'partially_paid', 'refunded')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'renewed', 'frozen', 'cancelled')),
    freeze_start_date DATE,
    freeze_end_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. Assessment Templates
CREATE TABLE IF NOT EXISTS public.assessment_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE, -- NULL = global YBS template
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. Assessment Questions
CREATE TABLE IF NOT EXISTS public.assessment_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES public.assessment_templates(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    question_type TEXT NOT NULL CHECK (question_type IN ('short_answer', 'long_answer', 'single_choice', 'multiple_choice', 'yes_no', 'dropdown', 'number', 'date', 'rating', 'file_upload', 'image_upload')),
    label TEXT NOT NULL,
    description TEXT,
    required BOOLEAN NOT NULL DEFAULT false,
    options TEXT[] DEFAULT '{}',
    conditional_rules JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. Assigned Assessments
CREATE TABLE IF NOT EXISTS public.assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    template_id UUID REFERENCES public.assessment_templates(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    assigned_ybs_coach_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    due_date DATE,
    submission_status TEXT NOT NULL DEFAULT 'pending' CHECK (submission_status IN ('pending', 'submitted', 'reviewed', 'overdue')),
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 12. Assessment Responses
CREATE TABLE IF NOT EXISTS public.assessment_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    question_id UUID REFERENCES public.assessment_questions(id) ON DELETE SET NULL,
    question_label TEXT NOT NULL,
    response_value JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 13. Metrics (Biometric track logs)
CREATE TABLE IF NOT EXISTS public.metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    assigned_ybs_coach_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    entry_date DATE NOT NULL,
    weight NUMERIC(5,2),
    height NUMERIC(5,2),
    body_fat NUMERIC(4,1),
    neck NUMERIC(5,2),
    chest NUMERIC(5,2),
    waist NUMERIC(5,2),
    hip NUMERIC(5,2),
    right_arm NUMERIC(5,2),
    left_arm NUMERIC(5,2),
    right_thigh NUMERIC(5,2),
    left_thigh NUMERIC(5,2),
    right_calf NUMERIC(5,2),
    left_calf NUMERIC(5,2),
    custom_measurements JSONB DEFAULT '[]'::jsonb,
    notes TEXT,
    ai_analysis TEXT,
    ai_analysis_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 14. Progress Photos
CREATE TABLE IF NOT EXISTS public.progress_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_id UUID REFERENCES public.metrics(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    angle TEXT CHECK (angle IN ('front', 'side', 'back', 'other')),
    captured_at DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 15. Foods (Global or workspace shared database)
CREATE TABLE IF NOT EXISTS public.foods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE, -- NULL = global library
    name TEXT NOT NULL,
    serving_unit TEXT NOT NULL,
    serving_size NUMERIC(8,2) NOT NULL DEFAULT 100,
    calories NUMERIC(8,2) NOT NULL,
    protein NUMERIC(8,2) NOT NULL,
    carbs NUMERIC(8,2) NOT NULL,
    fat NUMERIC(8,2) NOT NULL,
    fiber NUMERIC(8,2) DEFAULT 0,
    sugar NUMERIC(8,2) DEFAULT 0,
    category TEXT CHECK (category IN ('protein', 'carbs', 'fats', 'vegetables', 'fruits', 'dairy', 'beverages', 'other')),
    is_archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 16. Nutrition Plans
CREATE TABLE IF NOT EXISTS public.nutrition_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE, -- NULL for templates
    assigned_ybs_coach_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    is_template BOOLEAN NOT NULL DEFAULT false,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    daily_calories NUMERIC(8,2),
    daily_protein NUMERIC(8,2),
    daily_carbs NUMERIC(8,2),
    daily_fat NUMERIC(8,2),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 17. Nutrition Meals
CREATE TABLE IF NOT EXISTS public.nutrition_meals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nutrition_plan_id UUID NOT NULL REFERENCES public.nutrition_plans(id) ON DELETE CASCADE,
    meal_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    calories NUMERIC(8,2),
    notes TEXT
);

-- 18. Nutrition Items
CREATE TABLE IF NOT EXISTS public.nutrition_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meal_id UUID NOT NULL REFERENCES public.nutrition_meals(id) ON DELETE CASCADE,
    food_id UUID REFERENCES public.foods(id) ON DELETE SET NULL,
    food_name TEXT NOT NULL,
    amount NUMERIC(8,2) NOT NULL,
    unit TEXT NOT NULL,
    calories NUMERIC(8,2) NOT NULL,
    protein NUMERIC(8,2) NOT NULL,
    carbs NUMERIC(8,2) NOT NULL,
    fat NUMERIC(8,2) NOT NULL
);

-- 19. Exercises (Global library or custom)
CREATE TABLE IF NOT EXISTS public.exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE, -- NULL = global library
    name TEXT NOT NULL,
    video_url TEXT,
    category TEXT CHECK (category IN ('chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'cardio', 'full_body', 'other')),
    muscle_group TEXT,
    equipment TEXT,
    tags TEXT[] DEFAULT '{}',
    instructions TEXT,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20. Workout Plans
CREATE TABLE IF NOT EXISTS public.workout_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE, -- NULL for templates
    assigned_ybs_coach_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    split_type TEXT NOT NULL CHECK (split_type IN ('full_body', 'upper_lower', 'push_pull_legs', 'arnold_split', 'bro_split', 'push_pull', 'custom')),
    is_template BOOLEAN NOT NULL DEFAULT false,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 21. Workout Days
CREATE TABLE IF NOT EXISTS public.workout_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workout_plan_id UUID NOT NULL REFERENCES public.workout_plans(id) ON DELETE CASCADE,
    day_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    rest_day BOOLEAN NOT NULL DEFAULT false
);

-- 22. Workout Exercises
CREATE TABLE IF NOT EXISTS public.workout_exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workout_day_id UUID NOT NULL REFERENCES public.workout_days(id) ON DELETE CASCADE,
    exercise_id UUID REFERENCES public.exercises(id) ON DELETE SET NULL,
    exercise_name TEXT NOT NULL,
    video_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    sets INTEGER NOT NULL DEFAULT 3,
    rep_range TEXT NOT NULL DEFAULT '8-12',
    rest_seconds INTEGER DEFAULT 60,
    target_weight TEXT,
    warmup BOOLEAN NOT NULL DEFAULT false,
    rpe NUMERIC(3,1),
    notes TEXT
);

-- 23. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    related_entity_type TEXT,
    related_entity_id UUID,
    delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'delivered', 'failed')),
    delivery_channel TEXT NOT NULL DEFAULT 'in_app' CHECK (delivery_channel IN ('in_app', 'telegram', 'both')),
    scheduled_for TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 24. Audit Logs (Immutable security tracking)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    actor_name TEXT NOT NULL,
    actor_role TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    entity_name TEXT,
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 25. Timeline Events (Operational feed)
CREATE TABLE IF NOT EXISTS public.timeline_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    assigned_ybs_coach_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    actor_name TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PERFORMANCE INDEXES (Covering FKs and High-Frequency Query Paths)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_profiles_platform_role ON public.profiles(platform_role);
CREATE INDEX IF NOT EXISTS idx_profiles_active_workspace_id ON public.profiles(active_workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON public.workspaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_status ON public.workspaces(status);

CREATE INDEX IF NOT EXISTS idx_workspace_memberships_workspace_id ON public.workspace_memberships(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user_id ON public.workspace_memberships(user_id);

CREATE INDEX IF NOT EXISTS idx_clients_workspace_id ON public.clients(workspace_id);
CREATE INDEX IF NOT EXISTS idx_clients_user_id ON public.clients(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_assigned_ybs_coach_id ON public.clients(assigned_ybs_coach_id);
CREATE INDEX IF NOT EXISTS idx_clients_subscription_status ON public.clients(subscription_status);

CREATE INDEX IF NOT EXISTS idx_client_applications_user_id ON public.client_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_client_applications_status ON public.client_applications(status);

CREATE INDEX IF NOT EXISTS idx_client_assignments_client_id ON public.client_ybs_trainer_assignments(client_id);
CREATE INDEX IF NOT EXISTS idx_client_assignments_trainer_id ON public.client_ybs_trainer_assignments(trainer_id);

CREATE INDEX IF NOT EXISTS idx_packages_workspace_id ON public.packages(workspace_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_id ON public.subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_client_id ON public.subscriptions(client_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);

CREATE INDEX IF NOT EXISTS idx_assessment_templates_workspace_id ON public.assessment_templates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assessment_questions_template_id ON public.assessment_questions(template_id);
CREATE INDEX IF NOT EXISTS idx_assessments_workspace_id ON public.assessments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assessments_client_id ON public.assessments(client_id);
CREATE INDEX IF NOT EXISTS idx_assessment_responses_assessment_id ON public.assessment_responses(assessment_id);

CREATE INDEX IF NOT EXISTS idx_metrics_workspace_id ON public.metrics(workspace_id);
CREATE INDEX IF NOT EXISTS idx_metrics_client_id ON public.metrics(client_id);
CREATE INDEX IF NOT EXISTS idx_metrics_entry_date ON public.metrics(entry_date);
CREATE INDEX IF NOT EXISTS idx_progress_photos_client_id ON public.progress_photos(client_id);

CREATE INDEX IF NOT EXISTS idx_foods_workspace_id ON public.foods(workspace_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_plans_workspace_id ON public.nutrition_plans(workspace_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_plans_client_id ON public.nutrition_plans(client_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_meals_plan_id ON public.nutrition_meals(nutrition_plan_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_items_meal_id ON public.nutrition_items(meal_id);

CREATE INDEX IF NOT EXISTS idx_exercises_workspace_id ON public.exercises(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workout_plans_workspace_id ON public.workout_plans(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workout_plans_client_id ON public.workout_plans(client_id);
CREATE INDEX IF NOT EXISTS idx_workout_days_plan_id ON public.workout_days(workout_plan_id);
CREATE INDEX IF NOT EXISTS idx_workout_exercises_day_id ON public.workout_exercises(workout_day_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_workspace_id ON public.notifications(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_id ON public.audit_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_workspace_id ON public.timeline_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_client_id ON public.timeline_events(client_id);

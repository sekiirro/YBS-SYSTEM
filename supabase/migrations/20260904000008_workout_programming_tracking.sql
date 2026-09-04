-- ============================================================
-- YBS SYSTEM: WORKOUT PROGRAMMING & FITNESS TRACKING
-- Migration: 20260904000008_workout_programming_tracking.sql
-- Additive only — preserves all existing tables and data
-- ============================================================

-- 1. Update split_type check constraint on workout_plans
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workout_plans_split_type_check'
  ) THEN
    ALTER TABLE public.workout_plans DROP CONSTRAINT workout_plans_split_type_check;
  END IF;

  ALTER TABLE public.workout_plans
    ADD CONSTRAINT workout_plans_split_type_check
    CHECK (split_type IN (
      'full_body',
      'upper_lower',
      'push_pull_legs',
      'arnold_split',
      'bro_split',
      'anterior_posterior',
      'torso_limbs',
      'push_pull',
      'custom'
    ));
END $$;

-- 2. Add custom split name and source template reference to workout_plans
ALTER TABLE public.workout_plans
  ADD COLUMN IF NOT EXISTS custom_split_name TEXT,
  ADD COLUMN IF NOT EXISTS source_template_id UUID REFERENCES public.workout_plans(id) ON DELETE SET NULL;

-- 3. Add session-level notes to workout_days
ALTER TABLE public.workout_days
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 4. Add grouping (supersets/circuits) & per-set details to workout_exercises
ALTER TABLE public.workout_exercises
  ADD COLUMN IF NOT EXISTS group_id TEXT,
  ADD COLUMN IF NOT EXISTS group_type TEXT,
  ADD COLUMN IF NOT EXISTS prescribed_sets_detail JSONB DEFAULT '[]'::jsonb;

-- 5. Create Workout Logs (Session Execution Header)
CREATE TABLE IF NOT EXISTS public.workout_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    workout_plan_id UUID REFERENCES public.workout_plans(id) ON DELETE SET NULL,
    workout_day_id UUID REFERENCES public.workout_days(id) ON DELETE SET NULL,
    session_name TEXT NOT NULL,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Create Workout Set Logs (Set-level Execution)
CREATE TABLE IF NOT EXISTS public.workout_set_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workout_log_id UUID NOT NULL REFERENCES public.workout_logs(id) ON DELETE CASCADE,
    workout_exercise_id UUID REFERENCES public.workout_exercises(id) ON DELETE SET NULL,
    exercise_id UUID REFERENCES public.exercises(id) ON DELETE SET NULL,
    exercise_name TEXT NOT NULL,
    set_number INTEGER NOT NULL DEFAULT 1,
    is_warmup BOOLEAN NOT NULL DEFAULT false,
    weight_kg NUMERIC(6,2),
    reps_completed INTEGER,
    rpe NUMERIC(3,1),
    completed BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_workout_plans_source_template 
  ON public.workout_plans(source_template_id);

CREATE INDEX IF NOT EXISTS idx_workout_logs_workspace_client 
  ON public.workout_logs(workspace_id, client_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_workout_logs_plan_day 
  ON public.workout_logs(workout_plan_id, workout_day_id);

CREATE INDEX IF NOT EXISTS idx_workout_set_logs_log_id 
  ON public.workout_set_logs(workout_log_id, set_number ASC);

CREATE INDEX IF NOT EXISTS idx_workout_set_logs_exercise 
  ON public.workout_set_logs(exercise_id);

-- 8. Row Level Security (RLS)
ALTER TABLE public.workout_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_set_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Workout Logs Policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'workout_logs_select' AND tablename = 'workout_logs') THEN
    CREATE POLICY "workout_logs_select" ON public.workout_logs
    FOR SELECT TO authenticated
    USING (
      public.is_platform_owner()
      OR public.is_workspace_owner(workspace_id)
      OR public.has_workspace_access(workspace_id)
      OR public.is_client_self(client_id)
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'workout_logs_manage' AND tablename = 'workout_logs') THEN
    CREATE POLICY "workout_logs_manage" ON public.workout_logs
    FOR ALL TO authenticated
    USING (
      public.is_platform_owner()
      OR public.is_workspace_owner(workspace_id)
      OR public.has_workspace_access(workspace_id)
      OR public.is_client_self(client_id)
    );
  END IF;

  -- Workout Set Logs Policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'workout_set_logs_select' AND tablename = 'workout_set_logs') THEN
    CREATE POLICY "workout_set_logs_select" ON public.workout_set_logs
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.workout_logs wl
        WHERE wl.id = workout_log_id
          AND (
            public.is_platform_owner()
            OR public.is_workspace_owner(wl.workspace_id)
            OR public.has_workspace_access(wl.workspace_id)
            OR public.is_client_self(wl.client_id)
          )
      )
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'workout_set_logs_manage' AND tablename = 'workout_set_logs') THEN
    CREATE POLICY "workout_set_logs_manage" ON public.workout_set_logs
    FOR ALL TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.workout_logs wl
        WHERE wl.id = workout_log_id
          AND (
            public.is_platform_owner()
            OR public.is_workspace_owner(wl.workspace_id)
            OR public.has_workspace_access(wl.workspace_id)
            OR public.is_client_self(wl.client_id)
          )
      )
    );
  END IF;
END $$;

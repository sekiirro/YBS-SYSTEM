-- ============================================================
-- YBS SYSTEM: DAILY NUTRITION LOGS & MEAL COMPLETION
-- Migration: 20260905000012_daily_nutrition_logs.sql
-- Additive only — provides idempotent daily meal adherence tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS public.daily_nutrition_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    nutrition_plan_id UUID REFERENCES public.nutrition_plans(id) ON DELETE SET NULL,
    log_date DATE NOT NULL DEFAULT CURRENT_DATE,
    meals_completed BOOLEAN NOT NULL DEFAULT true,
    calories_consumed NUMERIC(8,2),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_daily_nutrition_client_date UNIQUE (client_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_nutrition_logs_client_date 
  ON public.daily_nutrition_logs(client_id, log_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_nutrition_logs_workspace 
  ON public.daily_nutrition_logs(workspace_id);

-- RLS Enforcement
ALTER TABLE public.daily_nutrition_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'daily_nutrition_logs_select' AND tablename = 'daily_nutrition_logs') THEN
    CREATE POLICY "daily_nutrition_logs_select" ON public.daily_nutrition_logs
    FOR SELECT TO authenticated
    USING (
      public.is_platform_owner()
      OR public.is_workspace_owner(workspace_id)
      OR public.is_client_self(client_id)
      OR public.is_assigned_ybs_coach(client_id)
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'daily_nutrition_logs_manage' AND tablename = 'daily_nutrition_logs') THEN
    CREATE POLICY "daily_nutrition_logs_manage" ON public.daily_nutrition_logs
    FOR ALL TO authenticated
    USING (
      public.is_platform_owner()
      OR public.is_workspace_owner(workspace_id)
      OR public.is_client_self(client_id)
    )
    WITH CHECK (
      public.is_platform_owner()
      OR public.is_workspace_owner(workspace_id)
      OR public.is_client_self(client_id)
    );
  END IF;
END $$;

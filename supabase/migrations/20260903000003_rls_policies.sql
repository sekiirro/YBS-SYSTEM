-- ============================================================
-- YBS SYSTEM: SUPABASE DATABASE ARCHITECTURE (MIGRATION 03)
-- ROW LEVEL SECURITY POLICIES FOR ALL TABLES
-- AUDITED & HARDENED FOR MULTI-TENANCY & TAMPER-RESISTANCE
-- ============================================================

-- ------------------------------------------------------------
-- 1. PROFILES
-- ------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select" ON public.profiles
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR id = (select auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.workspace_memberships wm1
    JOIN public.workspace_memberships wm2 ON wm1.workspace_id = wm2.workspace_id
    WHERE wm1.user_id = (select auth.uid()) AND wm2.user_id = profiles.id
  )
  OR EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.assigned_ybs_coach_id = (select auth.uid()) AND c.user_id = profiles.id
  )
);

CREATE POLICY "profiles_update" ON public.profiles
FOR UPDATE TO authenticated
USING (
  public.is_platform_owner() OR id = (select auth.uid())
)
WITH CHECK (
  public.is_platform_owner() OR (
    id = (select auth.uid())
    -- Regular users cannot self-escalate platform_role or account_status
    AND platform_role = (SELECT p.platform_role FROM public.profiles p WHERE p.id = (select auth.uid()))
    AND account_status = (SELECT p.account_status FROM public.profiles p WHERE p.id = (select auth.uid()))
  )
);

-- ------------------------------------------------------------
-- 2. WORKSPACES
-- ------------------------------------------------------------
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspaces_select" ON public.workspaces
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR public.has_workspace_access(id)
);

-- ONLY Platform Owner can create workspaces
CREATE POLICY "workspaces_insert" ON public.workspaces
FOR INSERT TO authenticated
WITH CHECK (public.is_platform_owner());

-- Workspace Owner can only update basic branding/notes; only Platform Owner can update plan/status/owner_id
CREATE POLICY "workspaces_update_owner" ON public.workspaces
FOR UPDATE TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(id)
)
WITH CHECK (
  public.is_platform_owner()
  OR (
    public.is_workspace_owner(id)
    AND owner_id = (SELECT w.owner_id FROM public.workspaces w WHERE w.id = workspaces.id)
    AND platform_plan = (SELECT w.platform_plan FROM public.workspaces w WHERE w.id = workspaces.id)
    AND status = (SELECT w.status FROM public.workspaces w WHERE w.id = workspaces.id)
  )
);

CREATE POLICY "workspaces_delete" ON public.workspaces
FOR DELETE TO authenticated
USING (public.is_platform_owner());

-- ------------------------------------------------------------
-- 3. WORKSPACE MEMBERSHIPS
-- ------------------------------------------------------------
ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "memberships_select" ON public.workspace_memberships
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR user_id = (select auth.uid())
  OR public.is_workspace_owner(workspace_id)
);

CREATE POLICY "memberships_insert" ON public.workspace_memberships
FOR INSERT TO authenticated
WITH CHECK (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
);

CREATE POLICY "memberships_update" ON public.workspace_memberships
FOR UPDATE TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
)
WITH CHECK (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
);

CREATE POLICY "memberships_delete" ON public.workspace_memberships
FOR DELETE TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
);

-- ------------------------------------------------------------
-- 4. CLIENTS
-- ------------------------------------------------------------
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_select" ON public.clients
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
  OR user_id = (select auth.uid())
);

CREATE POLICY "clients_insert" ON public.clients
FOR INSERT TO authenticated
WITH CHECK (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
);

-- Protected update: trainers cannot reassign client to another workspace or trainer
CREATE POLICY "clients_update" ON public.clients
FOR UPDATE TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
)
WITH CHECK (
  public.is_platform_owner()
  OR (
    public.is_workspace_owner(workspace_id)
  )
  OR (
    assigned_ybs_coach_id = (select auth.uid())
    AND workspace_id = (SELECT c.workspace_id FROM public.clients c WHERE c.id = clients.id)
    AND assigned_ybs_coach_id = (SELECT c.assigned_ybs_coach_id FROM public.clients c WHERE c.id = clients.id)
    AND client_code = (SELECT c.client_code FROM public.clients c WHERE c.id = clients.id)
  )
);

CREATE POLICY "clients_delete" ON public.clients
FOR DELETE TO authenticated
USING (public.is_platform_owner());

-- ------------------------------------------------------------
-- 5. CLIENT APPLICATIONS (Tamper-Proof Approval Workflow)
-- ------------------------------------------------------------
ALTER TABLE public.client_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "applications_select" ON public.client_applications
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR user_id = (select auth.uid())
);

CREATE POLICY "applications_insert" ON public.client_applications
FOR INSERT TO authenticated
WITH CHECK (
  user_id = (select auth.uid())
  AND status = 'pending'
  AND assigned_workspace_id IS NULL
  AND assigned_ybs_trainer_id IS NULL
  AND created_client_id IS NULL
);

-- Only Platform Owner can approve or assign workspace/trainer
CREATE POLICY "applications_update_admin" ON public.client_applications
FOR UPDATE TO authenticated
USING (public.is_platform_owner())
WITH CHECK (public.is_platform_owner());

-- Applicants can only respond to more info requests
CREATE POLICY "applications_update_applicant" ON public.client_applications
FOR UPDATE TO authenticated
USING (
  user_id = (select auth.uid())
  AND status = 'more_info_required'
)
WITH CHECK (
  user_id = (select auth.uid())
  AND status IN ('under_review', 'more_info_required')
  AND assigned_workspace_id IS NULL
  AND assigned_ybs_trainer_id IS NULL
  AND created_client_id IS NULL
);

-- ------------------------------------------------------------
-- 6. CLIENT TRAINER ASSIGNMENTS
-- ------------------------------------------------------------
ALTER TABLE public.client_ybs_trainer_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assignments_select" ON public.client_ybs_trainer_assignments
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR trainer_id = (select auth.uid())
  OR public.is_workspace_owner(public.get_client_workspace_id(client_id))
);

CREATE POLICY "assignments_all_admin" ON public.client_ybs_trainer_assignments
FOR ALL TO authenticated
USING (public.is_platform_owner())
WITH CHECK (public.is_platform_owner());

-- ------------------------------------------------------------
-- 7. PACKAGES
-- ------------------------------------------------------------
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "packages_select" ON public.packages
FOR SELECT TO authenticated
USING (
  workspace_id IS NULL -- Global shared catalog
  OR public.is_platform_owner()
  OR public.has_workspace_access(workspace_id)
);

CREATE POLICY "packages_insert" ON public.packages
FOR INSERT TO authenticated
WITH CHECK (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
);

CREATE POLICY "packages_update" ON public.packages
FOR UPDATE TO authenticated
USING (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
);

CREATE POLICY "packages_delete" ON public.packages
FOR DELETE TO authenticated
USING (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
);

-- ------------------------------------------------------------
-- 8. SUBSCRIPTIONS (Strict Financial Isolation)
-- ------------------------------------------------------------
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Platform Owner, Workspace Owner, AND Client (for their own subscription)
-- YBS Trainers CANNOT view financial subscriptions
CREATE POLICY "subscriptions_select" ON public.subscriptions
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR public.is_client_self(client_id)
);

-- Only Platform Owner and Workspace Owner can create/update subscriptions
CREATE POLICY "subscriptions_manage" ON public.subscriptions
FOR ALL TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
)
WITH CHECK (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
);

-- ------------------------------------------------------------
-- 9. ASSESSMENTS & TEMPLATES
-- ------------------------------------------------------------
ALTER TABLE public.assessment_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "templates_select" ON public.assessment_templates
FOR SELECT TO authenticated
USING (
  workspace_id IS NULL 
  OR public.is_platform_owner() 
  OR public.has_workspace_access(workspace_id)
);

CREATE POLICY "templates_manage" ON public.assessment_templates
FOR ALL TO authenticated
USING (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
);

CREATE POLICY "questions_select" ON public.assessment_questions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.assessment_templates t
    WHERE t.id = template_id
      AND (t.workspace_id IS NULL OR public.is_platform_owner() OR public.has_workspace_access(t.workspace_id))
  )
);

CREATE POLICY "assessments_select" ON public.assessments
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
  OR public.is_client_self(client_id)
);

CREATE POLICY "assessments_insert" ON public.assessments
FOR INSERT TO authenticated
WITH CHECK (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
);

CREATE POLICY "assessments_update" ON public.assessments
FOR UPDATE TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
  OR public.is_client_self(client_id)
);

CREATE POLICY "responses_select" ON public.assessment_responses
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.id = assessment_id
      AND (
        public.is_platform_owner()
        OR public.is_workspace_owner(a.workspace_id)
        OR a.assigned_ybs_coach_id = (select auth.uid())
        OR public.is_client_self(a.client_id)
      )
  )
);

CREATE POLICY "responses_insert" ON public.assessment_responses
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.id = assessment_id
      AND (
        public.is_platform_owner()
        OR public.is_workspace_owner(a.workspace_id)
        OR a.assigned_ybs_coach_id = (select auth.uid())
        OR public.is_client_self(a.client_id)
      )
  )
);

CREATE POLICY "responses_update" ON public.assessment_responses
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.id = assessment_id
      AND (
        public.is_platform_owner()
        OR public.is_workspace_owner(a.workspace_id)
        OR a.assigned_ybs_coach_id = (select auth.uid())
        OR public.is_client_self(a.client_id)
      )
  )
);

-- ------------------------------------------------------------
-- 10. METRICS & PROGRESS PHOTOS
-- ------------------------------------------------------------
ALTER TABLE public.metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "metrics_select" ON public.metrics
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
  OR public.is_client_self(client_id)
);

CREATE POLICY "metrics_insert" ON public.metrics
FOR INSERT TO authenticated
WITH CHECK (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
  OR public.is_client_self(client_id)
);

CREATE POLICY "metrics_update" ON public.metrics
FOR UPDATE TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
);

CREATE POLICY "progress_photos_select" ON public.progress_photos
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR public.is_assigned_ybs_coach(client_id)
  OR public.is_client_self(client_id)
);

CREATE POLICY "progress_photos_insert" ON public.progress_photos
FOR INSERT TO authenticated
WITH CHECK (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR public.is_assigned_ybs_coach(client_id)
  OR public.is_client_self(client_id)
);

-- ------------------------------------------------------------
-- 11. FOODS & NUTRITION (Child Tables Scoped to Plan RLS)
-- ------------------------------------------------------------
ALTER TABLE public.foods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "foods_select" ON public.foods
FOR SELECT TO authenticated
USING (
  workspace_id IS NULL
  OR public.is_platform_owner()
  OR public.has_workspace_access(workspace_id)
);

CREATE POLICY "foods_manage" ON public.foods
FOR ALL TO authenticated
USING (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
);

CREATE POLICY "nutrition_plans_select" ON public.nutrition_plans
FOR SELECT TO authenticated
USING (
  (is_template AND (workspace_id IS NULL OR public.has_workspace_access(workspace_id)))
  OR public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
  OR (client_id IS NOT NULL AND public.is_client_self(client_id))
);

CREATE POLICY "nutrition_plans_manage" ON public.nutrition_plans
FOR ALL TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
);

-- Scoped Nutrition Meals
CREATE POLICY "nutrition_meals_select" ON public.nutrition_meals
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.nutrition_plans np
    WHERE np.id = nutrition_plan_id
      AND (
        (np.is_template AND (np.workspace_id IS NULL OR public.has_workspace_access(np.workspace_id)))
        OR public.is_platform_owner()
        OR public.is_workspace_owner(np.workspace_id)
        OR np.assigned_ybs_coach_id = (select auth.uid())
        OR (np.client_id IS NOT NULL AND public.is_client_self(np.client_id))
      )
  )
);

CREATE POLICY "nutrition_meals_manage" ON public.nutrition_meals
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.nutrition_plans np
    WHERE np.id = nutrition_plan_id
      AND (
        public.is_platform_owner()
        OR public.is_workspace_owner(np.workspace_id)
        OR np.assigned_ybs_coach_id = (select auth.uid())
      )
  )
);

-- Scoped Nutrition Items
CREATE POLICY "nutrition_items_select" ON public.nutrition_items
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.nutrition_meals nm
    JOIN public.nutrition_plans np ON np.id = nm.nutrition_plan_id
    WHERE nm.id = meal_id
      AND (
        (np.is_template AND (np.workspace_id IS NULL OR public.has_workspace_access(np.workspace_id)))
        OR public.is_platform_owner()
        OR public.is_workspace_owner(np.workspace_id)
        OR np.assigned_ybs_coach_id = (select auth.uid())
        OR (np.client_id IS NOT NULL AND public.is_client_self(np.client_id))
      )
  )
);

CREATE POLICY "nutrition_items_manage" ON public.nutrition_items
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.nutrition_meals nm
    JOIN public.nutrition_plans np ON np.id = nm.nutrition_plan_id
    WHERE nm.id = meal_id
      AND (
        public.is_platform_owner()
        OR public.is_workspace_owner(np.workspace_id)
        OR np.assigned_ybs_coach_id = (select auth.uid())
      )
  )
);

-- ------------------------------------------------------------
-- 12. EXERCISES & WORKOUTS (Child Tables Scoped to Plan RLS)
-- ------------------------------------------------------------
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exercises_select" ON public.exercises
FOR SELECT TO authenticated
USING (
  workspace_id IS NULL
  OR public.is_platform_owner()
  OR public.has_workspace_access(workspace_id)
);

CREATE POLICY "exercises_manage" ON public.exercises
FOR ALL TO authenticated
USING (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
);

CREATE POLICY "workout_plans_select" ON public.workout_plans
FOR SELECT TO authenticated
USING (
  (is_template AND (workspace_id IS NULL OR public.has_workspace_access(workspace_id)))
  OR public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
  OR (client_id IS NOT NULL AND public.is_client_self(client_id))
);

CREATE POLICY "workout_plans_manage" ON public.workout_plans
FOR ALL TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
);

-- Scoped Workout Days
CREATE POLICY "workout_days_select" ON public.workout_days
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.workout_plans wp
    WHERE wp.id = workout_plan_id
      AND (
        (wp.is_template AND (wp.workspace_id IS NULL OR public.has_workspace_access(wp.workspace_id)))
        OR public.is_platform_owner()
        OR public.is_workspace_owner(wp.workspace_id)
        OR wp.assigned_ybs_coach_id = (select auth.uid())
        OR (wp.client_id IS NOT NULL AND public.is_client_self(wp.client_id))
      )
  )
);

CREATE POLICY "workout_days_manage" ON public.workout_days
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.workout_plans wp
    WHERE wp.id = workout_plan_id
      AND (
        public.is_platform_owner()
        OR public.is_workspace_owner(wp.workspace_id)
        OR wp.assigned_ybs_coach_id = (select auth.uid())
      )
  )
);

-- Scoped Workout Exercises
CREATE POLICY "workout_exercises_select" ON public.workout_exercises
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.workout_days wd
    JOIN public.workout_plans wp ON wp.id = wd.workout_plan_id
    WHERE wd.id = workout_day_id
      AND (
        (wp.is_template AND (wp.workspace_id IS NULL OR public.has_workspace_access(wp.workspace_id)))
        OR public.is_platform_owner()
        OR public.is_workspace_owner(wp.workspace_id)
        OR wp.assigned_ybs_coach_id = (select auth.uid())
        OR (wp.client_id IS NOT NULL AND public.is_client_self(wp.client_id))
      )
  )
);

CREATE POLICY "workout_exercises_manage" ON public.workout_exercises
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.workout_days wd
    JOIN public.workout_plans wp ON wp.id = wd.workout_plan_id
    WHERE wd.id = workout_day_id
      AND (
        public.is_platform_owner()
        OR public.is_workspace_owner(wp.workspace_id)
        OR wp.assigned_ybs_coach_id = (select auth.uid())
      )
  )
);

-- ------------------------------------------------------------
-- 13. NOTIFICATIONS, AUDIT & TIMELINE
-- ------------------------------------------------------------
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select" ON public.notifications
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR user_id = (select auth.uid())
);

CREATE POLICY "notifications_update" ON public.notifications
FOR UPDATE TO authenticated
USING (user_id = (select auth.uid()))
WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "audit_logs_select" ON public.audit_logs
FOR SELECT TO authenticated
USING (public.is_platform_owner());

CREATE POLICY "timeline_select" ON public.timeline_events
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR public.is_assigned_ybs_coach(client_id)
  OR public.is_client_self(client_id)
);

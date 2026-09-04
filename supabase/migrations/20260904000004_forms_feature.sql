-- ============================================================
-- YBS SYSTEM: FORMS FEATURE MIGRATION
-- Additive changes only — no destructive modifications
-- ============================================================

-- 1. Add status + created_by to assessment_templates
ALTER TABLE public.assessment_templates
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 2. Add questions_snapshot to assessments (frozen copy at assignment time)
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS questions_snapshot JSONB;

-- 3. Add time to question_type CHECK constraint
-- Drop and re-add the constraint to include 'time'
ALTER TABLE public.assessment_questions
  DROP CONSTRAINT IF EXISTS assessment_questions_question_type_check;

ALTER TABLE public.assessment_questions
  ADD CONSTRAINT assessment_questions_question_type_check
  CHECK (question_type IN (
    'short_answer', 'long_answer', 'single_choice', 'multiple_choice',
    'yes_no', 'dropdown', 'number', 'date', 'rating',
    'file_upload', 'image_upload', 'time'
  ));

-- 4. Unique constraint on assessment_responses for safe upsert
-- Prevents duplicate responses per question per assessment
ALTER TABLE public.assessment_responses
  DROP CONSTRAINT IF EXISTS uq_response_per_question;

ALTER TABLE public.assessment_responses
  ADD CONSTRAINT uq_response_per_question
  UNIQUE (assessment_id, question_id);

-- 5. Index for template status queries
CREATE INDEX IF NOT EXISTS idx_assessment_templates_status
  ON public.assessment_templates(status);

CREATE INDEX IF NOT EXISTS idx_assessment_templates_created_by
  ON public.assessment_templates(created_by);

-- ============================================================
-- RLS POLICY ADDITIONS
-- ============================================================

-- 6. assessment_questions: INSERT policy
-- Allows template creators to add questions
CREATE POLICY "questions_insert" ON public.assessment_questions
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.assessment_templates t
    WHERE t.id = template_id
      AND (
        public.is_platform_owner()
        OR (t.workspace_id IS NOT NULL AND public.is_workspace_owner(t.workspace_id))
        OR t.created_by = (select auth.uid())
      )
  )
);

-- 7. assessment_questions: UPDATE policy
CREATE POLICY "questions_update" ON public.assessment_questions
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.assessment_templates t
    WHERE t.id = template_id
      AND (
        public.is_platform_owner()
        OR (t.workspace_id IS NOT NULL AND public.is_workspace_owner(t.workspace_id))
        OR t.created_by = (select auth.uid())
      )
  )
);

-- 8. assessment_questions: DELETE policy
CREATE POLICY "questions_delete" ON public.assessment_questions
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.assessment_templates t
    WHERE t.id = template_id
      AND (
        public.is_platform_owner()
        OR (t.workspace_id IS NOT NULL AND public.is_workspace_owner(t.workspace_id))
        OR t.created_by = (select auth.uid())
      )
  )
);

-- 9. Extend assessment_templates manage policy for coaches (platform_trainers)
-- The existing "templates_manage" policy only covers platform_owner + workspace_owner.
-- We need coaches to manage their own templates.
-- Drop and recreate to add created_by check.
DROP POLICY IF EXISTS "templates_manage" ON public.assessment_templates;

CREATE POLICY "templates_manage" ON public.assessment_templates
FOR ALL TO authenticated
USING (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
  OR created_by = (select auth.uid())
)
WITH CHECK (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
  OR created_by = (select auth.uid())
);

-- 10. Notifications: INSERT policy
-- Platform owner / workspace owner can notify anyone in their scope.
-- Coaches can create notifications for their clients + their own user_id.
-- Clients can only see their own (already in select policy).
CREATE POLICY "notifications_insert" ON public.notifications
FOR INSERT TO authenticated
WITH CHECK (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
  OR user_id = (select auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.user_id = notifications.user_id
      AND c.assigned_ybs_coach_id = (select auth.uid())
  )
);

-- 11. Allow assessment_responses DELETE for resubmission cleanup
-- Only the client (self) or trainer/owner can delete responses
CREATE POLICY "responses_delete" ON public.assessment_responses
FOR DELETE TO authenticated
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

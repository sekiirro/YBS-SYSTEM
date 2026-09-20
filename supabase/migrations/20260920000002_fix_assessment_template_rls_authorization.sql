-- ============================================================
-- FIX: ASSESSMENT TEMPLATE RLS AUTHORIZATION (anti-koshary 7.1)
--
-- PROBLEM
--   templates_manage (FOR ALL) allowed ANY authenticated user --
--   including a CLIENT -- to Insert/Update/Delete
--   assessment_templates via the `OR created_by = auth.uid()`
--   branch. A caller could self-assert created_by and create
--   GLOBAL masters (workspace_id NULL) or templates pinned to
--   arbitrary workspaces. questions_insert/update/delete carried
--   the same raw created_by self-assertion against the parent
--   template.
--
-- FIX
--   Replace the single FOR ALL policy with per-command policies
--   that bind the creator branch to an actual YBS coach
--   (is_ybs_trainer):
--     * INSERT  -- workspace-scoped only; creator must be a
--                 trainer with active access to that workspace
--                 (has_workspace_access). Global masters can only
--                 be created by the platform owner.
--     * UPDATE  -- platform owner, workspace owner (own
--                 workspace), or the trainer who authored the
--                 template. A non-owner can never move a row to
--                 global (workspace_id IS NOT NULL required in
--                 WITH CHECK).
--     * DELETE  -- same as UPDATE.
--   SELECT visibility (templates_select / questions_select) is
--   preserved exactly as-is.
--
-- RLS-only changes -- no data, schema, or SECURITY DEFINER
-- changes. Apply via `supabase db query --linked -f <this file>`
-- (never a bare `supabase db push`, which would also apply the
-- forbidden cleanup migration 20260917000001).
-- ============================================================

-- 1. assessment_templates --------------------------------------
DROP POLICY IF EXISTS "templates_manage" ON public.assessment_templates;

CREATE POLICY "templates_insert" ON public.assessment_templates
FOR INSERT TO authenticated
WITH CHECK (
  public.is_platform_owner()
  OR (
    workspace_id IS NOT NULL
    AND public.is_workspace_owner(workspace_id)
  )
  OR (
    workspace_id IS NOT NULL
    AND created_by = (select auth.uid())
    AND public.is_ybs_trainer()
    AND public.has_workspace_access(workspace_id)
  )
);

CREATE POLICY "templates_update" ON public.assessment_templates
FOR UPDATE TO authenticated
USING (
  public.is_platform_owner()
  OR (
    workspace_id IS NOT NULL
    AND public.is_workspace_owner(workspace_id)
  )
  OR (
    created_by = (select auth.uid())
    AND public.is_ybs_trainer()
  )
)
WITH CHECK (
  public.is_platform_owner()
  OR (
    workspace_id IS NOT NULL
    AND public.is_workspace_owner(workspace_id)
  )
  OR (
    workspace_id IS NOT NULL
    AND created_by = (select auth.uid())
    AND public.is_ybs_trainer()
  )
);

CREATE POLICY "templates_delete" ON public.assessment_templates
FOR DELETE TO authenticated
USING (
  public.is_platform_owner()
  OR (
    workspace_id IS NOT NULL
    AND public.is_workspace_owner(workspace_id)
  )
  OR (
    created_by = (select auth.uid())
    AND public.is_ybs_trainer()
  )
);

-- 2. assessment_questions (bind creator branch to coach role) --
DROP POLICY IF EXISTS "questions_insert" ON public.assessment_questions;

CREATE POLICY "questions_insert" ON public.assessment_questions
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.assessment_templates t
    WHERE t.id = template_id
      AND (
        public.is_platform_owner()
        OR (
          t.workspace_id IS NOT NULL
          AND public.is_workspace_owner(t.workspace_id)
        )
        OR (
          t.workspace_id IS NOT NULL
          AND t.created_by = (select auth.uid())
          AND public.is_ybs_trainer()
          AND public.has_workspace_access(t.workspace_id)
        )
      )
  )
);

DROP POLICY IF EXISTS "questions_update" ON public.assessment_questions;

CREATE POLICY "questions_update" ON public.assessment_questions
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.assessment_templates t
    WHERE t.id = template_id
      AND (
        public.is_platform_owner()
        OR (
          t.workspace_id IS NOT NULL
          AND public.is_workspace_owner(t.workspace_id)
        )
        OR (
          t.created_by = (select auth.uid())
          AND public.is_ybs_trainer()
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.assessment_templates t
    WHERE t.id = template_id
      AND (
        public.is_platform_owner()
        OR (
          t.workspace_id IS NOT NULL
          AND public.is_workspace_owner(t.workspace_id)
        )
        OR (
          t.created_by = (select auth.uid())
          AND public.is_ybs_trainer()
        )
      )
  )
);

DROP POLICY IF EXISTS "questions_delete" ON public.assessment_questions;

CREATE POLICY "questions_delete" ON public.assessment_questions
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.assessment_templates t
    WHERE t.id = template_id
      AND (
        public.is_platform_owner()
        OR (
          t.workspace_id IS NOT NULL
          AND public.is_workspace_owner(t.workspace_id)
        )
        OR (
          t.created_by = (select auth.uid())
          AND public.is_ybs_trainer()
        )
      )
  )
);
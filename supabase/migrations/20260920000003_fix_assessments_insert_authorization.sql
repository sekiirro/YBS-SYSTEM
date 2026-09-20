-- ============================================================
-- FIX: ASSESSMENTS INSERT AUTHORIZATION (anti-koshary 7.2)
--
-- PROBLEM
--   assessments_insert WITH CHECK allowed ANY authenticated user
--   -- including a CLIENT -- to Insert an assessment (assigned
--   form) via the `OR assigned_ybs_coach_id = auth.uid()` branch.
--   A caller could self-assert assigned_ybs_coach_id and create an
--   assessment for a client/workspace they do not actually
--   control (cross-workspace), or for another tenant's clients.
--
-- FIX
--   The coach branch now requires ALL of:
--     * assigned_ybs_coach_id = auth.uid()       (no self-asserted
--                                                 other coach)
--     * is_ybs_trainer()                          (caller is an
--                                                 active YBS coach)
--     * the target client exists, belongs to the SAME workspace as
--       the assessment row (c.workspace_id = workspace_id), AND is
--       actually assigned to the caller (c.assigned_ybs_coach_id =
--       auth.uid()).
--   The workspace-owner branch is strengthened to require the
--   client to belong to that workspace too (prevents an owner from
--   injecting a cross-workspace client, keeping the row consistent
--   with clients.workspace_id -- verified: 0 rows currently
--   mismatch).
--   Platform owner keeps full bypass. assessments_select /
--   assessments_update are untouched (client access to their own
--   assessments preserved).
--
-- RLS-only change. Apply via `supabase db query --linked -f
-- <this file>` (never a bare `supabase db push`, which would also
-- apply the forbidden cleanup migration 20260917000001).
-- ============================================================

DROP POLICY IF EXISTS "assessments_insert" ON public.assessments;

CREATE POLICY "assessments_insert" ON public.assessments
FOR INSERT TO authenticated
WITH CHECK (
  public.is_platform_owner()
  OR (
    public.is_workspace_owner(workspace_id)
    AND EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = client_id
        AND c.workspace_id = assessments.workspace_id
    )
  )
  OR (
    assigned_ybs_coach_id = (select auth.uid())
    AND public.is_ybs_trainer()
    AND EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = client_id
        AND c.workspace_id = assessments.workspace_id
        AND c.assigned_ybs_coach_id = (select auth.uid())
    )
  )
);
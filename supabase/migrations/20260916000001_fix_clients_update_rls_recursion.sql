-- ============================================================
-- Migration 20260916000001: Fix "infinite recursion detected in
-- policy for relation \"clients\"" (SQLSTATE 42P17)
--
-- ROOT CAUSE:
--   The `clients_update` policy's WITH CHECK contains three inline
--   SAME-TABLE subqueries against public.clients (the trainer-guard
--   branch that prevents an assigned coach from reassigning the
--   client to another workspace/trainer or changing the client code):
--
--     WITH CHECK (
--       public.is_platform_owner()
--       OR (public.is_workspace_owner(workspace_id))
--       OR (
--         assigned_ybs_coach_id = (select auth.uid())
--         AND workspace_id          = (SELECT c.workspace_id          FROM public.clients c WHERE c.id = clients.id)
--         AND assigned_ybs_coach_id = (SELECT c.assigned_ybs_coach_id FROM public.clients c WHERE c.id = clients.id)
--         AND client_code           = (SELECT c.client_code           FROM public.clients c WHERE c.id = clients.id)
--       )
--     )
--
--   A policy row-clause (USING/WITH CHECK) that subselects from the
--   very table it protects re-enters that table's RLS, re-evaluating
--   the clients policies for the subquery's rows -> infinite
--   recursion (42P17). It surfaces as the runtime error
--   "Failed to update trainer: infinite recursion detected in policy
--   for relation \"clients\"" on PATCH /rest/v1/clients.
--
-- FIX (narrowest secure fix, additive — mirrors migration
--   20260907000003 for profiles):
--   Move the three self-subqueries out of the WITH CHECK into a single
--   SECURITY DEFINER helper (public.can_trainer_edit_client), owned by
--   the superuser, so the current-row read bypasses RLS instead of
--   re-entering the clients policy. The clients_update policy is
--   recreated to call that helper, eliminating the same-table subquery
--   and the recursion.
--
--   Security behavior is fully preserved:
--     * Platform Owner may update any client (is_platform_owner()).
--     * Workspace Owner may update clients in their workspace
--       (is_workspace_owner(workspace_id)) including reassigning
--       assigned_ybs_coach_id (unchanged).
--     * An assigned trainer may update their client ONLY while the
--       workspace_id, assigned_ybs_coach_id, and client_code stay
--       unchanged (helper requires the submitted values to equal the
--       row's current values AND the current coach to be auth.uid()).
--       Trainers CANNOT reassign the client to another trainer,
--       another workspace, or change the client code.
--   No RLS disabled, no USING(true)/WITH CHECK(true), no client
--   bypass, no changes to clients_select/insert/delete.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Narrowly scoped helper: substitutes the three inline
--    same-table subqueries with a single RLS-safe read.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_trainer_edit_client(
  p_client_id UUID,
  p_workspace_id UUID,
  p_assigned_ybs_coach_id UUID,
  p_client_code TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clients
    WHERE id = p_client_id
      AND workspace_id = p_workspace_id
      AND assigned_ybs_coach_id = (select auth.uid())
      AND assigned_ybs_coach_id = p_assigned_ybs_coach_id
      AND client_code = p_client_code
  );
$$;

-- The helper reads public.clients internally while SECURITY DEFINER;
-- normalize its owner to the superuser so that read actually bypasses
-- RLS (as with the other role-check helpers).
ALTER FUNCTION public.can_trainer_edit_client(UUID, UUID, UUID, TEXT) OWNER TO postgres;

REVOKE EXECUTE
ON FUNCTION public.can_trainer_edit_client(UUID, UUID, UUID, TEXT)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.can_trainer_edit_client(UUID, UUID, UUID, TEXT)
TO authenticated;

-- ------------------------------------------------------------
-- 2. Recreate ONLY the clients_update policy, replacing the
--    self-subqueries with a call to the helper above.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "clients_update" ON public.clients;

CREATE POLICY "clients_update"
ON public.clients
FOR UPDATE
TO authenticated
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
    AND public.can_trainer_edit_client(
      id,
      workspace_id,
      assigned_ybs_coach_id,
      client_code
    )
  )
);
-- ============================================================
-- YBS SYSTEM: FOOD DATABASE RLS AUTH ALIGNMENT (MIGRATION 20260904000003)
-- Aligns the foods_manage RLS policy with the application-level
-- `nutrition.fooddb` permission so that users granted that permission
-- (in the workspace that owns the food row) can write to the food
-- database, while preserving:
--   * Platform-owner / workspace-owner access (unchanged)
--   * Workspace isolation (permission is scoped to a workspace)
--   * That global foods (workspace_id IS NULL) remain owner/admin-managed
--   * That RLS is NOT opened to all authenticated users
-- ============================================================

-- 1. Helper: does the authenticated user hold a given permission in the
--    specified workspace via an active membership? Workspace-scoped and
--    mirrors the existing has_workspace_access() hardening pattern.
CREATE OR REPLACE FUNCTION public.has_workspace_permission(ws_id UUID, permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    JOIN public.workspaces w ON w.id = wm.workspace_id
    WHERE wm.user_id = (select auth.uid())
      AND wm.workspace_id = ws_id
      AND wm.status = 'active'
      AND w.status = 'active'
      AND wm.permissions @> ARRAY[permission]
  );
$$;

-- Grant strictly to authenticated (mirrors other helper grants)
REVOKE EXECUTE ON FUNCTION public.has_workspace_permission(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_workspace_permission(UUID, TEXT) TO authenticated;

-- 2. Replace foods_manage policy so nutrition.fooddb holders in the owning
--    workspace can write, in addition to platform owners and workspace owners.
--    Note: global foods (workspace_id IS NULL) are still restricted to the
--    platform owner (and implicitly any platform-owner-equivalent), keeping the
--    shared/global catalog protected.
DROP POLICY IF EXISTS "foods_manage" ON public.foods;

CREATE POLICY "foods_manage" ON public.foods
FOR ALL TO authenticated
USING (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
  OR (workspace_id IS NOT NULL AND public.has_workspace_permission(workspace_id, 'nutrition.fooddb'))
)
WITH CHECK (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
  OR (workspace_id IS NOT NULL AND public.has_workspace_permission(workspace_id, 'nutrition.fooddb'))
);

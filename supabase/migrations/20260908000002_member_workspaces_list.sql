-- ============================================================
-- YBS MEMBER WORKSPACES LIST — SWITCHER/SIDEBAR DATA SOURCE
--
-- `get_workspaces_overview()` intentionally returns ONLY the
-- caller's ACTIVE workspace (RLS `has_workspace_access`). The
-- workspace switcher must list EVERY ACTIVE membership so a
-- member can switch context between their workspaces. This RPC
-- returns exactly that, scoped to the caller via auth.uid().
--
-- SECURITY: SECURITY DEFINER but the row filter is anchored to
-- (select auth.uid()) — a caller can only ever read their own
-- active memberships. No blind-trust of client-supplied ids.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_member_workspaces()
RETURNS TABLE (
  workspace_id UUID,
  name TEXT,
  slug TEXT,
  workspace_role TEXT,
  status TEXT,
  is_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id,
    w.name,
    w.slug,
    wm.workspace_role,
    wm.status,
    (p.active_workspace_id = w.id) AS is_active
  FROM public.workspace_memberships wm
  JOIN public.workspaces w ON w.id = wm.workspace_id
  JOIN public.profiles p ON p.id = wm.user_id
  WHERE wm.user_id = (select auth.uid())
    AND wm.status = 'active'
    AND w.status = 'active'
  ORDER BY (p.active_workspace_id = w.id) DESC, w.created_at DESC;
$$;

ALTER FUNCTION public.get_member_workspaces() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_member_workspaces() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_workspaces() TO authenticated;
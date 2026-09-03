-- ============================================================
-- YBS SYSTEM: SUPABASE DATABASE ARCHITECTURE (MIGRATION 02)
-- RLS HELPER FUNCTIONS (HARDENED SECURITY DEFINER)
-- ============================================================

-- 1. Check if authenticated user is Platform Owner strictly
CREATE OR REPLACE FUNCTION public.is_platform_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (select auth.uid())
      AND platform_role = 'platform_owner'
      AND account_status = 'active'
  );
$$;

-- Alias for compatibility: only platform_owner has platform-wide authority
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner();
$$;

-- 2. Check if user is a verified active YBS internal trainer
CREATE OR REPLACE FUNCTION public.is_ybs_trainer()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (select auth.uid())
      AND platform_role = 'platform_trainer'
      AND account_status = 'active'
  );
$$;

-- 3. Check if user is Workspace Owner of the target workspace
CREATE OR REPLACE FUNCTION public.is_workspace_owner(ws_id UUID)
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
      AND wm.workspace_role = 'workspace_owner'
      AND wm.status = 'active'
      AND w.status = 'active'
  );
$$;

-- 4. Check if user has active membership in target workspace with optional minimum role
CREATE OR REPLACE FUNCTION public.has_workspace_access(ws_id UUID, min_role TEXT DEFAULT 'client')
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
      AND (
        min_role = 'client' OR
        (min_role = 'owner' AND wm.workspace_role = 'workspace_owner')
      )
  );
$$;

-- 5. Check if authenticated user is the assigned YBS coach for a given client
CREATE OR REPLACE FUNCTION public.is_assigned_ybs_coach(c_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = c_id
      AND assigned_ybs_coach_id = (select auth.uid())
  );
$$;

-- 6. Check if authenticated user is the client himself
CREATE OR REPLACE FUNCTION public.is_client_self(c_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = c_id
      AND user_id = (select auth.uid())
  );
$$;

-- 7. Helper to resolve client's workspace_id reliably
CREATE OR REPLACE FUNCTION public.get_client_workspace_id(c_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM public.clients WHERE id = c_id;
$$;

-- Revoke execute from public, grant strictly to authenticated
REVOKE EXECUTE ON FUNCTION public.is_platform_owner FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_owner TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_platform_admin FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_ybs_trainer FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ybs_trainer TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_workspace_owner FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_workspace_owner TO authenticated;

REVOKE EXECUTE ON FUNCTION public.has_workspace_access FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_workspace_access TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_assigned_ybs_coach FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_assigned_ybs_coach TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_client_self FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_client_self TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_client_workspace_id FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_client_workspace_id TO authenticated;

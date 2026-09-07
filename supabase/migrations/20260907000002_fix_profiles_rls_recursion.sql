-- ============================================================
-- Migration 20260907000002: Fix "infinite recursion detected in
-- policy for relation \"profiles\"" (SQLSTATE 42P17)
--
-- Observed runtime failure:
--   PATCH /rest/v1/profiles?id=eq.<owner_id>  ->  500
--   code: 42P17  message: infinite recursion detected in
--   policy for relation "profiles"
--
-- Exact recursion trace:
--   profiles_update / profiles_select  (20260903000003)
--     -> public.is_platform_owner()
--     -> SELECT ... FROM public.profiles        <-- RE-ENTERS the
--                                                  profiles policies
--     -> public.is_platform_owner() again       -> loop -> 42P17
--
-- Why it loops despite SECURITY DEFINER:
--   SECURITY DEFINER does NOT skip RLS by itself. The helper only
--   avoids the recursion when its OWNER is a superuser (or a
--   BYPASSRLS role). Migrations in this repo define these helpers
--   as SECURITY DEFINER but never normalise their owner, and
--   CREATE OR REPLACE never changes an existing function's owner.
--   If the remote functions were (re)created by a non-bypassing
--   owner, every internal profiles SELECT evaluates the profiles
--   policies again -> infinite recursion.
--
-- Fix (additive; preserves ALL policy semantics & table constraints):
--   Recreate the role-check helpers with hardened SECURITY DEFINER
--   (fixed search_path = public, pg_temp) and normalise their OWNER
--   to the postgres superuser so the role check can inspect the
--   profile / membership tables WITHOUT recursively re-evaluating
--   the same policies. Existing policies are untouched, and the
--   execute-grant surface (authenticated only) is preserved.
--   Bodies for the memberships-based helpers are the LATEST repo
--   versions (20260906000002), so no behaviour is reverted.
-- ============================================================

-- ------------------------------------------------------------
-- 1. is_platform_owner() — strict platform-owner check (profiles).
--    This is the function inside the recursion loop.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (select auth.uid())
      AND platform_role = 'platform_owner'
      AND account_status = 'active'
  );
$$;

-- ------------------------------------------------------------
-- 2. is_platform_admin() — alias used across the codebase;
--    delegates to the (fixed) helper above.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_platform_owner();
$$;

-- ------------------------------------------------------------
-- 3. is_ybs_trainer() — internal coach check over the same
--    profiles relation (identical ownership requirement).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_ybs_trainer()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (select auth.uid())
      AND platform_role = 'platform_trainer'
      AND account_status = 'active'
  );
$$;

-- ------------------------------------------------------------
-- 4. is_workspace_owner(ws_id) — owner check via memberships
--    (reached from memberships/workspaces/nutrition policies).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_workspace_owner(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- ------------------------------------------------------------
-- 5. has_workspace_access(ws_id, min_role) — LATEST body from
--    20260906000002 (role-aware + active-workspace gating).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_workspace_access(ws_id UUID, min_role TEXT DEFAULT 'client')
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_memberships wm
    JOIN public.workspaces w ON w.id = wm.workspace_id
    JOIN public.profiles p ON p.id = wm.user_id
    WHERE wm.user_id = (select auth.uid())
      AND wm.workspace_id = ws_id
      AND wm.status = 'active'
      AND w.status = 'active'
      AND (
        wm.workspace_role = 'workspace_owner'
        OR (
          p.active_workspace_id = ws_id
          AND (
            min_role = 'client'
            OR (min_role = 'staff' AND wm.workspace_role IN ('trainer', 'sales'))
            OR (min_role = 'owner' AND wm.workspace_role = 'workspace_owner')
          )
        )
      )
  );
$$;

-- ------------------------------------------------------------
-- 6. is_active_workspace_member(ws_id) — 20260906000002 body.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_active_workspace_member(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_memberships wm
    JOIN public.profiles p ON p.id = wm.user_id
    WHERE wm.workspace_id = ws_id
      AND wm.user_id = (select auth.uid())
      AND wm.status = 'active'
      AND p.active_workspace_id = ws_id
  );
$$;

-- ------------------------------------------------------------
-- 7. is_assigned_ybs_coach(c_id) / is_client_self(c_id) /
--    get_client_workspace_id(c_id) — client-side role helpers.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_assigned_ybs_coach(c_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = c_id
      AND assigned_ybs_coach_id = (select auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.is_client_self(c_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = c_id
      AND user_id = (select auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.get_client_workspace_id(c_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT workspace_id FROM public.clients WHERE id = c_id;
$$;

-- ------------------------------------------------------------
-- 8. THE RECURSION BREAKER: normalise ownership of every role
--    helper to the postgres superuser. SECURITY DEFINER only
--    skips RLS when its owner bypasses RLS (superuser/BYPASSRLS).
--    Applied even when already owned by postgres (no-op) so this
--    migration deterministically heals any non-bypassing owner.
-- ------------------------------------------------------------
ALTER FUNCTION public.is_platform_owner() OWNER TO postgres;
ALTER FUNCTION public.is_platform_admin() OWNER TO postgres;
ALTER FUNCTION public.is_ybs_trainer() OWNER TO postgres;
ALTER FUNCTION public.is_workspace_owner(UUID) OWNER TO postgres;
ALTER FUNCTION public.has_workspace_access(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.is_active_workspace_member(UUID) OWNER TO postgres;
ALTER FUNCTION public.is_assigned_ybs_coach(UUID) OWNER TO postgres;
ALTER FUNCTION public.is_client_self(UUID) OWNER TO postgres;
ALTER FUNCTION public.get_client_workspace_id(UUID) OWNER TO postgres;

-- ------------------------------------------------------------
-- 9. Preserve the existing execute-grant surface
--    (authenticated only — never public).
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.is_platform_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_owner() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_ybs_trainer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ybs_trainer() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_workspace_owner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_workspace_owner(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.has_workspace_access(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_workspace_access(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_active_workspace_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_workspace_member(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_assigned_ybs_coach(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_assigned_ybs_coach(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_client_self(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_client_self(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_client_workspace_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_client_workspace_id(UUID) TO authenticated;
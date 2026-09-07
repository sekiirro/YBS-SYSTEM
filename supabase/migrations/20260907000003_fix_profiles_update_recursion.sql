-- ============================================================
-- Migration 20260907000003: Fix "infinite recursion detected in
-- policy for relation \"profiles\"" (SQLSTATE 42P17)
--
-- ROOT CAUSE (confirmed against live schema):
--   The recursion is NOT caused by public.is_platform_owner().
--   The `profiles_update` policy's WITH CHECK contains two inline
--   SAME-TABLE subqueries against public.profiles:
--
--     WITH CHECK (
--       public.is_platform_owner() OR (
--         id = (select auth.uid())
--         AND platform_role  = (SELECT p.platform_role  FROM public.profiles p WHERE p.id = (select auth.uid()))
--         AND account_status = (SELECT p.account_status FROM public.profiles p WHERE p.id = (select auth.uid()))
--       )
--     )
--
--   A policy row-clause (USING/WITH CHECK) that subselects from the
--   very table it protects re-enters that table's RLS, re-evaluating
--   the policy for the subquery's rows -> infinite recursion (42P17).
--   This fires for EVERY authenticated UPDATE to profiles where the
--   updater is not a platform owner, i.e. exactly the
--   PATCH /rest/v1/profiles (Open Workspace -> set active_workspace_id)
--   call.
--
-- FIX (narrowest secure fix, additive):
--   Move the two self-subqueries out of the WITH CHECK into a single
--   SECURITY DEFINER helper (public.can_self_update_profile) that is
--   OWNED by the superuser, so the required role/status read bypasses
--   RLS instead of re-entering the profiles policy. The profiles_update
--   policy is recreated to call that helper, eliminating the same-table
--   subquery and the recursion.
--
--   Security behavior is fully preserved:
--     * Platform Owner may update their own profile (is_platform_owner()).
--     * Non-owners may update only rows WHERE id = auth.uid().
--     * Non-owners CANNOT escalate platform_role (helper requires the
--       submitted value to equal the row's current value).
--     * Non-owners CANNOT change account_status (same check).
--   No RLS disabled, no USING(true)/WITH CHECK(true), no client bypass.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Narrowly scoped helper: substitutes the two inline
--    same-table subqueries with a single RLS-safe read.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_self_update_profile(
  p_platform_role TEXT,
  p_account_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = (select auth.uid())
      AND platform_role = p_platform_role
      AND account_status = p_account_status
  );
$$;

-- The helper reads public.profiles internally while SECURITY DEFINER;
-- normalize its owner to the superuser so that read actually bypasses
-- RLS (as with the other role-check helpers).
ALTER FUNCTION public.can_self_update_profile(TEXT, TEXT) OWNER TO postgres;

REVOKE EXECUTE
ON FUNCTION public.can_self_update_profile(TEXT, TEXT)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.can_self_update_profile(TEXT, TEXT)
TO authenticated;

-- ------------------------------------------------------------
-- 2. Recreate ONLY the profiles_update policy, replacing the
--    self-subqueries with a call to the helper above.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;

CREATE POLICY "profiles_update"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  public.is_platform_owner()
  OR id = (select auth.uid())
)
WITH CHECK (
  public.is_platform_owner()
  OR (
    id = (select auth.uid())
    AND public.can_self_update_profile(
      platform_role,
      account_status
    )
  )
);
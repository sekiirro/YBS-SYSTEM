-- ============================================================
-- YBS SYSTEM: MEMBER DISPLAY NAMES (FIRST NAME / LAST NAME)
-- ============================================================
-- PURPOSE:
--   Persists First Name and Last Name separately on public.profiles so an
--   invited Trainer/Owner gets a real full name when they complete account
--   setup (instead of their stored email), and lets authorized admins fix
--   legacy email-only members from the Team page. full_name stays the
--   effective display field and is kept in sync with the two parts.
--
--   1. profiles.first_name / profiles.last_name  -> nullable TEXT columns.
--      Legacy rows keep whatever full_name they had (often the email);
--      nothing is forced into the new columns at migration time.
--
--   2. update_member_display_name(p_user_id, p_first_name, p_last_name)
--      -> SECURITY DEFINER RPC, the ONLY path to change another member's
--      name. The client-side profiles_update RLS policy is locked to
--      self-update + platform owner, so a workspace owner could never edit
--      their members without this helper.
--
--   AUTHORIZATION (mirrors existing team-management mutations — never
--   broadens them):
--      * Platform Owners may edit any member.
--      * Workspace Owners may edit staff members (workspace_owner /
--        trainer / sales, active) of workspaces they own.
--      * Trainers / Sales / Clients / Managers are NOT allowed.
--
--   PRESERVED: auth id, email, platform_role, account_status, memberships,
--   permissions, workspaces, password, client identity. Email is never used
--   as identity authority; it cannot be changed through this RPC.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT;

-- ============================================================
-- can_edit_member_name(p_user_id) — authorization helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_edit_member_name(p_user_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_owner()
    OR EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.user_id = p_user_id
        AND wm.status = 'active'
        AND wm.workspace_role IN ('workspace_owner', 'trainer', 'sales')
        AND public.is_workspace_owner(wm.workspace_id)
    );
$$;

-- ============================================================
-- update_member_display_name(p_user_id, p_first_name, p_last_name)
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_member_display_name(
  p_user_id UUID,
  p_first_name TEXT,
  p_last_name TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first TEXT := btrim(p_first_name);
  v_last  TEXT := btrim(p_last_name);
  v_full  TEXT;
  v_email TEXT;
  v_role  TEXT;
  v_actor_id UUID;
  v_actor_name TEXT;
BEGIN
  v_actor_id := auth.uid();
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;

  -- Names are required real names; whitespace-only input is rejected.
  IF v_first = '' THEN
    RAISE EXCEPTION 'Please enter your first name.';
  END IF;
  IF v_last = '' THEN
    RAISE EXCEPTION 'Please enter your last name.';
  END IF;
  IF char_length(v_first) > 80 OR char_length(v_last) > 80 THEN
    RAISE EXCEPTION 'Name is too long.';
  END IF;

  SELECT email, platform_role INTO v_email, v_role
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'member_not_found');
  END IF;

  IF NOT public.can_edit_member_name(p_user_id) THEN
    RAISE EXCEPTION 'You are not allowed to edit this member.';
  END IF;

  v_full := v_first || ' ' || v_last;

  UPDATE public.profiles
  SET first_name = v_first,
      last_name  = v_last,
      full_name  = v_full,
      updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, workspace_id, metadata)
  VALUES (
    v_actor_id,
    COALESCE(v_actor_name, 'System'),
    CASE WHEN public.is_platform_owner() THEN 'platform_owner' ELSE 'workspace_owner' END,
    'member_name_updated',
    'profile',
    p_user_id::text,
    v_full,
    NULL,
    jsonb_build_object('role', v_role)
  );

  RETURN jsonb_build_object('success', true, 'full_name', v_full, 'email', v_email);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_member_display_name(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_member_display_name(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
-- ============================================================
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name = 'profiles'
  AND  column_name IN ('first_name', 'last_name')
ORDER  BY column_name;

SELECT pg_get_functiondef('public.update_member_display_name(uuid, text, text)'::regprocedure);
-- ============================================================
-- YBS SYSTEM: MIGRATION 11 — CLIENT APPLICATIONS RESTRICTED
-- TO GENUINE TRAINEE SELF-REGISTRATION ONLY
-- ============================================================
--
-- BUSINESS RULE:
--   Pending Client Approvals is a queue for TRAINEES who want to
--   join a workspace as clients. Admin-provisioned accounts (Brand
--   Owners, Platform Trainers, Platform Owner) must NEVER generate a
--   client_application row.
--
-- ROOT CAUSE FIXED:
--   handle_new_user() (migrations 09/10) auto-created a client
--   application for every new auth user defaulting to
--   platform_role='none' + account_status='pending_approval'. The
--   Brand Owner invite (Workspaces.jsx, signInWithOtp) and the team
--   invites (Team.jsx, signInWithOtp) write roles into
--   raw_user_meta_data ONLY. handle_new_user reads only the trusted
--   raw_app_meta_data channel, so provisioned accounts were
--   indistinguishable from trainees and got bogus application rows.
--
-- FIX (three trusted, server-side signals — never client metadata):
--   1. BRAND OWNER: the sync_brand_owner_to_workspaces trigger
--      (migration 07) already creates an ACTIVE 'workspace_owner'
--      workspace_memberships row during the profile upsert INSIDE
--      handle_new_user, and workspaces.owner_email records the same
--      relationship. Presence of either proves the account was
--      provisioned by the platform, not self-registered.
--   2. PLATFORM TRAINER / OWNER INVITES: a guarded SECURITY DEFINER
--      RPC (invite_team_member) writes a trusted platform_invites
--      row server-side BEFORE the magic-link OTP is sent. handle_
--      new_user derives the platform role from that trusted DB row
--      (overriding the public raw_user_meta_data channel), never
--      from client-submitted metadata.
--   3. GENUINE TRAINEES: unchanged — signUp carry join_token in
--      raw_user_meta_data; the same server-side trigger creates their
--      pending application (email-confirmation flow preserved) and
--      assigns the workspace from the join token exactly as in
--      migration 10.
--
--   A controlled backfill removes only OPEN applications belonging to
--   users who hold an active 'workspace_owner' membership (the
--   admin-provisioning signature). Trainee applications and all
--   approved/rejected history are preserved.
--
-- SECURITY PROPERTIES (unchanged by this migration):
--   SECURITY DEFINER + SET search_path = public preserved on every
--   function; no anon INSERT capability added; RLS untouched; roles
--   are ALWAYS derived from trusted server-side state, so a trainee
--   cannot self-promote or dodge the approval queue via crafted
--   metadata.
-- ============================================================

-- ============================================================
-- 1. TRUSTED PLATFORM INVITE LEDGER (server-side only writes)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.platform_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('platform_trainer', 'platform_owner')),
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'accepted', 'revoked')),
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_invites ENABLE ROW LEVEL SECURITY;

-- One ACTIVE (non-revoked) invite per email; 'accepted'/'revoked'
-- rows coexist for audit so history is preserved.
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_invites_active_email
  ON public.platform_invites (lower(email))
  WHERE status <> 'revoked';

-- No INSERT/UPDATE/DELETE policies: writes happen ONLY through the
-- SECURITY DEFINER RPC below. Reads happen only server-side (trigger).
-- This deliberately keeps the ledger locked to direct client access.

-- ============================================================
-- 2. GUARDED SECURITY DEFINER RPC: invite_team_member
--    Writes the trusted invite row; role is NOT derived from any
--    client-supplied metadata.
-- ============================================================
CREATE OR REPLACE FUNCTION public.invite_team_member(
    p_email TEXT,
    p_role TEXT,
    p_workspace_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email TEXT := lower(btrim(p_email));
    v_role TEXT := lower(btrim(p_role));
    v_invite public.platform_invites%ROWTYPE;
BEGIN
    IF v_email IS NULL OR v_email = '' THEN
        RAISE EXCEPTION 'email_required';
    END IF;

    IF v_role NOT IN ('platform_trainer', 'platform_owner') THEN
        RAISE EXCEPTION 'invalid_role';
    END IF;

    -- Authorization: only Platform Owner may create Platform Owner
    -- invites; Workspace Owners may invite trainers only for their
    -- own active workspace. (Previously any canManageTeam UI user
    -- could emit an "owner" magic link with spoofable metadata.)
    IF v_role = 'platform_owner' THEN
        IF NOT public.is_platform_owner() THEN
            RAISE EXCEPTION 'permission_denied';
        END IF;
    ELSIF NOT (public.is_platform_owner() OR public.is_workspace_owner(p_workspace_id)) THEN
        RAISE EXCEPTION 'permission_denied';
    END IF;

    INSERT INTO public.platform_invites (email, workspace_id, role)
    VALUES (v_email, p_workspace_id, v_role)
    ON CONFLICT (lower(email)) WHERE status <> 'revoked'
    DO UPDATE SET
        role = EXCLUDED.role,
        workspace_id = EXCLUDED.workspace_id,
        updated_at = now()
    RETURNING * INTO v_invite;

    RETURN jsonb_build_object(
        'id', v_invite.id,
        'email', v_invite.email,
        'role', v_invite.role,
        'status', v_invite.status
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invite_team_member FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_team_member TO authenticated;

-- ============================================================
-- 3. handle_new_user(): role derived from TRUSTED state only,
--    applications created for GENUINE TRAINEES only
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT;
  v_full_name TEXT;
  v_platform_role TEXT;
  v_account_status TEXT;
  v_join_token TEXT;
  v_workspace_id UUID;
  v_is_provisioned BOOLEAN;
  v_invite RECORD;
BEGIN
  v_phone := NEW.raw_user_meta_data->>'phone';

  v_full_name :=
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.email
    );

  v_platform_role :=
    COALESCE(
      NEW.raw_app_meta_data->>'platform_role',
      'none'
    );

  v_account_status :=
    COALESCE(
      NEW.raw_app_meta_data->>'account_status',
      'pending_approval'
    );

  IF v_platform_role NOT IN (
    'platform_owner',
    'platform_trainer',
    'none'
  ) THEN
    v_platform_role := 'none';
  END IF;

  -- Trusted server-side invite lookup (written by invite_team_member,
  -- never by client code). If an ACTIVE invite exists for this email,
  -- the platform role comes from the DB ledger — NOT from metadata the
  -- user can control. This is what excludes Platform Trainer / Platform
  -- Owner invites from the approval queue.
  SELECT ir.id, ir.role INTO v_invite
  FROM public.platform_invites ir
  WHERE lower(btrim(ir.email)) = lower(btrim(NEW.email))
    AND ir.status <> 'revoked'
  ORDER BY ir.created_at DESC
  LIMIT 1;

  IF v_invite.id IS NOT NULL THEN
    v_platform_role := v_invite.role;
    v_account_status := 'active';

    UPDATE public.platform_invites
    SET status = 'accepted', updated_at = now()
    WHERE id = v_invite.id;
  END IF;

  -- 1. Upsert the linked profile (unchanged from migration 06)
  INSERT INTO public.profiles (
    id,
    email,
    phone,
    full_name,
    platform_role,
    account_status
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_phone,
    v_full_name,
    v_platform_role,
    v_account_status
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    updated_at = now();

  -- Resolve the registration token to a workspace EXCLUSIVELY
  -- server-side (unchanged from migration 10).
  v_join_token := NULLIF(btrim(NEW.raw_user_meta_data->>'join_token'), '');
  IF v_join_token IS NOT NULL THEN
    SELECT id INTO v_workspace_id
    FROM public.workspaces
    WHERE public_join_token = v_join_token
      AND status = 'active';
  END IF;

  -- ================================================================
  -- ADMIN-PROVISIONED ACCOUNT DETECTION (trusted, server-side only):
  --   * workspace_memberships covers Brand Owner provisioning
  --     (sync_brand_owner_to_workspaces fired on the profile upsert
  --     above, BEFORE this statement runs) — all statements inside
  --     this function execute top-down, so the membership already
  --     exists before this guard executes.
  --   * profiles.platform_role covers platform owner / trainer
  --     (now sourced from the trusted platform_invites ledger, or
  --     from server-set raw_app_meta_data).
  --   * workspaces.owner_email mirrors the same email relationship
  --     the owner sync trigger itself uses.
  --   * platform_invites covers an invite whose profile upsert/trigger
  --     ordering could not have materialized a membership yet.
  -- None of this is derived from client-submitted metadata.
  -- ================================================================
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_memberships wm
    WHERE wm.user_id = NEW.id
      AND wm.status = 'active'
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = NEW.id
      AND p.platform_role IN ('platform_owner', 'platform_trainer')
  ) OR EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE lower(btrim(w.owner_email)) = lower(btrim(NEW.email))
  ) OR (v_invite.id IS NOT NULL)
  INTO v_is_provisioned;

  -- 2. Auto-create a pending client application for genuine
  --    self-registered trainees (migration 09 behavior, unchanged):
  --    platform_role 'none' + pending_approval + not provisioned.
  --    COALESCE(v_phone, '') guards the applicant_phone NOT NULL
  --    constraint.
  IF
    v_platform_role = 'none'
    AND v_account_status = 'pending_approval'
    AND NOT v_is_provisioned
    AND NOT EXISTS (
      SELECT 1
      FROM public.client_applications ca
      WHERE ca.user_id = NEW.id
        AND ca.status IN (
          'pending',
          'under_review',
          'more_info_required'
        )
    )
  THEN
    INSERT INTO public.client_applications (
      user_id,
      applicant_name,
      applicant_phone,
      applicant_email,
      status,
      assigned_workspace_id
    )
    VALUES (
      NEW.id,
      v_full_name,
      COALESCE(v_phone, ''),
      NEW.email,
      'pending',
      v_workspace_id
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Reinstall trigger (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 4. SAFE BACKFILL: REMOVE ERRONEOUS OPEN APPLICATIONS FOR
--    PROVISIONED BRAND OWNERS ONLY
--    (trainee applications + approved/rejected history preserved)
-- ============================================================
DELETE FROM public.client_applications ca
USING public.workspace_memberships wm
WHERE ca.user_id = wm.user_id
  AND wm.workspace_role = 'workspace_owner'
  AND wm.status = 'active'
  AND ca.status IN ('pending', 'under_review', 'more_info_required');

-- ============================================================
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
-- ============================================================
SELECT tgname, tgenabled, tgrelid::regclass AS table_name
FROM   pg_trigger
WHERE  tgname = 'on_auth_user_created';

SELECT proname, prosecdef AS definitive
FROM   pg_proc
WHERE  proname IN ('handle_new_user', 'invite_team_member');

SELECT relname
FROM   pg_class
WHERE  relname = 'platform_invites';

-- No remaining OPEN application should reference an active
-- workspace owner membership (should return 0 rows):
SELECT ca.id, ca.user_id, ca.applicant_email, ca.status
FROM   public.client_applications ca
JOIN   public.workspace_memberships wm
  ON   wm.user_id = ca.user_id
WHERE  wm.workspace_role = 'workspace_owner'
  AND  wm.status = 'active'
  AND  ca.status IN ('pending', 'under_review', 'more_info_required');
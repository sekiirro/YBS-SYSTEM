-- ============================================================
-- YBS SYSTEM: EXTERNAL TEAM INVITATION TOKENS
-- ============================================================
-- PURPOSE:
--   An invited Trainer / Owner is EXTERNAL to the platform: they have no
--   Auth account yet. The invitation itself must therefore be a
--   self-contained secure credential (token) stored on the trusted
--   platform_invites ledger, NOT a GoTrue invite/recovery admin link
--   (which creates or requires an Auth user at generation time).
--
--   This migration makes the ledger token-capable and adds two narrow,
--   server-side helpers:
--
--   1. platform_invites.token          -> crypto-random, unique, secret.
--      Minted by invite_team_member():  the invite row stays status='sent'
--      until the invitee actually creates their Auth account (the
--      handle_new_user() trigger flips it to 'accepted').
--
--   2. get_team_invite(p_token)        -> STABLE SECURITY DEFINER RPC
--      returning ONLY {valid, email, role, workspace_id, workspace_name,
--      status} for a 'sent' token. Granted to anon+authenticated on the
--      same narrow-token basis as resolve_workspace_join(). The
--      platform_invites TABLE itself remains RLS-locked (no policies).
--
--   3. provision_invited_trainer_membership()
--                                      -> AFTER INSERT trigger on
--      auth.users: when an invited Trainer's account is actually created,
--      exactly one ACTIVE (workspace_role='trainer') membership is written
--      for the invited workspace. Idempotent via ON CONFLICT
--      (workspace_id, user_id) so refresh/retry cannot duplicate it.
--      Nothing is written at invitation-GENERATION time.
--
-- SECURITY PROPERTIES (preserved):
--   * platform_invites stays RLS-enabled with zero client policies.
--   * Token is never exposed through a table query — only via the
--     SECURITY DEFINER RPC (server-side) and the edge-function client
--     that minted it.
--   * No auth.users writes, no listUsers scan, no RLS changes.
--   * Owner authorization for invites is extended to match the EXISTING
--     generate-owner-invite rule: a workspace owner may mint an OWNER
--     invite only for their own workspace's owner_email (server-checked);
--     arbitrary platform-owner invites remain platform-owner only.
-- ============================================================

-- ============================================================
-- 1. TOKEN COLUMN (crypto-random, unique, secret)
-- ============================================================
ALTER TABLE public.platform_invites
  ADD COLUMN IF NOT EXISTS token TEXT;

-- Backfill existing rows so the column can be NOT NULL (matching the
-- 32-byte / 64-hex secret produced by invite_team_member below).
UPDATE public.platform_invites
SET token = encode(gen_random_bytes(32), 'hex')
WHERE token IS NULL OR btrim(token) = '';

ALTER TABLE public.platform_invites
  ALTER COLUMN token SET NOT NULL;

-- One unique secret per invitation (revoked rows keep their token for
-- audit; the credential is simply no longer resolvable as 'sent').
DROP INDEX IF EXISTS idx_platform_invites_token;
CREATE UNIQUE INDEX idx_platform_invites_token
  ON public.platform_invites (token);

-- ============================================================
-- 2. invite_team_member() — MINT + RETURN the token
--    (only the trusted edge function may call this on behalf of an
--    authorized inviter; the token leaves the DB only through this RPC)
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
    v_token TEXT := encode(gen_random_bytes(32), 'hex');
    v_invite public.platform_invites%ROWTYPE;
BEGIN
    IF v_email IS NULL OR v_email = '' THEN
        RAISE EXCEPTION 'email_required';
    END IF;

    IF v_role NOT IN ('platform_trainer', 'platform_owner') THEN
        RAISE EXCEPTION 'invalid_role';
    END IF;

    -- Authorization: only Platform Owner may create Platform Owner
    -- invites; a Workspace Owner may create an OWNER invite ONLY for
    -- their own workspace's owner_email (mirrors the existing
    -- generate-owner-invite rule); Workspace Owners may invite trainers
    -- only for their own active workspace.
    IF v_role = 'platform_owner' THEN
        IF NOT (
            public.is_platform_owner()
            OR (
                public.is_workspace_owner(p_workspace_id)
                AND EXISTS (
                    SELECT 1 FROM public.workspaces w
                    WHERE w.id = p_workspace_id
                      AND lower(btrim(w.owner_email)) = v_email
                )
            )
        ) THEN
            RAISE EXCEPTION 'permission_denied';
        END IF;
    ELSIF NOT (public.is_platform_owner() OR public.is_workspace_owner(p_workspace_id)) THEN
        RAISE EXCEPTION 'permission_denied';
    END IF;

    INSERT INTO public.platform_invites (email, workspace_id, role, token)
    VALUES (v_email, p_workspace_id, v_role, v_token)
    ON CONFLICT (lower(email)) WHERE status <> 'revoked'
    DO UPDATE SET
        role = EXCLUDED.role,
        workspace_id = EXCLUDED.workspace_id,
        token = EXCLUDED.token,
        status = 'sent',
        updated_at = now()
    RETURNING * INTO v_invite;

    RETURN jsonb_build_object(
        'id', v_invite.id,
        'email', v_invite.email,
        'role', v_invite.role,
        'status', v_invite.status,
        'token', v_invite.token
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invite_team_member(TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_team_member(TEXT, TEXT, UUID) TO authenticated;

-- ============================================================
-- 3. get_team_invite(p_token) — NARROW TOKEN RESOLUTION
--    Mirrors the resolve_workspace_join() anon-read pattern:
--    token-scoped, reveals ONLY onboarding identity for a 'sent' invite.
--    The platform_invites table itself is never made publicly readable.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_team_invite(p_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite RECORD;
BEGIN
    IF p_token IS NULL OR btrim(p_token) = '' THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'missing_token');
    END IF;

    SELECT
        ir.id,
        ir.email,
        ir.role,
        ir.workspace_id,
        ir.status,
        w.name AS workspace_name
    INTO v_invite
    FROM public.platform_invites ir
    LEFT JOIN public.workspaces w ON w.id = ir.workspace_id
    WHERE ir.token = btrim(p_token)
    LIMIT 1;

    IF v_invite.id IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'invalid_token');
    END IF;

    -- Only a 'sent' invitation is actionable; a used/revoked token must
    -- never keep yielding its details.
    IF v_invite.status <> 'sent' THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'already_used');
    END IF;

    RETURN jsonb_build_object(
        'valid', true,
        'email', v_invite.email,
        'role', v_invite.role,
        'workspace_id', v_invite.workspace_id,
        'workspace_name', COALESCE(v_invite.workspace_name, ''),
        'status', v_invite.status
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_team_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_team_invite(TEXT) TO anon, authenticated;

-- ============================================================
-- 4. TRAINER MEMBERSHIP AT ACCEPTANCE TIME
--    AFTER INSERT trigger on auth.users (house pattern, same as
--    handle_new_user). Fires only when the invitee's Auth account is
--    actually created; writes exactly one ACTIVE 'trainer' membership
--    for the invited workspace. Idempotent: ON CONFLICT reactivates
--    rather than duplicating. Never runs at invitation-generation time.
--    (Owner memberships are not created here: the existing
--    sync_brand_owner_to_workspaces() trigger provisions those.)
-- ============================================================
CREATE OR REPLACE FUNCTION public.provision_invited_trainer_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite RECORD;
BEGIN
    -- Same trusted email-ledger lookup as handle_new_user(); status-aware
    -- ('sent' or 'accepted') so ordering vs. handle_new_user is irrelevant.
    SELECT ir.id, ir.role, ir.workspace_id INTO v_invite
    FROM public.platform_invites ir
    WHERE lower(btrim(ir.email)) = lower(btrim(NEW.email))
      AND ir.status <> 'revoked'
    ORDER BY ir.created_at DESC
    LIMIT 1;

    IF v_invite.id IS NULL
       OR v_invite.role <> 'platform_trainer'
       OR v_invite.workspace_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Exactly one active membership for the invited workspace. The
    -- browser can never choose the workspace or the role (both come
    -- from the server-side ledger).
    INSERT INTO public.workspace_memberships (
        workspace_id,
        user_id,
        workspace_role,
        status
    )
    VALUES (
        v_invite.workspace_id,
        NEW.id,
        'trainer',
        'active'
    )
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET status = 'active';

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_provision_membership ON auth.users;
CREATE TRIGGER on_auth_user_created_provision_membership
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.provision_invited_trainer_membership();

-- ============================================================
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
-- ============================================================
SELECT column_name, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name = 'platform_invites'
  AND  column_name = 'token';

SELECT pg_get_functiondef('public.get_team_invite(text)'::regprocedure)
WHERE  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_team_invite');

SELECT tgname, tgenabled, tgrelid::regclass AS table_name
FROM   pg_trigger
WHERE  tgname IN ('on_auth_user_created', 'on_auth_user_created_provision_membership');
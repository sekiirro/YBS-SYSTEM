-- ============================================================
-- YBS SYSTEM: WORKSPACE OWNER INVITATION ACTIVATION FIX
-- ============================================================
-- DIAGNOSIS (confirmed, not re-audited here):
--   The /activate page previously called client-side supabase.auth.signUp()
--   whenever no browser session existed. That works for a brand-new email
--   but fails with `User already registered` when the invited email already
--   exists in auth.users (partial activation, legacy signup, or an existing
--   client account). The invitation token was only validated via
--   get_team_invite(), never used as the authorization credential to set the
--   existing account's password.
--
-- FIX (this migration — database side only):
--   All password work stays in GoTrue's Auth Admin API inside a new,
--   server-side `activate-invite` edge function (service-role key, never
--   exposed to the browser). The database changes are two narrow, focused
--   pieces:
--
--   1. resolve_auth_user_for_invite(p_email)
--      STABLE SECURITY DEFINER lookup of an existing auth.users row by
--      email. Granted to service_role ONLY, so the browser can never use it
--      to probe auth.users or substitute another email. Returns identity
--      fields only — never passwords. This is the trusted email -> id map
--      the edge function uses to target the password rotation.
--
--   2. Hardened invite_team_member()
--      The existing ON CONFLICT upsert could resurrect an
--      already-provisioned invitation: re-inviting an email whose invite was
--      already 'accepted' flipped the row back to status='sent' and minted a
--      brand-new usable credential for an already-provisioned account. A
--      conflict against an 'accepted' invite is now a no-op (row untouched,
--      no new token minted) and the RPC raises 'invite_already_accepted'.
--
-- SECURITY PROPERTIES (preserved):
--   * No password hashing in SQL. No manual auth.users password writes.
--   * The browser never receives the service-role key.
--   * The invitation token stays crypto-random, unique and server-validated.
--   * platform_invites remains RLS-locked to direct client access.
--   * No RLS policy changes anywhere.
-- ============================================================

-- ============================================================
-- 1. SERVER-ONLY auth.users RESOLUTION (service_role only)
--    The edge function calls this with the email read from the invitation
--    ledger row resolved by the token. Anonymous/authenticated clients get
--    no EXECUTE, so the roster of auth.users stays private.
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_auth_user_for_invite(p_email TEXT)
RETURNS TABLE (
    id uuid,
    email text,
    email_confirmed_at timestamptz,
    raw_app_meta_data jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.email, u.email_confirmed_at, u.raw_app_meta_data
    FROM auth.users u
    WHERE lower(btrim(u.email)) = lower(btrim(p_email))
    LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_auth_user_for_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_auth_user_for_invite(TEXT) TO service_role;

-- ============================================================
-- 2. HARDENED invite_team_member
--    Only change vs. the last applied version (20260907000005):
--    * DO UPDATE now carries `WHERE status <> 'accepted'`, so a conflict
--      on an already-provisioned invite is a skip (no resurrect, no new
--      token, return no row).
--    * An explicit `invite_already_accepted` guard for that skip.
--    Everything else (authorization, token minting, grants) unchanged.
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
    v_token TEXT := encode(extensions.gen_random_bytes(32), 'hex');
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
    -- their own workspace's owner_email; Workspace Owners may invite
    -- trainers only for their own active workspace.
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

    -- An already-ACCEPTED invite is the audit record of a provisioned
    -- account. Re-inviting that email must NOT resurrect it to 'sent':
    -- PostgreSQL skips the update when the DO UPDATE WHERE guard is false
    -- (RETURNING yields no row), so no new token is minted and the old
    -- audit row stays untouched.
    INSERT INTO public.platform_invites (email, workspace_id, role, token)
    VALUES (v_email, p_workspace_id, v_role, v_token)
    ON CONFLICT (lower(email)) WHERE status <> 'revoked'
    DO UPDATE SET
        role = EXCLUDED.role,
        workspace_id = EXCLUDED.workspace_id,
        token = EXCLUDED.token,
        status = 'sent',
        updated_at = now()
    WHERE public.platform_invites.status <> 'accepted'
    RETURNING * INTO v_invite;

    IF v_invite.id IS NULL THEN
        RAISE EXCEPTION 'invite_already_accepted';
    END IF;

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
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
-- ============================================================
SELECT pg_get_functiondef('public.resolve_auth_user_for_invite(text)'::regprocedure)
WHERE  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'resolve_auth_user_for_invite');

SELECT has_function_privilege('service_role', 'public.resolve_auth_user_for_invite(text)', 'EXECUTE') AS service_role_can_resolve,
       has_function_privilege('anon',             'public.resolve_auth_user_for_invite(text)', 'EXECUTE') AS anon_blocked,
       has_function_privilege('authenticated',    'public.resolve_auth_user_for_invite(text)', 'EXECUTE') AS authenticated_blocked;

SELECT pg_get_functiondef('public.invite_team_member(text,text,uuid)'::regprocedure);
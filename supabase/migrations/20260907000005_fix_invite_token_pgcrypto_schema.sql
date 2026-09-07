-- ============================================================
-- YBS SYSTEM: FIX pgcrypto SCHEMA QUALIFICATION IN invite_team_member
-- ============================================================
-- DIAGNOSIS:
--   Live error: "function gen_random_bytes(integer) does not exist"
--   raised by the new invitation flow's call to invite_team_member().
--
--   Root cause: pgcrypto IS installed (migration 20260903000001 creates
--   it), but on the managed project its objects live in the `extensions`
--   schema, NOT `public`. Top-level migration statements run with the
--   default search_path and resolve gen_random_bytes fine (that is why
--   07000004's backfill applied). But invite_team_member() is
--   SECURITY DEFINER with `SET search_path = public`, so the UNQUALIFIED
--   `gen_random_bytes(32)` from 07000004 cannot be resolved at runtime.
--
--   Fix: schema-qualify the call as `extensions.gen_random_bytes(32)`
--   inside a recreated invite_team_member(). Qualified references do not
--   depend on search_path, so the function works under the restricted
--   `SET search_path = public` configuration.
--
--   Token contract is UNCHANGED: 32 crypto-random bytes -> 64-char hex,
--   stored server-side, unique, returned only through the trusted RPC.
--   Invitation architecture, RLS, authorization rules: unchanged.
--
--   Verify live (run in SQL editor):
--     SELECT extname, extnamespace::regnamespace FROM pg_extension WHERE extname = 'pgcrypto';
--       -> expected: pgcrypto | extensions
--     SELECT n.nspname AS schema_name, p.proname,
--            pg_get_function_identity_arguments(p.oid) AS args
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE p.proname = 'gen_random_bytes';
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
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
-- ============================================================
SELECT pg_get_functiondef('public.invite_team_member(text,text,uuid)'::regprocedure);
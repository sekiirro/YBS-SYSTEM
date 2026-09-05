-- ============================================================
-- YBS SYSTEM: SUPABASE DATABASE ARCHITECTURE (MIGRATION 23)
-- ACTIVATION-COMPLETION MARKER (TRUSTED SERVER-SIDE)
-- ============================================================
-- PURPOSE:
--   Supabase's Admin API does NOT expose whether an auth user has a
--   password (GoTrue serializes encrypted_password as json:"-"; the
--   has-password state is a Go method only). An email-CONFIRMED user may
--   therefore still be unable to sign in because they never completed
--   activation (set a password). This migration adds the single trusted
--   signal used to distinguish:
--     A) fully activated account (confirmed + marker set)
--     B) confirmed but NOT activated (confirmed, marker missing)
--   The marker is written ONLY by this SECURITY DEFINER RPC at the moment
--   activation completes (Activate page, immediately after updateUser
--   sets the password). It lives in auth.users.raw_app_meta_data so it is
--   server-controlled (client code cannot spoof it) and readable by the
--   generate-trainer-invite Edge Function via the Admin API.
--   It is a BOOLEAN jsonb value; classification reads it as `true`.
-- SECURITY:
--   SECURITY DEFINER + SET search_path = public (house pattern, same as
--   invite_team_member). Restricted to the caller's OWN auth.uid().
--   EXECUTE revoked from PUBLIC, granted to authenticated only.
--   The function body never reads client-supplied metadata.
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_activation_complete()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    UPDATE auth.users
    SET raw_app_meta_data = jsonb_set(
            COALESCE(raw_app_meta_data, '{}'::jsonb),
            '{activated}',
            'true'::jsonb
        ),
        updated_at = now()
    WHERE id = (SELECT auth.uid());

    IF NOT FOUND THEN
        RAISE EXCEPTION 'user_not_found';
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_activation_complete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_activation_complete() TO authenticated;
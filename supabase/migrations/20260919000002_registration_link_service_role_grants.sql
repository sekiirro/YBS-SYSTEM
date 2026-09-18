-- ============================================================
-- YBS SYSTEM: FIX — registration-link RPCs must be callable by
-- the client-registration Edge Function (service_role)
--
-- Root cause: every RPC the client-registration Edge Function
-- invokes (resolve_registration_link, resolve_phone_identifier,
-- reserve_registration_link_ip, finalize_registration_reservation,
-- release_registration_link_ip) was created with
--   REVOKE EXECUTE ... FROM PUBLIC;
--   GRANT EXECUTE ... TO anon, authenticated;
-- and therefore service_role — the PostgreSQL role the Edge
-- Function authenticates as via SUPABASE_SERVICE_ROLE_KEY — has
-- NO EXECUTE privilege. The first server-side call
-- (resolve_registration_link) fails with "permission denied for
-- function", so every scoped registration returns:
--   500 {"error":{"code":"link_unavailable","message":"Unable to verify the registration link."}}
--
-- These are SECURITY DEFINER functions whose bodies implement
-- their own checks; granting service_role EXECUTE does NOT widen
-- browser access (anon/authenticated grants are unchanged) and
-- adds no new capability to service_role, which already holds the
-- service key and can bypass RLS everywhere.
--
-- Apply ONLY this file:
--   supabase db query --linked -f supabase/migrations/20260919000002_registration_link_service_role_grants.sql
-- ============================================================

GRANT EXECUTE ON FUNCTION public.resolve_registration_link(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_phone_identifier(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_registration_link_ip(uuid, inet) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_registration_reservation(uuid, inet, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_registration_link_ip(uuid, inet) TO service_role;
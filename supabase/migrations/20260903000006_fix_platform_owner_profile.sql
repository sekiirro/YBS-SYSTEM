-- ============================================================
-- YBS SYSTEM: MIGRATION 06 — FIX PLATFORM OWNER PROFILE & TABLE GRANTS
-- ============================================================

-- 1. Table Grants for PostgREST Roles (anon, authenticated, service_role)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.client_applications TO anon;
GRANT INSERT ON public.client_applications TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO authenticated;

-- 2. Ensure handle_new_user function and trigger exist for FUTURE auth users
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
BEGIN
  v_phone := NEW.raw_user_meta_data->>'phone';
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);
  v_platform_role := COALESCE(NEW.raw_app_meta_data->>'platform_role', 'none');
  v_account_status := COALESCE(NEW.raw_app_meta_data->>'account_status', 'pending_approval');

  IF v_platform_role NOT IN ('platform_owner', 'platform_trainer', 'none') THEN
    v_platform_role := 'none';
  END IF;

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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Safely create or update the profile for the exact Platform Owner ID
INSERT INTO public.profiles (
  id,
  email,
  phone,
  full_name,
  platform_role,
  account_status
)
VALUES (
  '6e3ce024-35ba-4cb6-a7fd-7aea8878011f',
  'sekiirro@gmail.com',
  NULL,
  'YBS Platform Owner',
  'platform_owner',
  'active'
)
ON CONFLICT (id) DO UPDATE SET
  platform_role = 'platform_owner',
  account_status = 'active',
  full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
  updated_at = now();

-- 4. Ensure is_platform_owner and resolve_phone_identifier are executable
GRANT EXECUTE ON FUNCTION public.is_platform_owner TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_phone_identifier TO anon, authenticated;

-- 5. Verification queries
SELECT id, email, full_name, platform_role, account_status, created_at
FROM public.profiles
WHERE id = '6e3ce024-35ba-4cb6-a7fd-7aea8878011f';

SELECT tgname, tgenabled, tgrelid::regclass AS table_name
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';

-- Carry a trainee's date of birth through the existing application approval
-- workflow. The canonical athlete value remains clients.date_of_birth.

ALTER TABLE public.client_applications
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

CREATE OR REPLACE FUNCTION public.capture_client_application_date_of_birth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_raw_dob TEXT;
  v_dob DATE;
BEGIN
  IF NEW.date_of_birth IS NOT NULL THEN
    v_dob := NEW.date_of_birth;
  ELSE
    SELECT NULLIF(btrim(u.raw_user_meta_data->>'date_of_birth'), '')
      INTO v_raw_dob
    FROM auth.users u
    WHERE u.id = NEW.user_id;

    -- Preserve non-public provisioning paths that predate the registration
    -- form requirement. The public form and Edge Function require the value.
    IF v_raw_dob IS NULL THEN
      RETURN NEW;
    END IF;

    BEGIN
      v_dob := v_raw_dob::DATE;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION USING
        ERRCODE = '22007',
        MESSAGE = 'Date of birth must be a valid ISO date';
    END;
  END IF;

  IF v_dob < DATE '1900-01-01' OR v_dob > CURRENT_DATE THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Date of birth must be between 1900-01-01 and today';
  END IF;

  NEW.date_of_birth := v_dob;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_client_application_date_of_birth
  ON public.client_applications;
CREATE TRIGGER trg_capture_client_application_date_of_birth
  BEFORE INSERT OR UPDATE OF date_of_birth ON public.client_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_client_application_date_of_birth();

CREATE OR REPLACE FUNCTION public.copy_application_date_of_birth_to_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.date_of_birth IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT ca.date_of_birth
      INTO NEW.date_of_birth
    FROM public.client_applications ca
    WHERE ca.user_id = NEW.user_id
      AND ca.date_of_birth IS NOT NULL
    ORDER BY ca.created_at DESC
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_copy_application_date_of_birth_to_client
  ON public.clients;
CREATE TRIGGER trg_copy_application_date_of_birth_to_client
  BEFORE INSERT ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.copy_application_date_of_birth_to_client();

COMMENT ON COLUMN public.client_applications.date_of_birth IS
  'Date of birth supplied during registration and copied to clients on approval.';

-- ============================================================
-- YBS SYSTEM: BODY PROGRESS TRACKING (MIGRATION 20260913000004)
--
-- Upgrades the Metrics domain into a structured Body Progress
-- tracking flow for the client portal:
--
--   * metrics.is_baseline:      flags the single "starting point"
--     row created by the portal Baseline wizard (server-enforced
--     write path via save_metrics_baseline).
--   * metrics.body_fat_method:  how body fat was obtained
--     (visual_estimate / manual_entry / navy_estimate / bia /
--     skinfold / dexa / other) so visual slider estimates are
--     never presented as measured values.
--   * Composite timeline index for fast per-client reads.
--   * RLS: metrics_select gains OR is_assigned_ybs_coach(client_id)
--     so a currently-assigned coach always sees the full history
--     of their clients (reassignment-proof; row-level
--     assigned_ybs_coach_id snapshots go stale on reassignment).
--   * get_client_metrics_state: single SECURITY DEFINER source of
--     truth for the baseline gate / prefill, access-checked
--     server-side (platform owner, workspace owner, assigned
--     coach, or the client themself).
--   * save_metrics_baseline:    SECURITY DEFINER upsert that
--     persists the baseline metric row AND mirrors family/profile
--     fields onto public.clients (gender / date_of_birth /
--     height / current_weight). Explicit bounded fields only,
--     realistic-range validation with friendly errors. Existing
--     historical metric rows are never modified.
--
-- No Gemini, photo-upload, or coach-review behaviour is added
-- here; the schema/services are deliberately Gemini-ready.
-- ============================================================

BEGIN;

-- ============================================================
-- SECTION 1: METRICS COLUMNS + INDEX
-- ============================================================

ALTER TABLE public.metrics
    ADD COLUMN is_baseline BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN body_fat_method TEXT;

ALTER TABLE public.metrics
    ADD CONSTRAINT metrics_body_fat_method_check
    CHECK (body_fat_method IN (
        'visual_estimate', 'manual_entry', 'navy_estimate',
        'bia', 'skinfold', 'dexa', 'other'
    ));

CREATE INDEX IF NOT EXISTS idx_metrics_client_entry_date
    ON public.metrics (client_id, entry_date DESC, id);

COMMENT ON COLUMN public.metrics.is_baseline IS
    'True for the single starting-point body progress row created by the portal Baseline wizard.';
COMMENT ON COLUMN public.metrics.body_fat_method IS
    'How body fat was obtained: visual_estimate (slider), manual_entry, navy_estimate, bia, skinfold, dexa, or other.';

-- ============================================================
-- SECTION 2: RLS — history visible to the currently-assigned coach
-- ============================================================

DROP POLICY IF EXISTS metrics_select ON public.metrics;

CREATE POLICY metrics_select ON public.metrics
    FOR SELECT
    USING (
        public.is_platform_owner()
        OR public.is_workspace_owner(workspace_id)
        OR assigned_ybs_coach_id = (SELECT auth.uid())
        OR public.is_client_self(client_id)
        OR public.is_assigned_ybs_coach(client_id)
    );

-- ============================================================
-- SECTION 3: SHARED VALIDATION HELPER
-- ============================================================

CREATE OR REPLACE FUNCTION public.body_progress_field(
    p_payload JSONB,
    p_key TEXT,
    p_min NUMERIC,
    p_max NUMERIC,
    p_label TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_val NUMERIC;
BEGIN
    IF NOT (p_payload ? p_key) OR p_payload ->> p_key IS NULL OR btrim(p_payload ->> p_key) = '' THEN
        RETURN NULL;
    END IF;

    BEGIN
        v_val := (p_payload ->> p_key)::NUMERIC;
    EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RAISE EXCEPTION 'Enter a valid number for %.', p_label;
    END;

    IF v_val < p_min OR v_val > p_max THEN
        RAISE EXCEPTION '% must be between % and %.', p_label, p_min, p_max;
    END IF;

    RETURN v_val;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.body_progress_field(JSONB, TEXT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.body_progress_field(JSONB, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated;

-- ============================================================
-- SECTION 4: get_client_metrics_state
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_client_metrics_state(p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_client public.clients;
    v_baseline public.metrics;
    v_latest public.metrics;
    v_has_baseline BOOLEAN;
    v_metric_count BIGINT;
BEGIN
    IF p_client_id IS NULL THEN
        RAISE EXCEPTION 'Client is required.';
    END IF;

    IF NOT (
        public.is_platform_owner()
        OR public.is_workspace_owner(public.get_client_workspace_id(p_client_id))
        OR public.is_assigned_ybs_coach(p_client_id)
        OR public.is_client_self(p_client_id)
    ) THEN
        RAISE EXCEPTION 'Not permitted to access this client''s metrics.';
    END IF;

    SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
    IF v_client.id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*)::BIGINT INTO v_metric_count
    FROM public.metrics
    WHERE client_id = p_client_id;

    SELECT EXISTS (
        SELECT 1 FROM public.metrics
        WHERE client_id = p_client_id AND is_baseline = true
    ) INTO v_has_baseline;

    SELECT * INTO v_baseline
    FROM public.metrics
    WHERE client_id = p_client_id AND is_baseline = true
    ORDER BY created_at ASC
    LIMIT 1;

    SELECT * INTO v_latest
    FROM public.metrics
    WHERE client_id = p_client_id
    ORDER BY entry_date DESC, created_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
        'client', jsonb_build_object(
            'id', v_client.id,
            'full_name', v_client.full_name,
            'client_code', v_client.client_code,
            'gender', v_client.gender,
            'date_of_birth', v_client.date_of_birth,
            'height', v_client.height,
            'current_weight', v_client.current_weight,
            'workspace_id', v_client.workspace_id,
            'assigned_ybs_coach_id', v_client.assigned_ybs_coach_id
        ),
        'age', CASE
            WHEN v_client.date_of_birth IS NULL THEN NULL
            ELSE EXTRACT(YEAR FROM age(current_date, v_client.date_of_birth))::INTEGER
        END,
        'metric_count', v_metric_count,
        'has_baseline', v_has_baseline,
        'baseline', CASE WHEN v_baseline.id IS NULL THEN NULL ELSE to_jsonb(v_baseline) END,
        'latest', CASE WHEN v_latest.id IS NULL THEN NULL ELSE to_jsonb(v_latest) END
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_client_metrics_state(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_client_metrics_state(UUID) TO authenticated;

-- ============================================================
-- SECTION 5: save_metrics_baseline
-- ============================================================

CREATE OR REPLACE FUNCTION public.save_metrics_baseline(p_client_id UUID, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_client public.clients;
    v_row public.metrics;
    v_base_id UUID;
    v_sex TEXT;
    v_dob DATE;
    v_method TEXT;
    v_height NUMERIC;
    v_weight NUMERIC;
    v_body_fat NUMERIC;
    v_neck NUMERIC;
    v_chest NUMERIC;
    v_waist NUMERIC;
    v_hip NUMERIC;
    v_right_arm NUMERIC;
    v_left_arm NUMERIC;
    v_right_thigh NUMERIC;
    v_left_thigh NUMERIC;
    v_right_calf NUMERIC;
    v_left_calf NUMERIC;
    v_notes TEXT;
BEGIN
    IF p_client_id IS NULL OR p_payload IS NULL THEN
        RAISE EXCEPTION 'Client and measurements are required.';
    END IF;

    IF NOT (
        public.is_platform_owner()
        OR public.is_workspace_owner(public.get_client_workspace_id(p_client_id))
        OR public.is_assigned_ybs_coach(p_client_id)
        OR public.is_client_self(p_client_id)
    ) THEN
        RAISE EXCEPTION 'Not permitted to update this client''s metrics.';
    END IF;

    SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
    IF v_client.id IS NULL THEN
        RAISE EXCEPTION 'Client not found.';
    END IF;

    -- Optional profile fields (bounded, validated).
    IF p_payload ? 'sex' AND p_payload ->> 'sex' IS NOT NULL AND btrim(p_payload ->> 'sex') <> '' THEN
        v_sex := lower(p_payload ->> 'sex');
        IF v_sex NOT IN ('male', 'female') THEN
            RAISE EXCEPTION 'Please choose Male or Female for sex.';
        END IF;
    END IF;

    IF p_payload ? 'date_of_birth' AND p_payload ->> 'date_of_birth' IS NOT NULL AND btrim(p_payload ->> 'date_of_birth') <> '' THEN
        BEGIN
            v_dob := (p_payload ->> 'date_of_birth')::DATE;
        EXCEPTION
            WHEN invalid_text_representation OR datetime_field_overflow THEN
                RAISE EXCEPTION 'Please enter a valid date of birth.';
        END;
        IF v_dob > current_date THEN
            RAISE EXCEPTION 'Date of birth cannot be in the future.';
        END IF;
        IF v_dob < '1900-01-01'::date THEN
            RAISE EXCEPTION 'Please enter a valid date of birth.';
        END IF;
    END IF;

    IF p_payload ? 'body_fat_method' AND p_payload ->> 'body_fat_method' IS NOT NULL AND btrim(p_payload ->> 'body_fat_method') <> '' THEN
        v_method := lower(p_payload ->> 'body_fat_method');
        IF v_method NOT IN ('visual_estimate', 'manual_entry', 'navy_estimate', 'bia', 'skinfold', 'dexa', 'other') THEN
            RAISE EXCEPTION 'Please choose a valid method for body fat.';
        END IF;
    END IF;

    -- Measurements (validated ranges; absent keys stay NULL / untouched).
    v_height      := public.body_progress_field(p_payload, 'height', 90, 260, 'Height');
    v_weight      := public.body_progress_field(p_payload, 'weight', 25, 400, 'Weight');
    v_body_fat    := public.body_progress_field(p_payload, 'body_fat', 0, 75, 'Body fat');
    v_neck        := public.body_progress_field(p_payload, 'neck', 5, 300, 'Neck');
    v_chest       := public.body_progress_field(p_payload, 'chest', 5, 300, 'Chest');
    v_waist       := public.body_progress_field(p_payload, 'waist', 5, 300, 'Waist');
    v_hip         := public.body_progress_field(p_payload, 'hip', 5, 300, 'Hip');
    v_right_arm   := public.body_progress_field(p_payload, 'right_arm', 5, 300, 'Arm');
    v_left_arm    := public.body_progress_field(p_payload, 'left_arm', 5, 300, 'Arm');
    v_right_thigh := public.body_progress_field(p_payload, 'right_thigh', 5, 300, 'Thigh');
    v_left_thigh  := public.body_progress_field(p_payload, 'left_thigh', 5, 300, 'Thigh');
    v_right_calf  := public.body_progress_field(p_payload, 'right_calf', 5, 300, 'Calf');
    v_left_calf   := public.body_progress_field(p_payload, 'left_calf', 5, 300, 'Calf');

    v_notes := NULLIF(btrim(COALESCE(p_payload ->> 'notes', '')), '');

    -- Mirror family/profile info onto the client record (authoritative).
    UPDATE public.clients SET
        gender = COALESCE(v_sex, gender),
        date_of_birth = COALESCE(v_dob, date_of_birth),
        height = COALESCE(v_height, height),
        current_weight = COALESCE(v_weight, current_weight),
        updated_at = now()
    WHERE id = p_client_id;

    -- Upsert the single baseline row (earliest created baseline wins).
    SELECT id INTO v_base_id
    FROM public.metrics
    WHERE client_id = p_client_id AND is_baseline = true
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_base_id IS NULL THEN
        INSERT INTO public.metrics (
            client_id, workspace_id, assigned_ybs_coach_id, entry_date,
            is_baseline, body_fat_method, height, weight, body_fat,
            neck, chest, waist, hip, right_arm, left_arm,
            right_thigh, left_thigh, right_calf, left_calf, notes
        ) VALUES (
            p_client_id, v_client.workspace_id, v_client.assigned_ybs_coach_id, current_date,
            true, v_method, v_height, v_weight, v_body_fat,
            v_neck, v_chest, v_waist, v_hip, v_right_arm, v_left_arm,
            v_right_thigh, v_left_thigh, v_right_calf, v_left_calf, v_notes
        )
        RETURNING * INTO v_row;
    ELSE
        UPDATE public.metrics SET
            body_fat_method = COALESCE(v_method, body_fat_method),
            height          = COALESCE(v_height, height),
            weight          = COALESCE(v_weight, weight),
            body_fat        = COALESCE(v_body_fat, body_fat),
            neck            = COALESCE(v_neck, neck),
            chest           = COALESCE(v_chest, chest),
            waist           = COALESCE(v_waist, waist),
            hip             = COALESCE(v_hip, hip),
            right_arm       = COALESCE(v_right_arm, right_arm),
            left_arm        = COALESCE(v_left_arm, left_arm),
            right_thigh     = COALESCE(v_right_thigh, right_thigh),
            left_thigh      = COALESCE(v_left_thigh, left_thigh),
            right_calf      = COALESCE(v_right_calf, right_calf),
            left_calf       = COALESCE(v_left_calf, left_calf),
            notes           = COALESCE(v_notes, notes),
            updated_at      = now()
        WHERE id = v_base_id
        RETURNING * INTO v_row;
    END IF;

    RETURN to_jsonb(v_row);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_metrics_baseline(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_metrics_baseline(UUID, JSONB) TO authenticated;

COMMIT;

-- ============================================================
-- POST-MIGRATION NOTES
-- ============================================================
-- * Client check-ins continue to use the normal metrics INSERT
--   path (is_client_self on metrics_insert); the portal sends
--   workspace_id = the client's own workspace and leaves
--   is_baseline = false. The assigned coach sees those rows via
--   the extended metrics_select (is_assigned_ybs_coach).
-- * save_metrics_baseline is VOLATILE and is the ONLY write path
--   that may touch is_baseline = true rows.
-- * Applied to remote project sakvtstauikdrlthhlij via
--   supabase db query --linked --file after this file is committed.
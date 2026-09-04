-- ============================================================
-- YBS SYSTEM: SUPABASE DATABASE ARCHITECTURE (MIGRATION 07)
-- WORKSPACE & PARTNERSHIP ARCHITECTURE, CAPACITY & PROVISIONING
-- ============================================================

-- 1. Partnership Types Lookup Table
CREATE TABLE IF NOT EXISTS public.partnership_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed authoritative partnership types (idempotent)
INSERT INTO public.partnership_types (name, code, description, is_active, sort_order)
VALUES
    ('Technology Managed Partnership', 'technology_managed', 'Core technology platform with independent coach operations.', true, 1),
    ('Operational Coaching Partnership', 'operational_coaching', 'Comprehensive operations powered by YBS platform and dedicated trainer staff.', true, 2),
    ('Hybrid Partnership', 'hybrid', 'Custom operational blend of brand-owned coaching and YBS specialized trainer support.', true, 3),
    ('Enterprise Partnership', 'enterprise', 'High-capacity enterprise solution with priority infrastructure and full operations.', true, 4)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

-- 2. Add Partnership Type and Capacity columns to Workspaces
DO $$
BEGIN
    -- Add partnership_type_id FK
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = 'partnership_type_id'
    ) THEN
        ALTER TABLE public.workspaces
            ADD COLUMN partnership_type_id UUID REFERENCES public.partnership_types(id) ON DELETE RESTRICT;
    END IF;

    -- Add client_capacity (NULL = unlimited, positive integer = limit)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = 'client_capacity'
    ) THEN
        ALTER TABLE public.workspaces
            ADD COLUMN client_capacity INTEGER NULL CHECK (client_capacity IS NULL OR client_capacity > 0);
    END IF;

    -- Add explicit timezone column (synced with settings)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = 'timezone'
    ) THEN
        ALTER TABLE public.workspaces
            ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Africa/Cairo';
    END IF;

    -- Add explicit currency column (synced with settings)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = 'currency'
    ) THEN
        ALTER TABLE public.workspaces
            ADD COLUMN currency TEXT NOT NULL DEFAULT 'EGP';
    END IF;
END $$;

-- Create index on partnership_type_id for fast joins
CREATE INDEX IF NOT EXISTS idx_workspaces_partnership_type_id ON public.workspaces(partnership_type_id);
CREATE INDEX IF NOT EXISTS idx_clients_workspace_status ON public.clients(workspace_id, status);

-- 3. Migrate and Backfill Existing Workspaces Safely
-- Map YBS Default Workspace and any existing records based on platform_plan
DO $$
DECLARE
    v_enterprise_id UUID;
    v_tech_id UUID;
    v_hybrid_id UUID;
BEGIN
    SELECT id INTO v_enterprise_id FROM public.partnership_types WHERE code = 'enterprise';
    SELECT id INTO v_tech_id FROM public.partnership_types WHERE code = 'technology_managed';
    SELECT id INTO v_hybrid_id FROM public.partnership_types WHERE code = 'hybrid';

    -- Migrate YBS Default Workspace specifically to Enterprise Partnership with unlimited capacity
    UPDATE public.workspaces
    SET partnership_type_id = v_enterprise_id,
        client_capacity = NULL,
        timezone = COALESCE(settings->>'timezone', timezone, 'Africa/Cairo'),
        currency = COALESCE(settings->>'currency', currency, 'EGP'),
        updated_at = now()
    WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
       OR slug = 'ybs-default';

    -- Migrate all remaining workspaces that don't have partnership_type_id yet
    UPDATE public.workspaces
    SET partnership_type_id = CASE
            WHEN platform_plan = 'enterprise' THEN v_enterprise_id
            WHEN platform_plan = 'custom' THEN v_hybrid_id
            ELSE v_tech_id
        END,
        timezone = COALESCE(settings->>'timezone', timezone, 'Africa/Cairo'),
        currency = COALESCE(settings->>'currency', currency, 'EGP'),
        updated_at = now()
    WHERE partnership_type_id IS NULL;
END $$;

-- 4. Enable RLS on partnership_types
ALTER TABLE public.partnership_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partnership_types_select" ON public.partnership_types
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "partnership_types_admin" ON public.partnership_types
FOR ALL TO authenticated
USING (public.is_platform_owner())
WITH CHECK (public.is_platform_owner());

-- 5. Concurrency-Safe Client Capacity Trigger Function
CREATE OR REPLACE FUNCTION public.check_client_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_capacity INTEGER;
    v_count INTEGER;
    v_is_override BOOLEAN;
BEGIN
    -- Only active clients consume capacity
    IF NEW.status != 'active' THEN
        RETURN NEW;
    END IF;

    -- Concurrency protection: Lock target workspace row for update
    -- This serializes active client additions for this workspace and eliminates race conditions.
    SELECT client_capacity INTO v_capacity
    FROM public.workspaces
    WHERE id = NEW.workspace_id
    FOR UPDATE;

    -- If capacity is NULL, unlimited clients are allowed
    IF v_capacity IS NULL THEN
        RETURN NEW;
    END IF;

    -- Count existing active clients in target workspace
    SELECT count(*) INTO v_count
    FROM public.clients
    WHERE workspace_id = NEW.workspace_id
      AND status = 'active';

    -- If updating an existing client that was already active, do not double-count
    IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN
        v_count := v_count - 1;
    END IF;

    -- If within limit, permit insertion
    IF v_count < v_capacity THEN
        RETURN NEW;
    END IF;

    -- Capacity reached: verify if caller is an authorized Platform Owner using deliberate override
    BEGIN
        v_is_override := (current_setting('ybs.allow_capacity_override', true) = 'on');
    EXCEPTION WHEN OTHERS THEN
        v_is_override := false;
    END;

    IF v_is_override AND public.is_platform_owner() THEN
        -- Record audit log entry for administrative capacity override
        INSERT INTO public.audit_logs (
            actor_id,
            actor_name,
            actor_role,
            action,
            entity_type,
            entity_id,
            entity_name,
            workspace_id,
            metadata
        )
        VALUES (
            auth.uid(),
            'Platform Owner',
            'platform_owner',
            'workspace_capacity_override',
            'client',
            COALESCE(NEW.id::text, 'pending'),
            NEW.full_name,
            NEW.workspace_id,
            jsonb_build_object(
                'capacity', v_capacity,
                'current_active_count', v_count,
                'client_code', NEW.client_code
            )
        );
        RETURN NEW;
    END IF;

    -- Rejection with standard PostgreSQL code P0001
    RAISE EXCEPTION 'WORKSPACE_CAPACITY_REACHED: Workspace % has reached active client capacity limit (% / %). Platform Owner override required.',
        NEW.workspace_id, v_count, v_capacity
        USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trigger_check_client_capacity ON public.clients;
CREATE TRIGGER trigger_check_client_capacity
    BEFORE INSERT OR UPDATE OF status, workspace_id ON public.clients
    FOR EACH ROW EXECUTE FUNCTION public.check_client_capacity();

-- 6. Administrative Platform Owner Client Creation with Override
CREATE OR REPLACE FUNCTION public.create_client_with_override(
    p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_client_id UUID;
    v_code TEXT;
    v_rand INT;
    v_count INT;
BEGIN
    IF NOT public.is_platform_owner() THEN
        RAISE EXCEPTION 'Only Platform Owners can authorize capacity overrides';
    END IF;

    -- Set transaction-scoped configuration flag
    PERFORM set_config('ybs.allow_capacity_override', 'on', true);

    -- Generate unique client code if not provided
    v_code := p_payload->>'client_code';
    IF v_code IS NULL OR trim(v_code) = '' THEN
        LOOP
            v_rand := 1000 + floor(random() * 9000)::int;
            v_code := 'YBS-' || v_rand::text;
            SELECT count(*) INTO v_count FROM public.clients WHERE client_code = v_code;
            EXIT WHEN v_count = 0;
        END LOOP;
    END IF;

    INSERT INTO public.clients (
        workspace_id,
        full_name,
        client_code,
        email,
        phone,
        date_of_birth,
        gender,
        height,
        current_weight,
        assigned_ybs_coach_id,
        join_date,
        status,
        subscription_status,
        follow_up_day,
        notes
    )
    VALUES (
        (p_payload->>'workspace_id')::uuid,
        p_payload->>'full_name',
        v_code,
        p_payload->>'email',
        p_payload->>'phone',
        NULLIF(p_payload->>'date_of_birth', '')::date,
        p_payload->>'gender',
        NULLIF(p_payload->>'height', '')::numeric,
        NULLIF(p_payload->>'current_weight', '')::numeric,
        NULLIF(p_payload->>'assigned_ybs_coach_id', '')::uuid,
        COALESCE(NULLIF(p_payload->>'join_date', '')::date, CURRENT_DATE),
        COALESCE(p_payload->>'status', 'active'),
        COALESCE(p_payload->>'subscription_status', 'no_subscription'),
        COALESCE(p_payload->>'follow_up_day', 'saturday'),
        p_payload->>'notes'
    )
    RETURNING id INTO v_client_id;

    RETURN jsonb_build_object(
        'success', true,
        'client_id', v_client_id,
        'client_code', v_code
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_client_with_override FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_client_with_override TO authenticated;

-- 7. Brand Owner Auto-Linking on Profile Creation / Update
CREATE OR REPLACE FUNCTION public.sync_brand_owner_to_workspaces()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ws RECORD;
BEGIN
    -- For any workspace created with this user's email:
    FOR v_ws IN
        SELECT id FROM public.workspaces
        WHERE lower(trim(owner_email)) = lower(trim(NEW.email))
    LOOP
        -- Link owner_id if missing or unlinked
        UPDATE public.workspaces
        SET owner_id = NEW.id
        WHERE id = v_ws.id AND (owner_id IS NULL OR owner_id != NEW.id);

        -- Upsert membership with workspace_owner role
        INSERT INTO public.workspace_memberships (
            workspace_id,
            user_id,
            workspace_role,
            status,
            permissions
        )
        VALUES (
            v_ws.id,
            NEW.id,
            'workspace_owner',
            'active',
            ARRAY['clients.view', 'clients.create', 'clients.update', 'clients.delete', 'clients.assign', 'clients.reassign',
                  'subscriptions.view', 'subscriptions.create', 'subscriptions.update', 'subscriptions.freeze', 'subscriptions.cancel',
                  'assessments.view', 'assessments.create', 'assessments.update', 'assessments.review', 'assessments.assign',
                  'metrics.view', 'metrics.update', 'nutrition.view', 'nutrition.create', 'nutrition.update', 'nutrition.fooddb',
                  'workouts.view', 'workouts.create', 'workouts.update', 'workouts.exercise', 'team.view', 'team.manage',
                  'financials.view', 'financials.manage', 'exports.create', 'settings.manage']
        )
        ON CONFLICT (workspace_id, user_id) DO UPDATE SET
            workspace_role = 'workspace_owner',
            status = 'active';

        -- Set active_workspace_id on profile if not already set
        IF NEW.active_workspace_id IS NULL THEN
            UPDATE public.profiles
            SET active_workspace_id = v_ws.id,
                account_status = 'active'
            WHERE id = NEW.id;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_brand_owner_on_profile ON public.profiles;
CREATE TRIGGER trigger_sync_brand_owner_on_profile
    AFTER INSERT OR UPDATE OF email ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.sync_brand_owner_to_workspaces();

-- 8. High-Performance Aggregated Workspace Overview Query
CREATE OR REPLACE FUNCTION public.get_workspaces_overview()
RETURNS TABLE (
    id UUID,
    name TEXT,
    slug TEXT,
    owner_id UUID,
    owner_name TEXT,
    owner_email TEXT,
    owner_phone TEXT,
    status TEXT,
    platform_plan TEXT,
    partnership_type_id UUID,
    partnership_type_name TEXT,
    partnership_type_code TEXT,
    client_capacity INTEGER,
    active_clients_count BIGINT,
    total_clients_count BIGINT,
    assigned_trainers_count BIGINT,
    timezone TEXT,
    currency TEXT,
    settings JSONB,
    notes TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        w.id,
        w.name,
        w.slug,
        w.owner_id,
        w.owner_name,
        w.owner_email,
        w.owner_phone,
        w.status,
        w.platform_plan,
        w.partnership_type_id,
        pt.name AS partnership_type_name,
        pt.code AS partnership_type_code,
        w.client_capacity,
        COUNT(c.id) FILTER (WHERE c.status = 'active') AS active_clients_count,
        COUNT(c.id) AS total_clients_count,
        COUNT(DISTINCT c.assigned_ybs_coach_id) FILTER (WHERE c.assigned_ybs_coach_id IS NOT NULL) AS assigned_trainers_count,
        w.timezone,
        w.currency,
        w.settings,
        w.notes,
        w.created_at,
        w.updated_at
    FROM public.workspaces w
    LEFT JOIN public.partnership_types pt ON pt.id = w.partnership_type_id
    LEFT JOIN public.clients c ON c.workspace_id = w.id
    WHERE public.is_platform_owner() OR public.has_workspace_access(w.id)
    GROUP BY w.id, pt.id
    ORDER BY w.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_workspaces_overview FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspaces_overview TO authenticated;

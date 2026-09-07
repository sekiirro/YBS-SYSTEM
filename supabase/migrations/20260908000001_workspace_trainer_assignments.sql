-- ============================================================
-- YBS TRAINER WORKSPACE ASSIGNMENTS — MEMBERSHIP-BASED OVERHAUL
--
-- Phases 2-4 of the Trainer Portal / Workspace assignment fix.
-- `workspace_memberships` (UNIQUE (workspace_id, user_id)) is the
-- authoritative 0..N trainer-access model. `workspaces.assigned_coach_id`
-- stays ONLY as the optional primary/registration-link coach.
--
-- Changes:
--   1. Allow 'inactive' membership status (removal = deactivation).
--   2. assign_workspace_trainers()   — add/reactivate 1..N trainers.
--   3. remove_workspace_trainer()    — deactivate a trainer membership.
--   4. get_workspace_trainers()      — read assigned trainers (memberships).
--   5. assign_workspace_coach()      — also creates/refreshes the coach's
--                                       trainer membership (kept for links).
--   6. provision_invited_trainer_membership() — also initializes
--                                       profiles.active_workspace_id.
--   7. Backfill active_workspace_id for existing active trainers (NULL only).
--   8. get_workspaces_overview()     — assigned_trainers_count now counts
--                                       ACTIVE trainer memberships instead
--                                       of client coach assignments.
-- ============================================================

-- ------------------------------------------------------------
-- 1. MEMBERSHIP STATUS GAINS 'inactive' (removal semantics)
-- ------------------------------------------------------------
ALTER TABLE public.workspace_memberships
  DROP CONSTRAINT IF EXISTS workspace_memberships_status_check;

ALTER TABLE public.workspace_memberships
  ADD CONSTRAINT workspace_memberships_status_check
  CHECK (status IN ('active', 'suspended', 'invited', 'inactive'));

-- ------------------------------------------------------------
-- 2. ASSIGN 1..N TRAINERS (idempotent upsert, reactivates on re-add)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_workspace_trainers(p_workspace_id UUID, p_trainer_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trainer_id UUID;
  v_assigned INTEGER := 0;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'A workspace is required';
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_workspace_owner(p_workspace_id)) THEN
    RAISE EXCEPTION 'Not authorized to assign trainers to this workspace.';
  END IF;

  IF p_trainer_ids IS NULL THEN
    RETURN jsonb_build_object('success', true, 'assigned', v_assigned);
  END IF;

  FOREACH v_trainer_id IN ARRAY p_trainer_ids
  LOOP
    CONTINUE WHEN v_trainer_id IS NULL;

    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = v_trainer_id
        AND platform_role = 'platform_trainer'
        AND account_status = 'active'
    ) THEN
      RAISE EXCEPTION 'One of the selected trainers is not an active YBS platform trainer.';
    END IF;

    INSERT INTO public.workspace_memberships (
      workspace_id,
      user_id,
      workspace_role,
      status
    )
    VALUES (
      p_workspace_id,
      v_trainer_id,
      'trainer',
      'active'
    )
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET
      workspace_role = 'trainer',
      status = 'active',
      updated_at = now();

    -- Initialize the trainer's active workspace context only when empty.
    -- Never overwrites an already-valid active workspace.
    UPDATE public.profiles
    SET active_workspace_id = p_workspace_id,
        updated_at = now()
    WHERE id = v_trainer_id
      AND active_workspace_id IS NULL;

    v_assigned := v_assigned + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'assigned', v_assigned);
END;
$$;

ALTER FUNCTION public.assign_workspace_trainers(UUID, UUID[]) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.assign_workspace_trainers(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_workspace_trainers(UUID, UUID[]) TO authenticated;

-- ------------------------------------------------------------
-- 3. REMOVE A TRAINER (deactivate membership; no user/profile deletion)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_workspace_trainer(p_workspace_id UUID, p_trainer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_removed INTEGER;
BEGIN
  IF p_workspace_id IS NULL OR p_trainer_id IS NULL THEN
    RAISE EXCEPTION 'A workspace and trainer are required';
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_workspace_owner(p_workspace_id)) THEN
    RAISE EXCEPTION 'Not authorized to modify trainers on this workspace.';
  END IF;

  UPDATE public.workspace_memberships
  SET status = 'inactive',
      updated_at = now()
  WHERE workspace_id = p_workspace_id
    AND user_id = p_trainer_id
    AND workspace_role = 'trainer'
    AND status = 'active';

  GET DIAGNOSTICS v_removed = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'removed', v_removed);
END;
$$;

ALTER FUNCTION public.remove_workspace_trainer(UUID, UUID) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.remove_workspace_trainer(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_workspace_trainer(UUID, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 4. READ ASSIGNED TRAINERS (membership-backed, admin/owner/trainer-own)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_workspace_trainers(p_workspace_id UUID)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  email TEXT,
  workspace_role TEXT,
  status TEXT,
  active_workspace_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    wm.user_id,
    p.full_name,
    p.email,
    wm.workspace_role,
    wm.status,
    p.active_workspace_id
  FROM public.workspace_memberships wm
  JOIN public.profiles p ON p.id = wm.user_id
  WHERE wm.workspace_id = p_workspace_id
    AND wm.workspace_role = 'trainer'
    AND wm.status = 'active'
    AND (
      public.is_platform_owner()
      OR public.is_workspace_owner(p_workspace_id)
      OR wm.user_id = (select auth.uid())
    )
  ORDER BY p.full_name ASC;
$$;

ALTER FUNCTION public.get_workspace_trainers(UUID) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_workspace_trainers(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspace_trainers(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 5. PRIMARY/REGISTRATION-LINK COACH ALSO BECOMES A REAL MEMBER
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_workspace_coach(p_workspace_id UUID, p_coach_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'A workspace is required';
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_workspace_owner(p_workspace_id)) THEN
    RAISE EXCEPTION 'Not authorized to assign a coach to this workspace.';
  END IF;

  IF p_coach_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_coach_id
      AND platform_role = 'platform_trainer'
      AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'The selected coach is not an active YBS platform trainer.';
  END IF;

  UPDATE public.workspaces
  SET assigned_coach_id = p_coach_id,
      updated_at = now()
  WHERE id = p_workspace_id;

  IF p_coach_id IS NOT NULL THEN
    INSERT INTO public.workspace_memberships (
      workspace_id,
      user_id,
      workspace_role,
      status
    )
    VALUES (
      p_workspace_id,
      p_coach_id,
      'trainer',
      'active'
    )
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET
      workspace_role = 'trainer',
      status = 'active',
      updated_at = now();

    UPDATE public.profiles
    SET active_workspace_id = p_workspace_id,
        updated_at = now()
    WHERE id = p_coach_id
      AND active_workspace_id IS NULL;
  END IF;

  PERFORM public.provision_workspace_registration_links(p_workspace_id);

  RETURN jsonb_build_object('success', true, 'workspace_id', p_workspace_id, 'coach_id', p_coach_id);
END;
$$;

ALTER FUNCTION public.assign_workspace_coach(UUID, UUID) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.assign_workspace_coach(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_workspace_coach(UUID, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 6. INVITE-ACCEPTANCE PROVISIONING ALSO INITIALIZES ACTIVE WORKSPACE
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_invited_trainer_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite RECORD;
BEGIN
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

    -- Initialize active workspace when empty (preserve any valid value).
    UPDATE public.profiles
    SET active_workspace_id = v_invite.workspace_id,
        updated_at = now()
    WHERE id = NEW.id
      AND active_workspace_id IS NULL;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.provision_invited_trainer_membership() OWNER TO postgres;

-- ------------------------------------------------------------
-- 7. BACKFILL: EXISTING ACTIVE TRAINERS GET A STABLE ACTIVE WORKSPACE
--    (oldest membership wins, only when NULL — never overwrites)
-- ------------------------------------------------------------
UPDATE public.profiles p
SET active_workspace_id = (
    SELECT wm.workspace_id
    FROM public.workspace_memberships wm
    WHERE wm.user_id = p.id
      AND wm.workspace_role = 'trainer'
      AND wm.status = 'active'
    ORDER BY wm.created_at ASC
    LIMIT 1
),
updated_at = now()
WHERE p.active_workspace_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    WHERE wm.user_id = p.id
      AND wm.workspace_role = 'trainer'
      AND wm.status = 'active'
  );

-- ------------------------------------------------------------
-- 8. OVERVIEW COUNT FIX: ACTIVE TRAINER MEMBERSHIPS, NOT CLIENT COACH IDS
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_workspaces_overview();

CREATE FUNCTION public.get_workspaces_overview()
RETURNS TABLE (
    id UUID,
    name TEXT,
    slug TEXT,
    public_join_token TEXT,
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
    assigned_coach_id UUID,
    assigned_coach_name TEXT,
    assigned_coach_email TEXT,
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
        w.public_join_token,
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
        (SELECT COUNT(DISTINCT wm.user_id)
           FROM public.workspace_memberships wm
          WHERE wm.workspace_id = w.id
            AND wm.workspace_role = 'trainer'
            AND wm.status = 'active') AS assigned_trainers_count,
        w.assigned_coach_id,
        ac.full_name AS assigned_coach_name,
        ac.email AS assigned_coach_email,
        w.timezone,
        w.currency,
        w.settings,
        w.notes,
        w.created_at,
        w.updated_at
    FROM public.workspaces w
    LEFT JOIN public.partnership_types pt ON pt.id = w.partnership_type_id
    LEFT JOIN public.clients c ON c.workspace_id = w.id
    LEFT JOIN public.profiles ac ON ac.id = w.assigned_coach_id
    WHERE public.is_platform_owner() OR public.has_workspace_access(w.id)
    GROUP BY w.id, pt.id, ac.id
    ORDER BY w.created_at DESC;
$$;

ALTER FUNCTION public.get_workspaces_overview() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_workspaces_overview FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspaces_overview TO authenticated;
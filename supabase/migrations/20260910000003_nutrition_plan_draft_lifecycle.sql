-- ============================================================
-- YBS SYSTEM: NUTRITION PLAN DRAFT LIFECYCLE (MIGRATION 20260910000003)
-- Adds status column (draft/active) to nutrition_plans, updates RLS
-- to hide drafts from clients, and adds activate_plan RPC.
-- ============================================================

-- 1. Add status + activated_at columns
ALTER TABLE public.nutrition_plans
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('draft', 'active'));

ALTER TABLE public.nutrition_plans
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

-- 2. Backfill: existing client plans were already visible, so treat them as active.
--    Their activation time is approximated by updated_at so ordering online is stable.
UPDATE public.nutrition_plans
SET activated_at = COALESCE(updated_at, created_at)
WHERE activated_at IS NULL
  AND status = 'active'
  AND client_id IS NOT NULL;

-- 3. Index for status filtering
CREATE INDEX IF NOT EXISTS idx_nutrition_plans_status ON public.nutrition_plans(status);

-- 4. Helper: does a plan have at least one meal? (activation validation)
CREATE OR REPLACE FUNCTION public.plan_has_meals(p_plan_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.nutrition_meals
    WHERE nutrition_plan_id = p_plan_id
  );
$$;

REVOKE EXECUTE ON FUNCTION public.plan_has_meals(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.plan_has_meals(UUID) TO authenticated;

-- 5. activate_plan RPC: validates a draft, assigns it to a client, marks it active,
--    and records actor + timestamp in the existing audit/timeline model.
CREATE OR REPLACE FUNCTION public.activate_plan(
  p_plan_id UUID,
  p_client_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan RECORD;
  v_ws_id UUID;
  v_actor_id UUID;
  v_actor_name TEXT;
BEGIN
  v_actor_id := auth.uid();
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;

  SELECT * INTO v_plan FROM public.nutrition_plans WHERE id = p_plan_id;

  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;

  IF v_plan.status != 'draft' THEN
    RAISE EXCEPTION 'Only draft plans can be activated';
  END IF;

  IF v_plan.is_template THEN
    RAISE EXCEPTION 'Templates cannot be activated directly';
  END IF;

  IF NOT public.plan_has_meals(p_plan_id) THEN
    RAISE EXCEPTION 'Cannot activate a plan with no meals';
  END IF;

  -- Ensure caller is authorized for this plan's workspace (defense in depth:
  -- SECURITY DEFINER bypasses RLS, so re-check explicitly).
  IF NOT (
    public.is_platform_owner()
    OR public.is_workspace_owner(v_plan.workspace_id)
    OR v_plan.assigned_ybs_coach_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to activate this plan';
  END IF;

  -- Verify the target client belongs to the same workspace as the plan
  -- (never trust the frontend to enforce workspace isolation).
  IF NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = p_client_id
      AND c.workspace_id = v_plan.workspace_id
  ) THEN
    RAISE EXCEPTION 'Client does not belong to this workspace';
  END IF;

  v_ws_id := v_plan.workspace_id;

  UPDATE public.nutrition_plans
  SET status = 'active',
      client_id = p_client_id,
      activated_at = now(),
      updated_at = now()
  WHERE id = p_plan_id;

  INSERT INTO public.audit_logs (
    actor_id, actor_name, action, entity_type, entity_id, entity_name,
    workspace_id, metadata
  ) VALUES (
    v_actor_id,
    COALESCE(v_actor_name, 'Unknown'),
    'activate',
    'nutrition_plan',
    p_plan_id::text,
    v_plan.name,
    v_ws_id,
    jsonb_build_object(
      'client_id', p_client_id,
      'previous_status', 'draft',
      'new_status', 'active'
    )
  );

  INSERT INTO public.timeline_events (
    workspace_id, client_id, assigned_ybs_coach_id,
    event_type, title, description,
    actor_id, actor_name, metadata
  ) VALUES (
    v_ws_id, p_client_id, v_actor_id,
    'nutrition_plan_activated',
    'Nutrition Plan Activated',
    'A new nutrition plan has been activated and assigned.',
    v_actor_id,
    COALESCE(v_actor_name, 'Unknown'),
    jsonb_build_object('plan_id', p_plan_id, 'plan_name', v_plan.name)
  );

  RETURN jsonb_build_object(
    'success', true,
    'plan_id', p_plan_id,
    'message', 'Plan activated and assigned successfully'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_plan(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_plan(UUID, UUID) TO authenticated;

-- 6. Update RLS policies: clients may only READ plans that are active.
--    Drafts stay visible to staff (owner / workspace-owner / assigned coach).

DROP POLICY IF EXISTS "nutrition_plans_select" ON public.nutrition_plans;

CREATE POLICY "nutrition_plans_select" ON public.nutrition_plans
FOR SELECT TO authenticated
USING (
  (is_template AND (workspace_id IS NULL OR public.has_workspace_access(workspace_id)))
  OR public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR assigned_ybs_coach_id = (select auth.uid())
  OR (
    client_id IS NOT NULL
    AND public.is_client_self(client_id)
    AND status = 'active'
  )
);

DROP POLICY IF EXISTS "nutrition_meals_select" ON public.nutrition_meals;

CREATE POLICY "nutrition_meals_select" ON public.nutrition_meals
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.nutrition_plans np
    WHERE np.id = nutrition_plan_id
      AND (
        (np.is_template AND (np.workspace_id IS NULL OR public.has_workspace_access(np.workspace_id)))
        OR public.is_platform_owner()
        OR public.is_workspace_owner(np.workspace_id)
        OR np.assigned_ybs_coach_id = (select auth.uid())
        OR (
          np.client_id IS NOT NULL
          AND public.is_client_self(np.client_id)
          AND np.status = 'active'
        )
      )
  )
);

DROP POLICY IF EXISTS "nutrition_items_select" ON public.nutrition_items;

CREATE POLICY "nutrition_items_select" ON public.nutrition_items
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.nutrition_meals nm
    JOIN public.nutrition_plans np ON np.id = nm.nutrition_plan_id
    WHERE nm.id = meal_id
      AND (
        (np.is_template AND (np.workspace_id IS NULL OR public.has_workspace_access(np.workspace_id)))
        OR public.is_platform_owner()
        OR public.is_workspace_owner(np.workspace_id)
        OR np.assigned_ybs_coach_id = (select auth.uid())
        OR (
          np.client_id IS NOT NULL
          AND public.is_client_self(np.client_id)
          AND np.status = 'active'
        )
      )
  )
);
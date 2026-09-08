-- ============================================================
-- YBS SYSTEM: MEAL REPLACEMENT REQUESTS (MIGRATION 20260908000006)
-- Client-side read-only replacement request workflow.
--
-- Clients cannot mutate nutrition plans directly. They create a
-- meal_replacement_requests row (RLS INSERT policy: is_client_self +
-- requested_by = auth.uid()); the actual plan mutation happens ONLY
-- inside the staff-only approve RPC, which applies the candidate
-- produced by the existing Smart Food Replacement engine and recomputes
-- meal/plan totals in a single transaction.
--
-- Additive only -- no destructive changes. Existing nutrition plans are
-- untouched (meal notes already live on nutrition_meals.notes).
-- ============================================================

-- 1. Requests table.
--    Snapshot columns (meal_name, current_*, requested_*) are intentionally
--    denormalized because the nutrition plan editor re-snapshots meals/items
--    on every save (meal/item ids are NOT stable across saves). They keep the
--    audit trail readable even after the plan is edited or the rows recreated.
CREATE TABLE IF NOT EXISTS public.meal_replacement_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  nutrition_plan_id UUID NOT NULL REFERENCES public.nutrition_plans(id) ON DELETE CASCADE,
  meal_id UUID REFERENCES public.nutrition_meals(id) ON DELETE SET NULL,
  meal_name TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('replacement', 'other')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by UUID NOT NULL CONSTRAINT meal_replacement_requests_requested_by_fkey
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_item_id UUID REFERENCES public.nutrition_items(id) ON DELETE SET NULL,
  current_food_id UUID REFERENCES public.foods(id) ON DELETE SET NULL,
  current_food_name TEXT NOT NULL,
  current_macros JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_food_id UUID REFERENCES public.foods(id) ON DELETE SET NULL,
  requested_food_name TEXT,
  requested_replacement JSONB,
  reason TEXT NOT NULL,
  reviewer_id UUID CONSTRAINT meal_replacement_requests_reviewer_id_fkey
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Indexes (FK + common query paths).
CREATE INDEX IF NOT EXISTS idx_meal_req_workspace_id ON public.meal_replacement_requests(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meal_req_client_id ON public.meal_replacement_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_meal_req_plan_id ON public.meal_replacement_requests(nutrition_plan_id);
CREATE INDEX IF NOT EXISTS idx_meal_req_status_created ON public.meal_replacement_requests(status, created_at DESC);

-- 3. Backstop against duplicate pending requests for the same meal.
--    A meal row belongs to exactly one plan + client, so a partial unique
--    index on meal_id is both correct and per-client. The service layer also
--    pre-checks and returns a friendly error.
CREATE UNIQUE INDEX IF NOT EXISTS unique_pending_meal_replacement_per_meal
  ON public.meal_replacement_requests(meal_id)
  WHERE status = 'pending' AND meal_id IS NOT NULL;

-- 4. Grants for the Data API.
GRANT SELECT, INSERT ON public.meal_replacement_requests TO authenticated;
-- No UPDATE/DELETE grants: mutation is exclusive to the staff RPCs below.

-- 5. RLS.
ALTER TABLE public.meal_replacement_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meal_req_select" ON public.meal_replacement_requests
FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR public.is_workspace_owner(workspace_id)
  OR public.is_assigned_ybs_coach(client_id)
  OR public.is_client_self(client_id)
);

-- Clients may only create pending requests for a meal in their OWN assigned
-- nutrition plan, always stamped with their own auth.uid(). Ownership is
-- derived entirely from the database (is_client_self + nutrition_plans.client_id
-- + nutrition_meals.nutrition_plan_id) — never from payload-supplied id/workspace
-- equality. They get NO update or delete capability, so the UI can never be used
-- to apply or resolve anything.
CREATE POLICY "meal_req_insert" ON public.meal_replacement_requests
FOR INSERT TO authenticated
WITH CHECK (
  public.is_client_self(client_id)
  AND requested_by = (select auth.uid())
  AND status = 'pending'
  AND request_type IN ('replacement', 'other')
  AND EXISTS (
    SELECT 1 FROM public.nutrition_plans np
    WHERE np.id = nutrition_plan_id
      AND np.client_id = client_id
      AND np.is_template IS NOT TRUE
  )
  AND EXISTS (
    SELECT 1 FROM public.nutrition_meals nm
    WHERE nm.id = meal_id
      AND nm.nutrition_plan_id = nutrition_plan_id
  )
);

-- 6. Notify responsible staff when a client submits a request.
--    Recipient: the client's assigned coach, falling back to the workspace
--    owner. Done server-side (SECURITY DEFINER) because the notifications
--    table has no client INSERT policy by design.
CREATE OR REPLACE FUNCTION public.notify_meal_replacement_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient UUID;
  v_client_name TEXT;
BEGIN
  SELECT COALESCE(c.assigned_ybs_coach_id, w.owner_id), c.full_name
    INTO v_recipient, v_client_name
  FROM public.clients c
  JOIN public.workspaces w ON w.id = c.workspace_id
  WHERE c.id = NEW.client_id;

  IF v_recipient IS NOT NULL THEN
    INSERT INTO public.notifications (
      workspace_id, user_id, client_id, type, title, message,
      related_entity_type, related_entity_id, delivery_status, delivery_channel
    ) VALUES (
      NEW.workspace_id,
      v_recipient,
      NEW.client_id,
      'meal_replacement_request',
      'Meal replacement requested',
      COALESCE(v_client_name, 'A client') || ' requested a replacement for "' || NEW.meal_name
        || '". Review it under Nutrition Plans → Replacement Requests.',
      'meal_replacement_request',
      NEW.id,
      'delivered',
      'in_app'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_meal_replacement_request ON public.meal_replacement_requests;
CREATE TRIGGER trigger_notify_meal_replacement_request
  AFTER INSERT ON public.meal_replacement_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_meal_replacement_request();

-- 7. Staff-only RPCs. Approved requests apply the stored engine candidate to
--    the original item (with an identity-based fallback when the item was
--    re-snapshot since the request), recompute meal + plan totals, and notify
--    the client. Rejected requests touch nothing but the request row.
CREATE OR REPLACE FUNCTION public.approve_meal_replacement_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.meal_replacement_requests%ROWTYPE;
  v_item_id UUID;
  v_client_user_id UUID;
BEGIN
  SELECT * INTO v_req FROM public.meal_replacement_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Replacement request % not found.', p_request_id;
  END IF;

  IF NOT (public.is_platform_owner()
          OR public.is_workspace_owner(v_req.workspace_id)
          OR public.is_assigned_ybs_coach(v_req.client_id)) THEN
    RAISE EXCEPTION 'Only the client''s assigned coach or workspace owner can approve replacement requests.';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been resolved (status: %).', v_req.status;
  END IF;

  -- Apply the replacement only when the client actually picked one. An
  -- "other" request (wants alternatives via chat) is acknowledged, never
  -- auto-applied, so the plan is left untouched.
  IF v_req.request_type = 'replacement' AND v_req.requested_replacement IS NOT NULL THEN
    v_item_id := v_req.current_item_id;
    IF v_item_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.nutrition_items WHERE id = v_item_id) THEN
      -- Fallback: locate the item by meal + original food reference within
      -- the current plan snapshot (ids are re-generated on plan re-save).
      SELECT ni.id INTO v_item_id
      FROM public.nutrition_items ni
      WHERE ni.meal_id = v_req.meal_id
        AND ni.food_id IS NOT DISTINCT FROM v_req.current_food_id
      ORDER BY ni.id
      LIMIT 1;
    END IF;

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'The original item for this request no longer exists in the current plan. Please re-edit the meal manually.';
    END IF;

    UPDATE public.nutrition_items SET
      food_id = COALESCE(v_req.requested_food_id, (v_req.requested_replacement->>'food_id')::uuid),
      food_name = COALESCE(v_req.requested_food_name, v_req.requested_replacement->>'food_name', v_req.requested_replacement->>'name'),
      amount = COALESCE((v_req.requested_replacement->>'recommended_amount')::numeric, (v_req.requested_replacement->>'amount')::numeric, 100),
      unit = COALESCE(v_req.requested_replacement->>'recommended_unit', v_req.requested_replacement->>'unit', 'g'),
      calories = COALESCE((v_req.requested_replacement->>'estimated_calories')::numeric, 0),
      protein = COALESCE((v_req.requested_replacement->>'estimated_protein')::numeric, 0),
      carbs = COALESCE((v_req.requested_replacement->>'estimated_carbs')::numeric, 0),
      fat = COALESCE((v_req.requested_replacement->>'estimated_fat')::numeric, 0)
    WHERE id = v_item_id;

    -- Recompute meal + plan totals from the mutated snapshot.
    IF v_req.meal_id IS NOT NULL THEN
      UPDATE public.nutrition_meals SET
        calories = (SELECT COALESCE(SUM(calories), 0) FROM public.nutrition_items WHERE meal_id = v_req.meal_id)
      WHERE id = v_req.meal_id;
    END IF;

    UPDATE public.nutrition_plans SET
      daily_calories = t.cal,
      daily_protein = t.pro,
      daily_carbs = t.car,
      daily_fat = t.fat,
      updated_at = now()
    FROM (
      SELECT COALESCE(SUM(ni.calories), 0) AS cal,
             COALESCE(SUM(ni.protein), 0) AS pro,
             COALESCE(SUM(ni.carbs), 0) AS car,
             COALESCE(SUM(ni.fat), 0) AS fat
      FROM public.nutrition_items ni
      JOIN public.nutrition_meals nm ON nm.id = ni.meal_id
      WHERE nm.nutrition_plan_id = v_req.nutrition_plan_id
    ) t
    WHERE public.nutrition_plans.id = v_req.nutrition_plan_id;
  END IF;

  UPDATE public.meal_replacement_requests SET
    status = 'approved',
    reviewer_id = (select auth.uid()),
    reviewed_at = now(),
    updated_at = now()
  WHERE id = v_req.id;

  SELECT user_id INTO v_client_user_id FROM public.clients WHERE id = v_req.client_id;
  IF v_client_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      workspace_id, user_id, client_id, type, title, message,
      related_entity_type, related_entity_id, delivery_status, delivery_channel
    ) VALUES (
      v_req.workspace_id,
      v_client_user_id,
      v_req.client_id,
      'meal_replacement_request_resolved',
      'Replacement request approved',
      'Your replacement for "' || v_req.meal_name || '" was approved'
        || CASE WHEN v_req.request_type = 'replacement' AND v_req.requested_food_name IS NOT NULL
                THEN ' (' || v_req.requested_food_name || ').'
                ELSE '.' END
        || ' Check your nutrition plan.',
      'meal_replacement_request',
      v_req.id,
      'delivered',
      'in_app'
    );
  END IF;

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name,
    workspace_id, metadata
  ) VALUES (
    (select auth.uid()),
    COALESCE((SELECT full_name FROM public.profiles WHERE id = (select auth.uid())), 'Staff'),
    CASE WHEN public.is_platform_owner() THEN 'platform_owner'
         WHEN public.is_workspace_owner(v_req.workspace_id) THEN 'workspace_owner'
         ELSE 'trainer' END,
    'meal_replacement_approved',
    'meal_replacement_request',
    v_req.id::text,
    v_req.meal_name,
    v_req.workspace_id,
    jsonb_build_object(
      'client_id', v_req.client_id,
      'request_type', v_req.request_type,
      'requested_food_id', v_req.requested_food_id,
      'requested_food_name', v_req.requested_food_name
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_req.id,
    'status', 'approved',
    'meal_name', v_req.meal_name,
    'request_type', v_req.request_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_meal_replacement_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.meal_replacement_requests%ROWTYPE;
  v_client_user_id UUID;
BEGIN
  SELECT * INTO v_req FROM public.meal_replacement_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Replacement request % not found.', p_request_id;
  END IF;

  IF NOT (public.is_platform_owner()
          OR public.is_workspace_owner(v_req.workspace_id)
          OR public.is_assigned_ybs_coach(v_req.client_id)) THEN
    RAISE EXCEPTION 'Only the client''s assigned coach or workspace owner can reject replacement requests.';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been resolved (status: %).', v_req.status;
  END IF;

  -- Rejection never touches the nutrition plan.
  UPDATE public.meal_replacement_requests SET
    status = 'rejected',
    reviewer_id = (select auth.uid()),
    reviewed_at = now(),
    updated_at = now()
  WHERE id = v_req.id;

  SELECT user_id INTO v_client_user_id FROM public.clients WHERE id = v_req.client_id;
  IF v_client_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      workspace_id, user_id, client_id, type, title, message,
      related_entity_type, related_entity_id, delivery_status, delivery_channel
    ) VALUES (
      v_req.workspace_id,
      v_client_user_id,
      v_req.client_id,
      'meal_replacement_request_resolved',
      'Replacement request declined',
      'Your replacement for "' || v_req.meal_name || '" was declined. Reach out in chat if you''d like a different option.',
      'meal_replacement_request',
      v_req.id,
      'delivered',
      'in_app'
    );
  END IF;

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name,
    workspace_id, metadata
  ) VALUES (
    (select auth.uid()),
    COALESCE((SELECT full_name FROM public.profiles WHERE id = (select auth.uid())), 'Staff'),
    CASE WHEN public.is_platform_owner() THEN 'platform_owner'
         WHEN public.is_workspace_owner(v_req.workspace_id) THEN 'workspace_owner'
         ELSE 'trainer' END,
    'meal_replacement_rejected',
    'meal_replacement_request',
    v_req.id::text,
    v_req.meal_name,
    v_req.workspace_id,
    jsonb_build_object('client_id', v_req.client_id, 'request_type', v_req.request_type)
  );

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_req.id,
    'status', 'rejected',
    'meal_name', v_req.meal_name,
    'request_type', v_req.request_type
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_meal_replacement_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_meal_replacement_request(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_meal_replacement_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_meal_replacement_request(UUID) TO authenticated;
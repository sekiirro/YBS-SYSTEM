-- ============================================================
-- YBS SYSTEM: PLAN DELIVERY SLA + AUTOMATIC CLIENT ACTIVATION
-- (MIGRATION 20260914000001)
--
-- Part 1  -> clients.activated_at (true activation instant).
-- Part 2  -> package_end_date() helper (shared period math).
-- Part 3  -> auto_activate_client() — the single idempotent
--            PENDING -> ACTIVE promotion path. Both the Nutrition
--            and the Workout plan must already be delivered; the
--            subscription period re-anchors at the activation
--            date. Safe to call from triggers: never raises for
--            business skips (capacity included).
-- Part 4  -> wires Part 3 into evaluate_form_rules_for_plan_assignment,
--            the exact function fired by BOTH delivery events:
--             * activate_plan (nutrition) — event is committed,
--               actor is the calling coach;
--             * workout_plans insert/update trigger.
-- Part 5  -> activate_client_package() now enforces the same
--            plan-delivery business rule on the manual path, and
--            records activated_at + re-anchors subscription dates.
-- Part 6  -> get_forms_with_delivery() — single-query Forms list
--            with per-form delivery booleans (avoids N+1).
-- ============================================================

-- ============================================================
-- PART 1: ACTIVATION DATE COLUMN
-- ============================================================
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.clients.activated_at IS
  'Moment the client was promoted to active (manual or automatic). The subscription period begins from this date.';

-- ============================================================
-- PART 2: PACKAGE END-DATE HELPER
-- ============================================================
-- Resolves the end date of a package period anchored at a given start.
-- Returns NULL when the package is no longer resolvable so callers can
-- fall back to their stored value. Matches the package duration units
-- used at subscription creation.
CREATE OR REPLACE FUNCTION public.package_end_date(p_package_id UUID, p_start DATE)
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_start + CASE pk.duration_unit
    WHEN 'days' THEN make_interval(days => pk.duration)
    WHEN 'weeks' THEN make_interval(weeks => pk.duration)
    ELSE make_interval(months => pk.duration)
  END
  FROM public.packages pk
  WHERE pk.id = p_package_id;
$$;

REVOKE EXECUTE ON FUNCTION public.package_end_date(UUID, DATE) FROM PUBLIC;

-- ============================================================
-- PART 3: AUTOMATIC CLIENT ACTIVATION
-- ============================================================
-- The canonical PENDING -> ACTIVE automation. Requirements:
--   * only ever promotes a 'pending' client (other statuses untouched);
--   * requires BOTH a delivered Nutrition plan (status='active', not
--     archived) AND a delivered Workout plan (not template, not archived);
--   * activation date = the event that completes the second plan;
--   * subscription period re-anchors at that activation date;
--   * idempotent: already-active clients return success without side effects;
--   * capacity-aware: when the workspace is full it SKIPS instead of raising,
--     so the triggering plan-delivery transaction is never blocked;
--   * audit + timeline trail with the acting session attributed when present.
CREATE OR REPLACE FUNCTION public.auto_activate_client(p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_ws_status TEXT;
  v_has_nutrition BOOLEAN;
  v_has_workout BOOLEAN;
  v_pending_sub public.subscriptions%ROWTYPE;
  v_start_date DATE;
  v_end_date DATE;
  v_capacity INTEGER;
  v_active_count INTEGER;
  v_actor_id UUID;
  v_actor_name TEXT;
BEGIN
  v_actor_id := auth.uid();
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;

  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
  IF v_client.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'client_not_found');
  END IF;

  -- Idempotent fast path: never re-activate an already active client.
  IF v_client.status = 'active' THEN
    RETURN jsonb_build_object(
      'success', true, 'already_active', true,
      'client_id', v_client.id, 'client_code', v_client.client_code
    );
  END IF;

  -- Only the approval lifecycle state 'pending' is eligible.
  IF v_client.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'success', false, 'reason', 'not_eligible', 'status', v_client.status
    );
  END IF;

  SELECT status INTO v_ws_status FROM public.workspaces WHERE id = v_client.workspace_id;
  IF v_ws_status IS NULL OR v_ws_status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'workspace_not_active');
  END IF;

  -- Both required plans must be delivered (same definition used by the
  -- form-rule evaluator, plus archive hardening).
  SELECT EXISTS (
    SELECT 1 FROM public.nutrition_plans
    WHERE client_id = p_client_id AND status = 'active' AND is_archived = false
  ) INTO v_has_nutrition;

  SELECT EXISTS (
    SELECT 1 FROM public.workout_plans
    WHERE client_id = p_client_id AND is_template = false AND is_archived = false
  ) INTO v_has_workout;

  IF NOT (v_has_nutrition AND v_has_workout) THEN
    RETURN jsonb_build_object(
      'success', false, 'reason', 'plans_not_complete',
      'nutrition_delivered', v_has_nutrition,
      'workout_delivered', v_has_workout
    );
  END IF;

  -- Capacity guard mirroring check_client_capacity(). Skipping here keeps
  -- the delivery of the triggering plan safe even at capacity; the DB
  -- constraint trigger remains the race-proof backstop.
  SELECT client_capacity INTO v_capacity FROM public.workspaces WHERE id = v_client.workspace_id;
  IF v_capacity IS NOT NULL THEN
    SELECT count(*) INTO v_active_count
    FROM public.clients
    WHERE workspace_id = v_client.workspace_id
      AND status = 'active'
      AND id <> p_client_id;
    IF v_active_count >= v_capacity THEN
      RETURN jsonb_build_object(
        'success', false, 'reason', 'capacity_blocked', 'capacity', v_capacity
      );
    END IF;
  END IF;

  -- Activation date = the day the second required plan is delivered.
  v_start_date := CURRENT_DATE;
  v_end_date := NULL;

  SELECT * INTO v_pending_sub
  FROM public.subscriptions
  WHERE client_id = p_client_id AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_pending_sub.id IS NOT NULL THEN
    v_end_date := public.package_end_date(v_pending_sub.package_id, v_start_date);
    IF v_end_date IS NULL THEN
      -- Package no longer resolvable: preserve the stored window.
      v_end_date := v_pending_sub.end_date;
    END IF;
  END IF;

  BEGIN
    IF v_pending_sub.id IS NOT NULL THEN
      UPDATE public.subscriptions
      SET status = 'active',
          start_date = v_start_date,
          end_date = v_end_date,
          updated_at = now()
      WHERE id = v_pending_sub.id;
    END IF;

    UPDATE public.clients
    SET status = 'active',
        activated_at = now(),
        subscription_status = CASE
          WHEN v_pending_sub.id IS NOT NULL THEN 'active'
          ELSE v_client.subscription_status
        END,
        subscription_end_date = COALESCE(v_end_date, v_client.subscription_end_date),
        package_name = COALESCE(v_pending_sub.package_name, v_client.package_name),
        approved_at = COALESCE(v_client.approved_at, now()),
        updated_at = now()
    WHERE id = p_client_id;
  EXCEPTION
    WHEN OTHERS THEN
      -- check_client_capacity raises P0001 on a full workspace raced into
      -- the UPDATE; convert that into a graceful skip, never a delivery block.
      IF SQLSTATE = 'P0001' THEN
        RETURN jsonb_build_object('success', false, 'reason', 'capacity_blocked');
      END IF;
      RAISE;
  END;

  INSERT INTO public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, workspace_id, metadata)
  VALUES (
    v_actor_id,
    COALESCE(v_actor_name, 'System'),
    CASE WHEN public.is_platform_owner() THEN 'platform_owner' ELSE 'system' END,
    'client_auto_activated',
    'client',
    p_client_id::text,
    v_client.full_name,
    v_client.workspace_id,
    jsonb_build_object(
      'activated_at', now(),
      'subscription_id', v_pending_sub.id,
      'start_date', v_start_date,
      'end_date', v_end_date,
      'nutrition_delivered', v_has_nutrition,
      'workout_delivered', v_has_workout
    )
  );

  INSERT INTO public.timeline_events (
    workspace_id, client_id, assigned_ybs_coach_id,
    event_type, title, description, actor_id, actor_name, metadata
  ) VALUES (
    v_client.workspace_id, p_client_id, COALESCE(v_client.assigned_ybs_coach_id, v_actor_id),
    'client_auto_activated',
    'Client Activated',
    'Both the Nutrition and Workout plans were delivered — the client was activated automatically.',
    v_actor_id, COALESCE(v_actor_name, 'System'),
    jsonb_build_object(
      'subscription_id', v_pending_sub.id,
      'start_date', v_start_date,
      'end_date', v_end_date
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'client_id', p_client_id,
    'subscription_id', v_pending_sub.id,
    'client_code', v_client.client_code,
    'activated_at', now(),
    'start_date', v_start_date,
    'end_date', v_end_date
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_activate_client(UUID) FROM PUBLIC;

-- ============================================================
-- PART 4: WIRE AUTOMATIC ACTIVATION INTO THE DELIVERY EVENT
-- ============================================================
-- evaluate_form_rules_for_plan_assignment is the single function fired by
-- BOTH plan-delivery events (activate_plan for nutrition and the
-- workout_plans trigger). It already computes the same delivered flags, so
-- automatic activation naturally happens exactly on the SECOND delivery.
CREATE OR REPLACE FUNCTION public.evaluate_form_rules_for_plan_assignment(p_client_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
  v_client public.clients%ROWTYPE;
  v_has_nutrition BOOLEAN;
  v_has_workout BOOLEAN;
BEGIN
  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
  IF v_client.id IS NULL OR v_client.workspace_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.nutrition_plans
    WHERE client_id = p_client_id AND status = 'active'
  ) INTO v_has_nutrition;

  SELECT EXISTS (
    SELECT 1 FROM public.workout_plans
    WHERE client_id = p_client_id AND is_template = false AND is_archived = false
  ) INTO v_has_workout;

  IF NOT (v_has_nutrition AND v_has_workout) THEN
    RETURN;
  END IF;

  -- Automatic activation: both plans delivered at this moment.
  PERFORM public.auto_activate_client(p_client_id);

  FOR v_rule IN
    SELECT r.* FROM public.form_assignment_rules r
    WHERE r.trigger_type = 'nutrition_workout'
      AND r.is_enabled = true
      AND (r.workspace_id IS NULL OR r.workspace_id = v_client.workspace_id)
  LOOP
    PERFORM public.assign_form_for_rule(v_rule.id, p_client_id, '', NULL);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.evaluate_form_rules_for_plan_assignment(UUID) FROM PUBLIC;

-- ============================================================
-- PART 5: MANUAL ACTIVATION ENFORCES THE SAME BUSINESS RULE
-- ============================================================
-- The manual Activate path may never bypass the plan-delivery business rule:
-- activation requires both plans delivered. It also records the activation
-- moment and re-anchors the subscription period from that date, keeping every
-- activation path consistent with the automatic one.
CREATE OR REPLACE FUNCTION public.activate_client_package(p_subscription_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_ws_status TEXT;
  v_has_nutrition BOOLEAN;
  v_has_workout BOOLEAN;
  v_start_date DATE;
  v_end_date DATE;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription % not found.', p_subscription_id;
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_workspace_owner(v_sub.workspace_id)) THEN
    RAISE EXCEPTION 'Only Platform Owners and Workspace Owners can activate client packages.';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = v_sub.client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client % not found.', v_sub.client_id;
  END IF;

  SELECT status INTO v_ws_status FROM public.workspaces WHERE id = v_sub.workspace_id;
  IF v_ws_status IS NULL OR v_ws_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot activate a package in a suspended or archived workspace.';
  END IF;

  -- Idempotent fast path.
  IF v_sub.status = 'active' AND v_client.status = 'active' THEN
    RETURN jsonb_build_object(
      'success', true,
      'client_id', v_client.id,
      'subscription_id', v_sub.id,
      'client_code', v_client.client_code
    );
  END IF;

  -- Business rule: activation requires both plans delivered.
  SELECT EXISTS (
    SELECT 1 FROM public.nutrition_plans
    WHERE client_id = v_client.id AND status = 'active' AND is_archived = false
  ) INTO v_has_nutrition;

  SELECT EXISTS (
    SELECT 1 FROM public.workout_plans
    WHERE client_id = v_client.id AND is_template = false AND is_archived = false
  ) INTO v_has_workout;

  IF NOT (v_has_nutrition AND v_has_workout) THEN
    RAISE EXCEPTION
      'Activation requires both the Nutrition plan and the Workout plan to be delivered first (Nutrition: % / Workout: %).',
      CASE WHEN v_has_nutrition THEN 'delivered' ELSE 'missing' END,
      CASE WHEN v_has_workout THEN 'delivered' ELSE 'missing' END;
  END IF;

  -- Subscription period begins from the activation date.
  v_start_date := CURRENT_DATE;
  v_end_date := public.package_end_date(v_sub.package_id, v_start_date);
  IF v_end_date IS NULL THEN
    v_end_date := v_sub.end_date;
  END IF;

  UPDATE public.subscriptions
  SET status = 'active',
      payment_status = CASE WHEN payment_status = 'unpaid' THEN 'paid' ELSE payment_status END,
      start_date = v_start_date,
      end_date = COALESCE(v_end_date, v_sub.end_date),
      updated_at = now()
  WHERE id = v_sub.id;

  UPDATE public.clients
  SET status = 'active',
      activated_at = now(),
      subscription_status = 'active',
      subscription_end_date = COALESCE(v_end_date, v_sub.end_date),
      package_name = v_sub.package_name,
      approved_at = COALESCE(approved_at, now()),
      updated_at = now()
  WHERE id = v_client.id;

  INSERT INTO public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, workspace_id, metadata)
  VALUES (
    auth.uid(),
    COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
    CASE WHEN public.is_platform_owner() THEN 'platform_owner' ELSE 'workspace_owner' END,
    'client_package_activated',
    'subscription',
    v_sub.id::text,
    v_client.full_name,
    v_sub.workspace_id,
    jsonb_build_object(
      'client_id', v_client.id,
      'package_name', v_sub.package_name,
      'activated_at', now(),
      'start_date', v_start_date::text,
      'end_date', v_end_date::text
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'client_id', v_client.id,
    'subscription_id', v_sub.id,
    'client_code', v_client.client_code
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_client_package(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_client_package(UUID) TO authenticated;

-- ============================================================
-- PART 6: FORMS LIST WITH DELIVERY STATE (single query, no N+1)
-- ============================================================
-- Mirrors the assessments_select RLS predicate inside a SECURITY DEFINER
-- body so the caller's visibility is re-checked after RLS is bypassed, and
-- enriches every row with the two plan-delivery booleans the Forms page
-- needs for its Plan Delivery column.
CREATE OR REPLACE FUNCTION public.get_forms_with_delivery()
RETURNS TABLE (
  id UUID,
  workspace_id UUID,
  client_id UUID,
  template_id UUID,
  name TEXT,
  assigned_ybs_coach_id UUID,
  due_date DATE,
  submission_status TEXT,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  questions_snapshot JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  response_count BIGINT,
  assigned_client_name TEXT,
  workspace_name TEXT,
  nutrition_delivered BOOLEAN,
  workout_delivered BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.workspace_id,
    a.client_id,
    a.template_id,
    a.name,
    a.assigned_ybs_coach_id,
    a.due_date,
    a.submission_status,
    a.submitted_at,
    a.reviewed_at,
    a.questions_snapshot,
    a.created_at,
    a.updated_at,
    (SELECT count(*)::bigint FROM public.assessment_responses r WHERE r.assessment_id = a.id),
    cl.full_name,
    w.name,
    EXISTS (
      SELECT 1 FROM public.nutrition_plans np
      WHERE np.client_id = a.client_id AND np.status = 'active' AND np.is_archived = false
    ),
    EXISTS (
      SELECT 1 FROM public.workout_plans wp
      WHERE wp.client_id = a.client_id AND wp.is_template = false AND wp.is_archived = false
    )
  FROM public.assessments a
  LEFT JOIN public.clients cl ON cl.id = a.client_id
  LEFT JOIN public.workspaces w ON w.id = a.workspace_id
  WHERE public.is_platform_owner()
     OR public.is_workspace_owner(a.workspace_id)
     OR a.assigned_ybs_coach_id = auth.uid()
     OR public.is_client_self(a.client_id)
  ORDER BY a.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_forms_with_delivery() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_forms_with_delivery() TO authenticated;
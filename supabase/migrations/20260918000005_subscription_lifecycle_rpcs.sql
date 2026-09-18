-- ============================================================
-- YBS SYSTEM: SUBSCRIPTION LIFECYCLE REBUILD — PART 2 (RPCs)
-- Migration: 20260918000005_subscription_lifecycle_rpcs.sql
--
-- Requires 20260918000004_subscription_lifecycle_core.sql.
--
-- AUTHORIZATION MODEL (enforced in the database, never only in the UI):
--   System Owner (profiles.platform_role = 'platform_owner')
--        -> freeze / cancel freeze / renew / manual date override /
--           full lifecycle summary (including financial fields).
--   Workspace Owner
--        -> READ-ONLY lifecycle summary (financial fields included,
--           matching the existing subscriptions_select policy).
--   Trainer (assigned coach)
--        -> READ-ONLY lifecycle summary. Financial fields are NEVER
--           returned for a trainer.
--   Client (self)
--        -> READ-ONLY summary of their own lifecycle.
--   Direct REST/RPC writes to subscriptions are already restricted to
--   the System Owner by the subscriptions_manage policy; every RPC here
--   re-checks authorization explicitly.
--
-- ACTIVATION ANCHOR (unchanged canonical lifecycle):
--   clients.join_date / created_at are NEVER used as the countdown
--   anchor. The countdown starts at clients.activated_at, which is set
--   by the existing auto_activate_client() / activate_client_package()
--   path once BOTH plans are delivered, and the subscription period is
--   re-anchored at that date by the same functions.
--   This migration only ADDS an emergency recovery hook
--   (repair_client_activation_anchor) for rows whose subscription dates
--   still hold a pre-activation window.
-- ============================================================

-- ============================================================
-- 1. AUTOMATIC (AND IDEMPOTENT) FREEZE RESUME
-- ============================================================
CREATE OR REPLACE FUNCTION public.resume_due_subscription_freezes(p_client_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_freeze RECORD;
  v_resumed INTEGER := 0;
  v_end_date DATE;
BEGIN
  FOR v_freeze IN
    SELECT f.id, f.subscription_id, f.client_id
    FROM public.subscription_freezes f
    WHERE f.status = 'active'
      AND f.freeze_end <= now()
      AND (p_client_id IS NULL OR f.client_id = p_client_id)
    ORDER BY f.freeze_end
    FOR UPDATE
  LOOP
    -- 1. Close the freeze (guarded on status so a concurrent caller is a no-op).
    UPDATE public.subscription_freezes f
    SET status = 'completed',
        closed_at = now(),
        close_reason = 'auto_resume',
        updated_at = now()
    WHERE f.id = v_freeze.id
      AND f.status = 'active';

    CONTINUE WHEN NOT FOUND;

    -- 2. Resume the subscription cycle.
    UPDATE public.subscriptions s
    SET status = 'active',
        freeze_start_date = NULL,
        freeze_end_date = NULL,
        updated_at = now()
    WHERE s.id = v_freeze.subscription_id
      AND s.status = 'frozen'
    RETURNING s.end_date INTO v_end_date;

    -- 3. Restore the denormalized client display state, but only while
    --    this cycle is still the client's CURRENT cycle and the client
    --    itself is active (a frozen cycle of an archived/expired client
    --    is never silently reactivated).
    UPDATE public.clients c
    SET subscription_status = 'active',
        subscription_end_date = COALESCE(v_end_date, c.subscription_end_date),
        updated_at = now()
    WHERE c.id = v_freeze.client_id
      AND c.status = 'active'
      AND c.subscription_status = 'frozen'
      AND public.current_subscription_id(c.id) = v_freeze.subscription_id;

    INSERT INTO public.audit_logs (
      actor_id, actor_name, actor_role, action, entity_type, entity_id,
      entity_name, workspace_id, metadata
    )
    SELECT
      NULL,
      'System',
      'system',
      'subscription_freeze_resumed',
      'subscription',
      v_freeze.subscription_id::text,
      c.full_name,
      c.workspace_id,
      jsonb_build_object('client_id', v_freeze.client_id, 'freeze_id', v_freeze.id)
    FROM public.clients c
    WHERE c.id = v_freeze.client_id;

    v_resumed := v_resumed + 1;
  END LOOP;

  RETURN v_resumed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resume_due_subscription_freezes(UUID) FROM PUBLIC;

-- Hourly sweep: keeps list views (which read clients.*) accurate without
-- requiring the detail page to be opened. The function itself is
-- idempotent, so overlapping runs are safe.
DO $cron_body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ybs-subscription-freeze-resume') THEN
    PERFORM cron.schedule(
      'ybs-subscription-freeze-resume',
      '7 * * * *',
      $cron$SELECT public.resume_due_subscription_freezes();$cron$
    );
  END IF;
END;
$cron_body$;

-- ============================================================
-- 2. FREEZE (System Owner only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.freeze_client_subscription(
  p_subscription_id UUID,
  p_freeze_days INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_name TEXT;
  v_sub public.subscriptions%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_ws_status TEXT;
  v_remaining INTEGER;
  v_previous_end DATE;
  v_extended_end DATE;
  v_resume_date DATE;
  v_freeze_id UUID;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Only the System Owner can freeze a subscription.';
  END IF;

  IF p_freeze_days IS NULL OR p_freeze_days < 1 OR p_freeze_days > 365 THEN
    RAISE EXCEPTION 'The freeze duration must be between 1 and 365 days.';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription not found';
  END IF;

  -- Deterministic pre-state: a freeze whose period already elapsed is
  -- resumed before anything else, so the status checks below are
  -- unambiguous.
  PERFORM public.resume_due_subscription_freezes(v_sub.client_id);
  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id FOR UPDATE;

  IF v_sub.status = 'pending' THEN
    RAISE EXCEPTION 'A subscription cannot be frozen before the client is activated (the countdown has not started).';
  ELSIF v_sub.status = 'expired' THEN
    RAISE EXCEPTION 'An expired subscription cannot be frozen. Renew it instead.';
  ELSIF v_sub.status IN ('renewed', 'cancelled') THEN
    RAISE EXCEPTION 'A % subscription is a closed historical cycle and cannot be frozen.', v_sub.status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscription_freezes
    WHERE subscription_id = v_sub.id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'This subscription is already frozen.';
  END IF;

  IF v_sub.end_date IS NULL THEN
    RAISE EXCEPTION 'The subscription has no end date to extend.';
  END IF;

  SELECT status INTO v_ws_status FROM public.workspaces WHERE id = v_sub.workspace_id;
  IF v_ws_status IS NULL OR v_ws_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot freeze a subscription in a suspended or archived workspace.';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = v_sub.client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found';
  END IF;

  -- Paused countdown snapshot + period extension. Extending end_date by
  -- exactly the freeze length makes the standard end_date - CURRENT_DATE
  -- formula return the preserved value the moment the freeze resumes.
  v_remaining := GREATEST(0, (v_sub.end_date - CURRENT_DATE)::int);
  v_previous_end := v_sub.end_date;
  v_extended_end := v_sub.end_date + p_freeze_days;
  v_resume_date := CURRENT_DATE + p_freeze_days;

  INSERT INTO public.subscription_freezes (
    subscription_id, client_id, workspace_id, freeze_days,
    freeze_start, freeze_end, resume_date, remaining_days_at_freeze,
    previous_end_date, extended_end_date, status, created_by
  )
  VALUES (
    v_sub.id, v_sub.client_id, v_sub.workspace_id, p_freeze_days,
    now(), now() + make_interval(days => p_freeze_days), v_resume_date, v_remaining,
    v_previous_end, v_extended_end, 'active', v_actor_id
  )
  RETURNING id INTO v_freeze_id;

  UPDATE public.subscriptions
  SET status = 'frozen',
      end_date = v_extended_end,
      freeze_start_date = CURRENT_DATE,
      freeze_end_date = v_resume_date,
      updated_at = now()
  WHERE id = v_sub.id;

  UPDATE public.clients
  SET subscription_status = 'frozen',
      subscription_end_date = v_extended_end,
      updated_at = now()
  WHERE id = v_client.id
    AND public.current_subscription_id(v_client.id) = v_sub.id;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role, action, entity_type, entity_id,
    entity_name, workspace_id, metadata
  )
  VALUES (
    v_actor_id, COALESCE(v_actor_name, 'Unknown'), 'platform_owner',
    'subscription_frozen', 'subscription', v_sub.id::text, v_client.full_name,
    v_sub.workspace_id,
    jsonb_build_object(
      'client_id', v_client.id,
      'freeze_id', v_freeze_id,
      'freeze_days', p_freeze_days,
      'remaining_days_at_freeze', v_remaining,
      'previous_end_date', v_previous_end,
      'extended_end_date', v_extended_end,
      'resume_date', v_resume_date
    )
  );

  INSERT INTO public.timeline_events (
    workspace_id, client_id, assigned_ybs_coach_id,
    event_type, title, description, actor_id, actor_name, metadata
  )
  VALUES (
    v_sub.workspace_id, v_client.id, v_client.assigned_ybs_coach_id,
    'subscription_frozen', 'Subscription Frozen',
    format('Subscription frozen for %s day(s); it resumes on %s.', p_freeze_days, v_resume_date),
    v_actor_id, COALESCE(v_actor_name, 'Unknown'),
    jsonb_build_object(
      'freeze_id', v_freeze_id,
      'freeze_days', p_freeze_days,
      'remaining_days_at_freeze', v_remaining
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'freeze_id', v_freeze_id,
    'subscription_id', v_sub.id,
    'client_id', v_client.id,
    'freeze_days', p_freeze_days,
    'remaining_days_at_freeze', v_remaining,
    'resume_date', v_resume_date,
    'end_date', v_extended_end
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.freeze_client_subscription(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.freeze_client_subscription(UUID, INTEGER) TO authenticated;

-- ============================================================
-- 3. FREEZE REVERSAL (backend safety valve, System Owner only)
-- ============================================================
-- Deliberately NOT surfaced as a first-class user action: it exists so a
-- mistaken freeze can be corrected safely (and so renewal never leaves an
-- orphaned freeze behind).
CREATE OR REPLACE FUNCTION public.cancel_client_freeze(
  p_freeze_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_name TEXT;
  v_freeze public.subscription_freezes%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_client public.clients%ROWTYPE;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Only the System Owner can cancel a freeze.';
  END IF;

  SELECT * INTO v_freeze FROM public.subscription_freezes WHERE id = p_freeze_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Freeze not found';
  END IF;

  IF v_freeze.status <> 'active' THEN
    RAISE EXCEPTION 'Only an active freeze can be cancelled (current status: %).', v_freeze.status;
  END IF;

  IF v_freeze.freeze_end <= now() THEN
    RAISE EXCEPTION 'This freeze has already ended; the subscription resumes automatically.';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE id = v_freeze.subscription_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription not found';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = v_freeze.client_id;

  UPDATE public.subscription_freezes
  SET status = 'cancelled',
      closed_at = now(),
      closed_by = v_actor_id,
      close_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
      updated_at = now()
  WHERE id = v_freeze.id;

  -- The period extension is undone: the cycle returns to its previous
  -- end date and resumes immediately.
  UPDATE public.subscriptions
  SET status = 'active',
      end_date = v_freeze.previous_end_date,
      freeze_start_date = NULL,
      freeze_end_date = NULL,
      updated_at = now()
  WHERE id = v_sub.id;

  UPDATE public.clients
  SET subscription_status = 'active',
      subscription_end_date = v_freeze.previous_end_date,
      updated_at = now()
  WHERE id = v_client.id
    AND v_client.status = 'active'
    AND public.current_subscription_id(v_client.id) = v_sub.id;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role, action, entity_type, entity_id,
    entity_name, workspace_id, metadata
  )
  VALUES (
    v_actor_id, COALESCE(v_actor_name, 'Unknown'), 'platform_owner',
    'subscription_freeze_cancelled', 'subscription', v_sub.id::text,
    COALESCE(v_client.full_name, 'Client'), v_sub.workspace_id,
    jsonb_build_object(
      'freeze_id', v_freeze.id,
      'client_id', v_freeze.client_id,
      'reason', p_reason,
      'restored_end_date', v_freeze.previous_end_date
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'freeze_id', v_freeze.id,
    'subscription_id', v_sub.id,
    'end_date', v_freeze.previous_end_date
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_client_freeze(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_client_freeze(UUID, TEXT) TO authenticated;

-- ============================================================
-- 4. RENEW (System Owner only)
-- ============================================================
-- Replaces the previous platform-owner-or-workspace-owner signature.
-- The old 2-argument function is dropped so PostgREST cannot resolve an
-- ambiguous overload; the new function keeps `p_extend_days` optional so
-- existing callers keep working.
DROP FUNCTION IF EXISTS public.renew_subscription(UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.renew_subscription(
  p_subscription_id UUID,
  p_package_id UUID DEFAULT NULL,
  p_extend_days INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_name TEXT;
  v_sub public.subscriptions%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_pkg public.packages%ROWTYPE;
  v_ws_status TEXT;
  v_new_package_id UUID;
  v_new_start DATE;
  v_new_end DATE;
  v_new_sub_id UUID;
  v_days INTEGER;
  v_payment_status TEXT;
  v_freeze public.subscription_freezes%ROWTYPE;
  v_closed_freeze_id UUID;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Only the System Owner can renew subscriptions.';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription not found';
  END IF;

  -- Deterministic pre-state: resume a freeze whose period already elapsed.
  PERFORM public.resume_due_subscription_freezes(v_sub.client_id);
  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id FOR UPDATE;

  IF v_sub.status = 'pending' THEN
    RAISE EXCEPTION 'This subscription has not been activated yet; activation happens once both plans are delivered.';
  ELSIF v_sub.status IN ('renewed', 'cancelled') THEN
    RAISE EXCEPTION 'A % subscription is a closed historical cycle and cannot be renewed.', v_sub.status;
  END IF;

  SELECT status INTO v_ws_status FROM public.workspaces WHERE id = v_sub.workspace_id;
  IF v_ws_status IS NULL OR v_ws_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot renew a subscription in a suspended or archived workspace.';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = v_sub.client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found';
  END IF;

  IF v_client.workspace_id IS DISTINCT FROM v_sub.workspace_id THEN
    RAISE EXCEPTION 'The subscription does not belong to the client''s workspace.';
  END IF;

  IF v_client.status IN ('archived', 'inactive') THEN
    RAISE EXCEPTION 'The client is % and cannot be renewed.', v_client.status;
  END IF;

  -- ------------------------------------------------------------
  -- Package resolution: explicit selection, otherwise the same package.
  -- Only packages owned by the client's OWN workspace may be selected.
  -- ------------------------------------------------------------
  v_new_package_id := COALESCE(p_package_id, v_sub.package_id);
  IF v_new_package_id IS NULL THEN
    RAISE EXCEPTION 'No package is linked to this subscription. Select a package to renew with.';
  END IF;

  SELECT * INTO v_pkg FROM public.packages WHERE id = v_new_package_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected package no longer exists.';
  END IF;

  IF p_package_id IS NOT NULL THEN
    IF v_pkg.workspace_id IS DISTINCT FROM v_sub.workspace_id THEN
      RAISE EXCEPTION 'The selected package does not belong to this client''s workspace.';
    END IF;
    IF v_pkg.is_active = false THEN
      RAISE EXCEPTION 'The selected package is not active.';
    END IF;
  END IF;

  -- ------------------------------------------------------------
  -- Freeze handling: never leave an orphaned active freeze pointing at a
  -- renewed historical cycle. The extension already granted by the freeze
  -- is preserved (the client keeps the paid days).
  -- ------------------------------------------------------------
  SELECT * INTO v_freeze
  FROM public.subscription_freezes
  WHERE subscription_id = v_sub.id AND status = 'active'
  ORDER BY freeze_start DESC
  LIMIT 1
  FOR UPDATE;

  IF v_freeze.id IS NOT NULL THEN
    UPDATE public.subscription_freezes
    SET status = 'completed',
        closed_at = now(),
        closed_by = v_actor_id,
        close_reason = 'closed_by_renewal',
        updated_at = now()
    WHERE id = v_freeze.id;

    UPDATE public.subscriptions
    SET status = 'active',
        freeze_start_date = NULL,
        freeze_end_date = NULL,
        updated_at = now()
    WHERE id = v_sub.id;

    SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id;
    v_closed_freeze_id := v_freeze.id;
  END IF;

  -- ------------------------------------------------------------
  -- Date rules (existing YBS convention: a live cycle's new period
  -- continues from its end date; an expired cycle restarts today).
  -- ------------------------------------------------------------
  IF v_sub.end_date IS NOT NULL AND v_sub.end_date >= CURRENT_DATE THEN
    v_new_start := v_sub.end_date;
  ELSE
    v_new_start := CURRENT_DATE;
  END IF;

  IF p_extend_days IS NOT NULL AND p_extend_days > 0 THEN
    v_new_end := v_new_start + p_extend_days;
  ELSE
    v_new_end := public.package_end_date(v_new_package_id, v_new_start);
    IF v_new_end IS NULL THEN
      -- Legacy fallback (no resolvable package duration): preserve the
      -- previous cycle length.
      v_days := GREATEST(
        1,
        COALESCE((v_sub.end_date - v_sub.start_date), 30)
      );
      v_new_end := v_new_start + v_days;
    END IF;
  END IF;

  IF v_new_end IS NULL OR v_new_end < v_new_start THEN
    RAISE EXCEPTION 'Could not compute the renewal period.';
  END IF;

  -- A new payment is only assumed settled when the cycle keeps the SAME
  -- package (the previous money still covers it).
  v_payment_status := CASE
    WHEN v_new_package_id IS NOT DISTINCT FROM v_sub.package_id
      THEN COALESCE(v_sub.payment_status, 'unpaid')
    ELSE 'unpaid'
  END;

  UPDATE public.subscriptions
  SET status = 'renewed', updated_at = now()
  WHERE id = v_sub.id;

  INSERT INTO public.subscriptions (
    workspace_id, client_id, package_id, package_name, price, currency,
    payment_status, start_date, end_date, status, features
  )
  VALUES (
    v_sub.workspace_id,
    v_sub.client_id,
    v_new_package_id,
    v_pkg.name,
    v_pkg.price,
    v_pkg.currency,
    v_payment_status,
    v_new_start,
    v_new_end,
    'active',
    COALESCE(v_pkg.features, '{}'::text[])
  )
  RETURNING id INTO v_new_sub_id;

  UPDATE public.clients
  SET subscription_status = 'active',
      subscription_end_date = v_new_end,
      package_name = v_pkg.name,
      updated_at = now()
  WHERE id = v_client.id;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role, action, entity_type, entity_id,
    entity_name, workspace_id, metadata
  )
  VALUES (
    v_actor_id, COALESCE(v_actor_name, 'Unknown'), 'platform_owner',
    'subscription_renewed', 'subscription', v_new_sub_id::text, v_pkg.name,
    v_sub.workspace_id,
    jsonb_build_object(
      'previous_subscription_id', v_sub.id,
      'client_id', v_client.id,
      'previous_package_id', v_sub.package_id,
      'previous_package_name', v_sub.package_name,
      'new_package_id', v_new_package_id,
      'new_package_name', v_pkg.name,
      'start_date', v_new_start,
      'end_date', v_new_end,
      'extend_days', p_extend_days,
      'closed_freeze_id', v_closed_freeze_id,
      'payment_status', v_payment_status
    )
  );

  -- Trigger 5: renewal form rules for the NEW cycle (unchanged).
  PERFORM public.evaluate_form_rules_for_renewal(v_client.id, v_new_sub_id);

  RETURN jsonb_build_object(
    'success', true,
    'subscription_id', v_new_sub_id,
    'previous_subscription_id', v_sub.id,
    'client_id', v_client.id,
    'package_id', v_new_package_id,
    'package_name', v_pkg.name,
    'start_date', v_new_start,
    'end_date', v_new_end,
    'closed_freeze_id', v_closed_freeze_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.renew_subscription(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renew_subscription(UUID, UUID, INTEGER) TO authenticated;

-- ============================================================
-- 5. MANUAL SUBSCRIPTION DATE OVERRIDE (System Owner only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.override_subscription_dates(
  p_subscription_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_name TEXT;
  v_sub public.subscriptions%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_new_start DATE;
  v_new_end DATE;
  v_recomputed BOOLEAN := false;
  v_old_start DATE;
  v_old_end DATE;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Only the System Owner can change subscription dates.';
  END IF;

  IF p_start_date IS NULL AND p_end_date IS NULL THEN
    RAISE EXCEPTION 'Provide a start date, an end date, or both.';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription not found';
  END IF;

  IF v_sub.status IN ('renewed', 'cancelled') THEN
    RAISE EXCEPTION 'A % subscription is a closed historical cycle and cannot be edited.', v_sub.status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscription_freezes
    WHERE subscription_id = v_sub.id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Cancel the active freeze before changing the subscription dates (freeze history is never silently rewritten).';
  END IF;

  v_old_start := v_sub.start_date;
  v_old_end := v_sub.end_date;

  v_new_start := COALESCE(p_start_date, v_sub.start_date);

  IF p_end_date IS NOT NULL THEN
    -- Rule 4 (both explicit) / Rule 3 (only end date).
    v_new_end := p_end_date;
  ELSE
    -- Rule 2: only the start date changed -> recompute the end date from
    -- the current package duration; fall back to preserving the previous
    -- period length when the package is unresolvable.
    v_new_end := public.package_end_date(v_sub.package_id, v_new_start);
    v_recomputed := true;
    IF v_new_end IS NULL THEN
      v_new_end := v_new_start + GREATEST(0, COALESCE((v_old_end - v_old_start), 0));
    END IF;
  END IF;

  IF v_new_end < v_new_start THEN
    RAISE EXCEPTION 'The subscription start date cannot be after the end date.';
  END IF;

  UPDATE public.subscriptions
  SET start_date = v_new_start,
      end_date = v_new_end,
      manually_adjusted = true,
      manual_adjusted_by = v_actor_id,
      manual_adjusted_at = now(),
      updated_at = now()
  WHERE id = v_sub.id;

  SELECT * INTO v_client FROM public.clients WHERE id = v_sub.client_id;

  IF v_client.id IS NOT NULL
     AND public.current_subscription_id(v_client.id) = v_sub.id
  THEN
    UPDATE public.clients
    SET subscription_end_date = v_new_end,
        subscription_status = CASE
          WHEN v_new_end < CURRENT_DATE THEN 'expired'
          WHEN v_sub.status = 'frozen' THEN 'frozen'
          WHEN v_client.status = 'active' AND v_client.activated_at IS NOT NULL THEN 'active'
          ELSE subscription_status
        END,
        updated_at = now()
    WHERE id = v_client.id;
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role, action, entity_type, entity_id,
    entity_name, workspace_id, metadata
  )
  VALUES (
    v_actor_id, COALESCE(v_actor_name, 'Unknown'), 'platform_owner',
    'subscription_dates_overridden', 'subscription', v_sub.id::text,
    COALESCE(v_client.full_name, 'Client'), v_sub.workspace_id,
    jsonb_build_object(
      'client_id', v_sub.client_id,
      'previous_start_date', v_old_start,
      'previous_end_date', v_old_end,
      'new_start_date', v_new_start,
      'new_end_date', v_new_end,
      'end_date_recomputed_from_package', v_recomputed
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'subscription_id', v_sub.id,
    'start_date', v_new_start,
    'end_date', v_new_end,
    'manually_adjusted', true
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.override_subscription_dates(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.override_subscription_dates(UUID, DATE, DATE) TO authenticated;

-- ============================================================
-- 6. ACTIVATION ANCHOR REPAIR (System Owner only)
-- ============================================================
-- Narrow recovery hook for a row whose client was activated but whose
-- cycle still holds the pre-activation window. This NEVER activates a
-- client on its own: it only re-anchors dates of an already-activated,
-- non-closed cycle, and it requires both plans to be delivered.
CREATE OR REPLACE FUNCTION public.repair_client_activation_anchor(p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_end DATE;
BEGIN
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Only the System Owner can repair an activation anchor.';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'Client not found';
  END IF;

  IF v_client.activated_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'client_not_activated');
  END IF;

  IF NOT (public.client_has_delivered_nutrition(v_client.id)
          AND public.client_has_delivered_workout(v_client.id)) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'plans_not_delivered');
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions
  WHERE id = public.current_subscription_id(v_client.id) FOR UPDATE;

  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_current_subscription');
  END IF;

  IF v_sub.status IN ('renewed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'closed_cycle');
  END IF;

  IF v_sub.start_date = v_client.activated_at::date THEN
    RETURN jsonb_build_object('success', true, 'changed', false, 'subscription_id', v_sub.id);
  END IF;

  v_end := public.package_end_date(v_sub.package_id, v_client.activated_at::date);
  IF v_end IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'package_unresolvable');
  END IF;

  UPDATE public.subscriptions
  SET start_date = v_client.activated_at::date,
      end_date = v_end,
      updated_at = now()
  WHERE id = v_sub.id;

  UPDATE public.clients
  SET subscription_end_date = v_end, updated_at = now()
  WHERE id = v_client.id;

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role, action, entity_type, entity_id,
    entity_name, workspace_id, metadata
  )
  VALUES (
    auth.uid(),
    COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
    'platform_owner',
    'subscription_activation_anchor_repaired', 'subscription', v_sub.id::text,
    v_client.full_name, v_sub.workspace_id,
    jsonb_build_object(
      'client_id', v_client.id,
      'previous_start_date', v_sub.start_date,
      'previous_end_date', v_sub.end_date,
      'new_start_date', v_client.activated_at::date,
      'new_end_date', v_end
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'changed', true,
    'subscription_id', v_sub.id,
    'start_date', v_client.activated_at::date,
    'end_date', v_end
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.repair_client_activation_anchor(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_client_activation_anchor(UUID) TO authenticated;

-- ============================================================
-- 7. READ-ONLY LIFECYCLE SUMMARY (single round trip, no N+1)
-- ============================================================
-- Powers the Client Detail Overview + Subscription tab. Trainers and
-- Workspace Owners receive the safe lifecycle fields only; price /
-- payment_status are returned solely to the System Owner, the Workspace
-- Owner and the client themselves.
CREATE OR REPLACE FUNCTION public.client_subscription_summary(p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_pkg public.packages%ROWTYPE;
  v_financials BOOLEAN;
  v_days INTEGER;
  v_active_freeze JSONB;
  v_history JSONB;
  v_freeze_count INTEGER := 0;
  v_frozen_days INTEGER := 0;
  v_pre_activation BOOLEAN;
BEGIN
  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'Client not found';
  END IF;

  IF NOT (
    public.is_platform_owner()
    OR public.is_workspace_owner(v_client.workspace_id)
    OR public.is_assigned_ybs_coach(v_client.id)
    OR public.is_client_self(v_client.id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to read this client''s subscription summary.';
  END IF;

  -- Idempotent: reflects an elapsed freeze immediately.
  PERFORM public.resume_due_subscription_freezes(v_client.id);

  v_financials := public.is_platform_owner()
    OR public.is_workspace_owner(v_client.workspace_id)
    OR public.is_client_self(v_client.id);

  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE id = public.current_subscription_id(v_client.id);

  IF v_sub.id IS NOT NULL THEN
    SELECT * INTO v_pkg FROM public.packages WHERE id = v_sub.package_id;
    v_days := public.subscription_remaining_days(v_sub.id);
  END IF;

  -- The countdown only runs once the client is activated AND the cycle is
  -- live. Anything else is reported as pre-activation.
  v_pre_activation := v_client.activated_at IS NULL
    OR v_sub.id IS NULL
    OR v_sub.status = 'pending';

  SELECT count(*), COALESCE(sum(f.freeze_days), 0)
  INTO v_freeze_count, v_frozen_days
  FROM public.subscription_freezes f
  WHERE f.client_id = v_client.id;

  SELECT jsonb_agg(x) INTO v_history
  FROM (
    SELECT jsonb_build_object(
      'id', f.id,
      'freeze_days', f.freeze_days,
      'freeze_start', f.freeze_start,
      'freeze_end', f.freeze_end,
      'resume_date', f.resume_date,
      'remaining_days_at_freeze', f.remaining_days_at_freeze,
      'previous_end_date', f.previous_end_date,
      'extended_end_date', f.extended_end_date,
      'status', f.status,
      'close_reason', f.close_reason,
      'created_at', f.created_at
    ) AS x
    FROM public.subscription_freezes f
    WHERE f.client_id = v_client.id
    ORDER BY f.freeze_start DESC
    LIMIT 50
  ) t;

  IF v_sub.id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', f.id,
      'freeze_days', f.freeze_days,
      'freeze_start', f.freeze_start,
      'freeze_end', f.freeze_end,
      'resume_date', f.resume_date,
      'remaining_days_at_freeze', f.remaining_days_at_freeze,
      'created_at', f.created_at
    ) INTO v_active_freeze
    FROM public.subscription_freezes f
    WHERE f.subscription_id = v_sub.id
      AND f.status = 'active'
    ORDER BY f.freeze_start DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'client_id', v_client.id,
    'workspace_id', v_client.workspace_id,
    'join_date', v_client.join_date,
    'approved_at', v_client.approved_at,
    'activated_at', v_client.activated_at,
    'client_status', v_client.status,
    'is_activated', (v_client.activated_at IS NOT NULL),
    'pre_activation', v_pre_activation,
    'can_view_financials', v_financials,
    'delivery', jsonb_build_object(
      'nutrition_delivered', public.client_has_delivered_nutrition(v_client.id),
      'workout_delivered', public.client_has_delivered_workout(v_client.id),
      'nutrition_delivered_at', (
        SELECT min(np.activated_at) FROM public.nutrition_plans np
        WHERE np.client_id = v_client.id
          AND np.status = 'active'
          AND np.is_archived = false
      ),
      'workout_delivered_at', (
        SELECT min(wp.delivered_at) FROM public.workout_plans wp
        WHERE wp.client_id = v_client.id
          AND wp.is_template = false
          AND wp.is_archived = false
      )
    ),
    'subscription', CASE WHEN v_sub.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_sub.id,
      'status', v_sub.status,
      'start_date', v_sub.start_date,
      'end_date', v_sub.end_date,
      'remaining_days', v_days,
      'manually_adjusted', v_sub.manually_adjusted,
      'manual_adjusted_at', v_sub.manual_adjusted_at,
      'package_id', v_sub.package_id,
      'package_name_snapshot', v_sub.package_name
    ) END,
    'package', CASE WHEN v_pkg.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_pkg.id,
      'name', v_pkg.name,
      'tier', v_pkg.tier,
      'price', CASE WHEN v_financials THEN v_pkg.price ELSE NULL END,
      'currency', v_pkg.currency,
      'duration', v_pkg.duration,
      'duration_unit', v_pkg.duration_unit,
      'features', v_pkg.features,
      'is_active', v_pkg.is_active
    ) END,
    'freeze', jsonb_build_object(
      'is_frozen', (v_active_freeze IS NOT NULL),
      'active', v_active_freeze,
      'count', v_freeze_count,
      'total_days', v_frozen_days,
      'history', COALESCE(v_history, '[]'::jsonb)
    ),
    'financials', CASE WHEN NOT v_financials THEN NULL ELSE jsonb_build_object(
      'price', v_sub.price,
      'currency', v_sub.currency,
      'payment_status', v_sub.payment_status
    ) END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_subscription_summary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_subscription_summary(UUID) TO authenticated;

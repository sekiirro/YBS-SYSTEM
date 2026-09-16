-- ============================================================
-- YBS SYSTEM: ACTIVATION-ANCHORED RECURRING FORMS (20260916000001)
--
-- Re-anchors weekly / biweekly form assignment to the client's
-- ACTIVATION date/time (public.clients.activated_at) instead of
-- "last assignment time":
--
--   * cycle N due date = activation_date + N * interval_days
--     (interval = the rule's configured recurrence_days: 7 / 14)
--   * only the CURRENTLY relevant due cycle is ever generated
--     (missed cycles are NOT back-filled)
--   * a deterministic per-cycle dedup key
--     'r:<rule>:c:<client>:d:<cycle due date YYYY-MM-DD>'
--     makes the flow idempotent across repeated sweeps, cron
--     restarts, and long downtimes (UNIQUE backstop untouched)
--   * ineligible clients (not active / no activation date) are a
--     clean no-op: NO empty assignment, NO exception
--
-- No table / column / constraint changes. This migration only
-- redefines the executor (public.assign_form_for_rule) and tightens
-- the recurring sweeper's candidate query to actually-activated
-- clients. legacy one-off triggers (approval / plans / renewal) are
-- byte-for-byte identical. The "sent form leaves the pending queue"
-- workflow is unchanged: assessment.submission_status flips to
-- submitted, the ledger mirrors it (sync trigger), and every
-- historical record is preserved — nothing is ever hard-deleted.
-- ============================================================

CREATE OR REPLACE FUNCTION public.assign_form_for_rule(
  p_rule_id UUID,
  p_client_id UUID,
  p_dedup_suffix TEXT DEFAULT '',
  p_next_due_interval_days INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
  v_client public.clients%ROWTYPE;
  v_template_name TEXT;
  v_snapshot JSONB;
  v_dedup TEXT;
  v_assessment_id UUID;
  v_next_due TIMESTAMPTZ;
  v_due_date DATE;
  v_cycle INTEGER;
  v_anchor DATE;
  v_interval INTEGER;
  v_workspace_id UUID;
  v_actor_id UUID;
  v_actor_name TEXT;
BEGIN
  v_actor_id := auth.uid();
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;

  SELECT * INTO v_rule
  FROM public.form_assignment_rules
  WHERE id = p_rule_id AND is_enabled = true;

  IF v_rule.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'rule_not_found_or_disabled');
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
  IF v_client.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'client_not_found');
  END IF;

  -- Audience: global rules apply to every workspace; scoped rules require
  -- an exact workspace match (server-side, never trusting frontend IDs).
  IF v_rule.workspace_id IS NOT NULL
     AND v_rule.workspace_id IS DISTINCT FROM v_client.workspace_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'audience_mismatch');
  END IF;

  -- Template must still exist and be active.
  IF v_rule.form_template_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'template_missing');
  END IF;

  SELECT name INTO v_template_name
  FROM public.assessment_templates
  WHERE id = v_rule.form_template_id AND is_active = true;

  IF v_template_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'template_inactive');
  END IF;

  -- Recurring cadence (weekly / biweekly): anchored to the client's
  -- ACTIVATION date, never to signup/registration, last assignment time,
  -- or template creation. Only the currently relevant cycle is generated
  -- (no back-fill of missed cycles), and the deterministic cycle key keeps
  -- repeated sweeps / restarts / downtime duplicate-free.
  IF v_rule.trigger_type IN ('weekly', 'biweekly') THEN
    IF v_client.status <> 'active' OR v_client.activated_at IS NULL THEN
      RETURN jsonb_build_object('success', false, 'reason', 'client_not_activated');
    END IF;

    v_anchor := v_client.activated_at::date;
    v_interval := COALESCE(p_next_due_interval_days, v_rule.recurrence_days, 7);

    -- Integer division on non-negative days == floor. cycle N's due date is
    -- activation + N * interval; once N >= 1 the interval has elapsed.
    v_cycle := (CURRENT_DATE - v_anchor) / v_interval;

    IF v_cycle < 1 THEN
      RETURN jsonb_build_object('success', false, 'reason', 'not_due_yet');
    END IF;

    -- This cycle's due date (what the client sees as Due) and the earliest
    -- moment the NEXT cycle becomes due (kept for ledger reporting parity).
    v_due_date := v_anchor + (v_cycle * v_interval);
    v_next_due := (v_anchor + ((v_cycle + 1) * v_interval))::timestamptz;

    -- Deterministic per-cycle identifier: client + rule + cycle due date.
    v_dedup := 'r:' || v_rule.id::text || ':c:' || p_client_id::text || ':d:' || to_char(v_due_date, 'YYYY-MM-DD');
  ELSIF length(COALESCE(p_dedup_suffix, '')) > 0 THEN
    v_dedup := 'r:' || v_rule.id::text || ':c:' || p_client_id::text || ':' || p_dedup_suffix;
  ELSE
    v_dedup := 'r:' || v_rule.id::text || ':c:' || p_client_id::text || ':';
  END IF;

  v_snapshot := public.form_template_snapshot(v_rule.form_template_id);
  v_workspace_id := v_client.workspace_id;

  INSERT INTO public.assessments (
    workspace_id,
    client_id,
    template_id,
    name,
    assigned_ybs_coach_id,
    due_date,
    submission_status,
    questions_snapshot
  )
  VALUES (
    v_workspace_id,
    p_client_id,
    v_rule.form_template_id,
    v_template_name,
    NULL, -- automatic assignments carry no coach (not coach-aware)
    v_due_date,
    'pending',
    v_snapshot
  )
  RETURNING id INTO v_assessment_id;

  -- Ledger insert is the single source of truth for dedup; the UNIQUE
  -- constraint is the race-proof backstop. Any duplicate rolls the
  -- freshly-created assessment back so nothing is orphaned.
  BEGIN
    INSERT INTO public.form_assignment_instances (
      rule_id, client_id, template_id, assessment_id, trigger_type,
      dedup_key, assigned_at, next_due_at, status
    )
    VALUES (
      v_rule.id, p_client_id, v_rule.form_template_id, v_assessment_id,
      v_rule.trigger_type, v_dedup, now(), v_next_due, 'assigned'
    );
  EXCEPTION WHEN unique_violation THEN
    DELETE FROM public.assessments WHERE id = v_assessment_id;
    RETURN jsonb_build_object('success', false, 'reason', 'duplicate');
  END;

  INSERT INTO public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, workspace_id, metadata)
  VALUES (
    v_actor_id,
    COALESCE(v_actor_name, 'System'),
    CASE WHEN public.is_platform_owner() THEN 'platform_owner' ELSE 'system' END,
    'automatic_form_assigned',
    'assessment',
    v_assessment_id::text,
    v_template_name,
    v_workspace_id,
    jsonb_build_object(
      'rule_id', v_rule.id,
      'rule_name', v_rule.name,
      'client_id', p_client_id,
      'template_id', v_rule.form_template_id,
      'trigger_type', v_rule.trigger_type,
      'cycle_number', v_cycle,
      'next_due_at', v_next_due,
      'due_date', v_due_date,
      'dedup_key', v_dedup
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'assessment_id', v_assessment_id,
    'next_due_at', v_next_due
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_form_for_rule(UUID, UUID, TEXT, INTEGER) FROM PUBLIC;

-- Tighten the recurring sweeper to only consider actually-activated active
-- clients. eligibility is re-verified inside the executor, so this is a
-- cheap candidate pre-filter, not a new rule.
CREATE OR REPLACE FUNCTION public.evaluate_due_recurring_form_rules()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
  v_client_id UUID;
BEGIN
  FOR v_rule IN
    SELECT r.* FROM public.form_assignment_rules r
    WHERE r.trigger_type IN ('weekly', 'biweekly')
      AND r.is_enabled = true
  LOOP
    FOR v_client_id IN
      SELECT c.id
      FROM public.clients c
      WHERE c.status = 'active'
        AND c.activated_at IS NOT NULL
        AND c.workspace_id IS NOT NULL
        AND (v_rule.workspace_id IS NULL OR c.workspace_id = v_rule.workspace_id)
    LOOP
      PERFORM public.assign_form_for_rule(v_rule.id, v_client_id, '', NULL);
    END LOOP;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.evaluate_due_recurring_form_rules() FROM PUBLIC;
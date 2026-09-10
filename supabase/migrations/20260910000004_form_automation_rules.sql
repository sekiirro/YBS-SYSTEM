-- ============================================================
-- YBS SYSTEM: FORM AUTOMATION RULES (MIGRATION 20260910000004)
-- Replaces the hardcoded master-intake auto-assignment with
-- configurable Form Assignment Rules.
--
--   * form_assignment_rules:   who gets which form, when.
--   * form_assignment_instances: per-client ledger of every
--     automatically-generated assignment (dedup + history).
--   * Triggers 1 (Client Approval), 4 (Nutrition + Workout
--     plan assigned), 5 (Subscription Renewal) + pg_cron
--     sweeps for weekly / biweekly cadences.
--   * RLS: rules are readable by Platform Owner / the owning
--     Workspace Owner; all writes go through SECURITY DEFINER
--     RPCs that re-check roles server-side.
--
-- The old hardcoded master-intake assignment in
-- public.on_client_application_approved() is replaced by
-- evaluation of client_approval rules. A default rule
-- ("Your First Step", template 00000000-0000-0000-0000-000000000101)
-- is seeded so existing behaviour is preserved out of the box.
-- ============================================================

-- ============================================================
-- SECTION 1: PHYSICAL TABLES
-- ============================================================

-- 1.1 Assignment rules
CREATE TABLE IF NOT EXISTS public.form_assignment_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
    -- NULL = the form this rule assigns; kept settable so a rule
    -- survives a template deletion (assignment is then skipped).
    form_template_id UUID REFERENCES public.assessment_templates(id) ON DELETE SET NULL,
    -- NULL = All Workspaces (Platform Owner only). Workspace Owner
    -- rules always store an explicit workspace (normalized server-side).
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    trigger_type TEXT NOT NULL CHECK (
        trigger_type IN ('client_approval', 'weekly', 'biweekly', 'nutrition_workout', 'subscription_renewal')
    ),
    -- Only meaningful for weekly / biweekly triggers.
    recurrence_days INTEGER CHECK (recurrence_days IS NULL OR recurrence_days IN (7, 14)),
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT form_rule_recurrence_matches_trigger CHECK (
        (trigger_type IN ('weekly', 'biweekly') AND recurrence_days IS NOT NULL)
        OR (trigger_type NOT IN ('weekly', 'biweekly') AND recurrence_days IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_form_rules_lookup
  ON public.form_assignment_rules (is_enabled, trigger_type, workspace_id)
  WHERE is_enabled = true;

-- 1.2 Assignment instances (per-client ledger + dedup)
CREATE TABLE IF NOT EXISTS public.form_assignment_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- SET NULL keeps history when a rule is deleted.
    rule_id UUID REFERENCES public.form_assignment_rules(id) ON DELETE SET NULL,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    -- Snapshot of the template at assignment time (may be orphaned).
    template_id UUID REFERENCES public.assessment_templates(id) ON DELETE SET NULL,
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    trigger_type TEXT NOT NULL CHECK (
        trigger_type IN ('client_approval', 'weekly', 'biweekly', 'nutrition_workout', 'subscription_renewal')
    ),
    -- Guarantee no double assignment by the same rule to the same client.
    --   approval / nutrition_workout -> 'r:<rule>:c:<client>:'
    --   subscription_renewal         -> 'r:<rule>:c:<client>:s:<subscription>'
    --   weekly / biweekly            -> 'r:<rule>:c:<client>:d:<YYYY-MM-DD>'
    dedup_key TEXT NOT NULL UNIQUE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Recurring triggers: earliest moment the SAME rule may assign again.
    next_due_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'submitted', 'reviewed', 'skipped')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_instances_client ON public.form_assignment_instances (client_id);
CREATE INDEX IF NOT EXISTS idx_form_instances_rule   ON public.form_assignment_instances (rule_id);
CREATE INDEX IF NOT EXISTS idx_form_instances_nextdue
  ON public.form_assignment_instances (client_id, rule_id, assigned_at);
CREATE INDEX IF NOT EXISTS idx_form_instances_nextdue_at
  ON public.form_assignment_instances (next_due_at)
  WHERE next_due_at IS NOT NULL;

-- ============================================================
-- SECTION 2: RLS (READ-ONLY TO THE ROLE AS AUTHORIZED)
-- Rule writes happen ONLY inside SECURITY DEFINER RPCs below.
-- ============================================================

ALTER TABLE public.form_assignment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_assignment_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "form_rules_select" ON public.form_assignment_rules;
CREATE POLICY "form_rules_select" ON public.form_assignment_rules
FOR SELECT TO authenticated
USING (
    public.is_platform_owner()
    OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
);

DROP POLICY IF EXISTS "form_rule_instances_select" ON public.form_assignment_instances;
CREATE POLICY "form_rule_instances_select" ON public.form_assignment_instances
FOR SELECT TO authenticated
USING (
    public.is_platform_owner()
    OR public.is_client_self(client_id)
    OR public.is_assigned_ybs_coach(client_id)
    OR EXISTS (
        SELECT 1 FROM public.clients c
        WHERE c.id = client_id
          AND c.workspace_id IS NOT NULL
          AND public.is_workspace_owner(c.workspace_id)
    )
);

GRANT SELECT ON public.form_assignment_rules TO authenticated;
GRANT SELECT ON public.form_assignment_instances TO authenticated;

-- ============================================================
-- SECTION 3: SHARED HELPERS
-- ============================================================

-- 3.1 Frozen question snapshot (identical shape to the old master-intake).
CREATE OR REPLACE FUNCTION public.form_template_snapshot(p_template_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', q.id,
      'sort_order', q.sort_order,
      'question_type', q.question_type,
      'label', q.label,
      'description', q.description,
      'required', q.required,
      'options', q.options,
      'conditional_rules', q.conditional_rules
    ) ORDER BY q.sort_order
  ), '[]'::jsonb)
  FROM public.assessment_questions q
  JOIN public.assessment_templates t ON t.id = q.template_id
  WHERE t.id = p_template_id
    AND t.is_active = true;
$$;

REVOKE EXECUTE ON FUNCTION public.form_template_snapshot(UUID) FROM PUBLIC;

-- 3.2 Resolve the workspace a rule should target.
--   * Platform Owner: NULL = All Workspaces; any explicit workspace is kept.
--   * Workspace Owner: "All Workspaces" resolves to their active workspace
--     (they can only manage workspaces they own); explicit workspace must
--     be one they own. Never trust the frontend to scope the rule.
CREATE OR REPLACE FUNCTION public.resolve_form_rule_workspace(p_workspace_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws_id UUID;
  v_actor_id UUID;
BEGIN
  v_actor_id := auth.uid();

  IF public.is_platform_owner() THEN
    RETURN p_workspace_id; -- NULL stays NULL (All Workspaces)
  END IF;

  -- Workspace Owners manage rules for workspaces they own. The caller must
  -- prove ownership of the resolved workspace (never trust frontend scope).
  v_ws_id := p_workspace_id;
  IF v_ws_id IS NULL THEN
    SELECT active_workspace_id INTO v_ws_id
    FROM public.profiles
    WHERE id = v_actor_id;
  END IF;

  IF v_ws_id IS NULL THEN
    RAISE EXCEPTION 'A Workspace must be selected for this rule. Please pick a workspace or set an active workspace first.';
  END IF;

  IF NOT public.is_workspace_owner(v_ws_id) THEN
    RAISE EXCEPTION 'You can only create rules for workspaces you own.';
  END IF;

  RETURN v_ws_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_form_rule_workspace(UUID) FROM PUBLIC;

-- 3.3 Normalize `recurrence_days` for a trigger type.
CREATE OR REPLACE FUNCTION public.rule_recurrence_days(p_trigger_type TEXT, p_recurrence_days INTEGER)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_trigger_type = 'weekly' THEN COALESCE(p_recurrence_days, 7)
    WHEN p_trigger_type = 'biweekly' THEN COALESCE(p_recurrence_days, 14)
    ELSE NULL
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.rule_recurrence_days(TEXT, INTEGER) FROM PUBLIC;

-- ============================================================
-- SECTION 4: CORE ASSIGNMENT EXECUTOR
-- ============================================================
-- Single entry point that turns a rule into a client-facing
-- assessment. Idempotent: dedup_key must never repeat.
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
  v_waiting BOOLEAN;
  v_assessment_id UUID;
  v_next_due TIMESTAMPTZ;
  v_due_date DATE;
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

  -- Recurring cadence gate: never re-assign before the previous cycle's
  -- next_due_at. Past / NULL next_due means the cadence has progressed.
  IF v_rule.trigger_type IN ('weekly', 'biweekly') THEN
    SELECT (fai.next_due_at IS NOT NULL AND fai.next_due_at > now()) INTO v_waiting
    FROM public.form_assignment_instances fai
    WHERE fai.rule_id = p_rule_id
      AND fai.client_id = p_client_id
    ORDER BY fai.assigned_at DESC
    LIMIT 1;

    IF v_waiting THEN
      RETURN jsonb_build_object('success', false, 'reason', 'not_due_yet');
    END IF;
  END IF;

  -- Build a cycle-scoped dedup key: recurring cycles carry a date so each
  -- cadence is unique; one-off events carry the caller's suffix (e.g. a
  -- specific subscription id for renewals) or nothing (approval / plans).
  IF v_rule.trigger_type IN ('weekly', 'biweekly') THEN
    v_dedup := 'r:' || v_rule.id::text || ':c:' || p_client_id::text || ':d:' || to_char(now(), 'YYYY-MM-DD');
  ELSIF length(COALESCE(p_dedup_suffix, '')) > 0 THEN
    v_dedup := 'r:' || v_rule.id::text || ':c:' || p_client_id::text || ':' || p_dedup_suffix;
  ELSE
    v_dedup := 'r:' || v_rule.id::text || ':c:' || p_client_id::text || ':';
  END IF;

  v_snapshot := public.form_template_snapshot(v_rule.form_template_id);
  v_workspace_id := v_client.workspace_id;

  IF v_rule.trigger_type IN ('weekly', 'biweekly') THEN
    v_next_due := now() + make_interval(days => COALESCE(p_next_due_interval_days, v_rule.recurrence_days, 7));
    v_due_date := v_next_due::date;
  ELSE
    v_next_due := NULL;
    v_due_date := NULL;
  END IF;

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
      'next_due_at', v_next_due,
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

-- ============================================================
-- SECTION 5: TRIGGER EVALUATORS (the five business events)
-- ============================================================

-- 5.1 Trigger 1: Client Approval. Called from
--     on_client_application_approved() (redefined at the bottom).
CREATE OR REPLACE FUNCTION public.evaluate_form_rules_for_approval(p_client_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
  v_ws_id UUID;
BEGIN
  SELECT workspace_id INTO v_ws_id FROM public.clients WHERE id = p_client_id;
  IF v_ws_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_rule IN
    SELECT r.* FROM public.form_assignment_rules r
    WHERE r.trigger_type = 'client_approval'
      AND r.is_enabled = true
      AND (r.workspace_id IS NULL OR r.workspace_id = v_ws_id)
  LOOP
    PERFORM public.assign_form_for_rule(v_rule.id, p_client_id, '', NULL);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.evaluate_form_rules_for_approval(UUID) FROM PUBLIC;

-- 5.2 Trigger 4: Nutrition + Workout BOTH assigned.
--     Fires when the plan-side event already committed (activate_plan RPC
--     and the workout_plans trigger below) and both conditions hold.
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

-- 5.3 Trigger 5: Subscription Renewal. dedup suffix carries the NEW
--     subscription id, so each renewal cycle assigns at most once.
CREATE OR REPLACE FUNCTION public.evaluate_form_rules_for_renewal(p_client_id UUID, p_subscription_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
  v_ws_id UUID;
BEGIN
  SELECT workspace_id INTO v_ws_id FROM public.clients WHERE id = p_client_id;
  IF v_ws_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_rule IN
    SELECT r.* FROM public.form_assignment_rules r
    WHERE r.trigger_type = 'subscription_renewal'
      AND r.is_enabled = true
      AND (r.workspace_id IS NULL OR r.workspace_id = v_ws_id)
  LOOP
    PERFORM public.assign_form_for_rule(v_rule.id, p_client_id, 's:' || p_subscription_id::text, NULL);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.evaluate_form_rules_for_renewal(UUID, UUID) FROM PUBLIC;

-- 5.4 Recurring sweeper: weekly / biweekly for every active client in the
--     rule's audience. The per-cycle next_due_at gate prevents duplicates.
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
        AND c.workspace_id IS NOT NULL
        AND (v_rule.workspace_id IS NULL OR c.workspace_id = v_rule.workspace_id)
    LOOP
      PERFORM public.assign_form_for_rule(v_rule.id, v_client_id, '', NULL);
    END LOOP;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.evaluate_due_recurring_form_rules() FROM PUBLIC;

-- 5.5 Assessment-submission mirror: keep the ledger status in sync when a
--     client submits / a staff member reviews an auto-generated form.
CREATE OR REPLACE FUNCTION public.sync_form_rule_instance_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.form_assignment_instances
  SET status = NEW.submission_status,
      updated_at = now()
  WHERE assessment_id = NEW.id
    AND status <> NEW.submission_status
    AND NEW.submission_status IN ('submitted', 'reviewed');
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_form_rule_instance_status() FROM PUBLIC;

DROP TRIGGER IF EXISTS trigger_sync_form_rule_instance_status ON public.assessments;
CREATE TRIGGER trigger_sync_form_rule_instance_status
  AFTER UPDATE OF submission_status ON public.assessments
  FOR EACH ROW
  WHEN (NEW.submission_status IN ('submitted', 'reviewed') AND OLD.submission_status IS DISTINCT FROM NEW.submission_status)
  EXECUTE FUNCTION public.sync_form_rule_instance_status();

-- ============================================================
-- SECTION 6: RULE MANAGEMENT RPCs (SECURITY DEFINER, role-checked)
-- ============================================================

-- 6.1 Create a rule
CREATE OR REPLACE FUNCTION public.create_form_assignment_rule(
  p_name TEXT,
  p_form_template_id UUID,
  p_trigger_type TEXT,
  p_workspace_id UUID DEFAULT NULL,
  p_recurrence_days INTEGER DEFAULT NULL,
  p_is_enabled BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws_id UUID;
  v_rec_days INTEGER;
  v_actor_id UUID;
  v_actor_name TEXT;
  v_role TEXT;
  v_rule_id UUID;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Rule name is required';
  END IF;

  IF p_form_template_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.assessment_templates WHERE id = p_form_template_id
  ) THEN
    RAISE EXCEPTION 'Please select a valid form template';
  END IF;

  v_rec_days := public.rule_recurrence_days(p_trigger_type, p_recurrence_days);
  v_ws_id := public.resolve_form_rule_workspace(p_workspace_id);

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;
  v_role := CASE WHEN public.is_platform_owner() THEN 'platform_owner' ELSE 'workspace_owner' END;

  INSERT INTO public.form_assignment_rules (
    name, form_template_id, workspace_id, trigger_type,
    recurrence_days, is_enabled, created_by
  )
  VALUES (
    btrim(p_name), p_form_template_id, v_ws_id, p_trigger_type,
    v_rec_days, p_is_enabled, v_actor_id
  )
  RETURNING id INTO v_rule_id;

  INSERT INTO public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, workspace_id, metadata)
  VALUES (
    v_actor_id, COALESCE(v_actor_name, 'Unknown'), v_role,
    'form_rule_created', 'form_assignment_rule', v_rule_id::text, btrim(p_name),
    v_ws_id,
    jsonb_build_object(
      'form_template_id', p_form_template_id,
      'trigger_type', p_trigger_type,
      'recurrence_days', v_rec_days,
      'is_enabled', p_is_enabled
    )
  );

  RETURN jsonb_build_object('success', true, 'rule_id', v_rule_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_form_assignment_rule(TEXT, UUID, TEXT, UUID, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_form_assignment_rule(TEXT, UUID, TEXT, UUID, INTEGER, BOOLEAN) TO authenticated;

-- 6.2 Update a rule (full-parameter write; caller must be the rule's owner)
CREATE OR REPLACE FUNCTION public.update_form_assignment_rule(
  p_rule_id UUID,
  p_name TEXT,
  p_form_template_id UUID,
  p_trigger_type TEXT,
  p_workspace_id UUID DEFAULT NULL,
  p_recurrence_days INTEGER DEFAULT NULL,
  p_is_enabled BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.form_assignment_rules%ROWTYPE;
  v_ws_id UUID;
  v_rec_days INTEGER;
  v_actor_id UUID;
  v_actor_name TEXT;
  v_role TEXT;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_existing FROM public.form_assignment_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rule not found';
  END IF;

  -- Authorization: platform owner manages everything; workspace owners only
  -- manage rules already scoped to a workspace they own.
  IF NOT (
    public.is_platform_owner()
    OR (v_existing.workspace_id IS NOT NULL AND public.is_workspace_owner(v_existing.workspace_id))
  ) THEN
    RAISE EXCEPTION 'Not authorized to update this rule';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Rule name is required';
  END IF;

  IF p_form_template_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.assessment_templates WHERE id = p_form_template_id
  ) THEN
    RAISE EXCEPTION 'Please select a valid form template';
  END IF;

  v_rec_days := public.rule_recurrence_days(p_trigger_type, p_recurrence_days);
  v_ws_id := public.resolve_form_rule_workspace(p_workspace_id);

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;
  v_role := CASE WHEN public.is_platform_owner() THEN 'platform_owner' ELSE 'workspace_owner' END;

  UPDATE public.form_assignment_rules
  SET name = btrim(p_name),
      form_template_id = p_form_template_id,
      trigger_type = p_trigger_type,
      workspace_id = v_ws_id,
      recurrence_days = v_rec_days,
      is_enabled = p_is_enabled,
      updated_at = now()
  WHERE id = p_rule_id;

  INSERT INTO public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, workspace_id, metadata)
  VALUES (
    v_actor_id, COALESCE(v_actor_name, 'Unknown'), v_role,
    'form_rule_updated', 'form_assignment_rule', p_rule_id::text, btrim(p_name),
    v_ws_id,
    jsonb_build_object(
      'form_template_id', p_form_template_id,
      'trigger_type', p_trigger_type,
      'recurrence_days', v_rec_days,
      'is_enabled', p_is_enabled
    )
  );

  RETURN jsonb_build_object('success', true, 'rule_id', p_rule_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_form_assignment_rule(UUID, TEXT, UUID, TEXT, UUID, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_form_assignment_rule(UUID, TEXT, UUID, TEXT, UUID, INTEGER, BOOLEAN) TO authenticated;

-- 6.3 Toggle a rule's enabled state (audit-friendly)
CREATE OR REPLACE FUNCTION public.set_form_assignment_rule_enabled(p_rule_id UUID, p_is_enabled BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.form_assignment_rules%ROWTYPE;
  v_actor_id UUID;
  v_actor_name TEXT;
  v_role TEXT;
  v_action TEXT;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_existing FROM public.form_assignment_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rule not found';
  END IF;

  IF NOT (
    public.is_platform_owner()
    OR (v_existing.workspace_id IS NOT NULL AND public.is_workspace_owner(v_existing.workspace_id))
  ) THEN
    RAISE EXCEPTION 'Not authorized to change this rule';
  END IF;

  UPDATE public.form_assignment_rules
  SET is_enabled = p_is_enabled, updated_at = now()
  WHERE id = p_rule_id;

  v_action := CASE WHEN p_is_enabled THEN 'form_rule_enabled' ELSE 'form_rule_disabled' END;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;
  v_role := CASE WHEN public.is_platform_owner() THEN 'platform_owner' ELSE 'workspace_owner' END;

  INSERT INTO public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, workspace_id, metadata)
  VALUES (
    v_actor_id, COALESCE(v_actor_name, 'Unknown'), v_role,
    v_action, 'form_assignment_rule', p_rule_id::text, v_existing.name,
    v_existing.workspace_id, jsonb_build_object('is_enabled', p_is_enabled)
  );

  RETURN jsonb_build_object('success', true, 'rule_id', p_rule_id, 'is_enabled', p_is_enabled);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_form_assignment_rule_enabled(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_form_assignment_rule_enabled(UUID, BOOLEAN) TO authenticated;

-- 6.4 Delete a rule (ledger rows keep their history via ON DELETE SET NULL)
CREATE OR REPLACE FUNCTION public.delete_form_assignment_rule(p_rule_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.form_assignment_rules%ROWTYPE;
  v_actor_id UUID;
  v_actor_name TEXT;
  v_role TEXT;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_existing FROM public.form_assignment_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rule not found';
  END IF;

  IF NOT (
    public.is_platform_owner()
    OR (v_existing.workspace_id IS NOT NULL AND public.is_workspace_owner(v_existing.workspace_id))
  ) THEN
    RAISE EXCEPTION 'Not authorized to delete this rule';
  END IF;

  DELETE FROM public.form_assignment_rules WHERE id = p_rule_id;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;
  v_role := CASE WHEN public.is_platform_owner() THEN 'platform_owner' ELSE 'workspace_owner' END;

  INSERT INTO public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, workspace_id, metadata)
  VALUES (
    v_actor_id, COALESCE(v_actor_name, 'Unknown'), v_role,
    'form_rule_deleted', 'form_assignment_rule', p_rule_id::text, v_existing.name,
    v_existing.workspace_id,
    jsonb_build_object('trigger_type', v_existing.trigger_type, 'form_template_id', v_existing.form_template_id)
  );

  RETURN jsonb_build_object('success', true, 'rule_id', p_rule_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_form_assignment_rule(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_form_assignment_rule(UUID) TO authenticated;

-- ============================================================
-- SECTION 7: SUBSCRIPTION RENEWAL RPC (Trigger 5 event path)
-- ============================================================
-- There is no pre-existing "renew" event, so this is the canonical one:
-- the current cycle is closed (status 'renewed') and a new active cycle
-- is opened on the same package; renewal-triggered form rules then run.
CREATE OR REPLACE FUNCTION public.renew_subscription(
  p_subscription_id UUID,
  p_extend_days INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_ws_status TEXT;
  v_days INTEGER;
  v_new_start DATE;
  v_new_end DATE;
  v_new_sub_id UUID;
  v_actor_id UUID;
  v_actor_name TEXT;
  v_role TEXT;
BEGIN
  v_actor_id := auth.uid();

  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription not found';
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_workspace_owner(v_sub.workspace_id)) THEN
    RAISE EXCEPTION 'Only Platform Owners and Workspace Owners can renew subscriptions.';
  END IF;

  SELECT status INTO v_ws_status FROM public.workspaces WHERE id = v_sub.workspace_id;
  IF v_ws_status IS NULL OR v_ws_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot renew a subscription in a suspended or archived workspace.';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = v_sub.client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found';
  END IF;

  -- New cycle length: explicit override > remaining days of current cycle.
  IF p_extend_days IS NOT NULL AND p_extend_days > 0 THEN
    v_days := p_extend_days;
  ELSIF v_sub.end_date IS NOT NULL AND v_sub.end_date > CURRENT_DATE THEN
    v_days := GREATEST(1, (v_sub.end_date - CURRENT_DATE)::int);
  ELSE
    v_days := 30;
  END IF;

  v_new_start := v_sub.end_date;
  v_new_end := v_sub.end_date + v_days;

  UPDATE public.subscriptions
  SET status = 'renewed', updated_at = now()
  WHERE id = v_sub.id;

  INSERT INTO public.subscriptions (
    workspace_id, client_id, package_id, package_name, price, currency,
    payment_status, start_date, end_date, status
  )
  VALUES (
    v_sub.workspace_id, v_sub.client_id, v_sub.package_id, v_sub.package_name,
    v_sub.price, v_sub.currency, COALESCE(v_sub.payment_status, 'paid'),
    v_new_start, v_new_end, 'active'
  )
  RETURNING id INTO v_new_sub_id;

  UPDATE public.clients
  SET subscription_status = 'active',
      subscription_end_date = v_new_end,
      updated_at = now()
  WHERE id = v_client.id;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;
  v_role := CASE WHEN public.is_platform_owner() THEN 'platform_owner' ELSE 'workspace_owner' END;

  INSERT INTO public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, workspace_id, metadata)
  VALUES (
    v_actor_id, COALESCE(v_actor_name, 'Unknown'), v_role,
    'subscription_renewed', 'subscription', v_new_sub_id::text, v_sub.package_name,
    v_sub.workspace_id,
    jsonb_build_object(
      'previous_subscription_id', v_sub.id,
      'client_id', v_client.id,
      'start_date', v_new_start,
      'end_date', v_new_end,
      'extend_days', v_days
    )
  );

  -- Trigger 5: evaluate renewal form rules for the NEW cycle.
  PERFORM public.evaluate_form_rules_for_renewal(v_client.id, v_new_sub_id);

  RETURN jsonb_build_object(
    'success', true,
    'subscription_id', v_new_sub_id,
    'client_id', v_client.id,
    'end_date', v_new_end
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.renew_subscription(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renew_subscription(UUID, INTEGER) TO authenticated;

-- ============================================================
-- SECTION 8: TRIGGER 4 WORKOUT EVENT + RE-DEFINED EXISTING FUNCTIONS
-- ============================================================

-- 8.1 Workout plan assigned to a client -> check the nutrition_workout rule.
CREATE OR REPLACE FUNCTION public.evaluate_form_rules_on_workout_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.client_id IS NOT NULL AND NEW.is_template = false AND NEW.is_archived = false THEN
    PERFORM public.evaluate_form_rules_for_plan_assignment(NEW.client_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.evaluate_form_rules_on_workout_assigned() FROM PUBLIC;

DROP TRIGGER IF EXISTS trigger_evaluate_form_rules_on_workout ON public.workout_plans;
CREATE TRIGGER trigger_evaluate_form_rules_on_workout
  AFTER INSERT OR UPDATE OF client_id, is_template, is_archived ON public.workout_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.evaluate_form_rules_on_workout_assigned();

-- 8.2 Re-define activate_plan: identical behaviour, plus evaluation of
--     nutrition_workout rules (nutrition side of the "both plans assigned" event).
--     The workout side is handled by the workout_plans trigger above.
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

  IF NOT (
    public.is_platform_owner()
    OR public.is_workspace_owner(v_plan.workspace_id)
    OR v_plan.assigned_ybs_coach_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to activate this plan';
  END IF;

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

  PERFORM public.evaluate_form_rules_for_plan_assignment(p_client_id);

  RETURN jsonb_build_object(
    'success', true,
    'plan_id', p_plan_id,
    'message', 'Plan activated and assigned successfully'
  );
END;
$$;

-- 8.3 Re-define on_client_application_approved: the hardcoded master-intake
--     block is replaced by evaluation of client_approval rules. All client /
--     subscription lifecycle handling is preserved byte-for-byte.
CREATE OR REPLACE FUNCTION public.on_client_application_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  UPDATE public.clients c
  SET status = 'pending',
      approved_at = now(),
      subscription_status = CASE
        WHEN EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.client_id = c.id AND s.status = 'pending')
        THEN 'no_subscription'
        ELSE c.subscription_status
      END,
      updated_at = now()
  WHERE c.id = NEW.created_client_id
    AND c.status = 'active';

  SELECT workspace_id INTO v_workspace_id
  FROM public.clients
  WHERE id = NEW.created_client_id;

  UPDATE public.subscriptions s
  SET status = 'pending',
      updated_at = now()
  WHERE s.client_id = NEW.created_client_id
    AND s.status = 'active';

  -- Configured client-approval form rules (replaces the hardcoded intake;
  -- the seeded default rule below preserves the original behaviour).
  PERFORM public.evaluate_form_rules_for_approval(NEW.created_client_id);

  RETURN NEW;
END;
$$;

-- ============================================================
-- SECTION 9: SEED DEFAULT "YOUR FIRST STEP" RULE
-- ============================================================
-- Idempotent: only seeded if the platform-wide client_approval rule for the
-- master intake template does not already exist (manual creation/editing by
-- a Platform Owner is never overwritten).
INSERT INTO public.form_assignment_rules (
  name, form_template_id, workspace_id, trigger_type,
  recurrence_days, is_enabled, created_by
)
SELECT
  'Your First Step',
  id,
  NULL,
  'client_approval',
  NULL,
  true,
  NULL
FROM public.assessment_templates
WHERE id = '00000000-0000-0000-0000-000000000101'
  AND NOT EXISTS (
    SELECT 1 FROM public.form_assignment_rules
    WHERE form_template_id = '00000000-0000-0000-0000-000000000101'
      AND trigger_type = 'client_approval'
      AND workspace_id IS NULL
  );

-- ============================================================
-- SECTION 10: RECURRING WEEKLY / BIWEEKLY SWEEPER (pg_cron)
-- ============================================================
-- Runs every day at 06:00 UTC. The executor's next_due_at gate keeps each
-- client/rule cycle on cadence and duplicate-free. SECURITY DEFINER means
-- the cron job runs with the owning (postgres) role, bypassing RLS.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $cron_body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ybs-form-automation-daily') THEN
    PERFORM cron.schedule(
      'ybs-form-automation-daily',
      '0 6 * * *',
      $cron$SELECT public.evaluate_due_recurring_form_rules();$cron$
    );
  END IF;
END;
$cron_body$;
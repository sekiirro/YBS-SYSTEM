-- ============================================================
-- YBS SYSTEM: AUTHORIZED MANUAL ACTIVATION OVERRIDE
-- (MIGRATION 20260920000004)
--
-- Complements 20260920000002 (guard + reconciliation). The
-- plan-delivery rule is structural, but a Platform/Workspace Owner may
-- still need to activate a client whose required plans are not yet in
-- delivered state (e.g. recovering a member experience, onboarding a
-- returning client). That decision must be:
--   - explicit (UI warning + owner confirmation),
--   - gated (Platform Owner or Workspace Owner of the client's workspace),
--   - durable (clients.activation_source = 'manual_override'),
--   - audited (audit_logs 'client_manually_activated'),
--   - and exempt from the automatic reconciliation sweep (reconciliation
--     must never undo an intentional override).
-- It must NOT weaken the structural backstop: a plain INSERT/UPDATE that
-- sets status='active' WITHOUT the override flag is still coerced to
-- 'pending' by trg_guard_client_activate.
--
-- Mechanism: the ONLY writer of the transaction-scoped configuration
-- flag 'ybs.manual_activation' is the new SECURITY DEFINER RPC
-- override_activate_client(). It is set immediately before the client
-- UPDATE inside the same transaction, and the redefined guard trigger
-- honors it (also stamping activation_source defensively). Outside that
-- RPC the flag is never set, so an ad-hoc UPDATE is coerced to
-- 'pending' as before; any illegitimate flag+UPDATE attempt that slips
-- through leaves no marker and is swept back to 'pending' by
-- reconcile_client_activation().
--
-- Apply ONLY this file via:
--   supabase db query --linked -f supabase/migrations/20260920000004_manual_activation_override.sql
-- (never a bare `supabase db push` — it would also run the forbidden
-- 20260917000001 cleanup migration).
-- ============================================================

-- ============================================================
-- PART 1: DURABLE OVERRIDE MARKER
-- ============================================================
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS activation_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'clients_activation_source_check'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_activation_source_check
      CHECK (activation_source IS NULL OR activation_source = 'manual_override');
  END IF;
END $$;

COMMENT ON COLUMN public.clients.activation_source IS
  'NULL = activation driven purely by delivered plans; ''manual_override'' = a Platform/Workspace Owner intentionally activated this client without the delivered plans. Rows marked manual_override are excluded from reconcile_client_activation().';

-- ============================================================
-- PART 2: OVERRIDE FLAG HELPER
-- ============================================================
-- Reads the transaction-scoped flag set exclusively by
-- override_activate_client(). Any other caller sees 'off'.
CREATE OR REPLACE FUNCTION public.manual_activation_override_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(current_setting('ybs.manual_activation', true), 'off') = 'on';
$$;

REVOKE EXECUTE ON FUNCTION public.manual_activation_override_active() FROM PUBLIC;

-- ============================================================
-- PART 3: GUARD HONORS THE AUTHORIZED OVERRIDE
-- ============================================================
-- Behavior is unchanged for every other path: INSERT with status='active'
-- is coerced to 'pending'; UPDATE to 'active' is coerced to 'pending'
-- unless client_required_plans_delivered(). Only the transaction that
-- override_activate_client() armed may promote to 'active'; the guard
-- also stamps the durable marker so the reconciliation exemption can
-- never be bypassed by a stray path.
CREATE OR REPLACE FUNCTION public.guard_client_activate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  -- Authorized manual activation override. The flag is only ever set by
  -- override_activate_client() (owner-gated, marker + audit written).
  IF public.manual_activation_override_active() THEN
    NEW.activation_source := 'manual_override';
    RETURN NEW;
  END IF;

  -- A brand-new client cannot have delivered plans yet; start in the
  -- 'pending' pre-activation state (does not consume active capacity).
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    RETURN NEW;
  END IF;

  -- UPDATE path: promotion to 'active' requires the delivered plans.
  IF NOT public.client_required_plans_delivered(COALESCE(NEW.id, OLD.id)) THEN
    NEW.status := 'pending';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_client_activate() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_client_activate ON public.clients;
CREATE TRIGGER trg_guard_client_activate
  BEFORE INSERT OR UPDATE OF status ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_client_activate();

-- ============================================================
-- PART 4: APPROVED OVERRIDE RPC (the ONLY override writer)
-- ============================================================
-- Platform Owner or the Workspace Owner of the client's workspace. It
-- arms the transaction-scoped flag, promotes the client to 'active'
-- (activated_at now()), writes the durable marker + audit row, and
-- best-effort activates the latest status='pending' subscription (same
-- re-anchoring as auto_activate_client(): today start + package length).
-- If no pending subscription exists, the lifecycle is activated without
-- touching billing rows. Idempotent: an already-active client returns
-- already_active.
CREATE OR REPLACE FUNCTION public.override_activate_client(p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_ws_status TEXT;
  v_sub public.subscriptions%ROWTYPE;
  v_end_date DATE;
  v_nutrition BOOLEAN;
  v_workout BOOLEAN;
BEGIN
  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'Client % not found.', p_client_id;
  END IF;

  -- Gate: Platform Owner or the Workspace Owner of the client's
  -- workspace. The database-operator session (auth.uid() IS NULL) is also
  -- allowed, mirroring reconcile_client_activation() — that session is
  -- only reachable by the owning role and is how this override is
  -- executed -- but it does NOT bypass the structural guard: a raw
  -- UPDATE to 'active' without the flag is still coerced to 'pending'.
  IF NOT (public.is_platform_owner() OR public.is_workspace_owner(v_client.workspace_id) OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Only Platform Owners and Workspace Owners can manually override client activation.';
  END IF;

  SELECT status INTO v_ws_status FROM public.workspaces WHERE id = v_client.workspace_id;
  IF v_ws_status IS NULL OR v_ws_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot activate a client in a suspended or archived workspace.';
  END IF;

  IF v_client.status = 'active' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_active', true,
      'client_code', v_client.client_code,
      'activation_source', v_client.activation_source
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.nutrition_plans np
    WHERE np.client_id = p_client_id AND np.status = 'active' AND np.is_archived = false
  ) INTO v_nutrition;

  SELECT EXISTS (
    SELECT 1 FROM public.workout_plans wp
    WHERE wp.client_id = p_client_id AND wp.is_template = false AND wp.is_archived = false
  ) INTO v_workout;

  -- Best-effort: latest pending cycle becomes active and re-anchors from
  -- today (mirrors auto_activate_client). No pending cycle -> lifecycle
  -- only, billing rows untouched.
  SELECT * INTO v_sub
  FROM public.subscriptions s
  WHERE s.client_id = p_client_id AND s.status = 'pending'
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF v_sub.id IS NOT NULL THEN
    v_end_date := public.package_end_date(v_sub.package_id, CURRENT_DATE);
    IF v_end_date IS NULL THEN
      v_end_date := v_sub.end_date;
    END IF;
    UPDATE public.subscriptions s
    SET status = 'active',
        payment_status = CASE WHEN s.payment_status = 'unpaid' THEN 'paid' ELSE s.payment_status END,
        start_date = CURRENT_DATE,
        end_date = COALESCE(v_end_date, s.end_date),
        updated_at = now()
    WHERE s.id = v_sub.id;
  END IF;

  -- Arm the transaction-scoped override flag BEFORE the client update so
  -- the guard allows promotion to 'active' and stamps the marker.
  PERFORM set_config('ybs.manual_activation', 'on', true);

  UPDATE public.clients
  SET status = 'active',
      activated_at = now(),
      approved_at = COALESCE(v_client.approved_at, now()),
      activation_source = 'manual_override',
      subscription_status = CASE WHEN v_sub.id IS NOT NULL THEN 'active' ELSE v_client.subscription_status END,
      subscription_end_date = COALESCE(v_end_date, v_client.subscription_end_date),
      package_name = COALESCE(v_sub.package_name, v_client.package_name),
      updated_at = now()
  WHERE id = p_client_id;

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role, action,
    entity_type, entity_id, entity_name, workspace_id, metadata
  )
  VALUES (
    auth.uid(),
    COALESCE((SELECT p.full_name FROM public.profiles p WHERE p.id = auth.uid()), 'Platform'),
    'platform_owner',
    'client_manually_activated',
    'client',
    v_client.id,
    v_client.full_name,
    v_client.workspace_id,
    jsonb_build_object(
      'client_code', v_client.client_code,
      'manual_override', true,
      'required_plans_delivered', false,
      'nutrition_delivered', v_nutrition,
      'workout_delivered', v_workout,
      'subscription_id', v_sub.id,
      'subscription_activated', v_sub.id IS NOT NULL,
      'reason', 'Manual activation override — required plans not delivered'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'already_active', false,
    'client_code', v_client.client_code,
    'activation_source', 'manual_override',
    'subscription_id', v_sub.id,
    'subscription_activated', v_sub.id IS NOT NULL,
    'activated_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.override_activate_client(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.override_activate_client(UUID) TO authenticated;

-- ============================================================
-- PART 5: READINESS REPORT FOR THE UI WARNING
-- ============================================================
-- Pure boolean report (no delivery-sensitive leakage beyond what the
-- client owner already sees on the Forms Plan Delivery column).
CREATE OR REPLACE FUNCTION public.client_activation_readiness(p_client_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'required_plans_delivered', public.client_required_plans_delivered(p_client_id),
    'nutrition_delivered', EXISTS (
      SELECT 1 FROM public.nutrition_plans np
      WHERE np.client_id = p_client_id AND np.status = 'active' AND np.is_archived = false
    ),
    'workout_delivered', EXISTS (
      SELECT 1 FROM public.workout_plans wp
      WHERE wp.client_id = p_client_id AND wp.is_template = false AND wp.is_archived = false
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.client_activation_readiness(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_activation_readiness(UUID) TO authenticated;

-- ============================================================
-- PART 6: RECONCILIATION EXEMPTS INTENTIONAL OVERRIDES
-- ============================================================
-- Both dry-run and apply exclude clients whose activation was an
-- explicit manual override, so the automatic sweep can never undo an
-- intentional owner decision. Everything else is unchanged (still
-- platform-owner only, still parks active subscriptions, still audits).
CREATE OR REPLACE FUNCTION public.reconcile_client_activation(p_apply boolean DEFAULT false)
RETURNS TABLE (
  client_id UUID,
  client_code TEXT,
  full_name TEXT,
  workspace_id UUID,
  action TEXT,
  detail TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_parked_subs INTEGER;
  v_demoted_count INTEGER := 0;
  v_parked_sub_count INTEGER := 0;
  v_result JSONB;
BEGIN
  IF NOT (public.is_platform_owner() OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Only Platform Owners can reconcile client activation state.';
  END IF;

  IF p_apply THEN
    FOR r IN
      SELECT c.id, c.client_code, c.full_name, c.workspace_id
      FROM public.clients c
      WHERE c.status = 'active'
        AND NOT public.client_required_plans_delivered(c.id)
        AND (c.activation_source IS DISTINCT FROM 'manual_override')
      ORDER BY c.workspace_id, c.client_code
    LOOP
      UPDATE public.subscriptions s
      SET status = 'pending',
          updated_at = now()
      WHERE s.client_id = r.id
        AND s.status = 'active';
      GET DIAGNOSTICS v_parked_subs = ROW_COUNT;
      IF v_parked_subs > 0 THEN
        UPDATE public.clients
        SET subscription_status = 'no_subscription'
        WHERE id = r.id;
      END IF;

      UPDATE public.clients
      SET status = 'pending',
          activated_at = NULL,
          updated_at = now()
      WHERE id = r.id;

      v_demoted_count := v_demoted_count + 1;
      v_parked_sub_count := v_parked_sub_count + v_parked_subs;

      client_id := r.id;
      client_code := r.client_code;
      full_name := r.full_name;
      workspace_id := r.workspace_id;
      action := 'demoted_to_pending';
      detail := 'required plans not delivered; subscriptions parked: ' || v_parked_subs::text;
      RETURN NEXT;
    END LOOP;
  ELSE
    FOR r IN
      SELECT c.id, c.client_code, c.full_name, c.workspace_id
      FROM public.clients c
      WHERE c.status = 'active'
        AND NOT public.client_required_plans_delivered(c.id)
        AND (c.activation_source IS DISTINCT FROM 'manual_override')
      ORDER BY c.workspace_id, c.client_code
    LOOP
      client_id := r.id;
      client_code := r.client_code;
      full_name := r.full_name;
      workspace_id := r.workspace_id;
      action := 'dry_run_demote';
      detail := 'required plans not delivered (would move to pending)';
      RETURN NEXT;
    END LOOP;
  END IF;

  IF p_apply THEN
    v_result := jsonb_build_object(
      'demoted_clients', v_demoted_count,
      'parked_subscriptions', v_parked_sub_count,
      'rule', 'required_plans_delivered (nutrition + workout); manual overrides excluded'
    );
    INSERT INTO public.audit_logs (
      actor_id, actor_name, actor_role, action,
      entity_type, entity_id, entity_name, workspace_id, metadata
    )
    VALUES (
      auth.uid(),
      COALESCE((SELECT p.full_name FROM public.profiles p WHERE p.id = auth.uid()), 'Platform'),
      'platform_owner',
      'client_activation_reconciled',
      'client',
      NULL,
      'Client activation reconciliation',
      NULL,
      v_result
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_client_activation(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_client_activation(BOOLEAN) TO authenticated;

-- ============================================================
-- PART 7: MIGRATION-TIME DRY-RUN (no writes)
-- ============================================================
-- Re-asserts the post-reconciliation invariant BEFORE the override
-- feature ships: any active client without delivered plans that is NOT
-- intentionally overridden should be reported (historical overrides do
-- not exist yet, so this should print zero).
DO $$
DECLARE
  r RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT c.client_code, c.full_name, c.workspace_id
    FROM public.clients c
    WHERE c.status = 'active'
      AND NOT public.client_required_plans_delivered(c.id)
      AND (c.activation_source IS DISTINCT FROM 'manual_override')
    ORDER BY c.workspace_id, c.client_code
  LOOP
    v_count := v_count + 1;
    RAISE NOTICE 'OVERRIDE MIGRATION DRY-RUN -> client % (%) workspace % is active without delivered plans and NOT override-marked', r.client_code, r.full_name, r.workspace_id;
  END LOOP;
  RAISE NOTICE 'OVERRIDE MIGRATION DRY-RUN -> % client(s) active without delivered plans and NOT override-marked', v_count;
END $$;
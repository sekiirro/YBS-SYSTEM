-- ============================================================
-- YBS SYSTEM: CLIENT ACTIVATION GATE + RECONCILIATION
-- (MIGRATION 20260920000002)
--
-- Business rule: a client may only be 'Active' once every required
-- plan has actually been DELIVERED. The required-plan set is exactly
-- what the Forms page Plan Delivery column (get_forms_with_delivery)
-- derives — BOTH the Nutrition plan AND the Workout plan must exist in
-- delivered state. Submitting an assessment or being approved/paid
-- NEVER activates a client on its own.
--
-- Root cause fixed here: every client-creation/approval path created
-- the client row with status='active' at INSERT
--   - approve_client_application (20260905000010, line ~738)
--   - approve_client_application (20260903000005, line ~191)
--   - create_client_with_override (20260904000007, default 'active')
--   - the clients.status column DEFAULT 'active'
-- and the ONLY protection was an AFTER-UPDATE trigger
-- (on_client_application_approved) which downgrades to 'pending' when
-- an application flips to 'approved'. Rows never passing through that
-- event (or created before the trigger existed) stay wrongfully
-- 'active' forever — e.g. YBS-6895, Active since approval with no
-- delivered plans. The plan-delivery gate on activate_client_package /
-- auto_activate_client (20260914000001) cannot help because those
-- functions were never invoked for such rows.
--
-- Part 1 -> client_required_plans_delivered(): the single shared
--           delivery authority (identical semantics to
--           get_forms_with_delivery / auto_activate_client / Part 4).
-- Part 2 -> DB-level guard: clients.status may become 'active' only
--           when the required plans are delivered. INSERT always forces
--           'pending' (a brand-new client has no delivered plans).
--           This backstop makes the rule structural for every write
--           path (existing flows, direct SQL, future code).
-- Part 3 -> reconcile_client_activation(dry_run|apply): idempotent,
--           platform-owner-only repair. Dry-run first reports exactly
--           which clients are wrongly active; apply mode demotes them
--           to the pre-activation 'pending' lifecycle state and parks
--           their current active subscription to 'pending' (mirroring
--           on_client_application_approved) so the canonical
--           auto_activate_client() re-anchors the cycle at real
--           activation. Genuinely-delivered clients are never touched.
--
-- Apply ONLY this file via:
--   supabase db query --linked -f supabase/migrations/20260920000002_client_activation_gate_and_reconciliation.sql
-- (never a bare `supabase db push` — it would also run the forbidden
-- 20260917000001 cleanup migration).
-- ============================================================

-- ============================================================
-- PART 1: SHARED DELIVERY AUTHORITY
-- ============================================================
-- Mirrors get_forms_with_delivery() exactly: nutrition delivered =
-- active non-archived nutrition plan; workout delivered = non-template
-- non-archived workout plan. The guard (Part 2) and the reconciliation
-- (Part 3) both derive activation solely from this boolean, so the
-- activation state and the Forms "Plan Delivery" column can never
-- disagree.
CREATE OR REPLACE FUNCTION public.client_required_plans_delivered(p_client_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.nutrition_plans np
    WHERE np.client_id = p_client_id AND np.status = 'active' AND np.is_archived = false
  ) AND EXISTS (
    SELECT 1 FROM public.workout_plans wp
    WHERE wp.client_id = p_client_id AND wp.is_template = false AND wp.is_archived = false
  );
$$;

REVOKE EXECUTE ON FUNCTION public.client_required_plans_delivered(UUID) FROM PUBLIC;

-- ============================================================
-- PART 2: ACTIVATION GUARD (structural backstop)
-- ============================================================
-- BEFORE INSERT OR UPDATE OF status: any write that would leave the
-- client 'active' is legal ONLY when the required plans are already
-- delivered. A fresh INSERT is always coerced to 'pending' (the
-- approved-but-not-activated lifecycle state). auto_activate_client()
-- and activate_client_package() deliberately set 'active' only after
-- verifying delivery, so they pass; every other path that tried the
-- old "create as active" shortcut now lands in 'pending'.
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
-- PART 3: IDEMPOTENT RECONCILIATION OF WRONGLY-ACTIVE CLIENTS
-- ============================================================
-- reconcile_client_activation():
--   * default (p_apply = false) -> DRY RUN: returns the exact list of
--     wrongly-active clients, no writes. Use this to report the
--     affected count FIRST.
--   * p_apply = true -> moves every wrongly-active client back to the
--     pre-activation 'pending' state, parks its current active
--     subscription to 'pending' (same semantics as the approval
--     trigger, so auto_activate_client() re-anchors the cycle when the
--     plans finally arrive), and writes one audit row. Clients whose
--     required plans ARE delivered are never touched.
-- Idempotent: approved-but-unactivated rows are 'pending', so re-runs
-- no-op. Platform Owner only.
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
  -- Auth scoped: Platform Owner over RPC. The database operator session
  -- (SQL editor / `supabase db query`, where auth.uid() IS NULL) is also
  -- allowed — it is only reachable by the owning role and is how the
  -- migration-time dry-run and admin reconciliation are executed.
  IF NOT (public.is_platform_owner() OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Only Platform Owners can reconcile client activation state.';
  END IF;

  -- Phase 1: clients currently 'active' whose required plans are NOT
  -- delivered -> wrongly active, must return to the pre-activation
  -- 'pending' state (subscription parked to 'pending' alongside, just
  -- like on_client_application_approved does).
  IF p_apply THEN
    FOR r IN
      SELECT c.id, c.client_code, c.full_name, c.workspace_id
      FROM public.clients c
      WHERE c.status = 'active'
        AND NOT public.client_required_plans_delivered(c.id)
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
    -- One aggregated audit row for the whole reconciliation run.
    v_result := jsonb_build_object(
      'demoted_clients', v_demoted_count,
      'parked_subscriptions', v_parked_sub_count,
      'rule', 'required_plans_delivered (nutrition + workout)'
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
-- PART 4: MIGRATION-TIME DRY-RUN REPORT (no writes)
-- ============================================================
-- Prints exactly which existing clients are wrongly active so the
-- affected count is known BEFORE anything is changed. Apply mode is
-- run separately by the operator:
--   SELECT * FROM public.reconcile_client_activation(true);
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
    ORDER BY c.workspace_id, c.client_code
  LOOP
    v_count := v_count + 1;
    RAISE NOTICE 'RECONCILE DRY-RUN -> client % (%) workspace % is active without delivered plans; should be pending', r.client_code, r.full_name, r.workspace_id;
  END LOOP;
  RAISE NOTICE 'RECONCILE DRY-RUN -> % client(s) are wrongly active (run SELECT * FROM public.reconcile_client_activation(true) to apply)', v_count;
END $$;
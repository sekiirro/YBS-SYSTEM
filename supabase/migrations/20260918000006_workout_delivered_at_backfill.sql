-- ============================================================
-- YBS SYSTEM: WORKOUT DELIVERY TIMESTAMP — HISTORICAL BACKFILL
-- Migration: 20260918000006_workout_delivered_at_backfill.sql
--
-- RUN THE READ-ONLY DRY RUN FIRST:
--     ybs-workout-delivery-dryrun.sql
-- and review the `exceptions` / `would_set_activated_at` /
-- `would_reanchor_dates` columns before applying this file.
--
-- WHAT THIS DOES (idempotent, re-runnable):
--   STEP 0  Report the evidence/exceptions in the migration output.
--   STEP 1  workout_plans.delivered_at for every already-delivered client
--           plan. The value is a RECONSTRUCTION from created_at (the row
--           is created already assigned to the client in every existing
--           code path) and is labelled
--           delivered_at_source = 'backfill_plan_created_at'. It is NOT
--           an exact delivery event timestamp — only rows stamped by the
--           trg_set_workout_delivered_at trigger are exact.
--   STEP 2  clients.activated_at for ACTIVE clients that have both
--           required plans delivered and NO ambiguity:
--             activation = GREATEST(nutrition delivered, workout delivered)
--           Ambiguity (skipped, never fabricated):
--             * missing plan(s)
--             * the workout is the SECOND plan and its own timestamp is
--               unreliable (the plan was edited more than a day after it
--               was created)
--   STEP 3  Re-anchors the CURRENT subscription cycle of exactly those
--           clients to the reconstructed activation date (that is the
--           canonical YBS lifecycle: the countdown starts at activation,
--           never at signup). Cycles that are already expired are
--           deliberately left untouched, and no client is ever
--           (re)activated by this migration.
--
-- NOT covered: clients whose evidence is missing or ambiguous keep
-- activated_at = NULL. Use the System Owner RPC
-- repair_client_activation_anchor(client_id) after a manual review.
-- ============================================================

-- ============================================================
-- STEP 0 + STEP 1: WORKOUT DELIVERY TIMESTAMPS
-- ============================================================
DO $step1$
DECLARE
  v_missing_nutrition INTEGER;
  v_missing_workout   INTEGER;
  v_missing_both      INTEGER;
  v_ambiguous         INTEGER;
  v_backfilled        INTEGER;
BEGIN
  SELECT
    count(*) FILTER (WHERE n.ts IS NULL AND w.ts IS NOT NULL),
    count(*) FILTER (WHERE n.ts IS NOT NULL AND w.ts IS NULL),
    count(*) FILTER (WHERE n.ts IS NULL AND w.ts IS NULL),
    count(*) FILTER (WHERE n.ts IS NOT NULL AND w.ts IS NOT NULL
                       AND w.edited_after_creation AND w.ts >= n.ts)
  INTO v_missing_nutrition, v_missing_workout, v_missing_both, v_ambiguous
  FROM public.clients c
  LEFT JOIN (
    SELECT np.client_id, min(np.activated_at) AS ts
    FROM public.nutrition_plans np
    WHERE np.client_id IS NOT NULL AND np.status = 'active' AND np.is_archived = false
    GROUP BY np.client_id
  ) n ON n.client_id = c.id
  LEFT JOIN (
    SELECT wp.client_id, min(wp.created_at) AS ts,
           bool_or(wp.updated_at > wp.created_at + interval '1 day') AS edited_after_creation
    FROM public.workout_plans wp
    WHERE wp.client_id IS NOT NULL AND wp.is_template = false AND wp.is_archived = false
    GROUP BY wp.client_id
  ) w ON w.client_id = c.id;

  RAISE NOTICE 'BACKFILL EVIDENCE — nutrition missing: %, workout missing: %, both missing: %, ambiguous: %',
    v_missing_nutrition, v_missing_workout, v_missing_both, v_ambiguous;

  -- STEP 1
  WITH delivered AS (
    SELECT wp.id,
           COALESCE(wp.created_at, wp.updated_at) AS ts,
           CASE
             WHEN wp.created_at IS NOT NULL THEN 'backfill_plan_created_at'
             ELSE 'backfill_plan_updated_at'
           END AS src
    FROM public.workout_plans wp
    WHERE wp.client_id IS NOT NULL
      AND wp.is_template = false
      AND wp.is_archived = false
      AND wp.delivered_at IS NULL
      AND COALESCE(wp.created_at, wp.updated_at) IS NOT NULL
  )
  UPDATE public.workout_plans wp
  SET delivered_at = d.ts,
      delivered_at_source = d.src
  FROM delivered d
  WHERE wp.id = d.id;

  GET DIAGNOSTICS v_backfilled = ROW_COUNT;
  RAISE NOTICE 'STEP 1 — workout_plans.delivered_at backfilled (reconstructed): % row(s)', v_backfilled;
END;
$step1$;

-- ============================================================
-- STEP 2 + STEP 3: ACTIVATION ANCHOR FOR UNAMBIGUOUS CLIENTS
-- ============================================================
DO $step23$
DECLARE
  v_activated  INTEGER := 0;
  v_reanchored INTEGER := 0;
BEGIN
  -- Only ACTIVE clients without an activation anchor and without any
  -- ambiguity are eligible. The workout timestamp is only required to be
  -- reliable when the workout is the SECOND (later) plan.
  DROP TABLE IF EXISTS ybs_backfill_targets;
  CREATE TEMP TABLE ybs_backfill_targets (
    client_id UUID PRIMARY KEY,
    anchor_date DATE NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO ybs_backfill_targets (client_id, anchor_date)
  SELECT c.id, GREATEST(n.ts, w.ts)::date
  FROM public.clients c
  JOIN (
    SELECT np.client_id, min(np.activated_at) AS ts
    FROM public.nutrition_plans np
    WHERE np.client_id IS NOT NULL
      AND np.status = 'active'
      AND np.is_archived = false
      AND np.activated_at IS NOT NULL
    GROUP BY np.client_id
  ) n ON n.client_id = c.id
  JOIN (
    SELECT wp.client_id,
           min(wp.delivered_at) AS ts,
           bool_or(wp.updated_at > wp.created_at + interval '1 day') AS edited_after_creation
    FROM public.workout_plans wp
    WHERE wp.client_id IS NOT NULL
      AND wp.is_template = false
      AND wp.is_archived = false
      AND wp.delivered_at IS NOT NULL
    GROUP BY wp.client_id
  ) w ON w.client_id = c.id
  WHERE c.activated_at IS NULL
    AND c.status = 'active'
    -- Ambiguity guard: the workout is the later plan AND its own
    -- timestamp cannot be trusted -> do not fabricate an activation.
    AND NOT (w.edited_after_creation AND w.ts >= n.ts);

  -- STEP 2: write the activation instant.
  UPDATE public.clients c
  SET activated_at = t.anchor_date::timestamptz,
      approved_at = COALESCE(c.approved_at, t.anchor_date::timestamptz),
      updated_at = now()
  FROM ybs_backfill_targets t
  WHERE c.id = t.client_id
    AND c.activated_at IS NULL;

  GET DIAGNOSTICS v_activated = ROW_COUNT;

  -- STEP 3: re-anchor the CURRENT cycle of exactly those clients. An
  -- already-expired cycle is left untouched (historical data is never
  -- rewritten and the client is never reactivated by a backfill).
  UPDATE public.subscriptions s
  SET start_date = t.anchor_date,
      end_date = COALESCE(public.package_end_date(s.package_id, t.anchor_date), s.end_date),
      updated_at = now()
  FROM ybs_backfill_targets t
  WHERE s.id = public.current_subscription_id(t.client_id)
    AND s.status IN ('active', 'frozen', 'pending')
    AND s.start_date IS DISTINCT FROM t.anchor_date
    AND NOT EXISTS (
      SELECT 1 FROM public.subscription_freezes f
      WHERE f.subscription_id = s.id AND f.status = 'active'
    )
    AND COALESCE(public.package_end_date(s.package_id, t.anchor_date), s.end_date) >= t.anchor_date;

  GET DIAGNOSTICS v_reanchored = ROW_COUNT;

  RAISE NOTICE 'STEP 2 — clients.activated_at backfilled: % client(s)', v_activated;
  RAISE NOTICE 'STEP 3 — subscription cycles re-anchored: % cycle(s)', v_reanchored;
END;
$step23$;

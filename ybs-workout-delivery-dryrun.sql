-- ============================================================
-- YBS SYSTEM: WORKOUT DELIVERY BACKFILL — READ-ONLY DRY RUN
-- (run BEFORE applying 20260918000006_workout_delivered_at_backfill.sql)
--
-- Safe to run at any time: SELECT only, no writes. It does NOT require
-- the new columns to exist yet — every proposed value is computed from
-- the columns that are already there.
--
-- Evidence rules used by the write migration:
--   nutrition delivery  = nutrition_plans.activated_at (EXACT, existing column)
--   workout delivery    = workout_plans.created_at, because a workout plan
--                         row is created already assigned to the client
--                         (client_id set) in every existing code path.
--                         This is a RECONSTRUCTION, not an exact event
--                         timestamp: a plan created as a template and
--                         assigned later would be stamped too early.
--                         Every reconstructed row is labelled
--                         delivered_at_source = 'backfill_plan_created_at'.
--   activation          = GREATEST(nutrition delivery, workout delivery),
--                         i.e. the moment the SECOND required plan existed.
--
-- exceptions column values:
--   missing_both_plans                  -> no delivery evidence at all
--   missing_nutrition                   -> workout only (never activated)
--   missing_workout                     -> nutrition only (never activated)
--   ambiguous_workout_is_second_plan    -> the workout is the SECOND plan and
--                                          its own timestamp is not reliable
--                                          (edited > 1 day after creation),
--                                          so the activation instant cannot be
--                                          reconstructed: no activation /
--                                          date backfill will be applied.
-- ============================================================
WITH workout_evidence AS (
  SELECT wp.client_id,
         min(wp.created_at)                                      AS ts,
         min(wp.updated_at)                                      AS min_updated_at,
         count(*)                                                AS plan_count,
         bool_or(wp.updated_at > wp.created_at + interval '1 day') AS edited_after_creation
  FROM public.workout_plans wp
  WHERE wp.client_id IS NOT NULL
    AND wp.is_template = false
    AND wp.is_archived = false
  GROUP BY wp.client_id
),
nutrition_evidence AS (
  SELECT np.client_id,
         min(np.activated_at) AS ts,
         count(*)             AS plan_count
  FROM public.nutrition_plans np
  WHERE np.client_id IS NOT NULL
    AND np.status = 'active'
    AND np.is_archived = false
  GROUP BY np.client_id
),
audit_evidence AS (
  SELECT al.entity_id::uuid AS client_id,
         max((al.metadata->>'start_date')::date) AS audit_activation_date
  FROM public.audit_logs al
  WHERE al.entity_type = 'client'
    AND al.action IN ('client_auto_activated', 'client_package_activated')
    AND al.entity_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  GROUP BY al.entity_id::uuid
),
current_sub AS (
  SELECT DISTINCT ON (s.client_id)
         s.client_id,
         s.id AS subscription_id,
         s.status,
         s.start_date,
         s.end_date,
         s.package_id,
         s.package_name
  FROM public.subscriptions s
  WHERE s.status <> 'renewed'
  ORDER BY s.client_id,
           CASE s.status
             WHEN 'active'  THEN 0
             WHEN 'frozen'  THEN 1
             WHEN 'pending' THEN 2
             WHEN 'expired' THEN 3
             ELSE 4
           END,
           s.start_date DESC NULLS LAST,
           s.created_at DESC
),
joined AS (
  SELECT
    c.id                                                  AS client_id,
    c.client_code,
    c.full_name,
    c.status                                              AS client_status,
    c.join_date,
    c.activated_at                                        AS current_activated_at,
    n.ts                                                  AS nutrition_delivered_at,
    w.ts                                                  AS proposed_workout_delivered_at,
    GREATEST(n.ts, w.ts)                                  AS proposed_activation_at,
    ae.audit_activation_date,
    cs.subscription_id,
    cs.status                                             AS subscription_status,
    cs.start_date                                         AS subscription_start_date,
    cs.end_date                                           AS subscription_end_date,
    cs.package_name                                       AS subscription_package_name,
    w.plan_count                                          AS workout_plan_count,
    n.plan_count                                          AS nutrition_plan_count,
    COALESCE(w.edited_after_creation, false)              AS workout_edited_after_creation,
    CASE
      WHEN n.ts IS NULL AND w.ts IS NULL THEN 'missing_both_plans'
      WHEN n.ts IS NULL THEN 'missing_nutrition'
      WHEN w.ts IS NULL THEN 'missing_workout'
      WHEN w.edited_after_creation AND w.ts >= n.ts THEN 'ambiguous_workout_is_second_plan'
      ELSE NULL
    END                                                   AS exceptions
  FROM public.clients c
  LEFT JOIN workout_evidence   w  ON w.client_id  = c.id
  LEFT JOIN nutrition_evidence n  ON n.client_id  = c.id
  LEFT JOIN audit_evidence     ae ON ae.client_id = c.id
  LEFT JOIN current_sub        cs ON cs.client_id = c.id
)
SELECT
  client_code,
  full_name,
  client_status,
  join_date,
  current_activated_at,
  nutrition_delivered_at,
  proposed_workout_delivered_at,
  proposed_activation_at,
  audit_activation_date,
  subscription_status,
  subscription_start_date,
  subscription_end_date,
  subscription_package_name,
  workout_plan_count,
  nutrition_plan_count,
  workout_edited_after_creation,
  exceptions,
  -- WOULD THE WRITE MIGRATION CHANGE THIS CLIENT?
  (exceptions IS NULL
     AND current_activated_at IS NULL
     AND client_status = 'active')                                    AS would_set_activated_at,
  (exceptions IS NULL
     AND current_activated_at IS NULL
     AND client_status = 'active'
     AND subscription_status IN ('active', 'frozen', 'pending')
     AND subscription_start_date IS DISTINCT FROM proposed_activation_at::date)  AS would_reanchor_dates,
  (subscription_end_date IS NOT NULL AND subscription_end_date < CURRENT_DATE)   AS subscription_is_expired
FROM joined
ORDER BY exceptions NULLS FIRST, full_name;

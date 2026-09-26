-- ============================================================================
-- YBS SYSTEM — READ-ONLY DIAGNOSTIC (run in Supabase SQL editor, owner role)
-- Why do recurring check-in forms appear in the Admin → Awaiting Response queue
-- but the cleanup predicate found 0 candidates?
--
-- READ ONLY. No DELETE / UPDATE / INSERT. Schemas, scheduler and migrations
-- are untouched. No filters are applied that would hide the excluded rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- NAME MATCHING HELPER (case-insensitive stems for the two recurring check-ins)
-- Nutrition : Nutrition Check In / التقييم التغذوي الدوري
-- Workout   : Workout Check In   / التقييم الدوري للبرنامج التدريبي
-- Matches template names, rule names AND the frozen assessments.name snapshot.
-- ---------------------------------------------------------------------------
WITH base AS (
  SELECT
    fai.id                                            AS instance_id,
    a.id                                              AS assessment_id,
    a.client_id                                       AS client_id,
    c.full_name                                       AS client_name,
    w.name                                            AS workspace,
    a.template_id                                     AS template_id,
    COALESCE(t.name, a.name)                          AS template_name,
    fai.rule_id                                       AS rule_id,
    r.name                                            AS rule_name,
    fai.trigger_type                                  AS trigger_type,
    COALESCE(r.recurrence_days,
             CASE fai.trigger_type WHEN 'weekly' THEN 7 WHEN 'biweekly' THEN 14 END)
                                                      AS recurrence_days,
    a.created_at                                      AS assessment_created_at,
    fai.assigned_at                                   AS assigned_at,
    a.due_date                                        AS due_date,
    c.activated_at                                    AS activated_at,
    -- current cycle under the activation-anchored schedule (client active + activated_at only)
    CASE
      WHEN c.status = 'active' AND c.activated_at IS NOT NULL THEN
        (CURRENT_DATE - c.activated_at::date)
          / COALESCE(r.recurrence_days, CASE fai.trigger_type WHEN 'weekly' THEN 7 ELSE 14 END)
      ELSE NULL
    END                                               AS current_cycle,
    CASE
      WHEN c.status = 'active' AND c.activated_at IS NOT NULL
        AND (CURRENT_DATE - c.activated_at::date)
              / COALESCE(r.recurrence_days, CASE fai.trigger_type WHEN 'weekly' THEN 7 ELSE 14 END) >= 1
      THEN c.activated_at::date
             + ((CURRENT_DATE - c.activated_at::date)
                  / COALESCE(r.recurrence_days, CASE fai.trigger_type WHEN 'weekly' THEN 7 ELSE 14 END))
               * COALESCE(r.recurrence_days, CASE fai.trigger_type WHEN 'weekly' THEN 7 ELSE 14 END)
      ELSE NULL
    END                                               AS expected_due_date,
    a.submission_status                               AS submission_status,
    fai.status                                        AS ledger_status,
    fai.dedup_key                                     AS dedup_key,
    (SELECT COUNT(*) FROM public.assessment_responses ar WHERE ar.assessment_id = a.id)
                                                      AS response_count,
    a.submitted_at                                    AS submitted_at,
    -- OLD-logic signature: due_date = assigned_at + interval  =>  due_date > assigned_at::date
    (a.due_date IS NOT NULL AND a.due_date > fai.assigned_at::date)
                                                      AS signature_due_gt_assigned,
    -- name-based tags (template / rule / assessment snapshot)
    (COALESCE(t.name, a.name) ILIKE '%nutrition%'
      OR COALESCE(t.name, a.name) ILIKE '%تغذوي%'
      OR COALESCE(r.name, '') ILIKE '%nutrition%'
      OR COALESCE(r.name, '') ILIKE '%تغذوي%'
      OR a.name ILIKE '%nutrition%'
      OR a.name ILIKE '%تغذوي%')                       AS nutrition_checkin,
    (COALESCE(t.name, a.name) ILIKE '%workout%'
      OR COALESCE(t.name, a.name) ILIKE '%تدريب%'
      OR COALESCE(r.name, '') ILIKE '%workout%'
      OR COALESCE(r.name, '') ILIKE '%تدريب%'
      OR a.name ILIKE '%workout%'
      OR a.name ILIKE '%تدريب%')                       AS workout_checkin
  FROM public.form_assignment_instances fai
  JOIN public.assessments a  ON a.id  = fai.assessment_id
  JOIN public.clients      c  ON c.id  = a.client_id
  LEFT JOIN public.workspaces          w ON w.id = c.workspace_id
  LEFT JOIN public.assessment_templates t ON t.id = a.template_id
  LEFT JOIN public.form_assignment_rules r ON r.id = fai.rule_id
)

-- ============================================================================
-- SECTION 1 — FULL recurring (weekly/biweekly) LEDGER UNIVERSE, ALL STATUSES
-- No cleanup-predicate filtering. Shows exactly why rows were / were not picked.
-- ============================================================================
SELECT
  'RECURRING' AS section,
  instance_id, assessment_id, client_id, client_name, workspace,
  template_id, template_name, rule_id, rule_name, trigger_type, recurrence_days,
  assessment_created_at, assigned_at, due_date, activated_at,
  current_cycle, expected_due_date,
  submission_status, ledger_status, dedup_key, response_count, submitted_at,
  signature_due_gt_assigned,
  (nutrition_checkin OR workout_checkin) AS named_checkin
FROM base
WHERE trigger_type IN ('weekly', 'biweekly')
ORDER BY assigned_at ASC;

-- ============================================================================
-- SECTION 2 — NON-RECURRING instances that use the check-in TEMPLATES/RULES
-- (client_approval / nutrition_workout / subscription_renewal). These are the
-- one-off-trigger check-ins that can also sit in the Awaiting Response queue.
-- ============================================================================
SELECT
  'NON-RECURRING' AS section,
  instance_id, assessment_id, client_id, client_name, workspace,
  template_id, template_name, rule_id, rule_name, trigger_type, recurrence_days,
  assessment_created_at, assigned_at, due_date, activated_at,
  current_cycle, expected_due_date,
  submission_status, ledger_status, dedup_key, response_count, submitted_at,
  signature_due_gt_assigned,
  (nutrition_checkin OR workout_checkin) AS named_checkin
FROM base
WHERE trigger_type NOT IN ('weekly', 'biweekly')
  AND (nutrition_checkin OR workout_checkin)
ORDER BY assigned_at ASC;

-- ============================================================================
-- SECTION 3 — ASSESSMENT-SIDE: all PENDING check-in assessments, LEFT JOIN ledger
-- Critical: a visible Awaiting-Response form with NO form_assignment_instances
-- row will NEVER match any ledger-based cleanup predicate.
-- ============================================================================
SELECT
  'ASSESSMENTS-SIDE' AS section,
  fai.id AS instance_id,
  a.id AS assessment_id, a.client_id, c.full_name AS client_name, w.name AS workspace,
  a.template_id, COALESCE(t.name, a.name) AS template_name,
  fai.rule_id, r.name AS rule_name, fai.trigger_type,
  COALESCE(r.recurrence_days, CASE fai.trigger_type WHEN 'weekly' THEN 7 WHEN 'biweekly' THEN 14 END) AS recurrence_days,
  a.created_at AS assessment_created_at, fai.assigned_at, a.due_date,
  c.activated_at,
  NULL::int AS current_cycle, NULL::date AS expected_due_date,
  a.submission_status,
  fai.status AS ledger_status, fai.dedup_key,
  (SELECT COUNT(*) FROM public.assessment_responses ar WHERE ar.assessment_id = a.id) AS response_count,
  a.submitted_at,
  (a.due_date IS NOT NULL AND fai.id IS NOT NULL AND a.due_date > fai.assigned_at::date) AS signature_due_gt_assigned,
  (COALESCE(t.name, a.name) ILIKE '%nutrition%' OR COALESCE(t.name, a.name) ILIKE '%تغذوي%'
    OR COALESCE(t.name, a.name) ILIKE '%workout%' OR COALESCE(t.name, a.name) ILIKE '%تدريب%') AS named_checkin
FROM public.assessments a
JOIN public.clients c ON c.id = a.client_id
LEFT JOIN public.workspaces w ON w.id = c.workspace_id
LEFT JOIN public.assessment_templates t ON t.id = a.template_id
LEFT JOIN public.form_assignment_instances fai ON fai.assessment_id = a.id
LEFT JOIN public.form_assignment_rules r ON r.id = fai.rule_id
WHERE a.submission_status = 'pending'
  AND a.submitted_at IS NULL
  AND (
    COALESCE(t.name, a.name) ILIKE '%nutrition%' OR COALESCE(t.name, a.name) ILIKE '%تغذوي%'
    OR COALESCE(t.name, a.name) ILIKE '%workout%' OR COALESCE(t.name, a.name) ILIKE '%تدريب%'
  )
ORDER BY a.created_at ASC;

-- ============================================================================
-- SECTION 4 — COUNTS (metrics 1-8 across three universes)
--   substitute note: "created before the activation-anchored migration" =
--   assessments.created_at < '2026-09-16T00:00:00Z' (the day the migration is
--   dated; adjust timezone/instant if you know the exact apply time). Exact
--   min/max dates are included so the usable boundary is visible.
-- ============================================================================
SELECT 'all-instances (any trigger)' AS universe,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE nutrition_checkin)                                  AS m1_nutrition_instances,
  COUNT(*) FILTER (WHERE workout_checkin)                                    AS m2_workout_instances,
  COUNT(*) FILTER (WHERE submission_status = 'pending')                      AS m3_pending_assessments,
  COUNT(*) FILTER (WHERE ledger_status = 'assigned')                         AS m4_assigned_ledger,
  COUNT(*) FILTER (WHERE response_count = 0)                                 AS m5_zero_responses,
  COUNT(*) FILTER (WHERE assessment_created_at < '2026-09-16T00:00:00Z')     AS m6_created_before_activation_migration,
  COUNT(*) FILTER (WHERE signature_due_gt_assigned)                          AS m7_due_gt_assigned,
  COUNT(*) FILTER (WHERE NOT signature_due_gt_assigned)                      AS m8_due_le_assigned,
  MIN(assigned_at)::text AS min_assigned_at,
  MAX(assigned_at)::text AS max_assigned_at
FROM base
UNION ALL
SELECT 'recurring-only' AS universe,
  COUNT(*),
  COUNT(*) FILTER (WHERE nutrition_checkin),
  COUNT(*) FILTER (WHERE workout_checkin),
  COUNT(*) FILTER (WHERE submission_status = 'pending'),
  COUNT(*) FILTER (WHERE ledger_status = 'assigned'),
  COUNT(*) FILTER (WHERE response_count = 0),
  COUNT(*) FILTER (WHERE assessment_created_at < '2026-09-16T00:00:00Z'),
  COUNT(*) FILTER (WHERE signature_due_gt_assigned),
  COUNT(*) FILTER (WHERE NOT signature_due_gt_assigned),
  MIN(assigned_at)::text, MAX(assigned_at)::text
FROM base WHERE trigger_type IN ('weekly', 'biweekly')
UNION ALL
SELECT 'named-checkin (template/rule/assessment name)' AS universe,
  COUNT(*),
  COUNT(*) FILTER (WHERE nutrition_checkin),
  COUNT(*) FILTER (WHERE workout_checkin),
  COUNT(*) FILTER (WHERE submission_status = 'pending'),
  COUNT(*) FILTER (WHERE ledger_status = 'assigned'),
  COUNT(*) FILTER (WHERE response_count = 0),
  COUNT(*) FILTER (WHERE assessment_created_at < '2026-09-16T00:00:00Z'),
  COUNT(*) FILTER (WHERE signature_due_gt_assigned),
  COUNT(*) FILTER (WHERE NOT signature_due_gt_assigned),
  MIN(assigned_at)::text, MAX(assigned_at)::text
FROM base WHERE nutrition_checkin OR workout_checkin
ORDER BY universe;
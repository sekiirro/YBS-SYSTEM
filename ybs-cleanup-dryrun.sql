-- ============================================================================
-- YBS SYSTEM — DRY-RUN REPORT (run in Supabase SQL editor, owner role)
-- Pre-activation-anchored recurring forms cleanup.
--
-- Lists EVERY weekly/biweekly automatic form-assignment instance with the
-- metadata needed for the cleanup decision, including a deterministic
-- "wrong time" signature. Run this FIRST; paste the output back before any
-- DELETE is performed.
--
-- Signature (provable from data, no wall clock needed):
--   * OLD logic  set  due_date = assigned_at + interval  ->  due_date ALWAYS > assigned_at::date
--   * NEW logic  sets due_date = activation + cycle*interval (cycle >= 1)
--                 where cycle*interval days have already elapsed           ->  due_date ALWAYS <= assigned_at::date
--   so  due_date > assigned_at::date  is ALWAYS an old-logic (wrong-time) form,
--   and  due_date <= assigned_at::date  is ALWAYS a new-logic (correct) form.
--
-- safe_to_delete = recurring AND ledger_status='assigned' AND submission_status='pending'
--                  AND zero responses AND old-logic signature.
-- ============================================================================

SELECT
  a.id                                             AS assessment_id,
  c.full_name                                      AS client,
  c.client_code                                    AS client_code,
  c.status                                         AS client_status,
  t.name                                           AS template_name,
  r.id                                             AS rule_id,
  r.name                                           AS rule_name,
  r.trigger_type                                   AS rule_trigger_type,
  COALESCE(r.recurrence_days, CASE fai.trigger_type WHEN 'weekly' THEN 7 WHEN 'biweekly' THEN 14 END)
                                                   AS interval_days,
  fai.assigned_at                                  AS generated_at,
  a.created_at                                     AS assessment_created_at,
  a.due_date                                       AS due_date,
  c.activated_at                                   AS activated_at,
  -- Expected CURRENT cycle + due date under the activation-anchored schedule:
  CASE
    WHEN c.status = 'active' AND c.activated_at IS NOT NULL THEN
      (CURRENT_DATE - c.activated_at::date) / COALESCE(r.recurrence_days, CASE fai.trigger_type WHEN 'weekly' THEN 7 ELSE 14 END)
    ELSE NULL
  END                                              AS current_cycle,
  CASE
    WHEN c.status = 'active' AND c.activated_at IS NOT NULL
      AND (CURRENT_DATE - c.activated_at::date) / COALESCE(r.recurrence_days, CASE fai.trigger_type WHEN 'weekly' THEN 7 ELSE 14 END) >= 1
    THEN c.activated_at::date
      + ((CURRENT_DATE - c.activated_at::date) / COALESCE(r.recurrence_days, CASE fai.trigger_type WHEN 'weekly' THEN 7 ELSE 14 END))
        * COALESCE(r.recurrence_days, CASE fai.trigger_type WHEN 'weekly' THEN 7 ELSE 14 END)
    ELSE NULL
  END                                              AS expected_current_due,
  fai.status                                       AS ledger_status,
  a.submission_status                              AS submission_status,
  (SELECT COUNT(*) FROM public.assessment_responses ar WHERE ar.assessment_id = a.id)
                                                   AS response_count,
  (a.due_date IS NOT NULL AND a.due_date > fai.assigned_at::date)
                                                   AS old_logic_signature,
  (fai.status = 'assigned'
   AND a.submission_status = 'pending'
   AND a.submitted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.assessment_responses ar WHERE ar.assessment_id = a.id)
   AND (a.due_date IS NOT NULL AND a.due_date > fai.assigned_at::date))
                                                   AS safe_to_delete
FROM public.form_assignment_instances fai
JOIN public.assessments             a  ON a.id  = fai.assessment_id
JOIN public.clients                 c  ON c.id  = fai.client_id
LEFT JOIN public.form_assignment_rules      r ON r.id = fai.rule_id
LEFT JOIN public.assessment_templates       t ON t.id = a.template_id
WHERE fai.trigger_type IN ('weekly', 'biweekly')
ORDER BY safe_to_delete DESC, fai.assigned_at ASC;
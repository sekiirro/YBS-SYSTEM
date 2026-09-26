-- ============================================================================
-- ybs-firststep-diagnostic.sql  (READ-ONLY — nothing here writes to the DB)
-- Target form   : "Your First Step" (master intake, template 00000000-0000-0000-0000-000000000101)
-- Target clients: محمد هاشم شومان  / احمد موسى
-- Run in the Supabase SQL Editor as an owner (postgres) role. Paste output back.
-- ============================================================================

-- 0) Does the crippling FK still exist on remote?  ('assessment_responses_question_id_fkey')
SELECT tc.constraint_name, tc.constraint_type, tc.table_name
FROM information_schema.table_constraints tc
WHERE tc.table_schema = 'public'
  AND tc.table_name = 'assessment_responses'
ORDER BY tc.constraint_name;

-- 1) The two clients (by email)
SELECT id AS client_id, full_name, email, status, subscription_status, workspace_id,
       activated_at, created_at AS client_created_at
FROM public.clients
WHERE email ILIKE 'mohamedhashim12005%' OR email ILIKE 'ahmedhavoc2%'
ORDER BY email;

-- 2) EVERY "Your First Step" assessment row for these two clients
--    (name = template snapshot name at assignment time; template 101 = master intake)
SELECT
  a.id  AS assessment_id,
  c.id  AS client_id,
  c.full_name,
  c.email,
  a.template_id,
  t.name AS template_name,
  a.name AS assessment_name,
  a.created_at,
  fai.assigned_at,
  fai.trigger_type,
  fai.dedup_key,
  a.due_date,
  a.submission_status,
  a.submitted_at,
  a.reviewed_at,
  fai.status AS ledger_status,
  fai.next_due_at,
  (SELECT count(*) FROM public.assessment_responses r WHERE r.assessment_id = a.id) AS response_count
FROM public.assessments a
JOIN public.clients c ON c.id = a.client_id
LEFT JOIN public.form_assignment_instances fai ON fai.assessment_id = a.id
LEFT JOIN public.assessment_templates t ON t.id = a.template_id
WHERE c.email ILIKE 'mohamedhashim12005%' OR c.email ILIKE 'ahmedhavoc2%'
  AND ( a.template_id = '00000000-0000-0000-0000-000000000101'
        OR a.name ILIKE '%First Step%'
        OR a.name = 'استمارة التقييم الأولي وبناء الخطة'
        OR a.id::text IN (
             SELECT fai2.assessment_id::text FROM public.form_assignment_instances fai2
             WHERE fai2.rule_id IN (
                 SELECT r.id FROM public.form_assignment_rules r
                 WHERE r.name ILIKE '%First Step%'
             )
        ) )
ORDER BY c.email, a.created_at;

-- 3) DUPLICATE CHECK — count "Your First Step" instances per client (any status)
SELECT c.id AS client_id, c.full_name, c.email,
       count(a.id) AS step_instances,
       count(*) FILTER (WHERE a.submission_status = 'submitted'  OR a.submission_status = 'reviewed') AS submitted_or_reviewed,
       count(*) FILTER (WHERE a.submission_status = 'pending') AS pending,
       count(*) FILTER (WHERE a.submission_status IS NULL) AS null_status
FROM public.clients c
LEFT JOIN public.assessments a
  ON a.client_id = c.id
 AND ( a.template_id = '00000000-0000-0000-0000-000000000101'
       OR a.name ILIKE '%First Step%'
       OR a.name = 'استمارة التقييم الأولي وبناء الخطة' )
WHERE c.email ILIKE 'mohamedhashim12005%' OR c.email ILIKE 'ahmedhavoc2%'
GROUP BY c.id, c.full_name, c.email;

-- 4) PROOF OF THE FK BLOCKER — for each of these clients' instances, how many
--    snapshot question ids are ORPHANED (do not exist in assessment_questions).
--    saveResponses() inserts with question_id -> FK. Orphaned count > 0 means the
--    client's save/submit was rejected by Postgres and submission_status stayed pending.
SELECT
  a.id AS assessment_id,
  c.full_name,
  c.email,
  count(*)                                                                AS snapshot_questions,
  count(*) FILTER (WHERE q.id IS NULL)                                    AS orphaned_snapshot_question_ids,
  count(*) FILTER (WHERE q.id IS NOT NULL)                                AS still_valid_question_ids
FROM public.assessments a
JOIN public.clients c ON c.id = a.client_id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.questions_snapshot, '[]'::jsonb)) AS snap(qs)
LEFT JOIN public.assessment_questions q ON q.id = (snap.qs ->> 'id')::uuid
WHERE (c.email ILIKE 'mohamedhashim12005%' OR c.email ILIKE 'ahmedhavoc2%')
  AND ( a.template_id = '00000000-0000-0000-0000-000000000101'
        OR a.name ILIKE '%First Step%'
        OR a.name = 'استمارة التقييم الأولي وبناء الخطة' )
GROUP BY a.id, c.full_name, c.email
ORDER BY c.email, a.id;

-- 5) ACTUAL RESPONSES (if any exist) — label + value, never writes, never deletes
SELECT
  r.assessment_id,
  c.full_name,
  c.email,
  r.question_id,
  r.question_label,
  left(r.response_value::text, 120) AS response_value_preview,
  r.created_at AS response_saved_at
FROM public.assessment_responses r
JOIN public.assessments a ON a.id = r.assessment_id
JOIN public.clients c ON c.id = a.client_id
WHERE (c.email ILIKE 'mohamedhashim12005%' OR c.email ILIKE 'ahmedhavoc2%')
  AND ( a.template_id = '00000000-0000-0000-0000-000000000101'
        OR a.name ILIKE '%First Step%'
        OR a.name = 'استمارة التقييم الأولي وبناء الخطة' )
ORDER BY c.email, r.assessment_id, r.created_at;

-- 6) ALL FORM INSTANCES for these two clients (any form, any status)
--    -> confirms there is no second/duplicate or cross-wired assignment.
SELECT
  a.id AS assessment_id,
  c.full_name,
  c.email,
  a.name AS assessment_name,
  fai.trigger_type,
  fai.dedup_key,
  a.submission_status,
  a.submitted_at,
  fai.status AS ledger_status,
  (SELECT count(*) FROM public.assessment_responses r WHERE r.assessment_id = a.id) AS response_count
FROM public.assessments a
JOIN public.clients c ON c.id = a.client_id
LEFT JOIN public.form_assignment_instances fai ON fai.assessment_id = a.id
WHERE c.email ILIKE 'mohamedhashim12005%' OR c.email ILIKE 'ahmedhavoc2%'
ORDER BY c.email, a.created_at;
-- ============================================================
-- YBS SYSTEM: REPAIR ORPHANED ASSESSMENT RESPONSE QUESTION_IDS
-- One-time, transactional, idempotent data repair
-- ============================================================
--
-- Background
-- ----------
-- Old form submissions (Sep 5-7, 2026) for "استمارة التقييم الأولي وبناء
-- الخطة" stopped displaying their answers (every answer rendered as "—").
-- Root cause: when the master-intake template's questions were deleted and
-- re-created with new UUIDs, the (then still live) FK
--   assessment_responses.question_id -> assessment_questions(id) ON DELETE SET NULL
-- nulled question_id on every already-saved response. The renderer joins
-- answers strictly via assessment_responses.question_id ===
-- assessments.questions_snapshot[].id, so NULL question_id meant no match.
--
-- This repair restores question_id from the assessment's own frozen
-- questions_snapshot (the authoritative question set the client answered),
-- matched 1:1 by question_label. It only touches question_id and only for
-- rows where question_id IS NULL and the label match is unique.
--
-- Safety guarantees
-- -----------------
--   * response_value, question_label, assessment_id, timestamps untouched.
--   * No row is modified unless its question_label maps to EXACTLY ONE
--     snapshot question (multi-match or no-match rows are skipped).
--   * No deletes, inserts, or schema changes.
--   * Idempotent: after it runs once (0 NULL question_ids), re-running is a
--     no-op.
--
-- Expected scope (pre-repair): 4 assessments x 86 NULL responses = 344 rows
--   restored, leaving 0 NULL question_ids and 86/86 matched per assessment.
-- ============================================================

BEGIN;

WITH mapping AS (
  SELECT a.id AS assessment_id,
         (q->>'id')::uuid AS snapshot_question_id,
         q->>'label' AS snapshot_label
  FROM public.assessments a
  CROSS JOIN LATERAL jsonb_array_elements(a.questions_snapshot) q
),
matched AS (
  SELECT r.id AS response_id,
         m.snapshot_question_id
  FROM public.assessment_responses r
  JOIN mapping m
    ON m.assessment_id = r.assessment_id
   AND m.snapshot_label = r.question_label
  WHERE r.question_id IS NULL
),
match_counts AS (
  SELECT response_id, count(*) AS c
  FROM matched
  GROUP BY response_id
),
safe AS (
  SELECT m.response_id, m.snapshot_question_id
  FROM matched m
  JOIN match_counts mc ON mc.response_id = m.response_id
  WHERE mc.c = 1
)
UPDATE public.assessment_responses r
SET question_id = s.snapshot_question_id
FROM safe s
WHERE r.id = s.response_id
  AND r.question_id IS NULL;

COMMIT;

-- Verification queries (read-only, re-run after applying):
--   SELECT r.assessment_id,
--          count(DISTINCT r.id) AS total_responses,
--          count(DISTINCT r.id) FILTER (WHERE r.question_id IS NULL) AS remaining_null_qid,
--          count(DISTINCT r.id) FILTER (WHERE EXISTS (
--            SELECT 1 FROM jsonb_array_elements(
--              (SELECT questions_snapshot FROM public.assessments a WHERE a.id = r.assessment_id)
--            ) q WHERE (q->>'id')::uuid = r.question_id
--          )) AS matched_to_snapshot
--   FROM public.assessment_responses r
--   GROUP BY r.assessment_id
--   HAVING count(DISTINCT r.id) FILTER (WHERE r.question_id IS NULL) > 0;
--   -- Expected: no rows (0 remaining NULL question_ids).
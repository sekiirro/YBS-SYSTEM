-- ============================================================
-- YBS SYSTEM: ASSESSMENT RESPONSES — DECOUPLE question_id FROM QUESTIONS
-- Additive/minimal change — RLS, uniqueness, and behavior preserved
-- ============================================================

-- root cause: a form freezes its questions in assessments.questions_snapshot
-- at assignment time, and clients answer against that frozen copy. The FK
--   assessment_responses.question_id REFERENCES assessment_questions(id)
-- made saving impossible whenever a question was removed or recreated in the
-- template AFTER assignment (orphaned snapshot id -> 23503 FK violation ->
-- "Failed to save" toast).
--
-- Dropping this FK only:
--   * assessment_responses.assessment_id FK (CASCADE) is untouched.
--   * uq_response_per_question UNIQUE(assessment_id, question_id) is untouched
--     (still prevents duplicate responses per question per assessment).
--   * RLS policies (responses_insert/update/delete/select) are untouched.
--   * question_id stays NULL-able and remains informational, so staff
--     rendering (response.question_id === snapshot q.id) stays correct even
--     when the template question no longer exists.
ALTER TABLE public.assessment_responses
  DROP CONSTRAINT IF EXISTS assessment_responses_question_id_fkey;
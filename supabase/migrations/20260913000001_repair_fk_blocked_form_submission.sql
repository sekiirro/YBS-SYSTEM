-- ============================================================
-- YBS SYSTEM: REPAIR FORM SUBMISSION STATUS BLOCKED BY FK-ERA
-- MASTER-INTAKE TEMPLATE QUESTION RECREATION
-- One-time, transactional, idempotent data repair
-- ============================================================
--
-- Background
-- ----------
-- On 2026-09-06 Ahmedkhaled fully completed "استمارة التقييم الأولي وبناء
-- الخطة" (assessment 8b61d989-e4bb-4c4b-916c-a3efee4f5473) and pressed
-- Submit, but the form stayed "pending" forever: no submitted_at was written
-- and no form_confirmation notification was created — those are the exact
-- side-effects of step #3/#4 of AssessmentsService.submitForm().
--
-- Root cause: submitForm() saves responses (step #2) BEFORE marking the
-- assessment submitted (step #3), and it upserts responses using the
-- assessment's frozen questions_snapshot IDs. While the master-intake
-- template's questions were deleted and re-created with new UUIDs, those
-- snapshot IDs no longer existed as rows, and the then still-live FK
--   assessment_responses.question_id -> assessment_questions(id) ON DELETE SET NULL
-- rejected the upsert (FK violation) -> submitForm() aborted at step #2, so
-- step #3 never persisted and the form froze at 'pending'. (The FK was
-- dropped 2026-09-08 by 20260908000008_assessment_responses_question_id_no_fk
-- .sql, and the orphaned question_ids were restored 2026-09-12 by
-- 20260912000001_repair_orphaned_assessment_response_question_ids.sql — but
-- the stuck submission status itself was never recovered.)
--
-- This repair completes exactly the submit step the app could not:
--   1. asserts the assessment is still 'pending' AND 100% answered against
--      its own questions_snapshot (safe guard — an incomplete form is NOT
--      silently marked submitted),
--   2. marks it submitted (idempotent: no-op if already submitted),
--   3. recreates the client-facing form_confirmation notification exactly as
--      submitForm() step #4 would have (delivery_status='delivered',
--      delivery_channel='in_app'). Ahmedkhaled has no assigned coach
--      (clients.assigned_ybs_coach_id IS NULL), so the coach notification is
--      deliberately omitted, matching the app's behavior.
--
-- Safety guarantees
-- -----------------
--   * Only touches assessment 8b61d989-e4bb-4c4b-916c-a3efee4f5473.
--   * Refuses to run unless submission_status='pending' AND every snapshot
--     question has a matched (non-null, snapshot-verified) response.
--   * No schema changes, no deletes, no response/template data touched.
--   * Idempotent: re-running after success is a no-op (status is no longer
--     'pending', so both the UPDATE and the notification INSERT no-op).
--   * Does NOT insert into supabase_migrations.schema_migrations — apply via
--     `supabase db push` (or the Supabase SQL editor) like the other repair
--     migrations.
-- ============================================================

BEGIN;

-- 1) Preflight: only repair a fully-answered, still-pending assessment.
DO $$
DECLARE
  v_status       text;
  v_snapshot_len int;
  v_answered     int;
BEGIN
  SELECT a.submission_status,
         jsonb_array_length(COALESCE(a.questions_snapshot, '[]'::jsonb))::int
    INTO v_status, v_snapshot_len
    FROM public.assessments a
   WHERE a.id = '8b61d989-e4bb-4c4b-916c-a3efee4f5473';

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Assessment 8b61d989-e4bb-4c4b-916c-a3efee4f5473 not found.';
  ELSIF v_status IN ('submitted', 'reviewed') THEN
    RAISE NOTICE 'Assessment already finalized (%); repair is a no-op.', v_status;
    RETURN;
  ELSIF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Refusing to repair: unexpected submission_status=%', v_status;
  END IF;

  SELECT count(*)::int
    INTO v_answered
    FROM public.assessment_responses r
   WHERE r.assessment_id = '8b61d989-e4bb-4c4b-916c-a3efee4f5473'
     AND r.question_id IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(
           (SELECT a.questions_snapshot FROM public.assessments a
             WHERE a.id = r.assessment_id)
         ) q
         WHERE (q->>'id')::uuid = r.question_id
     );

  IF v_snapshot_len = 0 OR v_answered < v_snapshot_len THEN
    RAISE EXCEPTION 'Refusing to mark submitted: form incomplete (%/% answered).',
                    v_answered, v_snapshot_len;
  END IF;

  RAISE NOTICE 'Preflight OK: %/% answered, status pending -> will mark submitted.',
               v_answered, v_snapshot_len;
END $$;

-- 2) Mark submitted (guarded by submission_status='pending' -> idempotent).
WITH repaired AS (
  UPDATE public.assessments
     SET submission_status = 'submitted',
         submitted_at      = now(),   -- original submit instant is unknowable; use repair time
         updated_at        = now()
   WHERE id = '8b61d989-e4bb-4c4b-916c-a3efee4f5473'
     AND submission_status = 'pending'
  RETURNING id, workspace_id, client_id
)
-- 3) Recreate the client form_confirmation exactly like submitForm() step #4
--    (only when the UPDATE above actually repaired a row).
INSERT INTO public.notifications
  (workspace_id, user_id, type, title, message,
   related_entity_type, related_entity_id, delivery_status, delivery_channel)
SELECT r.workspace_id,
       c.user_id,
       'form_confirmation',
       'Form Submitted Successfully',
       'Your "استمارة التقييم الأولي وبناء الخطة" has been submitted. Your training and nutrition plan will be ready within 3–7 days.',
       'assessment',
       r.id,
       'delivered',
       'in_app'
  FROM repaired r
  JOIN public.clients c ON c.id = r.client_id;

COMMIT;

-- Verification queries (read-only, re-run after applying):
--   SELECT id, submission_status, submitted_at, updated_at
--     FROM public.assessments
--    WHERE id = '8b61d989-e4bb-4c4b-916c-a3efee4f5473';
--   -- Expected: submission_status='submitted', submitted_at NOT NULL.
--
--   SELECT user_id, type, title, delivery_status, related_entity_id
--     FROM public.notifications
--    WHERE related_entity_id = '8b61d989-e4bb-4c4b-916c-a3efee4f5473';
--   -- Expected: exactly one form_confirmation row for user 8ad6e8f3-...
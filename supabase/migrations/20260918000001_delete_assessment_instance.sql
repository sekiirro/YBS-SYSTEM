-- ============================================================
-- YBS SYSTEM: INDIVIDUAL FORM-INSTANCE DELETION (20260918000001)
--
-- Adds a single-assessment delete path for the Admin -> Forms list.
-- Only the selected assessment instance is removed; templates, rules,
-- question snapshots, and other clients' instances are never touched.
--
-- WHY THE LEDGER IS KEPT (recurring-cycle safety):
--   The recurring scheduler (public.assign_form_for_rule, activation-anchored)
--   does NOT consult the ledger for the current cycle — it derives the due
--   date from the client's activation anchor and relies on the UNIQUE
--   dedup_key backstop in form_assignment_instances to stop duplicates.
--   A plain assessment DELETE with the old ON DELETE CASCADE ledger link
--   would remove that dedup_key, so the next cron sweep would regenerate
--   the same cycle. To prevent that, the ledger record is preserved as the
--   deletion marker:
--     * assessment_id becomes NULLABLE + ON DELETE SET NULL, so the row
--       survives with dedup_key / next_due_at / status intact.
--     * The same-cycle key still exists -> the UNIQUE backstop makes the
--       sweep a clean no-op ('duplicate'), so the deleted cycle cannot
--       regenerate.
--     * Once the client advances to the NEXT cycle, the due date changes,
--       the dedup key differs, and a fresh instance is created as normal.
--
-- DELETE PATH / ATOMICITY:
--   public.delete_assessment_instance(p_assessment_id UUID) is the ONLY
--   delete path (no client-side table DELETE). SECURITY DEFINER with an
--   explicit owner check mirroring the assessments_delete RLS policy
--   (platform owner or workspace owner). One transaction deletes:
--     * notifications tied to the assessment (notifications are not FK'd
--       to assessments, so they never cascade on their own),
--     * the assessment itself, which cascades assessment_responses and
--       ai_analysis_cache (both FK'ed with ON DELETE CASCADE),
--     * legacy ledger-less assessments delete safely (no ledger assumption).
--   The retained ledger row is merely unlinked, never deleted. audit_logs
--   history is preserved (audit is immutable by design) and a
--   form_instance_deleted entry is appended.
-- ============================================================

-- 1) Rework the ledger link: keep the ledger row, unlink the assessment.
ALTER TABLE public.form_assignment_instances
  DROP CONSTRAINT form_assignment_instances_assessment_id_fkey,
  ALTER COLUMN assessment_id DROP NOT NULL,
  ADD CONSTRAINT form_assignment_instances_assessment_id_fkey
    FOREIGN KEY (assessment_id)
    REFERENCES public.assessments(id)
    ON DELETE SET NULL;

-- 2) Single delete RPC (authorized, atomic).
CREATE OR REPLACE FUNCTION public.delete_assessment_instance(p_assessment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
  v_client_id UUID;
  v_name TEXT;
  v_due_date DATE;
  v_status TEXT;
  v_responses INTEGER;
  v_actor_id UUID;
  v_actor_name TEXT;
BEGIN
  v_actor_id := auth.uid();
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;

  SELECT workspace_id, client_id, name, due_date, submission_status
    INTO v_workspace_id, v_client_id, v_name, v_due_date, v_status
  FROM public.assessments
  WHERE id = p_assessment_id;

  IF v_workspace_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_found');
  END IF;

  -- Mirrors the assessments_delete RLS policy: Platform Owners and the
  -- owning workspace's owner. Coaches never acquire hard-delete rights.
  IF NOT (public.is_platform_owner() OR public.is_workspace_owner(v_workspace_id)) THEN
    RAISE EXCEPTION 'You are not allowed to delete forms for this workspace.';
  END IF;

  SELECT count(*) INTO v_responses
  FROM public.assessment_responses
  WHERE assessment_id = p_assessment_id;

  -- Notifications reference the assessment by (type, id) but are not FK'd,
  -- so they must be cleaned up here or a deleted form would leave visible
  -- notifications behind.
  DELETE FROM public.notifications
  WHERE related_entity_type = 'assessment'
    AND related_entity_id = p_assessment_id;

  -- Cascades: assessment_responses + ai_analysis_cache.
  -- Ledger rows: ON DELETE SET NULL (kept for dedup/next_due), never deleted.
  DELETE FROM public.assessments
  WHERE id = p_assessment_id;

  INSERT INTO public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, workspace_id, metadata)
  VALUES (
    v_actor_id,
    COALESCE(v_actor_name, 'System'),
    CASE WHEN public.is_platform_owner() THEN 'platform_owner' ELSE 'workspace_owner' END,
    'form_instance_deleted',
    'assessment',
    p_assessment_id::text,
    COALESCE(v_name, 'Deleted form'),
    v_workspace_id,
    jsonb_build_object(
      'client_id', v_client_id,
      'status', v_status,
      'due_date', v_due_date,
      'responses_deleted', v_responses
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'assessment_id', p_assessment_id,
    'name', v_name,
    'responses_deleted', v_responses
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_assessment_instance(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_assessment_instance(UUID) TO authenticated;
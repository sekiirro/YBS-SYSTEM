-- ============================================================
-- FORM TEMPLATE WORKSPACE CLONE (additive)
--
-- Purpose: let a Trainer / Workspace staff member edit a GLOBAL
-- master assessment template WITHOUT mutating the protected
-- source. The first edit on a global template clones it into a
-- workspace-local template the caller owns:
--
--   Global Master Template (workspace_id NULL)
--        │  clone_form_template_to_workspace()
--        ▼
--   Workspace-local clone (workspace_id = <ws>, created_by = caller)
--
-- Additive changes only:
--   1. cloned_from_id UUID column (link from clone back to source).
--   2. UNIQUE (cloned_from_id, workspace_id) — one clone per source
--      per workspace, enforced atomically (retry/concurrency safe).
--      Global rows have cloned_from_id NULL, so this UNIQUE never
--      constrains them (NULLs are not equal in Postgres UNIQUE).
--   3. Guarded SECURITY DEFINER RPC clone_form_template_to_workspace.
--
-- No RLS changes, no publish-semantics changes, no data backfill.
-- ============================================================

-- 1. Additive link column + per-(source, workspace) uniqueness.
ALTER TABLE public.assessment_templates
  ADD COLUMN IF NOT EXISTS cloned_from_id UUID
    REFERENCES public.assessment_templates(id) ON DELETE SET NULL;

ALTER TABLE public.assessment_templates
  DROP CONSTRAINT IF EXISTS uq_assessment_templates_clone_per_workspace;

ALTER TABLE public.assessment_templates
  ADD CONSTRAINT uq_assessment_templates_clone_per_workspace
  UNIQUE (cloned_from_id, workspace_id);

-- Index to make the existing-clone lookup fast (composite unique above
-- already serves (cloned_from_id, workspace_id); a dedicated source index
-- helps the "has this workspace cloned this source?" check on its own).
CREATE INDEX IF NOT EXISTS idx_assessment_templates_cloned_from
  ON public.assessment_templates(cloned_from_id)
  WHERE cloned_from_id IS NOT NULL;

-- 2. Guarded clone RPC.
CREATE OR REPLACE FUNCTION public.clone_form_template_to_workspace(p_template_id UUID, p_workspace_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source assessment_templates%ROWTYPE;
  v_clone_id UUID;
BEGIN
  -- Caller must be authenticated.
  IF (select auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- Target workspace must be an active workspace the caller may operate in.
  -- is_platform_owner() bypasses (Owner may clone anywhere).
  -- has_workspace_access() enforces: active membership + active workspace
  -- (+ active_workspace_id == p_workspace_id for non-owner roles). This
  -- prevents cross-workspace cloning by unprivileged callers.
  IF NOT (public.is_platform_owner() OR public.has_workspace_access(p_workspace_id)) THEN
    RAISE EXCEPTION 'You do not have access to workspace %.', p_workspace_id;
  END IF;

  -- Source must exist and must be a GLOBAL master template.
  SELECT * INTO v_source
  FROM public.assessment_templates
  WHERE id = p_template_id;

  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'Source template % not found.', p_template_id;
  END IF;

  IF v_source.workspace_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only global master templates (workspace_id NULL) can be cloned.';
  END IF;

  -- Reuse the existing clone if this workspace already has one (retry-safe).
  SELECT id INTO v_clone_id
  FROM public.assessment_templates
  WHERE cloned_from_id = p_template_id
    AND workspace_id = p_workspace_id
  LIMIT 1;

  IF v_clone_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'template_id', v_clone_id,
      'clone_id', v_clone_id,
      'created', false,
      'reused', true
    );
  END IF;

  -- Atomic clone: template + ALL questions, or nothing.
  -- ON CONFLICT guard: if another request raced us, DO NOTHING and reuse.
  INSERT INTO public.assessment_templates (
    workspace_id,
    name,
    description,
    status,
    is_active,
    is_archived,
    created_by,
    cloned_from_id,
    created_at,
    updated_at
  )
  VALUES (
    p_workspace_id,
    v_source.name,
    v_source.description,
    'draft',
    true,
    false,
    (select auth.uid()),
    p_template_id,
    now(),
    now()
  )
  ON CONFLICT (cloned_from_id, workspace_id) DO NOTHING
  RETURNING id INTO v_clone_id;

  IF v_clone_id IS NULL THEN
    -- Lost a concurrent clone race; reuse the winner's clone.
    SELECT id INTO v_clone_id
    FROM public.assessment_templates
    WHERE cloned_from_id = p_template_id
      AND workspace_id = p_workspace_id
    LIMIT 1;

    IF v_clone_id IS NULL THEN
      RAISE EXCEPTION 'Clone creation failed unexpectedly.';
    END IF;

    RETURN jsonb_build_object(
      'template_id', v_clone_id,
      'clone_id', v_clone_id,
      'created', false,
      'reused', true
    );
  END IF;

  -- Deep-copy all questions under the NEW template id.
  -- New rows get fresh ids (no id reuse), preserving sort_order and every
  -- field, so the clone is fully independent of the source.
  INSERT INTO public.assessment_questions (
    template_id,
    sort_order,
    question_type,
    label,
    description,
    required,
    options,
    conditional_rules
  )
  SELECT
    v_clone_id,
    q.sort_order,
    q.question_type,
    q.label,
    q.description,
    q.required,
    q.options,
    q.conditional_rules
  FROM public.assessment_questions q
  WHERE q.template_id = p_template_id;

  RETURN jsonb_build_object(
    'template_id', v_clone_id,
    'clone_id', v_clone_id,
    'created', true,
    'reused', false
  );
END;
$$;

ALTER FUNCTION public.clone_form_template_to_workspace(UUID, UUID) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.clone_form_template_to_workspace(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clone_form_template_to_workspace(UUID, UUID) TO authenticated;
-- ============================================================
-- YBS SYSTEM: CROSS-WORKSPACE GLOBAL EXERCISE LINKING
-- Migration: 20260921000001_cross_workspace_global_exercise_linking.sql
--
-- Fixes link_exercise_versions so the platform owner can publish a
-- YBS Global exercise (workspace_id IS NULL) as a specific workspace's
-- version — the intended cross-workspace linking behavior.
--
-- WHY: The YBS Global library (20260915000002) is the SHARED
-- cross-workspace pool: exercises_select exposes global rows to every
-- authenticated member, ExercisesService.list(ws) returns them in any
-- workspace picker, and resolve_exercise_versions_for_plan falls back to
-- the global mapping for every workspace. The old validation
--
--     IF v_ex_ws IS DISTINCT FROM v_workspace_id THEN RAISE ...
--
-- treated a global exercise as if it belonged EXCLUSIVELY to the
-- "YBS Global" (NULL) slot, so linking "Cable Y Raises" (YBS Global) as
-- the version for the TOJI workspace raised:
--
--   exercise "Cable Y Raises" belongs to workspace YBS Global, but was
--   linked as version for af321df9-b3e4-4929-ac04-15ae9af151ef
--
-- FIX (one condition): a GLOBAL exercise may be linked as the version
-- for the YBS Global tab OR for ANY workspace tab. A WORKSPACE-OWNED
-- exercise still may only be linked under its OWN workspace tab — a
-- workspace W1 exercise can never become workspace W2's version, nor
-- the YBS Global version. Workspace ownership (exercises.workspace_id)
-- and all RLS are unchanged.
--
-- IDEMPOTENT: CREATE OR REPLACE of the existing function only.
-- Apply via `supabase db query --linked -f <this file>` (never a bare
-- `supabase db push`; it would also run the forbidden cleanup migration
-- 20260917000001).
-- ============================================================

CREATE OR REPLACE FUNCTION public.link_exercise_versions(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_canonical_id UUID;
  v_canonical_name TEXT;
  v_exercise_id UUID;
  v_workspace_id UUID;
  v_ex_ws UUID;
  v_ex_name TEXT;
  v_changed INT := 0;
  v_new INT := 0;
  v_del INT := 0;
  v_actor_name TEXT;
  v_actor_role TEXT;
BEGIN
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'permission denied: platform owner required';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array of link items';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_canonical_id   := NULLIF(v_item->>'canonical_exercise_id', '')::uuid;
    v_canonical_name := NULLIF(btrim(v_item->>'canonical_name'), '');
    v_exercise_id    := NULLIF(v_item->>'exercise_id', '')::uuid;
    v_workspace_id   := NULLIF(v_item->>'workspace_id', '')::uuid;

    -- Resolve / create the canonical.
    IF v_canonical_id IS NULL THEN
      IF v_canonical_name IS NULL THEN
        RAISE EXCEPTION 'each item needs canonical_exercise_id or canonical_name';
      END IF;
      INSERT INTO public.canonical_exercises (canonical_name)
      VALUES (v_canonical_name)
      ON CONFLICT (canonical_name) DO UPDATE SET canonical_name = EXCLUDED.canonical_name
      RETURNING id INTO v_canonical_id;
    ELSIF v_canonical_name IS NOT NULL THEN
      UPDATE public.canonical_exercises
         SET canonical_name = v_canonical_name, updated_at = now()
       WHERE id = v_canonical_id;
    END IF;

    -- Unlink path.
    IF v_exercise_id IS NULL THEN
      DELETE FROM public.exercise_mappings
       WHERE canonical_exercise_id = v_canonical_id
         AND workspace_id IS NOT DISTINCT FROM v_workspace_id;
      GET DIAGNOSTICS v_del = ROW_COUNT;
      v_changed := v_changed + v_del;
      CONTINUE;
    END IF;

    -- Validate the exercise and its target slot.
    --   YBS Global exercise (workspace_id IS NULL): the shared
    --   cross-workspace pool. May be linked as the version for the
    --   YBS Global tab OR for ANY workspace tab (cross-workspace link).
    --   Workspace-owned exercise: may be linked ONLY under its OWN
    --   workspace tab. A workspace W1 exercise can never be linked as
    --   a version for workspace W2, nor as the YBS Global version.
    SELECT workspace_id, name INTO v_ex_ws, v_ex_name
      FROM public.exercises
     WHERE id = v_exercise_id AND is_archived = false;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'exercise % not found or archived', v_exercise_id;
    END IF;
    IF v_ex_ws IS NOT NULL AND v_ex_ws IS DISTINCT FROM v_workspace_id THEN
      RAISE EXCEPTION 'exercise "%" belongs to workspace %, but was linked as version for %',
        v_ex_name, COALESCE(v_ex_ws::text, 'YBS Global'), COALESCE(v_workspace_id::text, 'YBS Global');
    END IF;

    -- Replace any existing version in the same (canonical, workspace) slot,
    -- then upsert the new mapping.
    DELETE FROM public.exercise_mappings
     WHERE canonical_exercise_id = v_canonical_id
       AND workspace_id IS NOT DISTINCT FROM v_workspace_id
       AND exercise_id IS DISTINCT FROM v_exercise_id;
    GET DIAGNOSTICS v_del = ROW_COUNT;

    INSERT INTO public.exercise_mappings (canonical_exercise_id, exercise_id, workspace_id)
    VALUES (v_canonical_id, v_exercise_id, v_workspace_id)
    ON CONFLICT (exercise_id) DO UPDATE
      SET canonical_exercise_id = EXCLUDED.canonical_exercise_id,
          workspace_id          = EXCLUDED.workspace_id,
          updated_at            = now();
    GET DIAGNOSTICS v_new = ROW_COUNT;
    v_changed := v_changed + v_del + v_new;
  END LOOP;

  IF v_changed > 0 THEN
    SELECT COALESCE(full_name, 'Unknown') INTO v_actor_name FROM public.profiles WHERE id = auth.uid();
    v_actor_role := 'platform_owner';
    INSERT INTO public.audit_logs (
      actor_id, actor_name, actor_role, action, entity_type,
      entity_id, entity_name, workspace_id, metadata
    )
    VALUES (
      auth.uid(), v_actor_name, v_actor_role,
      'exercise_versions_linked', 'canonical_exercises', NULL, 'Exercise Version Linking',
      NULL, jsonb_build_object('changed', v_changed)
    );
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'changed', v_changed);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.link_exercise_versions FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_exercise_versions TO authenticated;
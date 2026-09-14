-- ============================================================
-- YBS SYSTEM: GLOBAL WORKOUT TEMPLATES + WORKSPACE-SPECIFIC
--             EXERCISE VERSION RESOLUTION
-- Migration: 20260915000003_global_workout_templates_exercise_versioning.sql
--
-- Turns every existing WORKOUT TEMPLATE owned by
--   'KENDO ONLINE COACHING' and 'Drbahaa Coaching'
-- into a TRUE GLOBAL template (workspace_id IS NULL) WITHOUT
-- changing any template / day / exercise row IDs and WITHOUT
-- touching historical client programs (resolution is a load-time
-- concern, never retroactive).
--
-- Version resolution uses a platform-level exercise identity:
--   canonical_exercises   — one row = one logical exercise.
--   exercise_mappings     — canonical -> exercise_id -> workspace_id
--                             (workspace_id IS NULL = YBS Global version).
--   UNIQUE(exercise_id)  -> an exercise row maps to exactly one canonical.
--   partial unique index  -> one global version per canonical + one
--                            version per (canonical, workspace).
--
-- Resolution at <template load time> (single RPC, no N+1):
--   template row.exercise_id -> canonical
--     -> target-workspace version (if linked)
--     -> YBS Global version    (if linked)
--     -> original id           (fallback; rendered "Not Linked")
--
-- NO name-based auto-linking: the seeding pass creates one canonical
-- per template-referenced exercise (names are made unique per source
-- workspace so two same-named versions NEVER merge implicitly).
-- Cross-workspace / global links are created ONLY through the
-- platform-owner "Link exercise versions" UI (link_exercise_versions),
-- which validates that a mapped exercise actually belongs to the
-- workspace it is linked under.
--
-- IDEMPOTENT: guarded by IF NOT EXISTS / DO blocks / ON CONFLICT.
-- ============================================================

-- ============================================================
-- 1. Canonical exercise identity
-- ============================================================
CREATE TABLE IF NOT EXISTS public.canonical_exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.canonical_exercises IS
  'One row per logical exercise across the whole platform. Written only by the Platform Owner.';

-- ============================================================
-- 2. Exercise version mappings
-- ============================================================
CREATE TABLE IF NOT EXISTS public.exercise_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_exercise_id UUID NOT NULL
      REFERENCES public.canonical_exercises(id) ON DELETE CASCADE,
    exercise_id UUID NOT NULL UNIQUE
      REFERENCES public.exercises(id) ON DELETE CASCADE,
    -- NULL = this canonical's YBS Global version.
    -- Non-NULL = the version published to that workspace.
    workspace_id UUID
      REFERENCES public.workspaces(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pluggable via UNIQUE(exercise_id) above + partial unique below.
-- One version per (canonical, workspace):
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_mappings_canonical_workspace
  ON public.exercise_mappings(canonical_exercise_id, workspace_id)
  WHERE workspace_id IS NOT NULL;

-- One global (NULL) version per canonical — a plain UNIQUE constraint
-- would not catch multiple NULL rows, so enforce it with a partial index:
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_mappings_canonical_global
  ON public.exercise_mappings(canonical_exercise_id)
  WHERE workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_exercise_mappings_exercise_id
  ON public.exercise_mappings(exercise_id);

CREATE INDEX IF NOT EXISTS idx_exercise_mappings_canonical
  ON public.exercise_mappings(canonical_exercise_id);

COMMENT ON TABLE public.exercise_mappings IS
  'Links a canonical logical exercise to concrete exercise rows per workspace (NULL = YBS Global version). Managed exclusively by the Platform Owner through link_exercise_versions.';

-- ============================================================
-- 3. RLS: deny by default; the platform owner manages both tables.
--    Workspace members consume resolution exclusively through the
--    SECURITY DEFINER RPCs below — they never touch these tables.
-- ============================================================
ALTER TABLE public.canonical_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canonical_exercises_platform_owner" ON public.canonical_exercises
FOR ALL TO authenticated
USING (public.is_platform_owner())
WITH CHECK (public.is_platform_owner());

CREATE POLICY "exercise_mappings_platform_owner" ON public.exercise_mappings
FOR ALL TO authenticated
USING (public.is_platform_owner())
WITH CHECK (public.is_platform_owner());

-- ============================================================
-- 4. RESOLUTION RPC — resolve every workout_exercises row of a plan
--    against the caller's workspace (canonical -> target version ->
--    YBS Global version -> original). Single query, no N+1.
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_exercise_versions_for_plan(
  p_plan_id UUID,
  p_target_workspace_id UUID
)
RETURNS TABLE (
  workout_exercise_id UUID,
  original_exercise_id UUID,
  resolved_exercise_id UUID,
  canonical_exercise_id UUID,
  linked BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Caller must be able to READ the plan (mirrors workout_plans_select).
  IF NOT EXISTS (
    SELECT 1 FROM public.workout_plans wp
    WHERE wp.id = p_plan_id
      AND (
        (wp.is_template AND (wp.workspace_id IS NULL OR public.has_workspace_access(wp.workspace_id)))
        OR public.is_platform_owner()
        OR public.is_workspace_owner(wp.workspace_id)
        OR wp.assigned_ybs_coach_id = auth.uid()
        OR (wp.client_id IS NOT NULL AND public.is_client_self(wp.client_id))
      )
  ) THEN
    RAISE EXCEPTION 'permission denied: no read access to plan %', p_plan_id;
  END IF;

  -- Target workspace must be the caller's own (unless the caller is the
  -- platform owner, who may resolve against any workspace).
  IF p_target_workspace_id IS NOT NULL
     AND NOT (public.is_platform_owner() OR public.has_workspace_access(p_target_workspace_id)) THEN
    RAISE EXCEPTION 'permission denied: no access to target workspace %', p_target_workspace_id;
  END IF;

  RETURN QUERY
    SELECT
      we.id                                            AS workout_exercise_id,
      we.exercise_id                                   AS original_exercise_id,
      COALESCE(m_target.exercise_id, m_global.exercise_id, we.exercise_id) AS resolved_exercise_id,
      c.id                                             AS canonical_exercise_id,
      (m_target.exercise_id IS NOT NULL OR m_global.exercise_id IS NOT NULL) AS linked
    FROM public.workout_days wd
    JOIN public.workout_exercises we ON we.workout_day_id = wd.id
    LEFT JOIN public.exercise_mappings m_source
      ON m_source.exercise_id = we.exercise_id
    LEFT JOIN public.canonical_exercises c
      ON c.id = m_source.canonical_exercise_id
    LEFT JOIN public.exercise_mappings m_target
      ON m_target.canonical_exercise_id = c.id
     AND m_target.workspace_id IS NOT DISTINCT FROM p_target_workspace_id
    LEFT JOIN public.exercise_mappings m_global
      ON m_global.canonical_exercise_id = c.id
     AND m_global.workspace_id IS NULL
    WHERE wd.workout_plan_id = p_plan_id
      AND we.exercise_id IS NOT NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_exercise_versions_for_plan FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_exercise_versions_for_plan TO authenticated;

-- ============================================================
-- 5. LINKING READ — full mapping matrix (platform owner only).
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_exercise_mappings()
RETURNS TABLE (
  canonical_id UUID,
  canonical_name TEXT,
  exercise_id UUID,
  exercise_name TEXT,
  video_url TEXT,
  category TEXT,
  workspace_id UUID,
  workspace_name TEXT,
  is_global BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'permission denied: platform owner required';
  END IF;

  RETURN QUERY
    SELECT
      c.id,
      c.canonical_name,
      e.id,
      e.name,
      e.video_url,
      e.category,
      m.workspace_id,
      w.name,
      (e.workspace_id IS NULL)
    FROM public.canonical_exercises c
    JOIN public.exercise_mappings m ON m.canonical_exercise_id = c.id
    JOIN public.exercises e ON e.id = m.exercise_id
    LEFT JOIN public.workspaces w ON w.id = m.workspace_id
    WHERE e.is_archived = false
    ORDER BY c.canonical_name ASC, w.name ASC NULLS FIRST;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_exercise_mappings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_exercise_mappings TO authenticated;

-- ============================================================
-- 6. LINKING WRITE — platform-owner only. Accepts an array of items:
--      { canonical_exercise_id?, canonical_name?, exercise_id?, workspace_id? }
--    - canonical_name creates a canonical when id is missing (or renames
--      an existing one when id is present).
--    - exercise_id IS NULL / missing  -> UNLINKS that workspace slot.
--    - workspace_id IS NULL           -> links the YBS Global version.
--    Validates that a mapped exercise truly belongs to its target
--    workspace, and replaces (never duplicates) the existing version.
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

    -- Validate the exercise and its workspace.
    SELECT workspace_id, name INTO v_ex_ws, v_ex_name
      FROM public.exercises
     WHERE id = v_exercise_id AND is_archived = false;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'exercise % not found or archived', v_exercise_id;
    END IF;
    IF v_ex_ws IS DISTINCT FROM v_workspace_id THEN
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

-- ============================================================
-- 7. GLOBALIZE WORKOUT TEMPLATES
--    workout_plans.workspace_id is NOT NULL today; templates from
--    KENDO / Drbahaa must become workspace_id IS NULL (the existing
--    global pattern, already readable by every authenticated member
--    via workout_plans_select). Only TEMPLATE rows are converted —
--    client programs and all programming columns are untouched.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workout_plans'
      AND column_name = 'workspace_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.workout_plans
      ALTER COLUMN workspace_id DROP NOT NULL;
  END IF;
END $$;

-- The inset-in library-source guard trigger would reject a migration
-- UPDATE (auth.uid() is NULL during migration, is_platform_owner() is
-- false). Drop it for the conversion, then re-instate it unchanged.
DROP TRIGGER IF EXISTS trg_workout_plan_library_source ON public.workout_plans;

DO $$
DECLARE
  v_name     TEXT;
  v_ws_count INTEGER;
  v_ws_id    UUID;
  v_converted INTEGER;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['KENDO ONLINE COACHING', 'Drbahaa Coaching'] LOOP
    SELECT count(*) INTO v_ws_count FROM public.workspaces WHERE name = v_name;

    IF v_ws_count = 0 THEN
      RAISE NOTICE 'Global template conversion: no workspace named "%" — skipped.', v_name;
      CONTINUE;
    ELSIF v_ws_count > 1 THEN
      RAISE EXCEPTION 'Global template conversion ABORTED: more than one workspace named "%". Resolve manually.', v_name;
    END IF;

    SELECT id INTO v_ws_id FROM public.workspaces WHERE name = v_name;

    UPDATE public.workout_plans
       SET workspace_id = NULL,
           exercise_library_workspace_id = NULL
     WHERE is_template = true
       AND workspace_id = v_ws_id;
    GET DIAGNOSTICS v_converted = ROW_COUNT;

    RAISE NOTICE 'Global template conversion: % template(s) from "%" moved to global scope (IDs preserved).',
      v_converted, v_name;
  END LOOP;
END $$;

-- Re-instate the guard trigger (function body unchanged from
-- 20260910000006_workout_plan_exercise_library_source.sql).
CREATE OR REPLACE FUNCTION public.guard_workout_plan_library_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.exercise_library_workspace_id IS NULL THEN
    NEW.exercise_library_workspace_id := NEW.workspace_id;
  END IF;

  IF NEW.exercise_library_workspace_id = NEW.workspace_id THEN
    RETURN NEW;
  END IF;

  IF public.is_platform_owner()
     OR public.is_workspace_owner(NEW.exercise_library_workspace_id) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'permission denied: workspace % is not an authorized exercise library source for this plan',
    NEW.exercise_library_workspace_id;
END;
$$;

DROP TRIGGER IF EXISTS trg_workout_plan_library_source ON public.workout_plans;
CREATE TRIGGER trg_workout_plan_library_source
  BEFORE INSERT OR UPDATE OF exercise_library_workspace_id ON public.workout_plans
  FOR EACH ROW EXECUTE FUNCTION public.guard_workout_plan_library_source();

-- ============================================================
-- 8. SEED CANONICALS FOR TEMPLATE-REFERENCED EXERCISES
--    One canonical per distinct template exercise (source mapping only).
--    Canonical names are made unique so EQUAL exercise names across
--    workspaces NEVER collide/merge — merging is a platform-owner
--    decision made later in the "Link exercise versions" UI.
-- ============================================================
DO $$
DECLARE
  v_ex RECORD;
  v_canonical_id UUID;
  v_base_name TEXT;
  v_unique_name TEXT;
  v_suffix INT;
  v_seeded INT := 0;
BEGIN
  FOR v_ex IN
    SELECT DISTINCT we.exercise_id, e.name AS ex_name, e.workspace_id AS ex_ws
    FROM public.workout_plans wp
    JOIN public.workout_days wd ON wd.workout_plan_id = wp.id
    JOIN public.workout_exercises we ON we.workout_day_id = wd.id
    JOIN public.exercises e ON e.id = we.exercise_id
    WHERE wp.is_template = true
      AND wp.workspace_id IS NULL        -- converted global templates
      AND we.exercise_id IS NOT NULL
    ORDER BY we.exercise_id
  LOOP
    -- Already seeded (this exercise maps to a canonical)?
    IF EXISTS (SELECT 1 FROM public.exercise_mappings WHERE exercise_id = v_ex.exercise_id) THEN
      CONTINUE;
    END IF;

    -- Deterministic unique canonical name. First choice is the exercise
    -- name alone; on collision (a same-named exercise was already
    -- canonicalized) qualify with the owning workspace, then a counter.
    -- The qualifier never merges equal names across workspaces.
    v_base_name := NULLIF(btrim(v_ex.ex_name), '');
    IF v_base_name IS NULL THEN
      v_base_name := 'Exercise ' || left(v_ex.exercise_id::text, 8);
    END IF;
    v_suffix := 1;
    v_unique_name := v_base_name;
    WHILE EXISTS (SELECT 1 FROM public.canonical_exercises WHERE canonical_name = v_unique_name) LOOP
      v_suffix := v_suffix + 1;
      IF v_suffix = 2 THEN
        v_unique_name := v_base_name || ' (' ||
          COALESCE((SELECT w.name FROM public.workspaces w WHERE w.id = v_ex.ex_ws), 'YBS Global') || ')';
      ELSE
        v_unique_name := v_base_name || ' (#' || v_suffix || ')';
      END IF;
    END LOOP;

    INSERT INTO public.canonical_exercises (canonical_name)
    VALUES (v_unique_name)
    ON CONFLICT (canonical_name) DO NOTHING
    RETURNING id INTO v_canonical_id;

    IF v_canonical_id IS NULL THEN
      SELECT id INTO v_canonical_id
      FROM public.canonical_exercises WHERE canonical_name = v_unique_name;
    END IF;

    INSERT INTO public.exercise_mappings (canonical_exercise_id, exercise_id, workspace_id)
    VALUES (v_canonical_id, v_ex.exercise_id, v_ex.ex_ws)
    ON CONFLICT (exercise_id) DO NOTHING;

    v_seeded := v_seeded + 1;
  END LOOP;

  RAISE NOTICE 'Exercise versioning: seeded % template-referenced canonical mapping(s).', v_seeded;
END $$;

-- ============================================================
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
--
-- 1. Templates globalized (expect counts per source workspace):
--      SELECT w.name, count(*) AS converted_templates
--      FROM public.workout_plans wp
--      JOIN public.workspaces w ON w.id = wp.workspace_id -- not used; see #2
--      WHERE wp.is_template = true AND wp.workspace_id IS NULL;
--      SELECT count(*) AS global_templates
--      FROM public.workout_plans WHERE is_template = true AND workspace_id IS NULL;
--
-- 2. Client programs untouched:
--      SELECT count(*) AS client_plans_remaining
--      FROM public.workout_plans wp
--      JOIN public.workspaces w ON w.id = wp.workspace_id
--      WHERE wp.is_template = false AND w.name IN ('KENDO ONLINE COACHING','Drbahaa Coaching');
--
-- 3. Every template exercise is canonicalized exactly once:
--      SELECT count(*) AS unmapped_template_exercises
--      FROM public.workout_exercises we
--      JOIN public.workout_days wd ON wd.id = we.workout_day_id
--      JOIN public.workout_plans wp ON wp.id = wd.workout_plan_id
--      WHERE wp.is_template = true AND wp.workspace_id IS NULL
--        AND we.exercise_id IS NOT NULL
--        AND NOT EXISTS (SELECT 1 FROM public.exercise_mappings m WHERE m.exercise_id = we.exercise_id);
--    (expected 0)
--
-- 4. No cross-workspace name-merge happened accidentally:
--      SELECT canonical_name, count(*) FROM public.canonical_exercises GROUP BY 1 HAVING count(*) > 1;
--    (expected 0 rows — canonical_name is UNIQUE; overlapping names got
--     a workspace qualifier suffix instead of merging)
--
-- 5. RPC authorization exercised:
--      -- as a workspace member (should resolve against own workspace):
--      SELECT * FROM public.resolve_exercise_versions_for_plan(<global_template_id>, <my_workspace_id>);
--      -- as platform owner, link a workspace version, then re-resolve:
--      SELECT public.link_exercise_versions('[{"canonical_name":"Bench Press","exercise_id":"<ex>","workspace_id":"<ws>"}]');
-- ============================================================
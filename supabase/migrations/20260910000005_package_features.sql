-- ============================================================
-- YBS SYSTEM: STRUCTURED PACKAGE FEATURES (Phase 5)
-- Migration: 20260910000005_package_features.sql
--
-- MODEL
--   package_features   relational rows (package_id, title, sort_order,
--                      is_active) with a stable UUID identity per feature.
--                      This becomes the authoritative store the Features
--                      editor reads and writes.
--   packages.features  existing TEXT[] column kept as a PROJECTION
--                      rebuilt by sync_package_features() so every current
--                      consumer (package cards, subscription display,
--                      cloning into workspaces) keeps working unchanged.
--   subscriptions.features  NEW immutable snapshot column filled ONLY at
--                      subscription INSERT time + one-time backfill for
--                      historical rows. Editing a package AFTER a
--                      subscription was created NEVER rewrites that
--                      subscription (financial-history protection, and it
--                      is not editable anywhere in the app).
--
-- Authorization / scope mirrors the existing packages rules:
--   Platform Owner  -> any package (global templates + every workspace).
--   Workspace Owner -> packages owned by their OWN active workspace only.
--   Readers         -> packages_select semantics (global catalog +
--                      platform owner / workspace-members with access).
--
-- Additive + idempotent. Does NOT modify prior migrations.
-- ============================================================

-- ============================================================
-- 1. Structured features table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.package_features (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_package_features_package
  ON public.package_features (package_id, sort_order);

-- ============================================================
-- 2. RLS: read-only for clients; writes are 100% via the
--    sync_package_features() SECURITY DEFINER RPC (which enforces
--    its own owner/scope check). No INSERT/UPDATE/DELETE policies.
-- ============================================================
ALTER TABLE public.package_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "package_features_select" ON public.package_features;
CREATE POLICY "package_features_select" ON public.package_features
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.packages p
    WHERE p.id = package_features.package_id
      AND (
        p.workspace_id IS NULL -- global catalog
        OR public.is_platform_owner()
        OR public.has_workspace_access(p.workspace_id)
      )
  )
);

GRANT SELECT ON public.package_features TO authenticated;

-- ============================================================
-- 3. Backfill structured rows from the existing TEXT[] projection.
--    Every currently-visible feature becomes a row with a stable id
--    (same display order). Packages that already have feature rows
--    (re-run safety) are left untouched.
-- ============================================================
INSERT INTO public.package_features (package_id, title, sort_order, is_active)
SELECT p.id, f.title, f.ord - 1, TRUE
FROM public.packages p
CROSS JOIN LATERAL unnest(p.features) WITH ORDINALITY AS f(title, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.package_features pf WHERE pf.package_id = p.id
);

-- ============================================================
-- 4. Historical subscription snapshot.
--    Adds subscriptions.features and fills it ONCE from the package
--    definition currently referenced by the subscription. This is
--    accurate because package features could NOT be edited before
--    this migration, so the live value equals what was sold.
-- ============================================================
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS features TEXT[] NOT NULL DEFAULT '{}';

UPDATE public.subscriptions s
SET features = COALESCE(
  (SELECT p.features FROM public.packages p WHERE p.id = s.package_id),
  '{}'::text[]
)
WHERE s.package_id IS NOT NULL AND s.features = '{}';

-- ============================================================
-- 5. INSERT-only snapshot trigger.
--    Any NEW subscription (registration link, renew_subscription,
--    future direct inserts) receives the package feature definition
--    valid at the moment of creation. Package edits AFTER that never
--    touch the stored snapshot.
-- ============================================================
CREATE OR REPLACE FUNCTION public.snapshot_subscription_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.features IS NULL OR NEW.features = '{}' THEN
    NEW.features := COALESCE(
      (SELECT p.features FROM public.packages p WHERE p.id = NEW.package_id),
      '{}'::text[]
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snapshot_subscription_features_on_insert ON public.subscriptions;
CREATE TRIGGER snapshot_subscription_features_on_insert
  BEFORE INSERT ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_subscription_features();

REVOKE EXECUTE ON FUNCTION public.snapshot_subscription_features FROM PUBLIC;

-- ============================================================
-- 6. sync_package_features(p_package_id, p_items jsonb)
--    The ONLY write path for package features.
--
--    p_items: ordered JSON array of {id?, title}.
--      - existing row id -> UPDATE title/sort_order in place (stable id)
--      - no id           -> INSERT a new row with a fresh id
--      - active row not listed -> soft-delete (is_active = FALSE)
--
--    After the reconcile it rebuilds packages.features as the ordered
--    projection of active rows and bumps packages.updated_at (this
--    UPDATE is allowed by the enforce_package_edit_scope trigger: for
--    workspace owners only features/updated_at differ).
--
--    One aggregated audit_logs row per saved change-set (a real diff):
--    added / edited / removed titles + reordered flag. Calls that are
--    no-ops (autosave baseline round-trips) write nothing.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_package_features(p_package_id UUID, p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg      RECORD;
  v_item     JSONB;
  v_uid      UUID;
  v_new_id   UUID;
  v_title    TEXT;
  v_cur      RECORD;
  v_i        INTEGER;
  v_kept     UUID[] := '{}'::uuid[];
  v_added    TEXT[] := '{}'::text[];
  v_edited   TEXT[] := '{}'::text[];
  v_removed  TEXT[] := '{}'::text[];
  v_reordered BOOLEAN := FALSE;
  v_new_features TEXT[] := '{}'::text[];
  v_actor_name  TEXT;
  v_actor_role  TEXT;
  v_audit       JSONB;
BEGIN
  SELECT id, workspace_id, name INTO v_pkg
  FROM public.packages
  WHERE id = p_package_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Package % not found.', p_package_id;
  END IF;

  -- Authorization: Platform Owner (any package) OR the owning
  -- Workspace Owner (own, active workspace package only).
  IF NOT (
    public.is_platform_owner()
    OR (v_pkg.workspace_id IS NOT NULL AND public.is_workspace_owner(v_pkg.workspace_id))
  ) THEN
    RAISE EXCEPTION 'Only Platform Owners and the workspace owner can edit package features.';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array of {id?, title} objects.';
  END IF;
  IF jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'Too many features (maximum 200).';
  END IF;

  -- Pass 1: validate the input shape before touching any data.
  FOR v_i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
    v_item := p_items -> v_i;
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Invalid feature entry at position %.', v_i;
    END IF;
    v_title := btrim(COALESCE(v_item ->> 'title', ''));
    IF length(v_title) = 0 THEN
      RAISE EXCEPTION 'Feature title is required (position %).', v_i;
    END IF;
    IF v_item ? 'id' AND COALESCE(v_item ->> 'id', '') <> '' THEN
      v_uid := (v_item ->> 'id')::uuid;
      IF array_position(v_kept, v_uid) IS NOT NULL THEN
        RAISE EXCEPTION 'Duplicate feature id % in the list.', v_uid;
      END IF;
      v_kept := array_append(v_kept, v_uid);
    END IF;
  END LOOP;
  v_kept := '{}'::uuid[]; -- rebuilt in pass 2 with only ids that survived

  -- Pass 2: reconcile incoming list -> UPSERT rows in order.
  FOR v_i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
    v_item := p_items -> v_i;
    v_title := btrim(COALESCE(v_item ->> 'title', ''));
    v_uid := NULL;

    IF v_item ? 'id' AND COALESCE(v_item ->> 'id', '') <> '' THEN
      v_uid := (v_item ->> 'id')::uuid;
      IF array_position(v_kept, v_uid) IS NOT NULL THEN
        RAISE EXCEPTION 'Duplicate feature id % in the list.', v_uid;
      END IF;
      v_kept := array_append(v_kept, v_uid);

      SELECT id, title, sort_order INTO v_cur
      FROM public.package_features
      WHERE id = v_uid AND package_id = p_package_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Feature id % does not belong to package %.', v_uid, p_package_id;
      END IF;

      IF v_cur.title IS DISTINCT FROM v_title THEN
        v_edited := array_append(v_edited, v_title);
      END IF;
      IF v_cur.sort_order IS DISTINCT FROM v_i THEN
        v_reordered := TRUE;
      END IF;

      UPDATE public.package_features
      SET title = v_title, sort_order = v_i, is_active = TRUE, updated_at = now()
      WHERE id = v_uid;
    ELSE
      INSERT INTO public.package_features (package_id, title, sort_order, is_active)
      VALUES (p_package_id, v_title, v_i, TRUE)
      RETURNING id INTO v_new_id;
      v_kept := array_append(v_kept, v_new_id);
      v_added := array_append(v_added, v_title);
    END IF;
  END LOOP;

  -- Pass 3: soft-delete active rows no longer present in the list.
  FOR v_cur IN
    SELECT id, title FROM public.package_features
    WHERE package_id = p_package_id AND is_active = TRUE
  LOOP
    IF array_position(v_kept, v_cur.id) IS NULL THEN
      UPDATE public.package_features
      SET is_active = FALSE, updated_at = now()
      WHERE id = v_cur.id;
      v_removed := array_append(v_removed, v_cur.title);
    END IF;
  END LOOP;

  -- Rebuild the TEXT[] projection used by the rest of the app.
  SELECT COALESCE(array_agg(title ORDER BY sort_order), '{}'::text[])
  INTO v_new_features
  FROM public.package_features
  WHERE package_id = p_package_id AND is_active = TRUE;

  UPDATE public.packages
  SET features = v_new_features, updated_at = now()
  WHERE id = p_package_id;

  -- Audit ONLY when a real change was made (debounced autosave round-trips
  -- and create/rename/remove/reorder all produce one aggregated row).
  IF array_length(v_added, 1) IS NOT NULL
      OR array_length(v_edited, 1) IS NOT NULL
      OR array_length(v_removed, 1) IS NOT NULL
      OR v_reordered THEN
    SELECT COALESCE(full_name, 'Unknown') INTO v_actor_name
    FROM public.profiles
    WHERE id = auth.uid();
    v_actor_role := CASE
      WHEN public.is_platform_owner() THEN 'platform_owner'
      ELSE 'workspace_owner'
    END;
    v_audit := jsonb_build_object(
      'package_id', p_package_id,
      'added', COALESCE(v_added, '{}'::text[]),
      'edited', COALESCE(v_edited, '{}'::text[]),
      'removed', COALESCE(v_removed, '{}'::text[]),
      'reordered', v_reordered,
      'feature_count', array_length(v_new_features, 1)
    );
    INSERT INTO public.audit_logs (
      actor_id, actor_name, actor_role, action, entity_type, entity_id,
      entity_name, workspace_id, metadata
    )
    VALUES (
      auth.uid(), v_actor_name, v_actor_role,
      'package_features_updated', 'package', p_package_id::text,
      v_pkg.name, v_pkg.workspace_id, v_audit
    );
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'features', v_new_features,
    'feature_count', array_length(v_new_features, 1)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_package_features FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_package_features TO authenticated;

-- ============================================================
-- 7. Cloning into workspaces: plain package rows plus the new
--    structured feature rows. Replaces the 20260905000005 helper.
--    Idempotent, same semantics (workspace gets its OWN copies of the
--    active global defaults; existing customizations untouched).
-- ============================================================
CREATE OR REPLACE FUNCTION public.clone_default_packages_for_workspace(p_workspace_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  IF p_workspace_id IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.packages (
    workspace_id,
    name,
    tier,
    duration,
    duration_unit,
    price,
    currency,
    description,
    features,
    is_active,
    is_custom
  )
  SELECT
    p_workspace_id,
    d.name,
    d.tier,
    d.duration,
    d.duration_unit,
    d.price,
    d.currency,
    d.description,
    d.features,
    d.is_active,
    d.is_custom
  FROM public.packages d
  WHERE d.workspace_id IS NULL
    AND d.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.packages w
      WHERE w.workspace_id = p_workspace_id
        AND w.tier = d.tier
        AND w.duration = d.duration
        AND w.duration_unit = d.duration_unit
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Clone the active structured features of the matching default template
  -- into each workspace-owned package row that has no features yet. Rows
  -- that already exist (run twice, or features customized after cloning)
  -- are left untouched.
  INSERT INTO public.package_features (package_id, title, sort_order)
  SELECT w.id, df.title, df.sort_order
  FROM public.packages w
  JOIN public.packages d
    ON d.workspace_id IS NULL
    AND d.is_active = true
    AND d.tier = w.tier
    AND d.duration = w.duration
    AND d.duration_unit = w.duration_unit
  JOIN public.package_features df
    ON df.package_id = d.id
    AND df.is_active = true
  WHERE w.workspace_id = p_workspace_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.package_features x
      WHERE x.package_id = w.id
    );

  RETURN v_inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clone_default_packages_for_workspace FROM PUBLIC;

-- ============================================================
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
-- ============================================================
-- 1) Every package features TEXT[] entry must equal its rows:
--    SELECT count(*) FROM public.packages p
--    WHERE p.features IS DISTINCT FROM (
--      SELECT COALESCE(array_agg(f.title ORDER BY f.sort_order), '{}')
--      FROM public.package_features f
--      WHERE f.package_id = p.id AND f.is_active = true
--    );
--    Expected: 0
-- 2) Historical subscriptions snapshot backfill:
--    SELECT count(*) FROM public.subscriptions
--    WHERE package_id IS NOT NULL AND features = '{}';  -- Expected: 0
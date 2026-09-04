-- ============================================================
-- YBS SYSTEM: WORKSPACE DEFAULT PACKAGE PROVISIONING
-- Migration: 20260905000005_workspace_default_packages.sql
--
-- BUSINESS MODEL (three distinct concepts):
--   DEFAULT PACKAGE TEMPLATE   packages.workspace_id IS NULL (Platform managed seed)
--   WORKSPACE PACKAGE          packages.workspace_id = <ws> (cloned from defaults)
--   CLIENT PACKAGE ASSIGNMENT  subscriptions.package_id FK (already exists)
--
-- When a workspace is created it receives its OWN copies of the active
-- global default packages. Workspace Owner (and Platform Owner) then
-- customize name/price of the workspace-owned row. Editing one workspace
-- never affects another workspace or the platform defaults.
--
-- Additive + idempotent. Does NOT modify old applied migrations, does NOT
-- delete or rewrite any existing packages/subscriptions/client record.
-- ============================================================

-- ============================================================
-- 1. Cloning helper (single source of truth)
--    Used by both the create trigger and the backfill below.
--    Structural identity of a "default" is (tier, duration, duration_unit):
--    if the workspace already owns that combination it counts as its own
--    version and is left untouched (no duplicates, no clobbering of
--    customizations that predate this migration).
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
  RETURN v_inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clone_default_packages_for_workspace FROM PUBLIC;

-- ============================================================
-- 2. Provision defaults automatically for EVERY new workspace.
-- ============================================================
CREATE OR REPLACE FUNCTION public.provision_workspace_default_packages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.clone_default_packages_for_workspace(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_provision_workspace_default_packages ON public.workspaces;
CREATE TRIGGER trigger_provision_workspace_default_packages
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.provision_workspace_default_packages();

REVOKE EXECUTE ON FUNCTION public.provision_workspace_default_packages FROM PUBLIC;

-- ============================================================
-- 3. Backfill EXISTING workspaces so every one owns its package
--    rows (YBS Default Workspace and every existing brand workspace).
-- ============================================================
DO $$
DECLARE
  r RECORD;
  v_count INTEGER;
BEGIN
  FOR r IN SELECT id FROM public.workspaces LOOP
    SELECT public.clone_default_packages_for_workspace(r.id) INTO v_count;
  END LOOP;
END $$;

-- ============================================================
-- 4. Ownership intent made explicit on packages_update.
--    Defense-in-depth on top of the USING clause and the existing
--    enforce_package_edit_scope trigger: a workspace owner can never
--    move a row out of (or into) a workspace they do not own, and can
--    never touch a global template. The column-scope enforcement stays
--    in the existing trigger (name/price only for non-platform-owners).
-- ============================================================
DROP POLICY IF EXISTS "packages_update" ON public.packages;
CREATE POLICY "packages_update" ON public.packages
FOR UPDATE TO authenticated
USING (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
)
WITH CHECK (
  public.is_platform_owner()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner(workspace_id))
);

-- ============================================================
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
-- Expected: every workspace row has >= 1 workspace-scoped package.
-- ============================================================
SELECT w.id AS workspace_id,
       w.name AS workspace_name,
       count(p.id) AS workspace_packages
FROM public.workspaces w
LEFT JOIN public.packages p ON p.workspace_id = w.id
GROUP BY w.id, w.name
ORDER BY w.created_at ASC;

SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name = 'packages'
  AND  column_name = 'workspace_id';
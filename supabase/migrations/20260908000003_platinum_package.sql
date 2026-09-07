-- ============================================================
-- PLATINUM — 3 MONTHS (additive package tier)
--
-- Adds the "Platinum — 3 Months" package to the existing
-- Silver/Gold model. Source of truth stays public.packages
-- (global workspace_id IS NULL template + per-workspace clones)
-- and public.workspace_registration_links (auto-provisioned).
--
-- Changes (all additive / idempotent):
--   1. packages.tier CHECK widened with 'platinum'.
--   2. workspace_registration_links.tier CHECK widened with
--      'platinum' (duration_months CHECK already allows 3).
--   3. Global "Platinum — 3 Months" template seeded (same shape
--      as Silver/Gold, price 8500.00 EGP).
--   4. provision_workspace_registration_links now also provisions
--      the (platinum, 3) link, labeled "Platinum — 3 Months".
--   5. Backfill: every existing workspace is re-cloned (gets its
--      own Platinum package row) and re-provisioned (gets the
--      Platinum link). Both steps are idempotent, so Silver/Gold
--      rows/links/tokens are untouched.
-- ============================================================

-- 1. Widen packages.tier CHECK
ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_tier_check;

ALTER TABLE public.packages
  ADD CONSTRAINT packages_tier_check
  CHECK (tier IN ('silver', 'gold', 'custom', 'platinum'));

-- 2. Widen workspace_registration_links.tier CHECK
ALTER TABLE public.workspace_registration_links
  DROP CONSTRAINT IF EXISTS workspace_registration_links_tier_check;

ALTER TABLE public.workspace_registration_links
  ADD CONSTRAINT workspace_registration_links_tier_check
  CHECK (tier IN ('silver', 'gold', 'platinum'));

-- 3. Seed the global Platinum template (idempotent).
INSERT INTO public.packages (name, tier, duration, duration_unit, price, currency, description, features, is_active, is_custom)
SELECT
    'Platinum — 3 Months',
    'platinum',
    3,
    'months',
    8500.00,
    'EGP',
    'Quarterly elite coaching program',
    ARRAY['Elite Program Design', 'Full Nutrition & Supplement Plan', 'Daily Priority Support', 'Weekly Video Check-ins', 'Monthly Review'],
    true,
    false
WHERE NOT EXISTS (
    SELECT 1 FROM public.packages WHERE name = 'Platinum — 3 Months' AND workspace_id IS NULL
);

-- 4. Provision the Platinum link too (silver/gold rows unchanged).
--    Replaces the function body only: the added CSV row + tier label
--    mapping keep all Silver/Gold provision behavior byte-identical.
CREATE OR REPLACE FUNCTION public.provision_workspace_registration_links(p_workspace_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provisioned INTEGER := 0;
  v_coach_id UUID;
  v_pkg_id UUID;
  v_link RECORD;
BEGIN
  IF p_workspace_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Reuse the existing package provisioning so every workspace owns its
  -- own copies of the standard package catalog (idempotent by design).
  PERFORM public.clone_default_packages_for_workspace(p_workspace_id);

  SELECT assigned_coach_id INTO v_coach_id
  FROM public.workspaces
  WHERE id = p_workspace_id;

  FOR v_link IN
    SELECT 'silver'::text AS tier, 1::integer AS duration_months
    UNION ALL SELECT 'silver', 3
    UNION ALL SELECT 'gold', 1
    UNION ALL SELECT 'gold', 3
    UNION ALL SELECT 'platinum', 3
  LOOP
    SELECT id INTO v_pkg_id
    FROM public.packages
    WHERE workspace_id = p_workspace_id
      AND tier = v_link.tier
      AND duration = v_link.duration_months
      AND duration_unit = 'months'
      AND is_active = true
    LIMIT 1;

    INSERT INTO public.workspace_registration_links (
      workspace_id,
      coach_id,
      package_id,
      tier,
      duration_months,
      label,
      is_active
    )
    VALUES (
      p_workspace_id,
      v_coach_id,
      v_pkg_id,
      v_link.tier,
      v_link.duration_months,
      (CASE v_link.tier
         WHEN 'silver' THEN 'Silver'
         WHEN 'gold' THEN 'Gold'
         WHEN 'platinum' THEN 'Platinum'
         ELSE 'Package'
       END)
        || ' — ' || v_link.duration_months
        || ' Month' || CASE WHEN v_link.duration_months > 1 THEN 's' ELSE '' END,
      true
    )
    ON CONFLICT (workspace_id, tier, duration_months) DO UPDATE SET
      coach_id = EXCLUDED.coach_id,
      package_id = EXCLUDED.package_id,
      label = EXCLUDED.label,
      is_active = true,
      updated_at = now();

    v_provisioned := v_provisioned + 1;
  END LOOP;

  RETURN v_provisioned;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.provision_workspace_registration_links FROM PUBLIC;

-- 5. Backfill existing workspaces (clone Platinum + provision its link).
DO $$
DECLARE
  r RECORD;
  v_dummy INTEGER;
BEGIN
  FOR r IN SELECT id FROM public.workspaces LOOP
    SELECT public.clone_default_packages_for_workspace(r.id) INTO v_dummy;
    SELECT public.provision_workspace_registration_links(r.id) INTO v_dummy;
  END LOOP;
END $$;
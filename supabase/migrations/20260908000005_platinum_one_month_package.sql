-- ============================================================
-- PLATINUM — 1 MONTH (additive package tier duration)
--
-- Adds the "Platinum — 1 Month" package to the existing
-- Platinum model. Source of truth stays public.packages
-- (global workspace_id IS NULL template + per-workspace clones)
-- and public.workspace_registration_links (auto-provisioned).
--
-- Changes (all additive / idempotent):
--   1. Global "Platinum — 1 Month" template seeded (same shape
--      as the existing Platinum — 3 Months, price 3000.00 EGP).
--   2. provision_workspace_registration_links now also provisions
--      the (platinum, 1) link, labeled "Platinum — 1 Month".
--   3. Backfill: every existing workspace is re-cloned (gets its
--      own Platinum 1M package row) and re-provisioned (gets the
--      Platinum 1M link). Both steps are idempotent, so Silver/Gold/
--      Platinum 3M rows/links/tokens are untouched.
--
-- No constraint changes needed: packages.tier_check already allows
-- 'platinum' and workspace_registration_links.duration_months CHECK
-- already allows 1.
-- ============================================================

-- 1. Seed the global Platinum template (idempotent).
INSERT INTO public.packages (name, tier, duration, duration_unit, price, currency, description, features, is_active, is_custom)
SELECT
    'Platinum — 1 Month',
    'platinum',
    1,
    'months',
    3000.00,
    'EGP',
    'Monthly elite coaching program',
    ARRAY['Elite Program Design', 'Full Nutrition & Supplement Plan', 'Daily Priority Support', 'Weekly Video Check-ins', 'Monthly Review'],
    true,
    false
WHERE NOT EXISTS (
    SELECT 1 FROM public.packages WHERE name = 'Platinum — 1 Month' AND workspace_id IS NULL
);

-- 2. Provision the Platinum 1M link too (silver/gold/platinum-3M rows unchanged).
--    Replaces the function body only: the added CSV row keeps all existing
--    provision behavior byte-identical.
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
    UNION ALL SELECT 'platinum', 1
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

-- 3. Backfill existing workspaces (clone Platinum 1M + provision its link).
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
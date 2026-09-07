import { supabase } from '@/utils/supabase';
import { calculateFoodNutrients } from '@/lib/nutritionUnits';
import { FoodsService } from './foods';
import {
  buildExplanation,
  buildScore,
  filterAccessibleFoods,
  filterCandidates,
  normalizeTarget,
  pickBestUnit,
  solveQuantity,
  REPLACEMENT_SCORING,
  DEFAULT_LIMIT,
} from '../lib/foodReplacementCore';

export { REPLACEMENT_SCORING, DEFAULT_LIMIT };

/**
 * Deterministic Smart Food Replacement engine.
 *
 * Given an existing nutrition-plan food item (its nutritional target at its
 * current quantity), returns the best available replacement foods from the
 * existing Food Database. READ-ONLY: never writes to the database and never
 * touches nutrition plans, items, or snapshots.
 *
 * Options:
 *   target            { calories, protein, carbs, fat, amount?, unit?, food_id? }
 *   food              Source food record (used to compute the target at
 *                     `amount` / `unit`, and to derive role/group context).
 *   amount, unit      Quantity at which `food` is currently used.
 *   workspaceId       Restricts candidates to global foods + this workspace.
 *   allergensToAvoid  Allergen slugs to exclude (e.g. ['peanuts', 'shellfish']).
 *   dietaryRestrictions Dietary flag slugs that candidates must satisfy
 *                     (e.g. ['veg​etarian']). Not invented — read from DB metadata.
 *   excludedFoodIds   Additional food ids to exclude.
 *   limit             Max results (default 5; fewer are returned when appropriate).
 *
 * Returns:
 *   { status, reason, target, count, results }
 *   status: 'ok' | 'no_candidates' | 'no_match' | 'invalid_target' | 'error'
 */
export async function findFoodReplacements(options = {}) {
  try {
    return await run(options);
  } catch (err) {
    console.error('[foodReplacement] unexpected failure:', err);
    return {
      status: 'error',
      reason: 'The replacement engine failed unexpectedly; no changes were made.',
      target: null,
      count: 0,
      results: [],
    };
  }
}

async function run(options) {
  const workspaceId = options.workspaceId ?? null;
  const avoidAllergens = (options.allergensToAvoid || []).map(String);
  const requireDietaryFlags = (options.dietaryRestrictions || []).map(String);
  const requestedExclusions = (options.excludedFoodIds || []).map(String);
  const rawLimit = Number(options.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : DEFAULT_LIMIT;

  const target = normalizeTarget(options.target, options.food, options.amount, options.unit);
  if (!target) {
    return {
      status: 'invalid_target',
      reason: 'A nutrition target or a source food with valid macros is required.',
      target: null,
      count: 0,
      results: [],
    };
  }

  const meta = await fetchMetadataOrEmpty();
  const allFoods = await FoodsService.list();
  const accessible = filterAccessibleFoods(allFoods, workspaceId);

  if (!accessible.length) {
    return {
      status: 'no_candidates',
      reason: 'No accessible foods found for the current context.',
      target,
      count: 0,
      results: [],
    };
  }

  const source =
    options.food || accessible.find((f) => f.id === (options.food_id || target.food_id)) || null;
  const excludeIds = source && source.id ? [...requestedExclusions, source.id] : requestedExclusions;

  const candidates = filterCandidates(accessible, {
    excludeIds,
    allergenSlugsByFood: meta.allergenSlugsByFood,
    avoidAllergens,
    requireDietaryFlags,
  });

  const sourceGroupKeys = source ? meta.groupKeysByFood.get(source.id) : null;

  const graded = [];
  for (const food of candidates) {
    const result = gradeCandidate(food, source, sourceGroupKeys, meta, target);
    if (result) graded.push(result);
  }

  // Deterministic ordering: descending score, ascending food id on ties.
  graded.sort((a, b) => b.score - a.score || (a.food_id < b.food_id ? -1 : a.food_id > b.food_id ? 1 : 0));

  const results = graded.slice(0, limit);

  return {
    status: results.length ? 'ok' : 'no_match',
    reason: results.length
      ? null
      : 'No suitable replacement candidates remained after the given constraints.',
    target,
    count: results.length,
    results,
  };
}

function gradeCandidate(candidate, source, sourceGroupKeys, meta, target) {
  const solved = solveQuantity(target, candidate);
  if (!solved) return null;

  const picked = pickBestUnit(candidate, solved.grams);
  const estimated = calculateFoodNutrients(candidate, picked.amount, picked.unit.id);

  let sharedKey = null;
  let preferred = false;
  const candidateGroupKeys = meta.groupKeysByFood.get(candidate.id);
  if (source && sourceGroupKeys && candidateGroupKeys) {
    for (const key of candidateGroupKeys) {
      if (sourceGroupKeys.has(key)) {
        sharedKey = key;
        preferred = meta.preferredGroupKeysByFood.get(candidate.id)?.has(key) ?? false;
        break;
      }
    }
  }

  const roleMatch = Boolean(
    source &&
      source.food_role_id &&
      candidate.food_role_id &&
      String(source.food_role_id) === String(candidate.food_role_id)
  );
  const categoryMatch = Boolean(
    source &&
      source.category &&
      candidate.category &&
      String(source.category).toLowerCase() === String(candidate.category).toLowerCase()
  );
  const impractical = solved.grams > REPLACEMENT_SCORING.IMPRACTICAL_MAX_GRAMS;

  const score = buildScore({
    groupMatch: Boolean(sharedKey),
    preferred,
    roleMatch,
    categoryMatch,
    rms: solved.rms,
    grams: solved.grams,
  });

  const explanation = buildExplanation({
    sourceKnown: Boolean(source),
    groupMatch: Boolean(sharedKey),
    preferred,
    roleMatch,
    categoryMatch,
    rms: solved.rms,
    proteinRelError: solved.proteinRelError,
    impractical,
  });

  return {
    food: candidate,
    food_id: candidate.id,
    name: candidate.name,
    name_ar: candidate.name_ar || null,
    food_role: meta.roleSlugById.get(candidate.food_role_id) || null,
    substitution_group: sharedKey ? meta.groupNameByKey.get(sharedKey) || null : null,
    target_amount: target.amount ?? null,
    target_unit: target.unit ?? null,
    recommended_amount: picked.amount,
    recommended_unit: picked.unit.id,
    estimated_calories: estimated.calories,
    estimated_protein: estimated.protein,
    estimated_carbs: estimated.carbs,
    estimated_fat: estimated.fat,
    score: Math.round(score * 100) / 100,
    explanation,
  };
}

/**
 * Loads Phase 1 replacement metadata (roles, allergens, substitution groups).
 * Degrades gracefully to empty metadata when the tables are unavailable, so
 * the engine still works (minus that metadata) and never crashes the planner.
 */
async function fetchMetadataOrEmpty() {
  const meta = {
    roleSlugById: new Map(),
    allergenSlugsByFood: new Map(),
    groupKeysByFood: new Map(),
    preferredGroupKeysByFood: new Map(),
    groupNameByKey: new Map(),
  };

  const queries = [
    supabase.from('food_roles').select('id, slug'),
    supabase.from('food_allergen_links').select('food_id, allergens(slug)'),
    supabase.from('food_substitution_members').select(
      'food_id, is_preferred, food_substitution_groups(name, workspace_id)'
    ),
  ];

  const settled = await Promise.all(
    queries.map((query) => query.then((res) => res, (err) => ({ data: null, error: err })))
  );

  const [roles, links, members] = settled;

  if (!roles.error && Array.isArray(roles.data)) {
    for (const row of roles.data) {
      if (row?.id) meta.roleSlugById.set(row.id, row.slug);
    }
  }
  if (!links.error && Array.isArray(links.data)) {
    for (const row of links.data) {
      const slug = row?.allergens?.slug;
      if (row?.food_id && slug) addToSetMap(meta.allergenSlugsByFood, row.food_id, slug);
    }
  }
  if (!members.error && Array.isArray(members.data)) {
    for (const row of members.data) {
      const group = row?.food_substitution_groups;
      if (row?.food_id && group?.name) {
        const key = `${group.name}::${group.workspace_id ?? 'global'}`;
        if (!meta.groupNameByKey.has(key)) meta.groupNameByKey.set(key, group.name);
        addToSetMap(meta.groupKeysByFood, row.food_id, key);
        if (row.is_preferred) addToSetMap(meta.preferredGroupKeysByFood, row.food_id, key);
      }
    }
  }

  return meta;
}

function addToSetMap(map, key, value) {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}
/**
 * Smart Food Replacement — Deterministic Ranking Core
 *
 * Pure, side-effect-free helpers used by src/services/foodReplacement.js.
 * Everything here is deterministic: the same inputs always produce the same
 * outputs. No database access, no mutations — only math and classification.
 *
 * Scoring model (higher is better). All constants are tunable below.
 */

import {
  calculateFoodNutrients,
  convertQuantityBetweenUnits,
  getAvailableUnitsForFood,
} from './nutritionUnits.js';

export const REPLACEMENT_SCORING = {
  // Strong positive signal when the candidate belongs to the same
  // substitution group as the original food. Not a hard requirement.
  GROUP_MATCH_BOOST: 40,
  // Extra signal when the candidate is flagged `is_preferred` in that group.
  PREFERRED_GROUP_BOOST: 10,
  // Same functional food_role_id is a medium positive signal.
  ROLE_MATCH_BOOST: 20,
  // Same foods.category is a softer compatibility signal.
  CATEGORY_MATCH_BOOST: 10,
  // Macro fit is scored in [0, MACRO_FIT_MAX], derived from the weighted
  // least-squares residual. MACRO_DEVIATION_SCALE converts the normalized
  // RMS relative error into that range.
  MACRO_FIT_MAX: 50,
  MACRO_DEVIATION_SCALE: 250,
  // Quantity constraints (grams of food, database values are per 100 g).
  MIN_GRAMS: 1,
  ABSOLUTE_MAX_GRAMS: 50000,
  // Portions above IMPRACTICAL_MAX_GRAMS are penalized linearly.
  IMPRACTICAL_MAX_GRAMS: 2000,
  IMPRACTICAL_PENALTY_PER_100_GRAMS: 2,
  MAX_IMPRACTICAL_PENALTY: 30,
  // Target macros below this value are ignored for optimization (avoids
  // divide-by-tiny-noise when targets are effectively zero).
  MIN_TARGET_COMPONENT: 1,
  // Upper bound for countable/natural units (pieces, slices, cups …).
  MAX_NATURAL_UNIT_AMOUNT: 12,
  // Explanation thresholds.
  STRONG_MATCH_MAX_RMS_ERROR: 0.08,
  STRONG_PROTEIN_MAX_RELATIVE_ERROR: 0.15,
};

export const DEFAULT_LIMIT = 5;

export function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNonNegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function toPositiveOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Macro target components that participate in quantity optimization.
 * Components below MIN_TARGET_COMPONENT are skipped (treated as irrelevant).
 */
export function targetComponents(target) {
  return ['calories', 'protein', 'carbs', 'fat']
    .map((key) => ({ key, value: toNonNegative(target[key]) }))
    .filter((c) => c.value >= REPLACEMENT_SCORING.MIN_TARGET_COMPONENT);
}

function hasMeaningfulTarget(target) {
  return targetComponents(target).length > 0;
}

/**
 * Builds the nutritional target vector.
 *
 * Priority:
 *   1. An explicit `target` object ({ calories, protein, carbs, fat }).
 *   2. A source `food` computed at its current quantity via the existing
 *      unit system (amount + unit, defaulting to serving_size g / 100 g).
 *
 * Returns null when neither a usable target nor a source food exists.
 */
export function normalizeTarget(target, food, amount, unit) {
  if (target && typeof target === 'object') {
    const cleaned = {
      calories: toNonNegative(target.calories),
      protein: toNonNegative(target.protein),
      carbs: toNonNegative(target.carbs),
      fat: toNonNegative(target.fat),
      amount: toPositiveOrNull(target.amount),
      unit: target.unit || null,
      food_id: target.food_id || null,
    };
    if (hasMeaningfulTarget(cleaned)) return cleaned;
  }
  if (food && food.id) {
    return targetFromFood(food, amount, unit);
  }
  return null;
}

export function targetFromFood(food, amount, unit) {
  let amt = toPositiveOrNull(amount);
  let unt = unit ? String(unit).trim() : '';
  if (!amt) amt = toPositiveOrNull(food.serving_size) || 100;
  if (!unt) unt = 'g';

  const computed = calculateFoodNutrients(food, amt, unt);
  if (computed.warning) {
    const baseAmount = toPositiveOrNull(food.serving_size) || 100;
    const base = calculateFoodNutrients(food, baseAmount, 'g');
    return {
      calories: base.calories,
      protein: base.protein,
      carbs: base.carbs,
      fat: base.fat,
      amount: baseAmount,
      unit: 'g',
      food_id: food.id || null,
    };
  }

  return {
    calories: computed.calories,
    protein: computed.protein,
    carbs: computed.carbs,
    fat: computed.fat,
    amount: amt,
    unit: unt,
    food_id: food.id || null,
  };
}

/**
 * One-variable weighted least-squares quantity solver.
 *
 * Foods scale approximately linearly with quantity. For a candidate whose
 * per-100 g macros are [c, p, ca, f] and a target vector t, we minimize
 *   Σ w_i (nutrient_i · q − t_i)²
 * which has the closed form
 *   q = Σ (w_i · nutrient_i · t_i) / Σ (w_i · nutrient_i²)
 *
 * Weights are the inverse of each target macro, so all macros are judged in
 * relative (percentage) terms and calories do not dominate the fit.
 *
 * Returns { grams, rms, proteinRelError } or null when the candidate cannot
 * meaningfully match the target (e.g. candidate has no positive macros).
 */
export function solveQuantity(target, food) {
  const comps = targetComponents(target);
  if (!comps.length) return null;

  let num = 0;
  let den = 0;
  for (const c of comps) {
    const perGram = toNumber(food[c.key]) / 100;
    if (perGram <= 0) continue;
    const w = 1 / c.value;
    num += w * perGram * c.value;
    den += w * perGram * perGram;
  }
  if (!(den > 0)) return null;

  const raw = num / den;
  if (!Number.isFinite(raw)) return null;

  const grams = Math.min(
    Math.max(raw, REPLACEMENT_SCORING.MIN_GRAMS),
    REPLACEMENT_SCORING.ABSOLUTE_MAX_GRAMS
  );

  let sqErr = 0;
  let proteinRelError = null;
  for (const c of comps) {
    const scaled = (toNumber(food[c.key]) / 100) * grams;
    const rel = (scaled - c.value) / c.value;
    sqErr += rel * rel;
    if (c.key === 'protein') proteinRelError = Math.abs(rel);
  }
  const rms = Math.sqrt(sqErr / comps.length);

  return { grams, rms, proteinRelError };
}

/**
 * Expresses an optimal gram quantity in the food's most practical unit from
 * the existing YBS nutrition unit system. Prefers a countable natural unit
 * (piece, slice, medium, tbsp, cup …) whose amount is closest to a whole
 * number, and falls back to grams otherwise.
 */
export function pickBestUnit(food, grams) {
  const units = getAvailableUnitsForFood(food);
  const gUnit = units.find((u) => u.id.toLowerCase() === 'g') || units[0];

  let best = gUnit;
  let bestDistance = Infinity;
  for (const u of units) {
    if (u === gUnit || u.id.toLowerCase() === 'g') continue;
    const gramPerUnit = Number(u.gramPerUnit) || 1;
    if (gramPerUnit <= 0) continue;
    const natural = grams / gramPerUnit;
    if (natural < Math.max(u.min || 0.5, 0.5)) continue;
    if (natural > REPLACEMENT_SCORING.MAX_NATURAL_UNIT_AMOUNT) continue;
    const distance = Math.abs(natural - Math.round(natural));
    if (distance < bestDistance - 1e-9) {
      bestDistance = distance;
      best = u;
    }
  }

  const amount = convertQuantityBetweenUnits('g', best.id, grams, food);
  return { unit: best, amount: Math.max(amount, 0) };
}

/**
 * Deterministic score for one candidate. Higher is better.
 * `rms` is the normalized RMS relative macro error at the solved quantity.
 */
export function buildScore({ groupMatch, preferred, roleMatch, categoryMatch, rms, grams }) {
  const S = REPLACEMENT_SCORING;
  let score = Math.min(S.MACRO_FIT_MAX, Math.max(0, S.MACRO_FIT_MAX - S.MACRO_DEVIATION_SCALE * rms));
  if (groupMatch) score += S.GROUP_MATCH_BOOST;
  if (preferred) score += S.PREFERRED_GROUP_BOOST;
  if (roleMatch) score += S.ROLE_MATCH_BOOST;
  if (categoryMatch) score += S.CATEGORY_MATCH_BOOST;
  const over = Math.max(0, grams - S.IMPRACTICAL_MAX_GRAMS);
  if (over > 0) {
    score -= Math.min(S.MAX_IMPRACTICAL_PENALTY, (over / 100) * S.IMPRACTICAL_PENALTY_PER_100_GRAMS);
  }
  return score;
}

/**
 * Deterministic, human-readable explanation for a candidate.
 */
export function buildExplanation({
  sourceKnown,
  groupMatch,
  preferred,
  roleMatch,
  categoryMatch,
  rms,
  proteinRelError,
  impractical,
}) {
  const S = REPLACEMENT_SCORING;

  let relation;
  if (groupMatch) {
    relation = preferred
      ? 'Preferred choice in the same substitution group.'
      : 'Same substitution group with similar macros.';
  } else if (roleMatch) {
    relation = 'Same food role, compatible portion.';
  } else if (categoryMatch) {
    relation = 'Same food category, nutritionally compatible.';
  } else {
    relation = sourceKnown
      ? 'Different food role but nutritionally viable.'
      : 'Nutritionally compatible replacement.';
  }

  let fit;
  if (rms <= S.STRONG_MATCH_MAX_RMS_ERROR) {
    fit = 'Strong weighted macro match at the recommended amount.';
  } else if (proteinRelError != null && proteinRelError <= S.STRONG_PROTEIN_MAX_RELATIVE_ERROR) {
    fit = 'Good protein match with a practical serving size.';
  } else {
    fit = 'Approximate macro match; quantity optimized to target.';
  }

  const suffix = impractical ? ' A large portion is required; verify it is practical.' : '';
  return `${relation} ${fit}${suffix}`;
}

/**
 * Restricts a food list to foods the current context may access:
 * global foods plus foods belonging to the given workspace.
 */
export function filterAccessibleFoods(foods, workspaceId) {
  const ws = workspaceId != null ? String(workspaceId) : null;
  return foods.filter(
    (f) => f.workspace_id == null || (ws != null && String(f.workspace_id) === ws)
  );
}

function hasAllDietaryFlags(flags, required) {
  const present = new Set((flags || []).map(String));
  for (const flag of required) {
    if (!present.has(flag)) return false;
  }
  return true;
}

function sharesAvoidedAllergen(allergens, avoid) {
  if (!allergens || allergens.size === 0) return false;
  for (const slug of allergens) {
    if (avoid.has(slug)) return true;
  }
  return false;
}

/**
 * Applies the hard filters: accessibility is handled separately via
 * filterAccessibleFoods. Here we exclude archived foods, the original food /
 * explicitly excluded ids, foods containing avoided allergens, and foods that
 * do not satisfy all required dietary flags. food_role_id is intentionally
 * NOT a hard filter.
 */
export function filterCandidates(
  foods,
  { excludeIds = [], allergenSlugsByFood = new Map(), avoidAllergens = [], requireDietaryFlags = [] } = {}
) {
  const exclude = new Set(excludeIds.map(String));
  const avoid = new Set(avoidAllergens.map(String));
  const required = new Set(requireDietaryFlags.map(String));

  return foods.filter((food) => {
    if (!food || !food.id) return false;
    if (food.is_archived) return false;
    if (exclude.has(String(food.id))) return false;
    if (avoid.size && sharesAvoidedAllergen(allergenSlugsByFood.get(food.id), avoid)) return false;
    if (required.size && !hasAllDietaryFlags(food.dietary_flags, required)) return false;
    return true;
  });
}
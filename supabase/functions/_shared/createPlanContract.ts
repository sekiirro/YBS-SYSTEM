/**
 * Create Plan V1 — shared proposal contract (PURE, no I/O).
 *
 * This module owns every rule that makes the AI *advisory* rather than
 * *authoritative*:
 *
 *   - The run-scoped reference scheme. Templates, foods, exercises and
 *     substitution alternatives are exposed to the model ONLY as
 *     `template_N` / `food_option_N` / `exercise_option_N` /
 *     `alternative_option_N` identifiers that are minted by the caller for a
 *     single generation run and are meaningless outside it. The model must
 *     echo a reference; it never supplies a database id.
 *
 *   - Deterministic reference resolution. Every reference is resolved against
 *     the run-scoped catalog here, and every number, enum, range and
 *     cross-operation conflict is checked here. A model that invents a
 *     reference, an id, a unit or a macro value is REJECTED — the router then
 *     fails over to the next provider.
 *
 *   - Nutrition arithmetic. Quantities and macros are computed HERE from real
 *     Food Database rows, never read from the model. The unit catalogue offered
 *     to the model is derived only from each food's own database row
 *     (`serving_size` / `serving_unit`), so a gram-equivalent can never be
 *     invented either.
 *
 *   - Allergen safety. A food that intersects the client's declared allergens
 *     is blocked, and unavailable allergen metadata degrades to an explicit
 *     acknowledgement note — never to an implicit "contains no allergens".
 *
 *   - Unit conversion. Training RIR (reps in reserve) is the coach-facing
 *     concept; the persisted column is `rpe`. `rirToRpe` is the single
 *     conversion point.
 *
 *   - Coach Notes. The server generates the notes that describe what it
 *     changed, what it could not do and what it could not verify. Model-proposed
 *     notes are merged only after validation and de-duplicated by code.
 *
 * Everything here is a pure function of its arguments so it can be unit tested
 * without Deno, Supabase or a network.
 */

export const PROPOSAL_SCHEMA_VERSION = 'create-plan-v1';

export const PLAN_KINDS = ['nutrition', 'training'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

/** Requirement 8 — the coach-selected objective is authoritative. */
export const PLAN_OBJECTIVES = ['cutting', 'recomp', 'bulking'] as const;
export type PlanObjective = (typeof PLAN_OBJECTIVES)[number];

export const NUTRITION_OP_TYPES = [
  'update_plan_targets',
  'adjust_amount',
  'swap_food',
  'add_item',
  'remove_item',
  'set_meal_notes',
  'update_plan_notes',
] as const;
export type NutritionOpType = (typeof NUTRITION_OP_TYPES)[number];

export const TRAINING_OP_TYPES = [
  'update_sets_reps_rir',
  'swap_exercise',
  'add_exercise',
  'remove_exercise',
  'set_day_type',
  'update_day_notes',
  'update_exercise_notes',
  'update_plan_notes',
] as const;
export type TrainingOpType = (typeof TRAINING_OP_TYPES)[number];

/** `workout_plans.split_type` — the persisted CHECK constraint (V1 migration 8). */
export const SPLIT_TYPES = [
  'full_body',
  'upper_lower',
  'push_pull_legs',
  'arnold_split',
  'bro_split',
  'anterior_posterior',
  'torso_limbs',
  'push_pull',
  'custom',
] as const;

/** `workout_days.day_type` — requirement 15 (rest days are preserved, not invented). */
export const DAY_TYPES = ['session', 'rest_day'] as const;

/** The food_roles vocabulary used to group candidate foods (requirement 10). */
export const MEAL_ROLES = [
  'protein',
  'carbs',
  'fats',
  'vegetables',
  'fruits',
  'other',
] as const;
export type MealRole = (typeof MEAL_ROLES)[number];

export const NOTE_SEVERITIES = ['info', 'advisory', 'warning', 'blocking'] as const;
export type NoteSeverity = (typeof NOTE_SEVERITIES)[number];

export const NOTE_CODES = [
  'summary_stale',
  'summary_missing',
  'summary_conflict',
  'metrics_newer_than_summary',
  'calculation_prerequisite_missing',
  'macro_target_divergence',
  'allergen_block',
  'allergen_metadata_unavailable',
  'food_swapped',
  'food_substitution_unavailable',
  'unverified_unit',
  'item_added',
  'item_removed',
  'amount_adjusted',
  'exercise_swapped',
  'exercise_alternative_unavailable',
  'exercise_version_unresolved',
  'rir_converted',
  'sets_reps_updated',
  'structure_preserved',
  'template_has_no_structure',
  'generation_incomplete',
] as const;
export type NoteCode = (typeof NOTE_CODES)[number];

// —————————————————————————————————————————————————————————————————————————————
// Limits (bounded inputs: nothing unbounded crosses the trust boundary)
// —————————————————————————————————————————————————————————————————————————————

export const LIMITS = {
  maxTemplates: 8,
  maxFoodOptions: 60,
  maxExerciseOptions: 40,
  maxAlternativeOptions: 40,
  maxOperations: 120,
  maxCoachNotes: 40,
  maxUnresolvedRequirements: 20,
  maxTextLength: 2000,
  maxRationaleLength: 1200,
  maxLabelLength: 300,
  minAmount: 0.01,
  maxAmount: 10000,
  minSets: 1,
  maxSets: 20,
  maxRestSeconds: 600,
  minRir: 0,
  maxRir: 5,
  maxPinnedNoteMessage: 400,
} as const;

// —————————————————————————————————————————————————————————————————————————————
// Small shared helpers
// —————————————————————————————————————————————————————————————————————————————

export function isPlanKind(value: unknown): value is PlanKind {
  return typeof value === 'string' && (PLAN_KINDS as readonly string[]).includes(value);
}

export function isPlanObjective(value: unknown): value is PlanObjective {
  return typeof value === 'string' && (PLAN_OBJECTIVES as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toTrimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

/** Unknown properties are a validation failure, not something to ignore. */
function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path}: unknown field "${key}"`);
  }
}

// —————————————————————————————————————————————————————————————————————————————
// RIR -> RPE (requirement 15). Single conversion point, never a rename.
// —————————————————————————————————————————————————————————————————————————————

/**
 * RIR (reps in reserve) is what the coach reads; `rpe` is the stored column.
 * Mapping is exact and lossless on the 0.5 grid: 0 RIR = RPE 10 (failure),
 * 5 RIR = RPE 5.
 */
export function rirToRpe(rir: number): number {
  if (!Number.isFinite(rir)) return 10;
  const clamped = Math.min(LIMITS.maxRir, Math.max(LIMITS.minRir, rir));
  return round(10 - clamped, 1);
}

export function rpeToRir(rpe: number): number {
  if (!Number.isFinite(rpe)) return 0;
  return round(Math.min(LIMITS.maxRir, Math.max(LIMITS.minRir, 10 - rpe)), 1);
}

// —————————————————————————————————————————————————————————————————————————————
// Nutrition units — derived only from the food's own database row
// —————————————————————————————————————————————————————————————————————————————

export interface FoodRow {
  id: string;
  name: string;
  serving_unit?: string | null;
  serving_size?: number | string | null;
  calories?: number | string | null;
  protein?: number | string | null;
  carbs?: number | string | null;
  fat?: number | string | null;
  fiber?: number | string | null;
  sugar?: number | string | null;
  category?: string | null;
  role_slugs?: string[] | null;
  allergen_slugs?: string[] | null;
  [key: string]: unknown;
}

export interface UnitOption {
  /** Run-scoped local reference: `${foodOptionRef}:${unit_ref}`. */
  unit_ref: string;
  /** The unit id the existing planner stores in `nutrition_items.unit`. */
  unit: string;
  label: string;
  /** Authoritative gram equivalent. Never inferred by the model. */
  gram_per_unit: number;
  min: number;
  step: number;
  default_amount: number;
}

const GRAM_UNITS = ['g', 'gram', 'grams'];

function baseServingSize(food: FoodRow): number {
  const size = Number(food?.serving_size);
  return Number.isFinite(size) && size > 0 ? size : 100;
}

/**
 * Builds the run-scoped unit catalogue for one food.
 *
 * Only units whose gram equivalent is directly derivable from the food row are
 * offered (g, kg, serving, and the food's own custom serving unit). The richer
 * heuristic catalogue in `src/lib/nutritionUnits.js` (cup / tbsp / piece, keyed
 * off food name and category) is deliberately NOT mirrored here: duplicating it
 * server-side would create a second source of truth that can silently drift
 * from the planner's calculator. If a coach needs a non-gram measure, the
 * planner's own unit picker is the authority and the amount is editable.
 */
export function buildUnitCatalog(food: FoodRow, foodOptionRef: string): UnitOption[] {
  const serving = baseServingSize(food);
  const units: UnitOption[] = [
    {
      unit_ref: `${foodOptionRef}:u1`,
      unit: 'g',
      label: 'g',
      gram_per_unit: 1,
      min: 1,
      step: 1,
      default_amount: 100,
    },
    {
      unit_ref: `${foodOptionRef}:u2`,
      unit: 'kg',
      label: 'kg',
      gram_per_unit: 1000,
      min: 0.05,
      step: 0.05,
      default_amount: 0.1,
    },
    {
      unit_ref: `${foodOptionRef}:u3`,
      unit: 'serving',
      label: `serving (${serving}g)`,
      gram_per_unit: serving,
      min: 0.5,
      step: 0.5,
      default_amount: 1,
    },
  ];

  const custom = typeof food?.serving_unit === 'string' ? food.serving_unit.trim().toLowerCase() : '';
  if (custom && !GRAM_UNITS.includes(custom) && custom !== 'serving' && custom !== 'kg') {
    units.push({
      unit_ref: `${foodOptionRef}:u4`,
      unit: custom,
      label: `${custom} (${serving}g)`,
      gram_per_unit: serving,
      min: 0.5,
      step: 0.5,
      default_amount: 1,
    });
  }

  return units;
}

export interface ComputedMacros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  gram_weight: number;
}

/** Either a raw `foods` row or a run-scoped FoodOption, both of which carry the
 *  same per-serving base values in one of two shapes. */
type MacroSource = FoodRow | FoodOption;

function baseValues(source: MacroSource): { calories: number; protein: number; carbs: number; fat: number } {
  const withBase = source as FoodOption;
  if (withBase.base && typeof withBase.base === 'object') {
    return withBase.base;
  }
  const row = source as FoodRow;
  return {
    calories: Number(row.calories) || 0,
    protein: Number(row.protein) || 0,
    carbs: Number(row.carbs) || 0,
    fat: Number(row.fat) || 0,
  };
}

/**
 * Requirement 10 — the APPLICATION calculates quantities and macros.
 * Mirrors `calculateFoodNutrients` in `src/lib/nutritionUnits.js` exactly:
 *   gram_equivalent = amount * unit.gram_per_unit
 *   ratio           = gram_equivalent / (food.serving_size || 100)
 *   nutrient        = base_value * ratio
 *
 * Note the base values are per ONE `serving_size` serving (which is 100g for the
 * overwhelming majority of rows), not literally per 100g — that is why the ratio
 * divides by serving_size.
 */
export function calculateMacros(
  source: MacroSource,
  amount: number,
  unit: UnitOption,
): ComputedMacros {
  const serving = baseServingSize(source as FoodRow);
  const gramWeight = amount * (unit?.gram_per_unit ?? 1);
  const ratio = serving > 0 ? gramWeight / serving : 0;
  const base = baseValues(source);
  return {
    calories: Math.round(base.calories * ratio),
    protein: round(base.protein * ratio, 1),
    carbs: round(base.carbs * ratio, 1),
    fat: round(base.fat * ratio, 1),
    gram_weight: round(gramWeight, 1),
  };
}

// —————————————————————————————————————————————————————————————————————————————
// Coach Notes
// —————————————————————————————————————————————————————————————————————————————

export interface CoachNote {
  code: NoteCode | string;
  severity: NoteSeverity;
  message: string;
  source_refs: string[];
  target_ref: string | null;
  suggested_action: string | null;
  requires_acknowledgement: boolean;
}

export function makeNote(
  code: NoteCode | string,
  severity: NoteSeverity,
  message: string,
  options: {
    sourceRefs?: string[];
    targetRef?: string | null;
    suggestedAction?: string | null;
    requiresAcknowledgement?: boolean;
  } = {},
): CoachNote {
  return {
    code,
    severity,
    message: message.slice(0, LIMITS.maxPinnedNoteMessage),
    source_refs: options.sourceRefs ?? [],
    target_ref: options.targetRef ?? null,
    suggested_action: options.suggestedAction ?? null,
    requires_acknowledgement: options.requiresAcknowledgement ?? false,
  };
}

function noteKey(note: CoachNote): string {
  return `${note.code}|${note.target_ref ?? ''}|${note.message}`;
}

function mergeNotes(generated: CoachNote[], modelNotes: CoachNote[]): CoachNote[] {
  const seen = new Set<string>();
  const out: CoachNote[] = [];
  // Server-generated notes first: the server is the authority on what it did.
  for (const note of [...generated, ...modelNotes]) {
    const key = noteKey(note);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
  }
  return out.slice(0, LIMITS.maxCoachNotes);
}

// —————————————————————————————————————————————————————————————————————————————
// Run-scoped catalog (what the server discovered and is willing to authorize)
// —————————————————————————————————————————————————————————————————————————————

export interface TemplateRef {
  ref: string;
  id: string;
  name: string;
  /** Preserved for the planner: nutrition target columns / split metadata. */
  meta: Record<string, unknown>;
}

export interface FoodOption {
  ref: string;
  id: string;
  name: string;
  role: MealRole;
  category: string | null;
  /** The food's own serving size in grams (the divisor for macro ratios). */
  serving_size: number;
  /** Per-one-serving base values, for reasoning AND for the app-side calculator. */
  base: { calories: number; protein: number; carbs: number; fat: number };
  units: UnitOption[];
  allergens: string[];
}

export interface ExerciseOption {
  ref: string;
  id: string;
  name: string;
  category: string | null;
  muscle_group: string | null;
  equipment: string | null;
  /** Set when the option came from the workspace's resolved template version. */
  canonical_exercise_id: string | null;
  is_alternative: boolean;
  /** The exercise this replaces, for alternatives. */
  replaces_canonical_exercise_id: string | null;
}

export interface NutritionItemSnapshot {
  ref: string;
  id: string;
  food_id: string | null;
  food_name: string;
  amount: number;
  unit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface NutritionMealSnapshot {
  ref: string;
  id: string;
  meal_name: string;
  sort_order: number;
  notes: string | null;
  items: NutritionItemSnapshot[];
}

export interface WorkoutExerciseSnapshot {
  ref: string;
  id: string;
  exercise_id: string | null;
  exercise_name: string;
  video_url: string | null;
  sort_order: number;
  sets: number;
  rep_range: string;
  rest_seconds: number | null;
  rpe: number | null;
  warmup: boolean;
  target_weight: string | null;
  notes: string | null;
  group_id: string | null;
  group_type: string | null;
  prescribed_sets_detail: unknown;
  canonical_exercise_id: string | null;
}

export interface WorkoutDaySnapshot {
  ref: string;
  id: string;
  day_name: string;
  sort_order: number;
  day_type: 'session' | 'rest_day';
  notes: string | null;
  exercises: WorkoutExerciseSnapshot[];
}

/**
 * Everything the strict gate needs, expressed as reference sets rather than
 * template content. This is deliberately separate from `ValidationContext` so
 * the same gate can run BEFORE the model output is known (as the router's
 * `validateOutput`, with only the catalog's refs loaded) and again afterwards
 * with the full template structure.
 */
export interface PreflightContext {
  kind: PlanKind;
  objective: PlanObjective;
  /** Refs + metadata of every template offered this run. */
  templates: TemplateRef[];
  foodOptions: FoodOption[];
  exerciseOptions: ExerciseOption[];
  alternativeOptions: ExerciseOption[];
  /** Every meal ref in the offered template structure. */
  mealRefs: Set<string>;
  /** Item ref -> the food it currently holds (guards adjust_amount). */
  itemFoodIdByRef: Map<string, string | null>;
  dayRefs: Set<string>;
  /** Day ref -> session/rest_day (guards adding to a rest day). */
  dayTypeByRef: Map<string, 'session' | 'rest_day'>;
  /** Every exercise slot ref in the offered template structure. */
  exerciseSlotRefs: Set<string>;
  /** Slot ref -> the load the template already carried (guards invented weights). */
  slotTargetWeightByRef: Map<string, string | null>;
  allergensToAvoid: string[];
  /** false when the allergen metadata query failed (never "no allergens"). */
  allergenMetadataAvailable: boolean;
  /**
   * Narrows the operation vocabulary for this run. When present, any operation
   * outside it is rejected by name before it is interpreted. This lives on the
   * preflight context so the router's failover gate enforces it too, not just
   * the final resolution. This is a server-side guarantee, deliberately
   * stronger than asking the model not to use an operation: a prompt
   * instruction can be ignored, this cannot.
   */
  allowedOps?: readonly string[];
}

export interface ValidationContext extends PreflightContext {
  meals: NutritionMealSnapshot[];
  days: WorkoutDaySnapshot[];
  /** True when the cached Summary was found and is the basis of this run. */
  hasSummary: boolean;
  /** True when current metrics are newer than the Summary they were read from. */
  metricsNewerThanSummary: boolean;
}

/** The reference-only projection both entry points need. */
interface DerivedRefs {
  mealRefs: Set<string>;
  itemFoodIdByRef: Map<string, string | null>;
  dayRefs: Set<string>;
  dayTypeByRef: Map<string, 'session' | 'rest_day'>;
  exerciseSlotRefs: Set<string>;
  slotTargetWeightByRef: Map<string, string | null>;
}

function deriveRefs(meals: NutritionMealSnapshot[], days: WorkoutDaySnapshot[]): DerivedRefs {
  const itemFoodIdByRef = new Map<string, string | null>();
  const slotTargetWeightByRef = new Map<string, string | null>();
  for (const meal of meals) {
    for (const item of meal.items) itemFoodIdByRef.set(item.ref, item.food_id ?? null);
  }
  for (const day of days) {
    for (const exercise of day.exercises) {
      slotTargetWeightByRef.set(exercise.ref, exercise.target_weight ?? null);
    }
  }
  return {
    mealRefs: new Set(meals.map((m) => m.ref)),
    itemFoodIdByRef,
    dayRefs: new Set(days.map((d) => d.ref)),
    dayTypeByRef: new Map(days.map((d) => [d.ref, d.day_type])),
    exerciseSlotRefs: new Set(days.flatMap((d) => d.exercises.map((e) => e.ref))),
    slotTargetWeightByRef,
  };
}

/**
 * Builds a complete validation context from the discovered catalog plus one
 * template's structure. Callers (the Edge Function) never assemble the derived
 * reference sets by hand.
 */
export function makeValidationContext(parts: {
  kind: PlanKind;
  objective: PlanObjective;
  templates: TemplateRef[];
  foodOptions: FoodOption[];
  exerciseOptions: ExerciseOption[];
  alternativeOptions: ExerciseOption[];
  meals: NutritionMealSnapshot[];
  days: WorkoutDaySnapshot[];
  allergensToAvoid: string[];
  allergenMetadataAvailable: boolean;
  hasSummary: boolean;
  metricsNewerThanSummary: boolean;
  allowedOps?: readonly string[];
}): ValidationContext {
  return { ...parts, ...deriveRefs(parts.meals, parts.days) };
}

/** Projects the full context down to the reference-only view the gate needs. */
export function preflightContextFrom(ctx: ValidationContext): PreflightContext {
  return {
    kind: ctx.kind,
    objective: ctx.objective,
    templates: ctx.templates,
    foodOptions: ctx.foodOptions,
    exerciseOptions: ctx.exerciseOptions,
    alternativeOptions: ctx.alternativeOptions,
    ...deriveRefs(ctx.meals, ctx.days),
    allergensToAvoid: ctx.allergensToAvoid,
    allergenMetadataAvailable: ctx.allergenMetadataAvailable,
    // Carried through explicitly: the router gate validates with this
    // projection, so dropping the narrowing here would let a forbidden
    // operation past the gate even though the final resolution rejected it.
    ...(ctx.allowedOps ? { allowedOps: ctx.allowedOps } : {}),
  };
}

export interface PreflightResult {
  ok: boolean;
  errors: string[];
  proposal: ValidatedProposal | null;
  notes: CoachNote[];
  /** Model-authored notes, kept separate so the server's always rank first. */
  modelNotes: CoachNote[];
  /** Reports allergen facts for a food that reached the draft. */
  reportAllergens: (food: FoodOption) => void;
}



// —————————————————————————————————————————————————————————————————————————————
// Resolved (hydratable) output shapes
// —————————————————————————————————————————————————————————————————————————————

export interface ResolvedNutritionItem {
  food_id: string | null;
  food_name: string;
  amount: number;
  unit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source_ref: string;
}

export interface ResolvedNutritionMeal {
  /** Client-side identity until the coach saves (no DB row exists yet). */
  temp_id: string;
  meal_name: string;
  sort_order: number;
  notes: string | null;
  items: ResolvedNutritionItem[];
}

export interface ResolvedNutritionDraft {
  kind: 'nutrition';
  objective: PlanObjective;
  template: { ref: string; id: string; name: string };
  plan: {
    name: string;
    daily_calories: number | null;
    daily_protein: number | null;
    daily_carbs: number | null;
    daily_fat: number | null;
    notes: string | null;
  };
  meals: ResolvedNutritionMeal[];
  totals: { calories: number; protein: number; carbs: number; fat: number };
  changes: PlanChange[];
  coach_notes: CoachNote[];
  unresolved_requirements: string[];
}

export interface ResolvedWorkoutExercise {
  exercise_id: string | null;
  exercise_name: string;
  video_url: string | null;
  sort_order: number;
  sets: number;
  rep_range: string;
  rest_seconds: number | null;
  rpe: number | null;
  warmup: boolean;
  target_weight: string | null;
  notes: string | null;
  group_id: string | null;
  group_type: string | null;
  prescribed_sets_detail: unknown;
  source_ref: string;
  /** Set when the RIR the coach asked for was converted to the stored RPE. */
  rir_source?: number | null;
}

export interface ResolvedWorkoutDay {
  temp_id: string;
  day_name: string;
  sort_order: number;
  day_type: 'session' | 'rest_day';
  notes: string | null;
  exercises: ResolvedWorkoutExercise[];
}

export interface ResolvedTrainingDraft {
  kind: 'training';
  objective: PlanObjective;
  template: { ref: string; id: string; name: string };
  plan: {
    name: string;
    split_type: string;
    custom_split_name: string | null;
    notes: string | null;
    source_template_id: string | null;
  };
  days: ResolvedWorkoutDay[];
  changes: PlanChange[];
  coach_notes: CoachNote[];
  unresolved_requirements: string[];
}

export type ResolvedDraft = ResolvedNutritionDraft | ResolvedTrainingDraft;

export interface PlanChange {
  scope: string;
  target_ref: string | null;
  target_label: string;
  change: string;
  detail: string;
}

export interface ValidatedProposal {
  schema_version: string;
  kind: PlanKind;
  objective: PlanObjective;
  selected_template_ref: string;
  selection_rationale: string;
  operations: Array<Record<string, unknown>>;
  coach_notes: CoachNote[];
  unresolved_requirements: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  proposal: ValidatedProposal | null;
  draft: ResolvedDraft | null;
}

// —————————————————————————————————————————————————————————————————————————————
// Strict proposal validation + deterministic resolution
// —————————————————————————————————————————————————————————————————————————————

const PROPOSAL_TOP_LEVEL_KEYS = [
  'schema_version',
  'kind',
  'objective',
  'selected_template_ref',
  'selection_rationale',
  'operations',
  'coach_notes',
  'unresolved_requirements',
] as const;

export const OP_KEYS_BY_TYPE: Record<string, readonly string[]> = {
  update_plan_targets: ['op', 'daily_calories', 'daily_protein', 'daily_carbs', 'daily_fat', 'reason'],
  adjust_amount: ['op', 'target_ref', 'amount', 'unit_ref', 'reason'],
  swap_food: ['op', 'target_ref', 'food_option_ref', 'amount', 'unit_ref', 'reason'],
  add_item: ['op', 'meal_ref', 'food_option_ref', 'amount', 'unit_ref', 'reason'],
  remove_item: ['op', 'target_ref', 'reason'],
  set_meal_notes: ['op', 'target_ref', 'notes', 'reason'],
  update_plan_notes: ['op', 'notes', 'reason'],
  update_sets_reps_rir: [
    'op',
    'target_ref',
    'sets',
    'rep_range',
    'rir',
    'rest_seconds',
    'target_weight',
    'reason',
  ],
  swap_exercise: ['op', 'target_ref', 'exercise_option_ref', 'reason'],
  add_exercise: [
    'op',
    'target_day_ref',
    'exercise_option_ref',
    'sets',
    'rep_range',
    'rir',
    'rest_seconds',
    'reason',
  ],
  remove_exercise: ['op', 'target_ref', 'reason'],
  set_day_type: ['op', 'target_day_ref', 'day_type', 'reason'],
  update_day_notes: ['op', 'target_day_ref', 'notes', 'reason'],
  update_exercise_notes: ['op', 'target_ref', 'notes', 'reason'],
};

const PROPOSAL_REQUIRED_KEYS = ['kind', 'objective', 'selected_template_ref', 'operations'] as const;

function safeRatio(numerator: number, denominator: number | null): number | null {
  if (denominator == null || denominator <= 0) return null;
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) ? ratio : null;
}

/**
 * Validates a model proposal against the run-scoped catalog and resolves it into
 * a planner-hydratable draft.
 *
 * Fatal problems (falsy `ok`) are ones only a better model could fix: unknown
 * fields, wrong enums, non-numeric or out-of-range numbers, references that were
 * never offered, and operations that contradict each other. The router uses
 * `ok` as its failover gate, so a hallucinating provider loses the route to the
 * next one instead of surfacing a broken draft.
 *
 * Soft problems (pinned, but `ok: true`) are things the coach must see: a
 * desired substitution the catalog could not satisfy, unavailable allergen
 * metadata, a target divergence the model itself called out.
 */
export function preflightProposal(
  raw: unknown,
  ctx: PreflightContext,
): PreflightResult {
  const errors: string[] = [];
  const notes: CoachNote[] = [];
  const modelNotes: CoachNote[] = [];
  const failed = (): PreflightResult => ({ ok: false, errors, proposal: null, notes, modelNotes, reportAllergens });

  /**
   * Allergen reporting runs for EVERY food that ends up in the draft (including
   * foods inherited unchanged from the template), not only for the ones an
   * operation touched. When the metadata query failed this emits an explicit
   * "unverified" warning per food — it must never read as "contains no
   * allergens".
   */
  const reportedAllergenRefs = new Set<string>();
  const reportAllergens = (food: FoodOption) => {
    if (reportedAllergenRefs.has(food.ref)) return;
    reportedAllergenRefs.add(food.ref);
    const slugs = (food.allergens ?? []).map((s) => s.toLowerCase());
    if (!ctx.allergenMetadataAvailable) {
      notes.push(
        makeNote(
          'allergen_metadata_unavailable',
          'warning',
          `Allergen metadata could not be loaded, so "${food.name}" is unverified. Treat it as unsafe until checked.`,
          {
            sourceRefs: [food.ref],
            requiresAcknowledgement: true,
            suggestedAction: 'Confirm allergens manually before delivery.',
          },
        ),
      );
    } else if (slugs.length > 0) {
      notes.push(
        makeNote(
          'allergen_block',
          'advisory',
          `"${food.name}" contains ${slugs.join(', ')}.`,
          { sourceRefs: [food.ref], suggestedAction: 'Confirm suitability with the client.' },
        ),
      );
    }
  };

  // —— Shape ————————————————————————————————————————————————————————————————
  if (!isPlainObject(raw)) {
    errors.push('proposal: must be a JSON object');
    return failed();
  }
  assertOnlyKeys(raw, PROPOSAL_TOP_LEVEL_KEYS, 'proposal', errors);
  for (const key of PROPOSAL_REQUIRED_KEYS) {
    if (raw[key] === undefined || raw[key] === null) errors.push(`proposal: missing "${key}"`);
  }

  if (!isPlanKind(raw.kind)) {
    errors.push(`proposal.kind: must be one of ${PLAN_KINDS.join(', ')}`);
  } else if (raw.kind !== ctx.kind) {
    errors.push(`proposal.kind: expected "${ctx.kind}" but received "${String(raw.kind)}"`);
  }

  if (!isPlanObjective(raw.objective)) {
    errors.push(`proposal.objective: must be one of ${PLAN_OBJECTIVES.join(', ')}`);
  } else if (raw.objective !== ctx.objective) {
    // The coach's choice is authoritative and must never be silently replaced.
    errors.push(
      `proposal.objective: expected the coach-selected "${ctx.objective}" but received "${raw.objective}"`,
    );
  }

  if (raw.schema_version !== undefined && raw.schema_version !== PROPOSAL_SCHEMA_VERSION) {
    errors.push(
      `proposal.schema_version: expected "${PROPOSAL_SCHEMA_VERSION}" but received "${String(raw.schema_version)}"`,
    );
  }
  if (raw.schema_version === undefined) {
    notes.push(
      makeNote('generation_incomplete', 'info', 'Proposal omitted schema_version; the server stamped the Create Plan V1 contract.', {
        suggestedAction: 'No action needed.',
      }),
    );
  }

  const templateRef = ctx.templates.find((t) => t.ref === raw.selected_template_ref)?.ref ?? null;
  if (!templateRef) {
    errors.push(
      `proposal.selected_template_ref: "${String(raw.selected_template_ref)}" was not offered in this run`,
    );
  }

  const rationale = toTrimmedString(raw.selection_rationale, LIMITS.maxRationaleLength) ?? '';

  if (!Array.isArray(raw.operations)) {
    errors.push('proposal.operations: must be an array');
  } else if (raw.operations.length === 0) {
    errors.push('proposal.operations: must contain at least one operation');
  } else if (raw.operations.length > LIMITS.maxOperations) {
    errors.push(`proposal.operations: exceeds the limit of ${LIMITS.maxOperations} operations`);
  }

  if (raw.unresolved_requirements !== undefined && !Array.isArray(raw.unresolved_requirements)) {
    errors.push('proposal.unresolved_requirements: must be an array of strings');
  }
  if (raw.coach_notes !== undefined && !Array.isArray(raw.coach_notes)) {
    errors.push('proposal.coach_notes: must be an array');
  }

  if (errors.length > 0) {
    return failed();
  }

  // —— Operations ———————————————————————————————————————————————————————————
  // A run may narrow the vocabulary (Phase 1 forbids substitutions outright).
  // That is a hard server-side restriction, not a prompt request: an operation
  // the caller never offered is rejected by name before it is interpreted.
  const allowedOps = ctx.allowedOps ?? (ctx.kind === 'nutrition' ? NUTRITION_OP_TYPES : TRAINING_OP_TYPES);

  // Conflict rules are per operation CLASS, not per target: swapping an item and
  // then setting its portion, or re-programming a slot and swapping the exercise
  // in it, are both legitimate single-intent requests. Only genuinely
  // contradictory combinations are rejected (see `removals` below). Because a
  // target may now appear in two operations, the resolvers apply operations in a
  // fixed priority order rather than array order, so the result is identical
  // however the model emitted them.
  const claimedRefs = new Set<string>();
  const removals = new Set<string>();
  const nonRemovalClaims = new Map<string, string>();
  const claims = (ref: string, opType: string) => {
    const removalOp = opType === 'remove_item' || opType === 'remove_exercise';
    if (removalOp) {
      if (nonRemovalClaims.has(ref)) {
        errors.push(
          `operations[${opType}]: "${ref}" cannot be removed and also ${nonRemovalClaims.get(ref)} in the same proposal`,
        );
        return false;
      }
      if (removals.has(ref)) {
        errors.push(`operations[${opType}]: more than one operation removes "${ref}"`);
        return false;
      }
      removals.add(ref);
      return true;
    }
    if (removals.has(ref)) {
      errors.push(
        `operations[${opType}]: "${ref}" cannot be ${opType} and also removed in the same proposal`,
      );
      return false;
    }
    const key = `${opType}|${ref}`;
    if (claimedRefs.has(key)) {
      errors.push(`operations[${opType}]: more than one ${opType} targets "${ref}"`);
      return false;
    }
    claimedRefs.add(key);
    nonRemovalClaims.set(ref, opType);
    return true;
  };

  const foodOptionByRef = new Map(ctx.foodOptions.map((o) => [o.ref, o]));
  const exerciseOptionByRef = new Map(ctx.exerciseOptions.map((o) => [o.ref, o]));
  const alternativeOptionByRef = new Map(ctx.alternativeOptions.map((o) => [o.ref, o]));
  // The reference-only projections the gate is allowed to rely on.
  const mealByRef = ctx.mealRefs;
  const dayByRef = ctx.dayRefs;
  const dayTypeByRef = ctx.dayTypeByRef;
  const itemFoodIdByRef = ctx.itemFoodIdByRef;
  const exerciseByRef = ctx.exerciseSlotRefs;
  const slotTargetWeightByRef = ctx.slotTargetWeightByRef;

  const allergenBlocklist = new Set(ctx.allergensToAvoid.map((s) => s.toLowerCase()));

  /** Resolves a `food_option_N:uK` reference to its food + authoritative unit. */
  const resolveFoodUnit = (unitRef: unknown): { food: FoodOption; unit: UnitOption } | null => {
    if (typeof unitRef !== 'string') return null;
    const idx = unitRef.lastIndexOf(':');
    if (idx <= 0) return null;
    const foodRef = unitRef.slice(0, idx);
    const food = foodOptionByRef.get(foodRef);
    if (!food) return null;
    const unit = food.units.find((u) => u.unit_ref === unitRef);
    if (!unit) return null;
    return { food, unit };
  };

  const resolveAmount = (value: unknown): number | null => {
    const num = toFiniteNumber(value);
    if (num == null) return null;
    if (num < LIMITS.minAmount || num > LIMITS.maxAmount) return null;
    return round(num, 2);
  };

  const checkFoodSafety = (food: FoodOption, opLabel: string) => {
    const slugs = (food.allergens ?? []).map((s) => s.toLowerCase());
    const hit = slugs.filter((s) => allergenBlocklist.has(s));
    if (hit.length > 0) {
      errors.push(
        `${opLabel}: "${food.name}" is blocked — the client must avoid ${hit.join(', ')}`,
      );
    }
    reportAllergens(food);
  };

  const operations: Array<Record<string, unknown>> = [];
  const rawOps = raw.operations as unknown[];

  for (let i = 0; i < rawOps.length; i += 1) {
    const opRaw = rawOps[i];
    if (!isPlainObject(opRaw)) {
      errors.push(`operations[${i}]: must be an object`);
      continue;
    }
    const opType = typeof opRaw.op === 'string' ? opRaw.op : '';
    if (!allowedOps.includes(opType as never)) {
      errors.push(`operations[${i}].op: "${opType}" is not a valid ${ctx.kind} operation`);
      continue;
    }
    const allowedKeys = OP_KEYS_BY_TYPE[opType] ?? ['op', 'reason'];
    assertOnlyKeys(opRaw, allowedKeys, `operations[${i}]`, errors);
    const label = `operations[${i}](${opType})`;
    const keep: Record<string, unknown> = { op: opType };

    const reason = toTrimmedString(opRaw.reason, LIMITS.maxTextLength);
    if (reason) keep.reason = reason;

    // —— Nutrition operations ————————————————————————————————————————————————
    if (opType === 'update_plan_targets') {
      for (const key of ['daily_calories', 'daily_protein', 'daily_carbs', 'daily_fat'] as const) {
        if (opRaw[key] === undefined || opRaw[key] === null) {
          keep[key] = null;
          continue;
        }
        const num = toFiniteNumber(opRaw[key]);
        if (num == null || num < 0 || num > 20000) {
          errors.push(`${label}.${key}: must be a number between 0 and 20000`);
          continue;
        }
        keep[key] = round(num, 0);
      }
      operations.push(keep);
      continue;
    }

    if (opType === 'update_plan_notes') {
      const text = toTrimmedString(opRaw.notes, LIMITS.maxTextLength);
      if (!text) errors.push(`${label}.notes: required, non-empty text`);
      else keep.notes = text;
      operations.push(keep);
      continue;
    }

    if (opType === 'set_meal_notes') {
      const ref = opRaw.target_ref;
      if (typeof ref !== 'string' || !mealByRef.has(ref)) {
        errors.push(`${label}.target_ref: "${String(ref)}" is not a meal in this run`);
        continue;
      }
      if (!claims(ref, opType)) continue;
      const text = toTrimmedString(opRaw.notes, LIMITS.maxTextLength);
      if (!text) errors.push(`${label}.notes: required, non-empty text`);
      else keep.notes = text;
      keep.target_ref = ref;
      operations.push(keep);
      continue;
    }

    if (opType === 'adjust_amount') {
      const ref = opRaw.target_ref;
      if (typeof ref !== 'string' || !itemFoodIdByRef.has(ref)) {
        errors.push(`${label}.target_ref: "${String(ref)}" is not an item in this run`);
        continue;
      }
      if (!claims(ref, opType)) continue;
      const amount = resolveAmount(opRaw.amount);
      if (amount == null) {
        errors.push(`${label}.amount: must be a number between ${LIMITS.minAmount} and ${LIMITS.maxAmount}`);
        continue;
      }
      const resolvedUnit = resolveFoodUnit(opRaw.unit_ref);
      if (opRaw.unit_ref !== undefined && !resolvedUnit) {
        errors.push(`${label}.unit_ref: "${String(opRaw.unit_ref)}" was not offered in this run`);
        continue;
      }
      keep.target_ref = ref;
      keep.amount = amount;
      if (resolvedUnit) keep.unit_ref = resolvedUnit.unit.unit_ref;
      else keep.unit_ref = null;
      operations.push(keep);
      continue;
    }

    if (opType === 'swap_food' || opType === 'add_item') {
      const optionRef = opRaw.food_option_ref;
      const option = typeof optionRef === 'string' ? foodOptionByRef.get(optionRef) : undefined;
      if (!option) {
        errors.push(`${label}.food_option_ref: "${String(optionRef)}" was not offered in this run`);
        continue;
      }
      const amount = resolveAmount(opRaw.amount);
      if (amount == null) {
        errors.push(`${label}.amount: must be a number between ${LIMITS.minAmount} and ${LIMITS.maxAmount}`);
        continue;
      }
      const resolvedUnit = resolveFoodUnit(opRaw.unit_ref);
      if (!resolvedUnit) {
        errors.push(`${label}.unit_ref: "${String(opRaw.unit_ref)}" was not offered in this run`);
        continue;
      }
      if (resolvedUnit.food.ref !== option.ref) {
        errors.push(
          `${label}.unit_ref: "${String(opRaw.unit_ref)}" belongs to ${resolvedUnit.food.ref}, not ${option.ref}`,
        );
        continue;
      }
      checkFoodSafety(option, label);
      if (opType === 'swap_food') {
        const ref = opRaw.target_ref;
        if (typeof ref !== 'string' || !itemFoodIdByRef.has(ref)) {
          errors.push(`${label}.target_ref: "${String(ref)}" is not an item in this run`);
          continue;
        }
        if (!claims(ref, opType)) continue;
        keep.target_ref = ref;
      } else {
        const mealRef = opRaw.meal_ref;
        if (typeof mealRef !== 'string' || !mealByRef.has(mealRef)) {
          errors.push(`${label}.meal_ref: "${String(mealRef)}" is not a meal in this run`);
          continue;
        }
        keep.meal_ref = mealRef;
      }
      keep.food_option_ref = option.ref;
      keep.amount = amount;
      keep.unit_ref = resolvedUnit.unit.unit_ref;
      operations.push(keep);
      continue;
    }

    if (opType === 'remove_item') {
      const ref = opRaw.target_ref;
      if (typeof ref !== 'string' || !itemFoodIdByRef.has(ref)) {
        errors.push(`${label}.target_ref: "${String(ref)}" is not an item in this run`);
        continue;
      }
      if (!claims(ref, opType)) continue;
      keep.target_ref = ref;
      operations.push(keep);
      continue;
    }

    // —— Training operations —————————————————————————————————————————————————
    if (opType === 'update_plan_notes') {
      const text = toTrimmedString(opRaw.notes, LIMITS.maxTextLength);
      if (!text) errors.push(`${label}.notes: required, non-empty text`);
      else keep.notes = text;
      operations.push(keep);
      continue;
    }

    if (opType === 'update_sets_reps_rir') {
      const ref = opRaw.target_ref;
      if (typeof ref !== 'string' || !exerciseByRef.has(ref)) {
        errors.push(`${label}.target_ref: "${String(ref)}" is not an exercise in this run`);
        continue;
      }
      if (!claims(ref, opType)) continue;
      keep.target_ref = ref;
      if (opRaw.sets !== undefined) {
        const num = toFiniteNumber(opRaw.sets);
        if (num == null || !Number.isInteger(num) || num < LIMITS.minSets || num > LIMITS.maxSets) {
          errors.push(`${label}.sets: must be a whole number between ${LIMITS.minSets} and ${LIMITS.maxSets}`);
          continue;
        }
        keep.sets = num;
      }
      if (opRaw.rep_range !== undefined) {
        const text = toTrimmedString(opRaw.rep_range, 40);
        if (!text) errors.push(`${label}.rep_range: must be non-empty text such as "8-12"`);
        else keep.rep_range = text;
      }
      if (opRaw.rir !== undefined) {
        const num = toFiniteNumber(opRaw.rir);
        if (num == null || num < LIMITS.minRir || num > LIMITS.maxRir) {
          errors.push(`${label}.rir: must be between ${LIMITS.minRir} and ${LIMITS.maxRir} reps in reserve`);
          continue;
        }
        keep.rir = round(num, 1);
      }
      if (opRaw.rest_seconds !== undefined && opRaw.rest_seconds !== null) {
        const num = toFiniteNumber(opRaw.rest_seconds);
        if (num == null || num < 0 || num > LIMITS.maxRestSeconds) {
          errors.push(`${label}.rest_seconds: must be between 0 and ${LIMITS.maxRestSeconds}`);
          continue;
        }
        keep.rest_seconds = Math.round(num);
      }
      if (opRaw.target_weight !== undefined && opRaw.target_weight !== null) {
        // Requirement 14 — the model must not invent loads. A weight is only ever
        // accepted when the template already carried one for this exact slot.
        const existing = slotTargetWeightByRef.get(ref) ?? null;
        if (existing && String(opRaw.target_weight).trim() === existing) keep.target_weight = existing;
        else {
          errors.push(
            `${label}.target_weight: loads cannot be generated. Set the weight in the planner instead.`,
          );
          continue;
        }
      }
      operations.push(keep);
      continue;
    }

    if (opType === 'swap_exercise' || opType === 'add_exercise') {
      const optionRef = opRaw.exercise_option_ref;
      const option =
        (typeof optionRef === 'string' ? exerciseOptionByRef.get(optionRef) : undefined) ??
        (typeof optionRef === 'string' ? alternativeOptionByRef.get(optionRef) : undefined);
      if (!option) {
        errors.push(`${label}.exercise_option_ref: "${String(optionRef)}" was not offered in this run`);
        continue;
      }
      if (opType === 'swap_exercise') {
        const ref = opRaw.target_ref;
        if (typeof ref !== 'string' || !exerciseByRef.has(ref)) {
          errors.push(`${label}.target_ref: "${String(ref)}" is not an exercise in this run`);
          continue;
        }
        if (!claims(ref, opType)) continue;
        keep.target_ref = ref;
      } else {
        const dayRef = opRaw.target_day_ref;
        if (typeof dayRef !== 'string' || !dayByRef.has(dayRef)) {
          errors.push(`${label}.target_day_ref: "${String(dayRef)}" is not a day in this run`);
          continue;
        }
        if (dayTypeByRef.get(dayRef) === 'rest_day') {
          errors.push(`${label}.target_day_ref: "${dayRef}" is a rest day and cannot receive exercises`);
          continue;
        }
        keep.target_day_ref = dayRef;
      }
      keep.exercise_option_ref = option.ref;

      if (opRaw.sets !== undefined) {
        const num = toFiniteNumber(opRaw.sets);
        if (num == null || !Number.isInteger(num) || num < LIMITS.minSets || num > LIMITS.maxSets) {
          errors.push(`${label}.sets: must be a whole number between ${LIMITS.minSets} and ${LIMITS.maxSets}`);
          continue;
        }
        keep.sets = num;
      }
      if (opRaw.rep_range !== undefined) {
        const text = toTrimmedString(opRaw.rep_range, 40);
        if (!text) errors.push(`${label}.rep_range: must be non-empty text such as "8-12"`);
        else keep.rep_range = text;
      }
      if (opRaw.rir !== undefined) {
        const num = toFiniteNumber(opRaw.rir);
        if (num == null || num < LIMITS.minRir || num > LIMITS.maxRir) {
          errors.push(`${label}.rir: must be between ${LIMITS.minRir} and ${LIMITS.maxRir} reps in reserve`);
          continue;
        }
        keep.rir = round(num, 1);
      }
      if (opRaw.rest_seconds !== undefined && opRaw.rest_seconds !== null) {
        const num = toFiniteNumber(opRaw.rest_seconds);
        if (num == null || num < 0 || num > LIMITS.maxRestSeconds) {
          errors.push(`${label}.rest_seconds: must be between 0 and ${LIMITS.maxRestSeconds}`);
          continue;
        }
        keep.rest_seconds = Math.round(num);
      }
      operations.push(keep);
      continue;
    }

    if (opType === 'remove_exercise') {
      const ref = opRaw.target_ref;
      if (typeof ref !== 'string' || !exerciseByRef.has(ref)) {
        errors.push(`${label}.target_ref: "${String(ref)}" is not an exercise in this run`);
        continue;
      }
      if (!claims(ref, opType)) continue;
      keep.target_ref = ref;
      operations.push(keep);
      continue;
    }

    if (opType === 'set_day_type') {
      const dayRef = opRaw.target_day_ref;
      if (typeof dayRef !== 'string' || !dayByRef.has(dayRef)) {
        errors.push(`${label}.target_day_ref: "${String(dayRef)}" is not a day in this run`);
        continue;
      }
      if (!claims(dayRef, opType)) continue;
      const dayType = opRaw.day_type;
      if (dayType !== 'session' && dayType !== 'rest_day') {
        errors.push(`${label}.day_type: must be "session" or "rest_day"`);
        continue;
      }
      keep.target_day_ref = dayRef;
      keep.day_type = dayType;
      operations.push(keep);
      continue;
    }

    if (opType === 'update_day_notes' || opType === 'update_exercise_notes') {
      const isDay = opType === 'update_day_notes';
      const ref = isDay ? opRaw.target_day_ref : opRaw.target_ref;
      const known = isDay ? dayByRef.has(String(ref)) : exerciseByRef.has(String(ref));
      if (typeof ref !== 'string' || !known) {
        errors.push(`${label}.${isDay ? 'target_day_ref' : 'target_ref'}: "${String(ref)}" was not offered in this run`);
        continue;
      }
      if (!claims(ref as string, opType)) continue;
      const text = toTrimmedString(opRaw.notes, LIMITS.maxTextLength);
      if (!text) errors.push(`${label}.notes: required, non-empty text`);
      else keep.notes = text;
      keep[isDay ? 'target_day_ref' : 'target_ref'] = ref;
      operations.push(keep);
      continue;
    }
  }

  if (errors.length > 0) {
    return failed();
  }

  // —— Model-proposed coach notes (strict, then merged) —————————————————————
  for (const [i, entry] of ((raw.coach_notes ?? []) as unknown[]).entries()) {
    if (!isPlainObject(entry)) {
      errors.push(`coach_notes[${i}]: must be an object`);
      continue;
    }
    assertOnlyKeys(
      entry,
      [
        'code',
        'severity',
        'message',
        'source_refs',
        'target_ref',
        'suggested_action',
        'requires_acknowledgement',
      ],
      `coach_notes[${i}]`,
      errors,
    );
    const message = toTrimmedString(entry.message, LIMITS.maxPinnedNoteMessage);
    if (!message) {
      errors.push(`coach_notes[${i}].message: required, non-empty text`);
      continue;
    }
    if (entry.severity !== undefined && !NOTE_SEVERITIES.includes(entry.severity as NoteSeverity)) {
      errors.push(`coach_notes[${i}].severity: must be one of ${NOTE_SEVERITIES.join(', ')}`);
      continue;
    }
    const sourceRefs = Array.isArray(entry.source_refs)
      ? entry.source_refs.filter((r): r is string => typeof r === 'string').slice(0, 10)
      : [];
    modelNotes.push(
      makeNote(typeof entry.code === 'string' ? entry.code : 'generation_incomplete', (entry.severity as NoteSeverity) ?? 'info', message, {
        sourceRefs,
        targetRef: typeof entry.target_ref === 'string' ? entry.target_ref : null,
        suggestedAction:
          typeof entry.suggested_action === 'string'
            ? toTrimmedString(entry.suggested_action, LIMITS.maxTextLength)
            : null,
        requiresAcknowledgement: entry.requires_acknowledgement === true,
      }),
    );
  }

  const unresolved = ((raw.unresolved_requirements ?? []) as unknown[])
    .map((v) => toTrimmedString(v, 300))
    .filter((v): v is string => Boolean(v))
    .slice(0, LIMITS.maxUnresolvedRequirements);
  if (unresolved.length > 0) {
    for (const requirement of unresolved) {
      notes.push(
        makeNote('generation_incomplete', 'advisory', `Unresolved requirement: ${requirement}`, {
          suggestedAction: 'Review and complete in the planner.',
        }),
      );
    }
  }

  if (errors.length > 0) {
    return failed();
  }

  const proposal: ValidatedProposal = {
    schema_version: PROPOSAL_SCHEMA_VERSION,
    kind: ctx.kind,
    objective: ctx.objective,
    selected_template_ref: templateRef!,
    selection_rationale: rationale,
    operations,
    coach_notes: modelNotes,
    unresolved_requirements: unresolved,
  };

  return { ok: true, errors: [], proposal, notes, modelNotes, reportAllergens };
}

/**
 * Authoritative resolution: preflight the proposal against the run-scoped
 * catalog, then apply it to the real template structure. The preflight is the
 * same code the router uses as its failover gate, so a provider that
 * hallucinated a reference, an enum, a number or a conflicting operation loses
 * the route rather than producing a broken draft.
 */
export function validateProposal(raw: unknown, ctx: ValidationContext): ValidationResult {
  const pre = preflightContextFrom(ctx);
  const pre1 = preflightProposal(raw, pre);
  if (!pre1.ok || !pre1.proposal) {
    return { ok: false, errors: pre1.errors, proposal: null, draft: null };
  }
  const proposal = pre1.proposal;
  const notes = pre1.notes;

  const acc: Accumulator = { errors: [], notes, reportAllergens: pre1.reportAllergens };
  const draft =
    ctx.kind === 'nutrition'
      ? buildNutritionDraft(proposal, ctx, acc)
      : buildTrainingDraft(proposal, ctx, acc);

  if (acc.errors.length > 0) {
    return { ok: false, errors: acc.errors, proposal: null, draft: null };
  }

  return {
    ok: true,
    errors: [],
    proposal,
    draft: { ...draft, coach_notes: mergeNotes(notes, proposal.coach_notes) } as ResolvedDraft,
  };
}

/** `nutrition_plans` daily target column -> the short name used in the draft. */
const PLAN_TARGET_FIELDS = [
  ['daily_calories', 'calories'],
  ['daily_protein', 'protein'],
  ['daily_carbs', 'carbs'],
  ['daily_fat', 'fat'],
] as const;

interface Accumulator {
  errors: string[];
  notes: CoachNote[];
  /** Reports allergen facts for a food that ended up in the resolved draft. */
  reportAllergens?: (food: FoodOption) => void;
}

/** Deterministic application order, so a proposal resolves identically no
 *  matter what order the model emitted its operations in. */
const NUTRITION_OP_PRIORITY: Record<string, number> = {
  update_plan_targets: 0,
  swap_food: 1,
  adjust_amount: 2,
  add_item: 3,
  remove_item: 4,
  set_meal_notes: 5,
  update_plan_notes: 6,
};

const TRAINING_OP_PRIORITY: Record<string, number> = {
  update_plan_notes: 0,
  swap_exercise: 1,
  update_sets_reps_rir: 2,
  add_exercise: 3,
  set_day_type: 4,
  remove_exercise: 5,
  update_day_notes: 6,
  update_exercise_notes: 7,
};

function inPriorityOrder(
  operations: Array<Record<string, unknown>>,
  priority: Record<string, number>,
): Array<Record<string, unknown>> {
  return operations
    .map((op, index) => ({ op, index }))
    .sort((a, b) => {
      const pa = priority[String(a.op.op)] ?? 99;
      const pb = priority[String(b.op.op)] ?? 99;
      return pa === pb ? a.index - b.index : pa - pb;
    })
    .map((entry) => entry.op);
}

// —————————————————————————————————————————————————————————————————————————————
// Nutrition draft resolution (requirement 9 — application-calculated macros)
// —————————————————————————————————————————————————————————————————————————————
let draftRequestId = '';
export function setDraftRequestId(id: string) { draftRequestId = id; }
function draftLog(stage: string, extra?: Record<string, unknown>) {
  if (!draftRequestId) return;
  console.log(JSON.stringify({ level: 'INFO', msg: `create-plan:draft:${stage}`, requestId: draftRequestId, ...extra }));
}
function draftError(stage: string, err: unknown, extra?: Record<string, unknown>) {
  if (!draftRequestId) return;
  let serialized: Record<string, unknown> = {};
  if (err instanceof Error) {
    serialized = { message: err.message, name: err.name, stack: err.stack };
  } else {
    serialized = { value: String(err) };
  }
  console.error(JSON.stringify({ level: 'ERROR', msg: `create-plan:draft:${stage}:error`, requestId: draftRequestId, error: serialized, ...extra }));
}

function buildNutritionDraft(
  proposal: ValidatedProposal,
  ctx: ValidationContext,
  acc: Accumulator,
): ResolvedNutritionDraft {
  draftLog('build-start', { templateRef: proposal.selected_template_ref, operationsCount: proposal.operations.length });
  
  const { errors, notes } = acc;
  const template = ctx.templates.find((t) => t.ref === proposal.selected_template_ref)!;
  const changes: PlanChange[] = [];

  // Start from a deep copy of the template structure so the template is
  // preserved by construction and the model can only express deltas.
  const meals: ResolvedNutritionMeal[] = ctx.meals.map((meal) => ({
    temp_id: meal.id,
    meal_name: meal.meal_name,
    sort_order: meal.sort_order,
    notes: meal.notes,
    items: meal.items.map((item) => ({
      food_id: item.food_id,
      food_name: item.food_name,
      amount: item.amount,
      unit: item.unit,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
      source_ref: `item:${item.ref}`,
    })),
  }));

  const mealIndexById = new Map(meals.map((m) => [m.temp_id, m]));
  // ref -> { meal, index } resolved from the ORIGINAL template snapshots, so
  // removal/reordering of hydrated items can never desynchronize the lookup.
  const itemLocByRef = new Map<string, { meal: ResolvedNutritionMeal; index: number }>();
  for (const sourceMeal of ctx.meals) {
    const target = mealIndexById.get(sourceMeal.id);
    if (!target) continue;
    for (const [index, item] of sourceMeal.items.entries()) {
      itemLocByRef.set(item.ref, { meal: target, index });
    }
  }

  const foodOptionByRef = new Map(ctx.foodOptions.map((o) => [o.ref, o]));
  const resolveUnit = (unitRef: unknown) => {
    if (typeof unitRef !== 'string') return null;
    const idx = unitRef.lastIndexOf(':');
    if (idx <= 0) return null;
    const food = foodOptionByRef.get(unitRef.slice(0, idx));
    const unit = food?.units.find((u) => u.unit_ref === unitRef);
    return food && unit ? { food, unit } : null;
  };

  const pendingTargets: { calories: number | null; protein: number | null; carbs: number | null; fat: number | null } = {
    calories: toFiniteNumber(template.meta.daily_calories),
    protein: toFiniteNumber(template.meta.daily_protein),
    carbs: toFiniteNumber(template.meta.daily_carbs),
    fat: toFiniteNumber(template.meta.daily_fat),
  };
  let planNotes = typeof template.meta.notes === 'string' ? template.meta.notes : null;
  const removed = new Set<string>();
  let addedCount = 0;
  let swappedCount = 0;
  let adjustedCount = 0;

  for (const op of inPriorityOrder(proposal.operations, NUTRITION_OP_PRIORITY)) {
    switch (op.op) {
      case 'update_plan_targets': {
        for (const [column, field] of PLAN_TARGET_FIELDS) {
          const next = op[column] as number | null;
          if (next == null) continue;
          if (pendingTargets[field] !== next) {
            changes.push({
              scope: 'plan',
              target_ref: null,
              target_label: 'Daily targets',
              change: 'target',
              detail: `${field}: ${pendingTargets[field] ?? '—'} — ${next}`,
            });
          }
          pendingTargets[field] = next;
        }
        break;
      }
      case 'update_plan_notes': {
        const text = op.notes as string;
        if (planNotes !== text) {
          changes.push({
            scope: 'plan',
            target_ref: null,
            target_label: 'Plan notes',
            change: 'note',
            detail: 'Plan notes updated.',
          });
        }
        planNotes = text;
        break;
      }
      case 'set_meal_notes': {
        const ref = op.target_ref as string;
        const meal = ctx.meals.find((m) => m.ref === ref);
        const target = meal ? mealIndexById.get(meal.id) : undefined;
        if (target) {
          target.notes = op.notes as string;
          changes.push({
            scope: 'meal',
            target_ref: ref,
            target_label: target.meal_name,
            change: 'note',
            detail: 'Meal notes updated.',
          });
        }
        break;
      }
      case 'adjust_amount': {
        const loc = itemLocByRef.get(op.target_ref as string);
        if (!loc) break;
        const current = loc.meal.items[loc.index];
        const before = `${current.amount} ${current.unit} (${current.calories} kcal)`;
        const nextAmount = op.amount as number;
        let nextUnit = current.unit;
        if (typeof op.unit_ref === 'string') {
          const resolved = resolveUnit(op.unit_ref);
          if (!resolved) {
            draftError('adjust_amount:unit-unresolved', new Error('Unit not resolved'), { unitRef: op.unit_ref, targetRef: op.target_ref });
            errors.push(`operations(adjust_amount): unit "${String(op.unit_ref)}" could not be resolved`);
            break;
          }
          if (resolved.food.id !== current.food_id) {
            // Swapping the food through adjust_amount is a swap, not an amount change.
            draftError('adjust_amount:food-mismatch', new Error('Food ID mismatch'), { resolvedFoodId: resolved.food.id, currentFoodId: current.food_id });
            errors.push(
              `operations(adjust_amount): "${op.target_ref as string}" refers to a different food than the one it adjusts`,
            );
            break;
          }
          nextUnit = resolved.unit.unit;
          try {
            const macros = calculateMacros(resolved.food as unknown as FoodRow, nextAmount, resolved.unit);
            draftLog('adjust_amount:macros-calculated', { targetRef: op.target_ref, amount: nextAmount, unit: nextUnit, macros });
            current.calories = macros.calories;
            current.protein = macros.protein;
            current.carbs = macros.carbs;
            current.fat = macros.fat;
          } catch (e) {
            draftError('adjust_amount:calculateMacros', e, { targetRef: op.target_ref, amount: nextAmount, unitRef: op.unit_ref });
            throw e;
          }
        }
        current.amount = nextAmount;
        current.unit = nextUnit;
        adjustedCount += 1;
        changes.push({
          scope: 'item',
          target_ref: op.target_ref as string,
          target_label: current.food_name,
          change: 'amount',
          detail: `${before} — ${current.amount} ${current.unit} (${current.calories} kcal)`,
        });
        break;
      }
      case 'swap_food': {
        const ref = op.target_ref as string;
        const loc = itemLocByRef.get(ref);
        const meal = loc?.meal;
        const resolved = resolveUnit(op.unit_ref);
        const option = foodOptionByRef.get(op.food_option_ref as string);
        if (!loc || !meal || !resolved || !option) {
          draftError('swap_food:missing-data', new Error('Missing required data'), { hasLoc: !!loc, hasMeal: !!meal, hasResolved: !!resolved, hasOption: !!option });
          break;
        }
        const current = meal.items[loc.index];
        if (current.food_id === option.id) {
          notes.push(
            makeNote('food_swapped', 'info', `"${current.food_name}" was already the selected food.`, {
              sourceRefs: [option.ref],
              targetRef: ref,
            }),
          );
          break;
        }
        const amount = op.amount as number;
        try {
          const macros = calculateMacros(option as unknown as FoodRow, amount, resolved.unit);
          draftLog('swap_food:macros-calculated', { targetRef: ref, foodOptionRef: op.food_option_ref, amount, macros });
          const before = `${current.food_name}`;
          current.food_id = option.id;
          current.food_name = option.name;
          current.amount = amount;
          current.unit = resolved.unit.unit;
          current.calories = macros.calories;
          current.protein = macros.protein;
          current.carbs = macros.carbs;
          current.fat = macros.fat;
          current.source_ref = option.ref;
          swappedCount += 1;
          changes.push({
            scope: 'item',
            target_ref: ref,
            target_label: option.name,
            change: 'swap',
            detail: `${before} — ${option.name} (${amount} ${resolved.unit.unit}, ${macros.calories} kcal)`,
          });
        } catch (e) {
          draftError('swap_food:calculateMacros', e, { targetRef: ref, foodOptionRef: op.food_option_ref, amount });
          throw e;
        }
        break;
      }
      case 'add_item': {
        const meal = ctx.meals.find((m) => m.ref === op.meal_ref);
        const target = meal ? mealIndexById.get(meal.id) : undefined;
        const resolved = resolveUnit(op.unit_ref);
        const option = foodOptionByRef.get(op.food_option_ref as string);
        if (!target || !resolved || !option) {
          draftError('add_item:missing-data', new Error('Missing required data'), { hasTarget: !!target, hasResolved: !!resolved, hasOption: !!option });
          break;
        }
        const amount = op.amount as number;
        try {
          const macros = calculateMacros(option as unknown as FoodRow, amount, resolved.unit);
          draftLog('add_item:macros-calculated', { mealRef: op.meal_ref, foodOptionRef: op.food_option_ref, amount, macros });
          // Deterministic merge: an identical food already present is adjusted, not duplicated.
          const existing = target.items.find((i) => i.food_id === option.id);
          if (existing) {
            const before = `${existing.amount} ${existing.unit}`;
            const combined = round(existing.amount + amount, 2);
            try {
              const combinedMacros = calculateMacros(option as unknown as FoodRow, combined, resolved.unit);
              draftLog('add_item:combined-macros-calculated', { mealRef: op.meal_ref, foodOptionRef: op.food_option_ref, combinedAmount: combined, macros: combinedMacros });
              existing.amount = combined;
              existing.unit = resolved.unit.unit;
              existing.calories = combinedMacros.calories;
              existing.protein = combinedMacros.protein;
              existing.carbs = combinedMacros.carbs;
              existing.fat = combinedMacros.fat;
              existing.source_ref = option.ref;
              changes.push({
                scope: 'item',
                target_ref: op.meal_ref as string,
                target_label: option.name,
                change: 'amount',
                detail: `${before} + ${amount} ${resolved.unit.unit} — ${combined} ${resolved.unit.unit}`,
              });
            } catch (e) {
              draftError('add_item:combined-calculateMacros', e, { mealRef: op.meal_ref, foodOptionRef: op.food_option_ref, combinedAmount: combined });
              throw e;
            }
            break;
          }
          target.items.push({
            food_id: option.id,
            food_name: option.name,
            amount,
            unit: resolved.unit.unit,
            calories: macros.calories,
            protein: macros.protein,
            carbs: macros.carbs,
            fat: macros.fat,
            source_ref: option.ref,
          });
          addedCount += 1;
          changes.push({
            scope: 'meal',
            target_ref: op.meal_ref as string,
            target_label: target.meal_name,
            change: 'add',
            detail: `+ ${option.name} (${amount} ${resolved.unit.unit}, ${macros.calories} kcal)`,
          });
        } catch (e) {
          draftError('add_item:calculateMacros', e, { mealRef: op.meal_ref, foodOptionRef: op.food_option_ref, amount });
          throw e;
        }
        break;
      }
      case 'remove_item': {
        const ref = op.target_ref as string;
        const loc = itemLocByRef.get(ref);
        const meal = loc?.meal;
        if (!loc || !meal) break;
        const [removedItem] = meal.items.splice(loc.index, 1);
        removed.add(ref);
        changes.push({
          scope: 'item',
          target_ref: ref,
          target_label: removedItem?.food_name ? removedItem.food_name : 'Item',
          change: 'remove',
          detail: `Removed ${removedItem?.food_name ?? 'item'}.`,
        });
        break;
      }
      default:
        break;
    }
  }

  // Every food that survives into the draft gets an allergen fact — including
  // foods inherited unchanged from the template, which no operation touched.
  if (typeof acc.reportAllergens === 'function') {
    const optionByFoodId = new Map<string, FoodOption>();
    for (const option of foodOptionByRef.values()) optionByFoodId.set(option.id, option);
    const seenFoods = new Set<string>();
    for (const meal of meals) {
      for (const item of meal.items) {
        if (!item.food_id || seenFoods.has(item.food_id)) continue;
        seenFoods.add(item.food_id);
        const option = optionByFoodId.get(item.food_id);
        if (option) acc.reportAllergens(option);
      }
    }
  }

  const totals = meals.reduce(
    (acc, meal) => {
      for (const item of meal.items) {
        acc.calories += item.calories;
        acc.protein += item.protein;
        acc.carbs += item.carbs;
        acc.fat += item.fat;
      }
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const totalsRounded = {
    calories: Math.round(totals.calories),
    protein: round(totals.protein, 1),
    carbs: round(totals.carbs, 1),
    fat: round(totals.fat, 1),
  };

  // Requirement 11 — flag divergence instead of silently forcing targets.
  const calorieRatio = safeRatio(totalsRounded.calories, pendingTargets.calories);
  if (calorieRatio != null && (calorieRatio > 1.1 || calorieRatio < 0.9)) {
    notes.push(
      makeNote(
        'macro_target_divergence',
        'advisory',
        `Items total ${totalsRounded.calories} kcal against a ${Math.round(pendingTargets.calories ?? 0)} kcal target.`,
        {
          suggestedAction:
            'Adjust portions in the planner, or update the daily target to match the food you actually want.',
        },
      ),
    );
  }

  notes.push(
    makeNote(
      'structure_preserved',
      'info',
      `Started from "${template.name}" — ${meals.length} meals preserved${addedCount ? `, ${addedCount} item(s) added` : ''}${swappedCount ? `, ${swappedCount} food(s) swapped` : ''}${adjustedCount ? `, ${adjustedCount} portion(s) adjusted` : ''}.`,
      {
        sourceRefs: [template.ref],
        suggestedAction: 'Nothing here is saved yet. Review, then save.',
      },
    ),
  );

  return {
    kind: 'nutrition',
    objective: ctx.objective,
    template: { ref: template.ref, id: template.id, name: template.name },
    plan: {
      name: typeof template.meta.name === 'string' ? template.meta.name : template.name,
      daily_calories: pendingTargets.calories == null ? null : Math.round(pendingTargets.calories),
      daily_protein: pendingTargets.protein == null ? null : round(pendingTargets.protein, 1),
      daily_carbs: pendingTargets.carbs == null ? null : round(pendingTargets.carbs, 1),
      daily_fat: pendingTargets.fat == null ? null : round(pendingTargets.fat, 1),
      notes: planNotes,
    },
    meals: meals
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((meal) => ({ ...meal, sort_order: meal.sort_order })),
    totals: totalsRounded,
    changes,
    coach_notes: notes,
    unresolved_requirements: proposal.unresolved_requirements,
  };
}

// —————————————————————————————————————————————————————————————————————————————
// Training draft resolution (requirements 14/15 — RIR is converted, never renamed)
// —————————————————————————————————————————————————————————————————————————————

function buildTrainingDraft(
  proposal: ValidatedProposal,
  ctx: ValidationContext,
  acc: Accumulator,
): ResolvedTrainingDraft {
  const { errors, notes } = acc;
  const template = ctx.templates.find((t) => t.ref === proposal.selected_template_ref)!;
  const changes: PlanChange[] = [];

  const days: ResolvedWorkoutDay[] = ctx.days.map((day) => ({
    temp_id: day.id,
    day_name: day.day_name,
    sort_order: day.sort_order,
    day_type: day.day_type,
    notes: day.notes,
    exercises: day.exercises.map((exercise) => ({
      exercise_id: exercise.exercise_id,
      exercise_name: exercise.exercise_name,
      video_url: exercise.video_url,
      sort_order: exercise.sort_order,
      sets: exercise.sets,
      rep_range: exercise.rep_range,
      rest_seconds: exercise.rest_seconds,
      rpe: exercise.rpe,
      warmup: exercise.warmup,
      target_weight: exercise.target_weight,
      notes: exercise.notes,
      group_id: exercise.group_id,
      group_type: exercise.group_type,
      prescribed_sets_detail: exercise.prescribed_sets_detail,
      source_ref: `exercise:${exercise.ref}`,
    })),
  }));

  const dayById = new Map(days.map((d) => [d.temp_id, d]));
  const exerciseLocByRef = new Map<string, { day: ResolvedWorkoutDay; index: number }>();
  for (const day of ctx.days) {
    for (const [index, exercise] of day.exercises.entries()) {
      const target = dayById.get(day.id);
      if (target) exerciseLocByRef.set(exercise.ref, { day: target, index });
    }
  }

  const optionByRef = new Map<string, ExerciseOption>([
    ...ctx.exerciseOptions.map((o) => [o.ref, o] as const),
    ...ctx.alternativeOptions.map((o) => [o.ref, o] as const),
  ]);

  let rirConverted = 0;
  let swappedCount = 0;
  let addedCount = 0;
  let removedCount = 0;
  let programmedCount = 0;
  let unresolvedVersions = 0;

  const setRir = (exercise: ResolvedWorkoutExercise, rir: number, ref: string) => {
    const rpe = rirToRpe(rir);
    exercise.rpe = rpe;
    exercise.rir_source = rir;
    rirConverted += 1;
    notes.push(
      makeNote('rir_converted', 'info', `"${exercise.exercise_name}": ${rir} RIR — RPE ${rpe}.`, {
        sourceRefs: [ref],
        targetRef: ref,
        suggestedAction: 'The plan stores RPE; the coach reads RIR.',
      }),
    );
  };

  for (const op of inPriorityOrder(proposal.operations, TRAINING_OP_PRIORITY)) {
    switch (op.op) {
      case 'update_plan_notes': {
        changes.push({
          scope: 'plan',
          target_ref: null,
          target_label: 'Plan notes',
          change: 'note',
          detail: 'Plan notes updated.',
        });
        break;
      }
      case 'update_day_notes': {
        const day = ctx.days.find((d) => d.ref === op.target_day_ref);
        const target = day ? dayById.get(day.id) : undefined;
        if (target) {
          target.notes = op.notes as string;
          changes.push({
            scope: 'day',
            target_ref: op.target_day_ref as string,
            target_label: target.day_name,
            change: 'note',
            detail: 'Session notes updated.',
          });
        }
        break;
      }
      case 'set_day_type': {
        const day = ctx.days.find((d) => d.ref === op.target_day_ref);
        const target = day ? dayById.get(day.id) : undefined;
        if (target && target.day_type !== op.day_type) {
          const before = target.day_type;
          target.day_type = op.day_type as 'session' | 'rest_day';
          changes.push({
            scope: 'day',
            target_ref: op.target_day_ref as string,
            target_label: target.day_name,
            change: 'day_type',
            detail: `${before} — ${String(op.day_type)}`,
          });
        }
        break;
      }
      case 'update_sets_reps_rir': {
        const loc = exerciseLocByRef.get(op.target_ref as string);
        if (!loc) break;
        const exercise = loc.day.exercises[loc.index];
        const before = `${exercise.sets} sets — ${exercise.rep_range}${
          exercise.rpe == null ? '' : ` @ RPE ${exercise.rpe}`
        }`;
        if (typeof op.sets === 'number') exercise.sets = op.sets;
        if (typeof op.rep_range === 'string') exercise.rep_range = op.rep_range;
        if (typeof op.rest_seconds === 'number') exercise.rest_seconds = op.rest_seconds;
        if (typeof op.target_weight === 'string') exercise.target_weight = op.target_weight;
        if (typeof op.rir === 'number') setRir(exercise, op.rir, op.target_ref as string);
        const after = `${exercise.sets} sets — ${exercise.rep_range}${
          exercise.rpe == null ? '' : ` @ RPE ${exercise.rpe}`
        }`;
        if (before !== after) {
          programmedCount += 1;
          changes.push({
            scope: 'exercise',
            target_ref: op.target_ref as string,
            target_label: exercise.exercise_name,
            change: 'programming',
            detail: `${before} — ${after}`,
          });
        }
        break;
      }
      case 'swap_exercise': {
        const loc = exerciseLocByRef.get(op.target_ref as string);
        const option = optionByRef.get(op.exercise_option_ref as string);
        if (!loc || !option) break;
        const exercise = loc.day.exercises[loc.index];
        if (exercise.exercise_id === option.id) {
          notes.push(
            makeNote('exercise_swapped', 'info', `"${exercise.exercise_name}" was already the selected exercise.`, {
              sourceRefs: [option.ref],
              targetRef: op.target_ref as string,
            }),
          );
          break;
        }
        const before = exercise.exercise_name;
        const inheritedLoad = exercise.target_weight;
        exercise.exercise_id = option.id;
        exercise.exercise_name = option.name;
        exercise.video_url = null;
        exercise.source_ref = option.ref;
        exercise.rir_source = null;
        // A load belongs to the exercise it was written for. Carrying it onto a
        // different exercise would be the model inventing a prescription, so it
        // is dropped and pinned as a coach note.
        exercise.target_weight = null;
        if (inheritedLoad) {
          notes.push(
            makeNote(
              'sets_reps_updated',
              'advisory',
              `"${inheritedLoad}" was the template load for "${before}" and was cleared when it was swapped for "${option.name}".`,
              {
                sourceRefs: [template.ref, option.ref],
                targetRef: op.target_ref as string,
                suggestedAction: 'Set the working weight in the planner from the client\'s history.',
              },
            ),
          );
        }
        if (typeof op.sets === 'number') exercise.sets = op.sets;
        if (typeof op.rep_range === 'string') exercise.rep_range = op.rep_range;
        if (typeof op.rest_seconds === 'number') exercise.rest_seconds = op.rest_seconds;
        if (typeof op.rir === 'number') setRir(exercise, op.rir, op.target_ref as string);
        if (!option.canonical_exercise_id) unresolvedVersions += 1;
        swappedCount += 1;
        changes.push({
          scope: 'exercise',
          target_ref: op.target_ref as string,
          target_label: option.name,
          change: 'swap',
          detail: `${before} — ${option.name}`,
        });
        break;
      }
      case 'add_exercise': {
        const day = ctx.days.find((d) => d.ref === op.target_day_ref);
        const target = day ? dayById.get(day.id) : undefined;
        const option = optionByRef.get(op.exercise_option_ref as string);
        if (!target || !option) break;
        const dupe = target.exercises.find((e) => e.exercise_id === option.id);
        if (dupe) {
          notes.push(
            makeNote('exercise_alternative_unavailable', 'advisory', `"${option.name}" is already in "${target.day_name}".`, {
              sourceRefs: [option.ref],
              targetRef: op.target_day_ref as string,
              suggestedAction: 'Remove the duplicate or choose another exercise.',
            }),
          );
          break;
        }
        const added: ResolvedWorkoutExercise = {
          exercise_id: option.id,
          exercise_name: option.name,
          video_url: null,
          sort_order: target.exercises.length + 1,
          sets: typeof op.sets === 'number' ? op.sets : 3,
          rep_range: typeof op.rep_range === 'string' ? op.rep_range : '8-12',
          rest_seconds: typeof op.rest_seconds === 'number' ? op.rest_seconds : 60,
          rpe: null,
          warmup: false,
          target_weight: null,
          notes: null,
          group_id: null,
          group_type: null,
          prescribed_sets_detail: [],
          source_ref: option.ref,
          rir_source: null,
        };
        if (typeof op.rir === 'number') setRir(added, op.rir, op.target_day_ref as string);
        target.exercises.push(added);
        addedCount += 1;
        if (!option.canonical_exercise_id) unresolvedVersions += 1;
        changes.push({
          scope: 'day',
          target_ref: op.target_day_ref as string,
          target_label: target.day_name,
          change: 'add',
          detail: `+ ${option.name} (${added.sets} — ${added.rep_range})`,
        });
        break;
      }
      case 'remove_exercise': {
        const loc = exerciseLocByRef.get(op.target_ref as string);
        if (!loc) break;
        const [removedExercise] = loc.day.exercises.splice(loc.index, 1);
        removedCount += 1;
        changes.push({
          scope: 'exercise',
          target_ref: op.target_ref as string,
          target_label: removedExercise?.exercise_name ? removedExercise.exercise_name : 'Exercise',
          change: 'remove',
          detail: `Removed ${removedExercise?.exercise_name ?? 'exercise'}.`,
        });
        break;
      }
      case 'update_exercise_notes': {
        const loc = exerciseLocByRef.get(op.target_ref as string);
        if (!loc) break;
        const exercise = loc.day.exercises[loc.index];
        exercise.notes = op.notes as string;
        changes.push({
          scope: 'exercise',
          target_ref: op.target_ref as string,
          target_label: exercise.exercise_name,
          change: 'note',
          detail: 'Exercise notes updated.',
        });
        break;
      }
      default:
        break;
    }
  }

  if (unresolvedVersions > 0) {
    notes.push(
      makeNote(
        'exercise_version_unresolved',
        'advisory',
        `${unresolvedVersions} added or swapped exercise(s) have no confirmed canonical version.`,
        {
          suggestedAction: 'Confirm the exercise version for this workspace before delivery.',
        },
      ),
    );
  }

  const sessionCount = days.filter((d) => d.day_type === 'session').length;
  notes.push(
    makeNote(
      'structure_preserved',
      'info',
      `Started from "${template.name}" — ${days.length} day(s) and ${sessionCount} training session(s) preserved${addedCount ? `, ${addedCount} exercise(s) added` : ''}${swappedCount ? `, ${swappedCount} swapped` : ''}${removedCount ? `, ${removedCount} removed` : ''}${programmedCount ? `, ${programmedCount} re-programmed` : ''}.`,
      {
        sourceRefs: [template.ref],
        suggestedAction: 'Nothing here is saved yet. Review, then assign.',
      },
    ),
  );

  const splitType = typeof template.meta.split_type === 'string' ? template.meta.split_type : 'custom';
  if (!(SPLIT_TYPES as readonly string[]).includes(splitType)) {
    errors.push(`template.split_type: "${splitType}" is not a valid split type`);
  }

  return {
    kind: 'training',
    objective: ctx.objective,
    template: { ref: template.ref, id: template.id, name: template.name },
    plan: {
      name: typeof template.meta.name === 'string' ? template.meta.name : template.name,
      split_type: splitType,
      custom_split_name: typeof template.meta.custom_split_name === 'string' ? template.meta.custom_split_name : null,
      notes: typeof template.meta.notes === 'string' ? template.meta.notes : null,
      source_template_id: template.id,
    },
    days: days.sort((a, b) => a.sort_order - b.sort_order),
    changes,
    coach_notes: notes,
    unresolved_requirements: proposal.unresolved_requirements,
  };
}

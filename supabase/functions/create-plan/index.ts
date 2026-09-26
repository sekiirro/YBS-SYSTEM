/**
 * create-plan
 *
 * Turns a client's cached assessment Summary into a DRAFT nutrition or training
 * plan proposal for their coach to review. It is strictly advisory:
 *
 *   - ONE `runFailover` call per generate. There is no second "adapt this"
 *     pass, so a weak provider can never loop.
 *   - ZERO writes. Nothing is inserted, updated or activated here. The proposal
 *     lives in the response, the coach reviews it, and the existing Nutrition
 *     `Save Draft` / Training `Save & Assign` buttons are the only write paths.
 *   - Every fact comes from the caller's own RLS-scoped session. The browser
 *     sends only ids and the coach-chosen objective; it never sends client
 *     facts, macro targets, food ids or exercise ids that the server would have
 *     to trust.
 *   - The model only ever sees run-scoped references (`template_1`,
 *     `food_option_3`, `exercise_option_7`). Resolution to real database ids
 *     happens in `createPlanContract.ts`, never in the model output.
 *   - Model strategy: `routeScope: 'create_plan'` â€” Qwen 3.8 27B (OpenRouter ->
 *     Groq) -> Nemotron 3 Ultra (NVIDIA -> OpenRouter -> Kilo) -> Gemini. Ling is
 *     never used here; it remains the Summary primary, and the two route tables
 *     are independent.
 */
import { authenticateCaller, CORS, errorResponse, json, computeInputFingerprint } from '../_shared/genai.ts';
import { runFailover } from '../_shared/aiRouter.ts';
import { extractJsonObject } from '../_shared/aiProviders.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildUnitCatalog,
  isPlanKind,
  isPlanObjective,
  LIMITS,
   makeValidationContext,
   MEAL_ROLES,
   PLAN_KINDS,
  PLAN_OBJECTIVES,
  PROPOSAL_SCHEMA_VERSION,
  preflightContextFrom,
  preflightProposal,
  TRAINING_OP_TYPES,
  validateProposal,
  setDraftRequestId,
} from '../_shared/createPlanContract.ts';
   import type {
     ExerciseOption,
     FoodOption,
     MealRole,
     NutritionMealSnapshot,
     NutritionOpType,
     PlanKind,
     PlanObjective,
     PreflightContext,
     TemplateRef,
     ValidationContext,
     WorkoutDaySnapshot,
   } from '../_shared/createPlanContract.ts';
import {
  createPlanResponseSchemaFor,
  operationRuleLineFor,
} from '../_shared/createPlanSchema.ts';

const MAX_OUTPUT_TOKENS = 8192;
const PROMPT_LIMIT = 30000;
/**
 * Hard input budget for the Create Plan prompt, in characters.
 *
 * The route that actually serves Create Plan is Groq, and Groq's input ceiling
 * is 7,000 tokens per minute. On 2026-09-26 the measured prompt was 16,620
 * characters and Groq rejected it outright: `input tokens per minute (ITPM):
 * Limit 7000, Requested 7826`. This prompt measures ~2.12 characters per Groq
 * token, so 7,000 tokens is roughly 14,800 characters. The budget sits below
 * that on purpose. A prompt the serving route cannot accept is a guaranteed
 * `ai_unavailable` after six wasted provider attempts, so it is far cheaper to
 * refuse it here, loudly and before any inference, than to discover it live.
 */
const PROMPT_BUDGET_CHARS = 14200;
/** Measured on this prompt shape; only used to make the budget legible in logs. */
const CHARS_PER_INPUT_TOKEN = 2.12;

export const CREATE_PLAN_INPUT_BUDGET = {
  promptBudgetChars: PROMPT_BUDGET_CHARS,
  charsPerInputToken: CHARS_PER_INPUT_TOKEN,
} as const;
const LIBRARY_EXERCISE_POOL = 160;
const LIBRARY_FOOD_MULTIPLIER = 4;
const SUBSTITUTION_CANDIDATES_PER_ROLE = 4;
const MAX_METRIC_ROWS = 12;

/**
 * Phase 1 scope. The application resolves one existing template and the model
 * may only adapt it.
 */
export const PHASE1_MAX_TEMPLATES = 1;

/**
 * The Phase 1.1 nutrition operation vocabulary.
 *
 * `swap_food`, `add_item` and `remove_item` are excluded on purpose: all three
 * need a food-option reference the prompt no longer carries, and `swap_food`
 * changes the food at all, which is exactly what this phase is proving we can
 * do without.
 *
 * `set_meal_notes` and `update_plan_notes` were removed after the first real
 * end-to-end attempt (request 382fd3f8, 2026-09-26). Groq answered HTTP 200 with
 * a complete proposal, and the run died on exactly one operation:
 *
 *   operations[3](set_meal_notes).notes: required, non-empty text
 *
 * The model reached for a free-text notes field and left it empty. Both ops are
 * pure prose with no numeric consequence, so dropping them removes the only
 * shape in this phase where the model must author meaningful text -- and
 * therefore the only shape it can get wrong. `reason` stays, because it is
 * short, optional, and never load-bearing.
 *
 * This list is the single source of truth for the prompt rule, the provider
 * response schema enum and the server-side validator, so the three cannot drift.
 */
export const PHASE1_NUTRITION_OPS = [
  'update_plan_targets',
  'adjust_amount',
] as const satisfies readonly NutritionOpType[];
// Generous next to the measured cost of these reads (single-digit ms): this
// only fires on a genuinely stuck request, never on a slow one.
const CATALOG_OP_TIMEOUT_MS = 8000;

/** Module-level logging for non-handler functions. Pass requestId from handler. */
let currentRequestId = '';
export function setRequestId(id: string) { currentRequestId = id; }
function logStageLocal(stage: string, extra?: Record<string, unknown>) {
  if (!currentRequestId) return;
  console.log(JSON.stringify({ level: 'INFO', msg: `create-plan:${stage}`, requestId: currentRequestId, ...extra }));
}
function logErrorLocal(stage: string, err: unknown, extra?: Record<string, unknown>) {
  if (!currentRequestId) return;
  let serialized: Record<string, unknown> = {};
  if (err instanceof Error) {
    serialized = { message: err.message, name: err.name, stack: err.stack };
    // Supabase PostgrestError has these properties
    const pgErr = err as any;
    if (pgErr.code) serialized.code = pgErr.code;
    if (pgErr.details) serialized.details = pgErr.details;
    if (pgErr.hint) serialized.hint = pgErr.hint;
    if (pgErr.status) serialized.status = pgErr.status;
  } else {
    serialized = { value: String(err) };
  }
  console.error(JSON.stringify({ level: 'ERROR', msg: `create-plan:${stage}:error`, requestId: currentRequestId, error: serialized, ...extra }));
}

/**
 * Runs one catalog read under a deadline, logging start, finish and latency.
 *
 * The client has no fetch timeout, so a PostgREST request that never settles
 * leaves the promise pending forever: no stage log, no thrown error, no
 * response - the isolate just dies at the platform wall clock. Pairing the
 * deadline with per-operation timings makes that failure named and locatable.
 */
async function timedCatalogOp<T>(
  op: string,
  run: () => PromiseLike<T>,
  countOf?: (result: T) => number | undefined,
): Promise<T> {
  const startedAt = Date.now();
  logStageLocal('catalog-op-start', { op, startedAt });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`catalog_op_timeout: ${op} exceeded ${CATALOG_OP_TIMEOUT_MS}ms`)),
        CATALOG_OP_TIMEOUT_MS,
      );
    });
    const result = await Promise.race([Promise.resolve(run()), deadline]);
    const finishedAt = Date.now();
    const rowCount = countOf?.(result);
    logStageLocal('catalog-op-end', {
      op,
      startedAt,
      finishedAt,
      latencyMs: finishedAt - startedAt,
      ...(rowCount === undefined ? {} : { rowCount }),
    });
    return result;
  } catch (err) {
    const finishedAt = Date.now();
    logErrorLocal('catalog-op', err, { op, startedAt, finishedAt, latencyMs: finishedAt - startedAt });
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The caller's RLS-scoped Supabase client, as built by `authenticateCaller`. */
type UserClient = ReturnType<typeof createClient>;

// â”€â”€ Small helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function trimTo(value: unknown, max: number): string {
  return str(value).trim().slice(0, max);
}

/**
 * A numeric answer out of the form is a string, so `"72.5"`, `"72.5 kg"` and
 * `"> 80"` all have to be understood. Anything unparseable is dropped rather
 * than guessed at.
 */
function readMeasurement(answers: Map<string, string>, labels: string[]): number | null {
  for (const label of labels) {
    const raw = answers.get(label.toLowerCase());
    if (!raw) continue;
    const match = raw.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    if (!match) continue;
    const n = Number(match[0]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Maps a food's DB category onto the meal role the planner uses. */
function roleForCategory(category: string | null): MealRole {
  const value = str(category).trim().toLowerCase();
  if ((MEAL_ROLES as readonly string[]).includes(value)) return value as MealRole;
  if (value === 'protein' || value === 'dairy') return 'protein';
  if (value === 'carb' || value === 'grains') return 'carbs';
  if (value === 'fat') return 'fats';
  if (value === 'vegetable') return 'vegetables';
  if (value === 'fruit') return 'fruits';
  if (value === 'beverages') return 'other';
  return 'other';
}

/** Collapse the richer DB food-role vocabulary into the planner's six roles. */
function roleForFood(row: Record<string, any>): MealRole {
  const slug = str(row.food_roles?.slug).trim().toLowerCase();
  if (['lean_protein', 'fatty_protein', 'plant_protein', 'dairy'].includes(slug)) return 'protein';
  if (['carb', 'high_fiber_carb', 'starchy_vegetable'].includes(slug)) return 'carbs';
  if (slug === 'fat_source') return 'fats';
  if (slug === 'vegetable') return 'vegetables';
  if (slug === 'fruit') return 'fruits';
  return roleForCategory(row.category ?? null);
}

// â”€â”€ Context loading (all reads go through the caller's RLS-scoped client) â”€â”€â”€â”€

interface LoadedContextBase {
  kind: PlanKind;
  objective: PlanObjective;
  templates: TemplateRef[];
  summary: Record<string, any> | null;
  metrics: Record<string, any>[];
  metricsNewerThanSummary: boolean;
  client: Record<string, any>;
  /** True when the offered template page was capped, so the prompt can say so. */
  catalogCapped: boolean;
}

export interface NutritionContext extends LoadedContextBase {
  kind: 'nutrition';
  mealsByTemplate: Map<string, NutritionMealSnapshot[]>;
  foodOptions: FoodOption[];
  /** False when the allergen join could not be read (never "no allergens"). */
  allergenMetadataAvailable: boolean;
}

interface TrainingContext extends LoadedContextBase {
  kind: 'training';
  daysByTemplate: Map<string, WorkoutDaySnapshot[]>;
  exerciseOptions: ExerciseOption[];
  alternativeOptions: ExerciseOption[];
}

export type LoadedContext = NutritionContext | TrainingContext;

async function loadSummary(
  db: UserClient,
  assessment: Record<string, any>,
  kind: 'nutrition' | 'training',
): Promise<{ summary: Record<string, any> | null; metricsNewerThanSummary: boolean }> {
  // Same lookup the Summary panel restores from, and the same freshness test:
  // a cached analysis whose form answers have since changed is not a safe basis
  // for a plan, and the coach is told so instead of being handed a stale plan.
  const { data: cached } = await db
    .from('ai_analysis_cache')
    .select('result, input_fingerprint, updated_at')
    .eq('assessment_id', assessment.id)
    .eq('analysis_type', kind)
    .maybeSingle();

  const fingerprint = await computeInputFingerprint(assessment);
  const fresh = !!cached && cached.input_fingerprint === fingerprint && cached.result;

  const { data: latestMetric } = await db
    .from('metrics')
    .select('updated_at')
    .eq('client_id', assessment.client_id)
    .order('entry_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const summaryAt = cached?.updated_at ? Date.parse(String(cached.updated_at)) : 0;
  const metricAt = latestMetric?.updated_at ? Date.parse(String(latestMetric.updated_at)) : 0;
  const metricsNewerThanSummary = !!fresh && metricAt > summaryAt;

  return {
    summary: fresh ? (cached!.result as Record<string, any>) : null,
    metricsNewerThanSummary,
  };
}

async function loadClient(db: UserClient, clientId: string): Promise<Record<string, any> | null> {
  const { data } = await db
    .from('clients')
    .select('id, workspace_id, full_name, client_code, date_of_birth, gender, height, current_weight, status')
    .eq('id', clientId)
    .maybeSingle();
  return data ?? null;
}

async function loadMetrics(db: UserClient, clientId: string): Promise<Record<string, any>[]> {
  const { data } = await db
    .from('metrics')
    .select('entry_date, weight, body_fat, chest, waist, hip, updated_at')
    .eq('client_id', clientId)
    .order('entry_date', { ascending: false })
    .limit(MAX_METRIC_ROWS);
  return data ?? [];
}

async function loadNutritionContext(
  db: UserClient,
  workspaceId: string,
  client: Record<string, any>,
  objective: PlanObjective,
  summary: Record<string, any> | null,
  metrics: Record<string, any>[],
  metricsNewerThanSummary: boolean,
): Promise<NutritionContext> {
  // A count-aware page so a capped catalog is never presented as complete.
  // Phase 1 resolves ONE existing template: the application picks it, the model
  // only adapts it. `count: 'exact'` still reports the true total so the log
  // shows how many candidates existed behind the single choice.
  const { data: planRows, count: planTotal } = await timedCatalogOp(
    'nutrition_plan_templates',
    () => db
      .from('nutrition_plans')
      .select('id, name, daily_calories, daily_protein, daily_carbs, daily_fat, notes', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .eq('is_template', true)
      .eq('is_archived', false)
      .order('name', { ascending: true })
      .limit(PHASE1_MAX_TEMPLATES),
    (r) => r.data?.length ?? 0,
  );

  logStageLocal('nutrition-templates-loaded', { count: planRows?.length ?? 0, total: planTotal ?? 0 });

  // One candidate per page is not a "capped" catalogue, so this stays false:
  // nothing was withheld from the model, by design.
  const catalogCapped = false;
  const templates: TemplateRef[] = (planRows ?? []).map((row: any, index: number) => ({
    ref: `template_${index + 1}`,
    id: row.id,
    name: row.name,
    meta: {
      name: row.name,
      daily_calories: row.daily_calories == null ? null : num(row.daily_calories),
      daily_protein: row.daily_protein == null ? null : num(row.daily_protein),
      daily_carbs: row.daily_carbs == null ? null : num(row.daily_carbs),
      daily_fat: row.daily_fat == null ? null : num(row.daily_fat),
      notes: row.notes ?? null,
    },
  }));

  // An empty result is not an error here: the handler already answers it with
  // a 409 `no_templates`, which is the right status for "this workspace has no
  // template yet". Throwing here would downgrade that to a 502.
  if (templates.length > 0) {
    logStageLocal('nutrition-template-resolved', {
      templateRef: templates[0].ref,
      templateId: templates[0].id,
      templateName: templates[0].name,
      candidatesAvailable: planTotal ?? templates.length,
    });
  }

  // Full structure for every offered template: the router gate resolves the
  // model's references against real rows, so it needs them all up front.
  const planIds = templates.map((t) => t.id);
  const { data: mealRows } = planIds.length
    ? await timedCatalogOp(
        'nutrition_meals',
        () => db
          .from('nutrition_meals')
          .select('id, nutrition_plan_id, meal_name, sort_order, notes')
          .in('nutrition_plan_id', planIds)
          .order('sort_order', { ascending: true }),
        (r) => r.data?.length ?? 0,
      )
    : { data: [] as any[] };

  const mealIds = (mealRows ?? []).map((m: any) => m.id);
  const { data: itemRows } = mealIds.length
    ? await timedCatalogOp(
        'nutrition_items',
        () => db
          .from('nutrition_items')
          .select('id, meal_id, food_id, food_name, amount, unit, calories, protein, carbs, fat')
          .in('meal_id', mealIds),
        (r) => r.data?.length ?? 0,
      )
    : { data: [] as any[] };

  logStageLocal('nutrition-meals-items-loaded', { meals: mealRows?.length ?? 0, items: itemRows?.length ?? 0 });

  const itemsByMeal = new Map<string, any[]>();
  for (const item of itemRows ?? []) {
    const list = itemsByMeal.get(item.meal_id) ?? [];
    list.push(item);
    itemsByMeal.set(item.meal_id, list);
  }

  // One global ref counter across every template, so `item_7` names exactly
  // one row no matter which template the model chose.
  const mealsByTemplate = new Map<string, NutritionMealSnapshot[]>();
  const foodIdsInTemplates = new Set<string>();
  let mealSeq = 0;
  let itemSeq = 0;
  for (const template of templates) {
    const meals: NutritionMealSnapshot[] = (mealRows ?? [])
      .filter((m: any) => m.nutrition_plan_id === template.id)
      .map((meal: any) => {
        const items = (itemsByMeal.get(meal.id) ?? []).map((item: any) => {
          if (item.food_id) foodIdsInTemplates.add(item.food_id);
          return {
            ref: `item_${++itemSeq}`,
            id: item.id,
            food_id: item.food_id ?? null,
            food_name: item.food_name,
            amount: num(item.amount),
            unit: item.unit,
            calories: num(item.calories),
            protein: num(item.protein),
            carbs: num(item.carbs),
            fat: num(item.fat),
          };
        });
        return {
          ref: `meal_${++mealSeq}`,
          id: meal.id,
          meal_name: meal.meal_name,
          sort_order: num(meal.sort_order),
          notes: meal.notes ?? null,
          items,
        };
      });
    mealsByTemplate.set(template.ref, meals);
  }

  // Phase 1: no food library is loaded at all. Every Phase 1 operation is
  // answerable from the selected template alone -- `adjust_amount` keeps the
  // item's existing unit when `unit_ref` is omitted, and `add_item` /
  // `swap_food` are forbidden -- so the ~9k characters of food options the
  // model cannot legally reference are pure input cost. Phase 3 reintroduces
  // this query once substitutions are actually allowed.
  const foodOptions: FoodOption[] = [];
  logStageLocal('food-library-skipped', { reason: 'phase1_no_substitutions', foodOptionsCount: 0 });

  return {
    kind: 'nutrition',
    objective,
    templates,
    mealsByTemplate,
    foodOptions,
    // Honest: no allergen metadata was read this run. Inert in Phase 1 because
    // `reportAllergens` only fires for an op carrying a `food_option_ref`, and
    // those ops are forbidden -- so this can never become a claim that a food
    // is allergen safe.
    allergenMetadataAvailable: false,
    summary,
    metrics,
    metricsNewerThanSummary,
    client,
    catalogCapped,
  };
}

async function loadTrainingContext(
  db: UserClient,
  workspaceId: string,
  client: Record<string, any>,
  objective: PlanObjective,
  summary: Record<string, any> | null,
  metrics: Record<string, any>[],
  metricsNewerThanSummary: boolean,
): Promise<TrainingContext> {
  const { data: planRows, count: planTotal } = await timedCatalogOp(
    'workout_plan_templates',
    () => db
      .from('workout_plans')
      .select('id, name, split_type, notes')
      .eq('workspace_id', workspaceId)
      .eq('is_template', true)
      .eq('is_archived', false)
      .order('name', { ascending: true })
      .limit(LIMITS.maxTemplates),
    (r) => r.data?.length ?? 0,
  );

  const catalogCapped = (planTotal ?? 0) > (planRows?.length ?? 0);
  const templates: TemplateRef[] = (planRows ?? []).map((row: any, index: number) => ({
    ref: `template_${index + 1}`,
    id: row.id,
    name: row.name,
    meta: {
      name: row.name,
      split_type: row.split_type,
      custom_split_name: null,
      notes: row.notes ?? null,
    },
  }));

  const planIds = templates.map((t) => t.id);
  const { data: dayRows } = planIds.length
    ? await timedCatalogOp(
        'workout_days',
        () => db
          .from('workout_days')
          .select('id, workout_plan_id, day_name, sort_order, rest_day, day_type')
          .in('workout_plan_id', planIds)
          .order('sort_order', { ascending: true }),
        (r) => r.data?.length ?? 0,
      )
    : { data: [] as any[] };

  const dayIds = (dayRows ?? []).map((d: any) => d.id);
  const { data: exerciseRows } = dayIds.length
    ? await timedCatalogOp(
        'workout_exercises',
        () => db
          .from('workout_exercises')
          .select(
            'id, workout_day_id, exercise_id, exercise_name, video_url, sort_order, sets, rep_range, ' +
              'rest_seconds, target_weight, warmup, rpe, notes',
          )
          .in('workout_day_id', dayIds),
        (r) => r.data?.length ?? 0,
      )
    : { data: [] as any[] };

  // Canonical exercise identity per template row, resolved BEFORE generation so
  // the router gate can stay synchronous. Bounded to the offered templates.
  const versionByExerciseId = new Map<string, Record<string, any>>();
  await Promise.all(
    planIds.map(async (planId: string, planIndex: number) => {
      const { data } = await timedCatalogOp(
        `exercise_version_resolution:${planIndex + 1}`,
        () => db.rpc('resolve_exercise_versions_for_plan', {
          p_plan_id: planId,
          p_target_workspace_id: workspaceId,
        }),
        (r) => r.data?.length ?? 0,
      );
      for (const row of data ?? []) {
        if (row?.workout_exercise_id) versionByExerciseId.set(row.workout_exercise_id, row);
      }
    }),
  );

  const exercisesByDay = new Map<string, any[]>();
  for (const row of exerciseRows ?? []) {
    const list = exercisesByDay.get(row.workout_day_id) ?? [];
    list.push(row);
    exercisesByDay.set(row.workout_day_id, list);
  }

  const daysByTemplate = new Map<string, WorkoutDaySnapshot[]>();
  const templateExerciseIds = new Set<string>();
  let daySeq = 0;
  let exerciseSeq = 0;
  for (const template of templates) {
    const days: WorkoutDaySnapshot[] = (dayRows ?? [])
      .filter((d: any) => d.workout_plan_id === template.id)
      .map((day: any) => {
        const isRest = day.day_type === 'rest_day' || day.rest_day === true;
        const exercises = (exercisesByDay.get(day.id) ?? []).map((row: any) => {
          if (row.exercise_id) templateExerciseIds.add(row.exercise_id);
          const version = versionByExerciseId.get(row.id);
          return {
            ref: `exercise_${++exerciseSeq}`,
            id: row.id,
            exercise_id: row.exercise_id ?? null,
            exercise_name: row.exercise_name,
            video_url: row.video_url ?? null,
            sort_order: num(row.sort_order),
            sets: num(row.sets),
            rep_range: row.rep_range,
            rest_seconds: row.rest_seconds == null ? null : num(row.rest_seconds),
            rpe: row.rpe == null ? null : num(row.rpe),
            warmup: row.warmup === true,
            target_weight: row.target_weight ?? null,
            notes: row.notes ?? null,
            group_id: null,
            group_type: null,
            prescribed_sets_detail: [],
            canonical_exercise_id: version?.canonical_exercise_id ?? null,
          };
        });
        return {
          ref: `day_${++daySeq}`,
          id: day.id,
          day_name: day.day_name,
          sort_order: num(day.sort_order),
          day_type: isRest ? ('rest_day' as const) : ('session' as const),
          notes: null,
          exercises,
        };
      });
    daysByTemplate.set(template.ref, days);
  }

  // Swap/add candidates from the Exercise Library the caller can already see
  // (RLS exposes workspace-owned plus the global YBS pool).
  const { data: libraryRows } = await timedCatalogOp(
    'exercise_library',
    () => db
      .from('exercises')
      .select('id, name, category, muscle_group, equipment, video_url, is_archived')
      .eq('is_archived', false)
      .order('name', { ascending: true })
      .limit(LIBRARY_EXERCISE_POOL),
    (r) => r.data?.length ?? 0,
  );

  const library = (libraryRows ?? []).filter((row: any) => !row.is_archived);
  const existing = new Set(templateExerciseIds);

  const toOption = (row: any, ref: string, canonical: string | null): ExerciseOption => ({
    ref,
    id: row.id,
    name: row.name,
    category: row.category ?? null,
    muscle_group: row.muscle_group ?? null,
    equipment: row.equipment ?? null,
    canonical_exercise_id: canonical,
    is_alternative: false,
    replaces_canonical_exercise_id: null,
  });

  const exerciseOptions: ExerciseOption[] = [];
  const seenExercises = new Set<string>();
  for (const days of daysByTemplate.values()) {
    for (const day of days) {
      for (const ex of day.exercises) {
        if (!ex.exercise_id || seenExercises.has(ex.exercise_id)) continue;
        if (exerciseOptions.length >= LIMITS.maxExerciseOptions) break;
        seenExercises.add(ex.exercise_id);
        const row = library.find((r: any) => r.id === ex.exercise_id);
        exerciseOptions.push(
          toOption(
            row ?? { id: ex.exercise_id, name: ex.exercise_name, category: null, muscle_group: null, equipment: null },
            `exercise_option_${exerciseOptions.length + 1}`,
            ex.canonical_exercise_id,
          ),
        );
      }
    }
  }
  for (const row of library) {
    if (exerciseOptions.length >= LIMITS.maxExerciseOptions) break;
    if (existing.has(row.id) || seenExercises.has(row.id)) continue;
    seenExercises.add(row.id);
    exerciseOptions.push(toOption(row, `exercise_option_${exerciseOptions.length + 1}`, null));
  }

  // Bounded alternatives: other concrete versions of a canonical exercise the
  // templates already use. This is the same "same movement, workspace's row"
  // idea the versioning service applies, surfaced as a separate ref namespace so
  // the model can never confuse a swap with an alternative.
  const alternativeOptions: ExerciseOption[] = [];
  const canonicalToOptions = new Map<string, ExerciseOption[]>();
  for (const option of exerciseOptions) {
    if (!option.canonical_exercise_id) continue;
    const list = canonicalToOptions.get(option.canonical_exercise_id) ?? [];
    list.push(option);
    canonicalToOptions.set(option.canonical_exercise_id, list);
  }
  for (const options of canonicalToOptions.values()) {
    for (const option of options) {
      if (alternativeOptions.length >= LIMITS.maxAlternativeOptions) break;
      if (options.length < 2) continue;
      alternativeOptions.push({
        ...option,
        ref: `alternative_option_${alternativeOptions.length + 1}`,
        is_alternative: true,
        replaces_canonical_exercise_id: option.canonical_exercise_id,
      });
    }
  }

  return {
    kind: 'training',
    objective,
    templates,
    daysByTemplate,
    exerciseOptions,
    alternativeOptions,
    summary,
    metrics,
    metricsNewerThanSummary,
    client,
    catalogCapped,
  };
}

// â”€â”€ Validation contexts, derived from the run-scoped catalog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function validationContextFor(ctx: LoadedContext, templateRef: string): ValidationContext | null {
  const template = ctx.templates.find((t) => t.ref === templateRef);
  if (!template) return null;

  if (ctx.kind === 'nutrition') {
    return makeValidationContext({
      kind: 'nutrition',
      objective: ctx.objective,
      templates: ctx.templates,
      foodOptions: ctx.foodOptions,
      exerciseOptions: [],
      alternativeOptions: [],
      meals: ctx.mealsByTemplate.get(template.ref) ?? [],
      days: [],
      // No client allergen record exists in the schema, so nothing is declared
      // to avoid. The contract still reports every food's own allergens to the
      // coach, and a failed metadata read degrades to "unverified", so this
      // empty list never becomes a claim that the plan is allergen safe.
      allergensToAvoid: [],
      allergenMetadataAvailable: ctx.allergenMetadataAvailable,
      hasSummary: !!ctx.summary,
      metricsNewerThanSummary: ctx.metricsNewerThanSummary,
      // Phase 1: substitutions are refused by the contract itself, so the
      // router gate rejects a hallucinated `swap_food` as a bad route instead
      // of letting it through to a broken draft.
      allowedOps: PHASE1_NUTRITION_OPS,
    });
  }

  return makeValidationContext({
    kind: 'training',
    objective: ctx.objective,
    templates: ctx.templates,
    foodOptions: [],
    exerciseOptions: ctx.exerciseOptions,
    alternativeOptions: ctx.alternativeOptions,
    meals: [],
    days: ctx.daysByTemplate.get(template.ref) ?? [],
    allergensToAvoid: [],
    allergenMetadataAvailable: true,
    hasSummary: !!ctx.summary,
    metricsNewerThanSummary: ctx.metricsNewerThanSummary,
  });
}

function preflightFor(ctx: LoadedContext, templateRef: string): PreflightContext | null {
  const full = validationContextFor(ctx, templateRef);
  return full ? preflightContextFrom(full) : null;
}

/**
 * The router's failover gate. A route only counts as a success if its output
 * survives the SAME strict contract the final resolution uses, so a provider
 * that hallucinates a reference, an enum, a number or a conflicting operation
 * loses the route instead of producing a broken draft.
 *
 * The failure reason is the error's field path only -- never the model's own
 * text, which could echo the client's assessment back into the logs.
 */
/**
 * Safe structural summary of the operation names a model emitted. Only
 * identifier-shaped values are echoed (anything else becomes `<non-name>`),
 * so client data, food names or assessment text can never leak into the logs
 * through this path.
 */
function safeInvalidOpValues(parsed: unknown): string[] {
  const ops = (parsed as Record<string, any> | null)?.operations;
  if (!Array.isArray(ops)) return [];
  const out: string[] = [];
  for (const op of ops.slice(0, 12)) {
    const value = (op as Record<string, any> | null)?.op;
    const safe =
      typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)
        ? value
        : '<non-name>';
    if (!out.includes(safe)) out.push(safe);
    if (out.length >= 5) break;
  }
  return out;
}

function gateFor(ctx: LoadedContext): (text: string) => { ok: true } | { ok: false; reason: string } {
  return (text: string) => {
    const parsed = extractJsonObject(text);
    if (!parsed) return { ok: false, reason: 'non-JSON or truncated proposal' };

    const templateRef = str((parsed as Record<string, any>).selected_template_ref);
    if (!ctx.templates.some((t) => t.ref === templateRef)) {
      return { ok: false, reason: 'proposal.selected_template_ref' };
    }
    const pre = preflightFor(ctx, templateRef);
    if (!pre) return { ok: false, reason: 'proposal.selected_template_ref' };

    const verdict = preflightProposal(parsed, pre);
    if (!verdict.ok) {
      const first = verdict.errors[0] ?? 'unknown';
      const field = first.includes(':') ? first.slice(0, first.indexOf(':')) : 'proposal';
      const values = safeInvalidOpValues(parsed);
      const suffix = values.length > 0 ? ` invalid=${JSON.stringify(values)}` : '';
      return { ok: false, reason: `${field.replace(/\[\d+\]/g, '[]')}${suffix}` };
    }
    return { ok: true };
  };
}

// â”€â”€ Prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function describeClient(ctx: LoadedContext): string {
  const client = ctx.client;
  const lines: string[] = [];
  lines.push(`- Name: ${str(client.full_name) || 'unknown'}`);
  if (client.gender) lines.push(`- Gender: ${str(client.gender)}`);
  if (client.date_of_birth) lines.push(`- Date of birth: ${str(client.date_of_birth)}`);
  if (client.height != null) lines.push(`- Height: ${num(client.height)} cm`);
  if (client.current_weight != null) lines.push(`- Current weight (clients table): ${num(client.current_weight)} kg`);
  return lines.join('\n');
}

function describeSummary(ctx: LoadedContext): string {
  if (!ctx.summary) {
    return 'No cached assessment Summary was available for this client. Base the plan on the verified body data above and record anything you still need in unresolved_requirements.';
  }
  const summary = ctx.summary;
  const parts: string[] = [];
  if (str(summary.clientSummary)) parts.push(str(summary.clientSummary));
  if (Array.isArray(summary.keyPoints)) {
    for (const point of summary.keyPoints.slice(0, 8)) parts.push(`- ${trimTo(point, 240)}`);
  }
  if (ctx.metricsNewerThanSummary) {
    parts.push(
      'NOTE: the client has logged new measurements since this Summary was written. Where they conflict, trust the measurements and say so in a coach note.',
    );
  }
  return parts.join('\n') || 'The cached Summary contained no usable text.';
}

function describeMetrics(ctx: LoadedContext): string {
  if (ctx.metrics.length === 0) return 'No measurement history is available.';
  const rows = ctx.metrics.map((m) => {
    const parts = [`${str(m.entry_date)}: ${num(m.weight)} kg`];
    if (m.body_fat != null) parts.push(`${num(m.body_fat)}% body fat`);
    if (m.waist != null) parts.push(`waist ${num(m.waist)} cm`);
    return `- ${parts.join(', ')}`;
  });
  return rows.join('\n');
}

export function nutritionCatalog(ctx: NutritionContext): string {
  // Phase 1: exactly one application-resolved template, rendered as a flat,
  // ref-annotated outline. No food options, no unit catalogue, no allergens and
  // no per-serving macros -- every Phase 1 operation is answerable from this
  // outline plus the form.
  const template = ctx.templates[0];
  if (!template) return 'SELECTED TEMPLATE:\n  (none available)';
  const meta = template.meta as Record<string, any>;
  const targets = [
    meta.daily_calories != null ? `${meta.daily_calories} kcal` : null,
    meta.daily_protein != null ? `P ${meta.daily_protein} g` : null,
    meta.daily_carbs != null ? `C ${meta.daily_carbs} g` : null,
    meta.daily_fat != null ? `F ${meta.daily_fat} g` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const meals = ctx.mealsByTemplate.get(template.ref) ?? [];
  const body = meals
    .map((meal) => {
      const items = meal.items
        .map((item) => `      ${item.ref}=${trimTo(item.food_name, 40)} ${item.amount}${item.unit ?? ''}`)
        .join('\n');
      return `    ${meal.ref}:${trimTo(meal.meal_name, 40)}\n${items}`;
    })
    .join('\n');

  return (
    `SELECTED TEMPLATE:\n  ${template.ref}:"${trimTo(template.name, 60)}"${targets ? ` [${targets}]` : ''}\n${body}\n\n` +
    `These meal_N and item_N refs are the only targets you may reference. ` +
    `adjust_amount changes the number and keeps that item's current unit.`
  );
}

function trainingCatalog(ctx: TrainingContext): string {
  const templates = ctx.templates
    .map((template) => {
      const days = ctx.daysByTemplate.get(template.ref) ?? [];
      const meta = template.meta as Record<string, any>;
      const body = days
        .map((day) => {
          if (day.day_type === 'rest_day') return `    ${day.ref}: ${day.day_name} (rest day)`;
          const exercises = day.exercises
            .map(
              (ex) =>
                `      ${ex.ref}: ${ex.exercise_name} â€” ${ex.sets} x ${ex.rep_range}` +
                (ex.target_weight ? ` @ ${ex.target_weight}` : '') +
                (ex.rpe != null ? ` (stored RPE ${ex.rpe})` : ''),
            )
            .join('\n');
          return `    ${day.ref}: ${day.day_name}\n${exercises}`;
        })
        .join('\n');
      return `  ${template.ref}: "${template.name}" (split: ${str(meta.split_type)})\n${body}`;
    })
    .join('\n');

  const exercises = ctx.exerciseOptions
    .map(
      (option) =>
        `  ${option.ref}: ${option.name} [${str(option.category) || 'other'}/${str(option.muscle_group) || '-'}/${str(option.equipment) || '-'}]`,
    )
    .join('\n');

  const alternatives = ctx.alternativeOptions
    .map((option) => `  ${option.ref}: ${option.name} (alternative version)`)
    .join('\n');

  return (
    `TEMPLATES (pick exactly one as selected_template_ref):\n${templates || '  (none available)'}` +
    `\n\nEXERCISE OPTIONS:\n${exercises || '  (none available)'}` +
    `\n\nALTERNATIVE OPTIONS (same movement, other concrete version):\n${alternatives || '  (none available)'}`
  );
}

/**
 * Phase 1.1 nutrition instructions.
 *
 * Deliberately short. The original 12-rule block described unit refs, allergen
 * screening and substitution mechanics for a food catalogue this phase no
 * longer sends, so most of it described input the model no longer has. What
 * remains is the output shape the validator actually requires, and nothing else.
 *
 * With `set_meal_notes` / `update_plan_notes` gone there is no field left that
 * asks the model for authored prose, so the rule block no longer has to describe
 * one -- which is the point of this revision.
 */
function phase1NutritionRules(templateRef: string): string {
  return [
    'Create a nutrition plan by adapting the provided YBS template.',
    'Use only the provided template. Do not invent foods. Do not add foods. Do not swap foods.',
    'adjust_amount: reference an existing template item and give its new amount (omit unit_ref to keep that item\'s existing unit). update_plan_targets: set daily calories/protein/carbs/fat only, and only when clearly justified.',
    'Do not place operation identifiers inside text fields. Return only valid structured proposal operations.',
    'The application calculates all nutrition values: never state a calorie or macro in an operation.',
    `Every reference must be copied from the selected template, and "selected_template_ref" must be "${templateRef}".`,
    'Every operation needs a short reason. Put anything you could not satisfy in unresolved_requirements and anything the coach must check in coach_notes.',
    `At most ${LIMITS.maxOperations} operations. Be surgical.`,
    operationRuleLineFor('nutrition', PHASE1_NUTRITION_OPS),
  ].join('\n');
}

function trainingRules(): string {
  const shared = [
    'HARD RULES (violating any of these makes your output invalid):',
    '1. Use ONLY the reference ids you were given. Never invent an id, never use a database uuid, never reference anything not listed.',
    '2. selected_template_ref must be one of the template ids listed. Operations only ever target the structure of THAT template.',
    '3. You never state a calorie or macro number in an operation. Amounts and units only; the application computes every macro from the Food Database.',
    '4. Every operation needs a short reason explaining the coaching decision.',
    `5. At most ${LIMITS.maxOperations} operations. Be surgical: a focused, defensible change beats an exhaustive rewrite.`,
    '6. Never remove a meal, a training day or a rest day that the template defines. Structure is preserved; you adjust its contents.',
    '7. Put anything you could not satisfy in unresolved_requirements, and anything the coach must double-check in coach_notes.',
  ];
  return [
    ...shared,
    '8. Program intensity in RIR (reps in reserve), an integer or 0.5 step from 0 to 5. The application converts it to the stored RPE.',
    '9. NEVER set target_weight. Loads are never invented. If the template already carries a load you may repeat it verbatim; otherwise leave it out.',
    '10. swap_exercise replaces the movement in an existing slot and keeps its programming. add_exercise places a movement on an existing session day; rest days cannot receive exercises.',
    '11. A swap plus update_sets_reps_rir on the same exercise is allowed and is the normal way to re-program a movement.',
    '12. rep_range is free text such as "6-8" or "8-12". rest_seconds is 0-600.',
    operationRuleLineFor('training'),
  ].join('\n');
}

export function buildPrompt(ctx: LoadedContext, objective: string, catalog: string): string {
  // Phase 1 applies to nutrition only; training keeps its full catalog and rule
  // set until its own phase.
  if (ctx.kind === 'nutrition') {
    const templateRef = ctx.templates[0]?.ref ?? 'template_1';
    return [
      `You are a senior nutrition coach inside the YBS coaching platform. Produce a starting DRAFT nutrition plan for a coach to review. The coach has already chosen the goal.`,
      '',
      `OBJECTIVE: ${objective}`,
      objective === 'cutting'
        ? 'A fat-loss phase: a calorie deficit, high protein, controlled carbohydrates around training.'
        : objective === 'bulking'
          ? 'A lean-gain phase: a modest surplus, high protein, more total food and more training volume.'
          : 'A recomp: maintenance calories with high protein, performance-focused training and no aggressive deficit or surplus.',
      '',
      'CLIENT FORM:',
      describeClient(ctx),
      describeSummary(ctx),
      '',
      catalog,
      '',
      phase1NutritionRules(templateRef),
      '',
      'OUTPUT (JSON only, no prose, no markdown fence):',
      '{',
      `  "schema_version": "${PROPOSAL_SCHEMA_VERSION}",`,
      `  "kind": "nutrition",`,
      `  "objective": "${objective}",`,
      `  "selected_template_ref": "${templateRef}",`,
      '  "selection_rationale": "one or two sentences on why this template fits THIS client and goal",',
      '  "operations": [',
      '    { "op": "adjust_amount", "target_ref": "item ref from the template", "amount": 200, "reason": "why" },',
      '    { "op": "update_plan_targets", "daily_protein": 180, "reason": "why" }',
      '  ],',
      '  "coach_notes": [',
      '    { "code": "advisory_code", "severity": "info|advisory|warning", "message": "what the coach must know", "target_ref": "ref or omitted", "suggested_action": "optional", "requires_acknowledgement": false }',
      '  ],',
      '  "unresolved_requirements": ["information you still need from the coach"]',
      '}',
    ].join('\n');
  }

  const kindLabel = 'TRAINING plan';
  return [
    `You are a senior strength and conditioning coach inside the YBS coaching platform.`,
    `You are producing a starting DRAFT ${kindLabel} for a coach to review. The coach has already decided the goal.`,
    '',
    `COACH-SELECTED OBJECTIVE: ${objective}`,
    `This is authoritative. The output objective MUST be exactly "${objective}". Never substitute your own goal.`,
    objective === 'cutting'
      ? 'A fat-loss phase: a calorie deficit, high protein, controlled carbohydrates around training.'
      : objective === 'bulking'
        ? 'A lean-gain phase: a modest surplus, high protein, more total food and more training volume.'
        : 'A recomp: maintenance calories with high protein, performance-focused training and no aggressive deficit or surplus.',
    '',
    'VERIFIED CLIENT DATA (from the database, not from the client):',
    describeClient(ctx),
    '',
    'RECENT MEASUREMENTS:',
    describeMetrics(ctx),
    '',
    "CLIENT'S ASSESSMENT SUMMARY:",
    describeSummary(ctx),
    '',
    'AVAILABLE CATALOG:',
    catalog,
    ctx.catalogCapped
      ? `NOTE: this workspace has more templates than are listed above. These are the ones on offer for this run, so choose from these only; do not claim a template is missing.`
      : '',
    '',
    trainingRules(),
    '',
    'OUTPUT (JSON only, no prose, no markdown fence):',
    '{',
    `  "schema_version": "${PROPOSAL_SCHEMA_VERSION}",`,
    `  "kind": "${ctx.kind}",`,
    `  "objective": "${objective}",`,
    '  "selected_template_ref": "template_N",',
    '  "selection_rationale": "one or two sentences on why this template fits THIS client and goal",',
    `  "operations": [ ${TRAINING_OP_TYPES.map((op) => `"${op}"`).join(' | ')} ],`,
    '  "coach_notes": [',
    '    { "code": "advisory_code", "severity": "info|advisory|warning", "message": "what the coach must know", "target_ref": "ref or omitted", "suggested_action": "optional", "requires_acknowledgement": false }',
    '  ],',
    '  "unresolved_requirements": ["information you still need from the coach"]',
    '}',
  ].join('\n');
}

// â”€â”€ Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return errorResponse('method_not_allowed', 'POST requests only.', 405);

  const REQUEST_ID = crypto.randomUUID().slice(0, 8);
  setRequestId(REQUEST_ID);
  const logStage = (stage: string, extra?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'INFO', msg: `create-plan:${stage}`, requestId: REQUEST_ID, ...extra }));
  };
  const logError = (stage: string, err: unknown, extra?: Record<string, unknown>) => {
    let serialized: Record<string, unknown> = {};
    if (err instanceof Error) {
      serialized = { message: err.message, name: err.name, stack: err.stack };
      const pgErr = err as any;
      if (pgErr.code) serialized.code = pgErr.code;
      if (pgErr.details) serialized.details = pgErr.details;
      if (pgErr.hint) serialized.hint = pgErr.hint;
      if (pgErr.status) serialized.status = pgErr.status;
    } else {
      serialized = { value: String(err) };
    }
    console.error(JSON.stringify({ level: 'ERROR', msg: `create-plan:${stage}:error`, requestId: REQUEST_ID, error: serialized, ...extra }));
  };

  try {
    const auth = await authenticateCaller(req);
    if (!auth.ok) return auth.response;
    const db = auth.userClient;

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return errorResponse('bad_request', 'Invalid JSON body.', 400);
    }

    const assessmentId = str(body.assessmentId);
    const kind = str(body.kind);
    const objective = str(body.objective);
    if (!assessmentId) return errorResponse('bad_request', 'An assessmentId is required.', 400);
    if (!isPlanKind(kind)) {
      return errorResponse('bad_request', `kind must be one of ${PLAN_KINDS.join(', ')}.`, 400);
    }
    if (!isPlanObjective(objective)) {
      return errorResponse('bad_request', `objective must be one of ${PLAN_OBJECTIVES.join(', ')}.`, 400);
    }

    // 1. The assessment, through the caller's own RLS scope. A coach who cannot
    //    see it gets the same not_found the rest of the app gives them.
    const { data: assessment, error: loadErr } = await db
      .from('assessments')
      .select('*, assessment_responses(*)')
      .eq('id', assessmentId)
      .maybeSingle();
    if (loadErr) {
      logError('assessment-load', loadErr);
      return errorResponse('load_failed', 'Failed to load the form.', 502);
    }
    if (!assessment) {
      logStage('assessment-not-found');
      return errorResponse('assessment_not_found', 'Form not found or you do not have access to it.', 404);
    }
    if (!assessment.client_id) {
      logStage('no-client-linked');
      return errorResponse('no_client', 'This form is not linked to a client.', 409);
    }

    const status = assessment.submission_status;
    if (status !== 'submitted' && status !== 'reviewed') {
      logStage('no-submission', { status });
      return errorResponse('no_submission', 'Your client has not submitted the required form yet.', 409);
    }

    logStage('assessment-loaded', { assessmentId, clientId: assessment.client_id, status });
    const client = await loadClient(db, assessment.client_id);
    if (!client) {
      logStage('client-not-found', { clientId: assessment.client_id });
      return errorResponse('client_not_found', 'Client not found or you do not have access to them.', 404);
    }
    logStage('client-loaded', { clientId: client.id, workspaceId: client.workspace_id });

    // 2. The cached Summary for this exact form input, plus current measurements.
    const { summary, metricsNewerThanSummary } = await loadSummary(db, assessment, kind);
    const metrics = await loadMetrics(db, assessment.client_id);
    logStage('summary-loaded', { hasSummary: !!summary, metricsNewerThanSummary, metricsCount: metrics.length });

    // 3. Dynamic catalog: real templates, real foods, real exercises.
    let ctx: LoadedContext;
    try {
      logStage('catalog-loading', { kind, workspaceId: client.workspace_id });
      ctx =
        kind === 'nutrition'
          ? await loadNutritionContext(db, client.workspace_id, client, objective, summary, metrics, metricsNewerThanSummary)
          : await loadTrainingContext(db, client.workspace_id, client, objective, summary, metrics, metricsNewerThanSummary);
      logStage('catalog-loaded', { 
        kind, 
        templatesCount: ctx.templates.length, 
        foodOptionsCount: ctx.kind === 'nutrition' ? (ctx as NutritionContext).foodOptions.length : 0,
        exerciseOptionsCount: ctx.kind === 'training' ? (ctx as TrainingContext).exerciseOptions.length : 0,
        catalogCapped: ctx.catalogCapped 
      });
    } catch (err) {
      logError('catalog-load', err);
      return errorResponse('load_failed', 'Failed to load the plan templates.', 502);
    }

    if (ctx.templates.length === 0) {
      logStage('no-templates', { kind });
      return errorResponse(
        'no_templates',
        kind === 'nutrition'
          ? 'This workspace has no nutrition templates yet. Create one first.'
          : 'This workspace has no training templates yet. Create one first.',
        409,
      );
    }

    const catalog =
      ctx.kind === 'nutrition'
        ? nutritionCatalog(ctx as NutritionContext)
        : trainingCatalog(ctx as TrainingContext);
    const selected = ctx.templates[0];
    logStage('catalog-built', {
      catalogLength: catalog.length,
      templateRef: selected?.ref ?? null,
      templateId: selected?.id ?? null,
      templateName: selected?.name ?? null,
    });

    const prompt = buildPrompt(ctx, objective, catalog);
    // The response schema is sent as a separate system message, so the route's
    // input ceiling covers it too. Measuring the prompt alone understates the
    // real request, which is how v7 looked affordable and was rejected.
    const schema = createPlanResponseSchemaFor(
      kind,
      kind === 'nutrition' ? PHASE1_NUTRITION_OPS : undefined,
    );
    const schemaLength = JSON.stringify(schema).length;
    // Inputs are bounded section-by-section. Never truncate the completed
    // prompt because its safety rules, canonical operations and output shape
    // live at the end and must either be present in full or not sent at all.
    if (prompt.length > PROMPT_LIMIT) {
      logError('prompt-too-large', new Error('Bounded Create Plan prompt exceeded its limit'), {
        promptLength: prompt.length,
        promptLimit: PROMPT_LIMIT,
        catalogLength: catalog.length,
      });
      return errorResponse('generation_failed', 'The plan context is too large to process safely.', 422);
    }
    // Separately from the structural limit: refuse a request that the route
    // which actually serves Create Plan cannot accept. Refusing here costs
    // nothing, whereas sending it spends every provider in the table and still
    // ends in `ai_unavailable`. Checked before any inference, so it can never
    // consume a request.
    const estimatedInputTokens = Math.round(
      (prompt.length + schemaLength) / CHARS_PER_INPUT_TOKEN,
    );
    if (prompt.length + schemaLength > PROMPT_BUDGET_CHARS) {
      logError('prompt-over-input-budget', new Error('Create Plan request exceeds the input budget of the serving route'), {
        promptLength: prompt.length,
        schemaLength,
        inputBudgetChars: PROMPT_BUDGET_CHARS,
        estimatedInputTokens,
        catalogLength: catalog.length,
      });
      return errorResponse('generation_failed', 'The plan context is too large to process safely.', 422);
    }
    logStage('prompt-built', {
      promptLength: prompt.length,
      promptLimit: PROMPT_LIMIT,
      schemaLength,
      inputBudgetChars: PROMPT_BUDGET_CHARS,
      estimatedInputTokens,
      selectedTemplateRef: selected?.ref ?? null,
      selectedTemplateId: selected?.id ?? null,
      selectedTemplateName: selected?.name ?? null,
    });

    // 4. Exactly one generation attempt chain. `validateOutput` is the strict
    //    contract, so an unusable answer costs a route, never a second model call.
    //    `routeScope: 'create_plan'` walks the dedicated Groq -> Qwen ->
    //    Nemotron -> Gemini table; it never touches the Summary chain.
    logStage('ai-call-start', { kind, maxOutputTokens: MAX_OUTPUT_TOKENS, routeScope: 'create_plan' });
    const routed = await runFailover({
      task: kind,
      routeScope: 'create_plan',
      prompt,
      schema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      validateOutput: gateFor(ctx),
    });
    logStage('ai-call-end', {
      ok: routed.ok,
      attempts: routed.attempts.length,
      provider: routed.ok ? routed.provider : null,
      model: routed.ok ? routed.model : null,
      errorClass: routed.ok ? null : routed.errorClass ?? null,
    });

    if (!routed.ok) {
      logStage('ai-failed', { notConfigured: routed.notConfigured, errorClass: routed.errorClass, attempts: routed.attempts.length });
      if (routed.notConfigured) {
        logStage('response-status', { httpStatus: 503, ok: false, errorCode: 'server_not_configured' });
        return errorResponse('server_not_configured', 'AI service is not configured.', 503);
      }
      if (routed.errorClass === 'generation_output_invalid') {
        logStage('response-status', { httpStatus: 502, ok: false, errorCode: 'generation_failed' });
        return errorResponse(
          'generation_failed',
          'The AI could not produce a usable plan proposal. Please try again.',
          502,
        );
      }
      logStage('response-status', { httpStatus: 502, ok: false, errorCode: 'ai_unavailable' });
      return errorResponse('ai_unavailable', 'AI service is currently unavailable.', 502);
    }

    // 5. Authoritative resolution against the real template structure. The gate
    //    already passed, so this should not fail; if it does, the coach gets a
    //    clear message rather than a half-applied draft.
    logStage('proposal-validation-start');
    const parsed = extractJsonObject(routed.text);
    const templateRef = parsed ? str((parsed as Record<string, any>).selected_template_ref) : '';
    const validationCtx = templateRef ? validationContextFor(ctx, templateRef) : null;
    if (!parsed || !validationCtx) {
      logStage('proposal-validation-failed', { hasParsed: !!parsed, hasValidationCtx: !!validationCtx });
      logStage('proposal-validation-result', { ok: false, errorCount: 1, fields: ['proposal'] });
      logStage('response-status', { httpStatus: 502, ok: false, errorCode: 'generation_failed' });
      return errorResponse('generation_failed', 'The AI could not produce a usable plan proposal.', 502);
    }
    logStage('proposal-validation-parsed', { templateRef });

    setDraftRequestId(REQUEST_ID);
    const resolved = validateProposal(parsed, validationCtx);
    if (!resolved.ok || !resolved.draft) {
      // Bounded, secret-free and model-text-free: how many structural problems
      // and which fields, never the values the model produced.
      const fields = [...new Set(resolved.errors.map((e) => (e.includes(':') ? e.slice(0, e.indexOf(':')) : e)))].slice(0, 6);
      logStage('proposal-validation-result', { ok: false, errorCount: resolved.errors.length, fields });
      logError('proposal-validation-rejected', new Error('Validation failed'), { fields, errorCount: resolved.errors.length });
      logStage('response-status', { httpStatus: 502, ok: false, errorCode: 'generation_failed' });
      return errorResponse('generation_failed', 'The AI could not produce a usable plan proposal. Please try again.', 502);
    }
    logStage('proposal-validation-ok', { 
      kind: resolved.draft.kind, 
      changesCount: resolved.draft.changes?.length ?? 0,
      coachNotesCount: resolved.draft.coach_notes?.length ?? 0,
      unresolvedCount: resolved.draft.unresolved_requirements?.length ?? 0 
    });
    logStage('proposal-validation-result', { ok: true, errorCount: 0 });

    // 6. Read-only by design: no plan rows, no autosave, no activation. The
    //    coach reviews this and then uses the planner's own save buttons.
    logStage('response-built', { 
      provider: routed.provider, 
      model: routed.model,
      fallbackDepth: routed.attempts.length,
      latencyMs: routed.latencyMs 
    });
    logStage('response-status', { httpStatus: 200, ok: true, persisted: false });
    return json({
      success: true,
      kind,
      objective,
      meta: {
        provider: routed.provider,
        model: routed.model,
        fallbackDepth: routed.attempts.length,
        latencyMs: routed.latencyMs,
      },
      proposal: resolved.proposal,
      draft: resolved.draft,
      catalog: {
        templates: ctx.templates.map((t) => ({ ref: t.ref, name: t.name })),
        food_options: ctx.kind === 'nutrition' ? (ctx as NutritionContext).foodOptions.length : 0,
        exercise_options: ctx.kind === 'training' ? (ctx as TrainingContext).exerciseOptions.length : 0,
        alternative_options: ctx.kind === 'training' ? (ctx as TrainingContext).alternativeOptions.length : 0,
      },
    });
  } catch (err) {
    // Top-level catch: any unhandled exception becomes a structured error
    // instead of a platform 500 HTML page. This ensures the frontend can
    // always parse a JSON error response with a proper code/message.
    logError('unhandled', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse('generation_failed', 'An unexpected error occurred while generating the plan. Please try again.', 500);
  }
}

Deno.serve(handler);

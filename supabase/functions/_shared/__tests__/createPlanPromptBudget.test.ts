/**
 * Create Plan Phase 1 regression.
 *
 * Phase 1 exists to prove one small thing end to end: the application resolves
 * ONE existing nutrition template, the model only adapts it, and the result
 * survives the canonical contract. The prompt is therefore minimal by design,
 * and these tests pin the properties that made that possible:
 *
 *   - the catalog is one template with no food options, units or allergens;
 *   - the prompt carries only objective, client form and that template;
 *   - the whole request fits the serving route's input ceiling with margin;
 *   - `swap_food` is impossible, in the prompt, the provider schema AND the
 *     server-side validator -- not merely discouraged in prose.
 */
import { describe, it, expect } from 'vitest';
import {
  makeValidationContext,
  NUTRITION_OP_TYPES,
  preflightContextFrom,
  preflightProposal,
  PROPOSAL_SCHEMA_VERSION,
  validateProposal,
} from '../createPlanContract.ts';
import type { NutritionMealSnapshot, TemplateRef } from '../createPlanContract.ts';
import { createPlanResponseSchemaFor } from '../createPlanSchema.ts';
import {
  buildPrompt,
  CREATE_PLAN_INPUT_BUDGET,
  nutritionCatalog,
  PHASE1_NUTRITION_OPS,
} from '../../create-plan/index.ts';
import type { LoadedContext, NutritionContext } from '../../create-plan/index.ts';

const OBJECTIVE = 'recomp';

/**
 * The largest single template the production workspace held on 2026-09-26: the
 * largest of the six templates carried 5 meals. Sized a little above that so a
 * template that grows later still has to fight for budget.
 */
const MEALS = 8;
const ITEMS_PER_MEAL = 6;

function buildFixture(): NutritionContext {
  const mealsByTemplate = new Map<string, NutritionMealSnapshot[]>();
  const templates: TemplateRef[] = [];
  let itemSeq = 0;

  for (let t = 0; t < 1; t++) {
    const meals: NutritionMealSnapshot[] = [];
    for (let m = 0; m < MEALS; m++) {
      const items = [];
      for (let k = 0; k < ITEMS_PER_MEAL; k++) {
        items.push({
          ref: `item_${++itemSeq}`,
          id: `item-row-${itemSeq}`,
          food_id: `food-${(itemSeq % 9) + 1}`,
          food_name: `Sample Food Number ${(itemSeq % 9) + 1} With A Realistic Name`,
          amount: 100 + k * 25,
          unit: 'g',
          calories: 165,
          protein: 31,
          carbs: 0,
          fat: 3.6,
        });
      }
      meals.push({
        ref: `meal_${m + 1}`,
        id: `meal-row-${m}`,
        meal_name: `Meal ${m + 1} Of The Selected Template`,
        sort_order: m,
        notes: null,
        items: items as any,
      });
    }
    const ref = `template_${t + 1}`;
    mealsByTemplate.set(ref, meals);
    templates.push({
      ref,
      id: `plan-${t + 1}`,
      name: 'The One Selected Nutrition Template',
      meta: {
        name: 'The One Selected Nutrition Template',
        daily_calories: 2400,
        daily_protein: 180,
        daily_carbs: 220,
        daily_fat: 70,
        notes: 'A long template note that the prompt must not repeat verbatim because it is noise.',
      },
    });
  }

  return {
    kind: 'nutrition',
    objective: OBJECTIVE,
    templates,
    mealsByTemplate,
    // Phase 1 loads no food library at all.
    foodOptions: [],
    allergenMetadataAvailable: false,
    summary: {
      summary_text: 'A'.repeat(900),
      key_points: Array.from({ length: 8 }, (_, i) => `Key point ${i + 1} ` + 'B'.repeat(120)),
    },
    metrics: [],
    metricsNewerThanSummary: false,
    client: {
      full_name: 'Sample Client',
      email: 'sample@example.com',
      gender: 'male',
      height: 178,
      current_weight: 82.5,
    },
    catalogCapped: false,
  };
}

const ctx = buildFixture();

function validationContext(allowedOps: readonly string[] = PHASE1_NUTRITION_OPS) {
  return makeValidationContext({
    kind: 'nutrition',
    objective: OBJECTIVE,
    templates: ctx.templates,
    foodOptions: ctx.foodOptions,
    exerciseOptions: [],
    alternativeOptions: [],
    meals: ctx.mealsByTemplate.get('template_1') ?? [],
    days: [],
    allergensToAvoid: [],
    allergenMetadataAvailable: ctx.allergenMetadataAvailable,
    hasSummary: !!ctx.summary,
    metricsNewerThanSummary: false,
    allowedOps,
  });
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: PROPOSAL_SCHEMA_VERSION,
    kind: 'nutrition',
    objective: OBJECTIVE,
    selected_template_ref: 'template_1',
    selection_rationale: 'Matches the client goal and their current training load.',
    operations: [{ op: 'adjust_amount', target_ref: 'item_1', amount: 150, reason: 'Needs more fuel.' }],
    coach_notes: [],
    unresolved_requirements: [],
    ...overrides,
  };
}

describe('Create Plan Phase 1 operation scope', () => {
  it('is a strict, non-empty subset of the canonical nutrition vocabulary', () => {
    for (const op of PHASE1_NUTRITION_OPS) {
      expect(NUTRITION_OP_TYPES).toContain(op);
    }
    expect(PHASE1_NUTRITION_OPS.length).toBeGreaterThan(0);
    expect(PHASE1_NUTRITION_OPS.length).toBeLessThan(NUTRITION_OP_TYPES.length);
  });

  it('forbids every operation that would change or add a food', () => {
    for (const forbidden of ['swap_food', 'add_item', 'remove_item']) {
      expect(PHASE1_NUTRITION_OPS as readonly string[]).not.toContain(forbidden);
    }
  });

  it('rejects a swap_food in the provider response schema enum', () => {
    const schema = createPlanResponseSchemaFor('nutrition', PHASE1_NUTRITION_OPS);
    const opEnum = schema.properties.operations.items.properties.op.enum as string[];
    expect(opEnum).toEqual([...PHASE1_NUTRITION_OPS]);
    expect(opEnum).not.toContain('swap_food');
  });

  it('rejects a swap_food at the router gate, not only at final resolution', () => {
    // The gate validates with the preflight projection, so the narrowing has to
    // survive `preflightContextFrom` or a forbidden op would pass the gate.
    const gate = preflightContextFrom(validationContext());
    const verdict = preflightProposal(
      proposal({
        operations: [
          {
            op: 'swap_food',
            target_ref: 'item_1',
            food_option_ref: 'food_option_1',
            amount: 100,
            unit_ref: 'food_option_1:u1',
            reason: 'swap',
          },
        ],
      }),
      gate,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join(' ')).toContain('not a valid nutrition operation');
  });

  it('never names swap_food in the prompt', () => {
    const prompt = buildPrompt(ctx as LoadedContext, OBJECTIVE, nutritionCatalog(ctx));
    expect(prompt.toLowerCase()).not.toContain('swap_food');
    expect(prompt).not.toContain('food_option');
  });

  it('accepts each allowed operation', () => {
    for (const op of [
      { op: 'update_plan_targets', daily_calories: 2300, daily_protein: 190 },
      { op: 'adjust_amount', target_ref: 'item_1', amount: 150 },
    ]) {
      const resolved = validateProposal(proposal({ operations: [op] }), validationContext());
      expect(resolved.ok, JSON.stringify(resolved.errors ?? op)).toBe(true);
    }
  });

  it('keeps adjust_amount unit-free by keeping unit_ref optional', () => {
    // No food catalogue is loaded, so the model cannot name a valid unit_ref.
    // The contract must therefore keep the item's existing unit.
    const resolved = validateProposal(
      proposal({ operations: [{ op: 'adjust_amount', target_ref: 'item_1', amount: 150, reason: 'x' }] }),
      validationContext(),
    );
    expect(resolved.ok).toBe(true);
    const draft = resolved.draft as any;
    const item = draft.meals[0].items.find((i: any) => i.source_ref === 'item:item_1');
    expect(item.amount).toBe(150);
    // Preserved from the template, not invented and not nulled.
    expect(item.unit).toBe('g');
  });
});

describe('Create Plan Phase 1 prompt is minimal', () => {
  const catalog = nutritionCatalog(ctx);
  const prompt = buildPrompt(ctx as LoadedContext, OBJECTIVE, catalog);

  it('offers exactly one template and no food options', () => {
    expect(catalog).toContain('template_1');
    expect(catalog).not.toContain('template_2');
    expect(catalog).not.toContain('FOOD OPTIONS');
    expect(catalog).not.toContain('unit_ref');
  });

  it('carries the objective, the client form and the selected template, and nothing else', () => {
    expect(prompt).toContain(`OBJECTIVE: ${OBJECTIVE}`);
    expect(prompt).toContain('CLIENT FORM:');
    expect(prompt).toContain('SELECTED TEMPLATE:');
    // Not carried: measurements, catalog rules, food metadata, allergens.
    expect(prompt).not.toContain('RECENT MEASUREMENTS');
    expect(prompt).not.toContain('ALLERGEN');
    expect(prompt).not.toContain('TEMPLATES (pick one)');
  });

  it('keeps the full request, prompt plus response schema, inside the input budget', () => {
    const schemaLength = JSON.stringify(
      createPlanResponseSchemaFor('nutrition', PHASE1_NUTRITION_OPS),
    ).length;
    const input = prompt.length + schemaLength;

    expect(input).toBeLessThanOrEqual(CREATE_PLAN_INPUT_BUDGET.promptBudgetChars);

    // The number that actually decides the route.
    const tokens = input / CREATE_PLAN_INPUT_BUDGET.charsPerInputToken;
    expect(tokens).toBeLessThan(6800);
  });
});

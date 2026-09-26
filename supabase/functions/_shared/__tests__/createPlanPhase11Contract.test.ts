/**
 * Create Plan Phase 1.1 contract regression.
 *
 * Phase 1.1 exists to maximise the probability of ONE valid end-to-end proposal.
 * It follows the first real authenticated attempt (request 382fd3f8, 2026-09-26),
 * where the infrastructure all worked -- Groq returned HTTP 200 with a complete
 * 5,622-character proposal -- and the run failed on exactly one operation:
 *
 *   operations[3](set_meal_notes).notes: required, non-empty text
 *
 * The model reached for a free-text field and left it empty. So the fix is not a
 * looser validator; it is a contract with no free-text field left to get wrong.
 * `set_meal_notes` and `update_plan_notes` are the only two operations whose sole
 * payload is authored prose, so dropping them leaves `update_plan_targets` and
 * `adjust_amount`: targets, an amount, and an optional short reason.
 *
 * The validator is NOT relaxed anywhere in this file. Every assertion below
 * expects rejection to still work -- these tests prove the contract got
 * narrower, not that the checks got weaker.
 */
import { describe, it, expect } from 'vitest';
import {
  makeValidationContext,
  NUTRITION_OP_TYPES,
  OP_KEYS_BY_TYPE,
  preflightContextFrom,
  preflightProposal,
  PROPOSAL_SCHEMA_VERSION,
  validateProposal,
} from '../createPlanContract.ts';
import type { NutritionMealSnapshot, TemplateRef } from '../createPlanContract.ts';
import { createPlanResponseSchemaFor, operationRuleLineFor } from '../createPlanSchema.ts';
import { buildPrompt, CREATE_PLAN_INPUT_BUDGET, nutritionCatalog, PHASE1_NUTRITION_OPS } from '../../create-plan/index.ts';
import type { LoadedContext, NutritionContext } from '../../create-plan/index.ts';

const OBJECTIVE = 'recomp';

function buildFixture(): NutritionContext {
  const mealsByTemplate = new Map<string, NutritionMealSnapshot[]>();
  const templates: TemplateRef[] = [];
  let itemSeq = 0;

  for (let t = 0; t < 1; t += 1) {
    const meals: NutritionMealSnapshot[] = [];
    for (let m = 0; m < 8; m += 1) {
      const items = [];
      for (let k = 0; k < 6; k += 1) {
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
        notes: 'A long template note the prompt must not repeat verbatim because it is noise.',
      },
    });
  }

  return {
    kind: 'nutrition',
    objective: OBJECTIVE,
    templates,
    mealsByTemplate,
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

const REMOVED_OPS = ['set_meal_notes', 'update_plan_notes'] as const;

describe('Phase 1.1 allowed operation set', () => {
  it('allows update_plan_targets', () => {
    expect(PHASE1_NUTRITION_OPS as readonly string[]).toContain('update_plan_targets');
  });

  it('allows adjust_amount', () => {
    expect(PHASE1_NUTRITION_OPS as readonly string[]).toContain('adjust_amount');
  });

  it('does NOT allow set_meal_notes', () => {
    expect(PHASE1_NUTRITION_OPS as readonly string[]).not.toContain('set_meal_notes');
  });

  it('does NOT allow update_plan_notes', () => {
    expect(PHASE1_NUTRITION_OPS as readonly string[]).not.toContain('update_plan_notes');
  });

  it('is exactly the two target/amount operations, and still a strict subset of canonical', () => {
    expect([...PHASE1_NUTRITION_OPS]).toEqual(['update_plan_targets', 'adjust_amount']);
    for (const op of PHASE1_NUTRITION_OPS) {
      expect(NUTRITION_OP_TYPES).toContain(op);
    }
    expect(PHASE1_NUTRITION_OPS.length).toBeLessThan(NUTRITION_OP_TYPES.length);
  });

  it('leaves no free-text-only operation in the allowed set', () => {
    // The whole point of 1.1: every allowed op carries structured values.
    for (const op of PHASE1_NUTRITION_OPS) {
      const keys = OP_KEYS_BY_TYPE[op] ?? [];
      expect(keys, `${op} must not carry a notes field`).not.toContain('notes');
    }
  });
});

describe('Phase 1.1 provider response schema', () => {
  const schema = createPlanResponseSchemaFor('nutrition', PHASE1_NUTRITION_OPS);
  const itemProps = schema.properties.operations.items.properties as Record<string, any>;
  const opEnum = itemProps.op.enum as string[];

  it('enum contains only the two allowed operations', () => {
    expect(opEnum).toEqual(['update_plan_targets', 'adjust_amount']);
  });

  it('enum excludes both removed notes operations', () => {
    for (const removed of REMOVED_OPS) {
      expect(opEnum).not.toContain(removed);
    }
  });

  it('still excludes every food-changing operation', () => {
    for (const forbidden of ['swap_food', 'add_item', 'remove_item']) {
      expect(opEnum).not.toContain(forbidden);
    }
  });

  it('cannot express a notes field at all', () => {
    // `notes` is not merely absent from the enum: it is absent from the
    // property list, and the item is closed, so emitting it is a schema
    // violation before the validator ever runs.
    expect(itemProps).not.toHaveProperty('notes');
    expect(schema.properties.operations.items.additionalProperties).toBe(false);
  });

  it('names only fields the canonical validator would accept', () => {
    const allowed = new Set<string>();
    for (const op of PHASE1_NUTRITION_OPS) {
      for (const key of OP_KEYS_BY_TYPE[op] ?? []) allowed.add(key);
    }
    for (const key of Object.keys(itemProps)) {
      expect(allowed.has(key), `${key} must be a canonical field`).toBe(true);
    }
    // ...and it does not omit any field the validator requires either.
    for (const key of allowed) {
      expect(itemProps).toHaveProperty(key);
    }
  });

  it('excludes the removed operations from the prompt rule line', () => {
    const line = operationRuleLineFor('nutrition', PHASE1_NUTRITION_OPS);
    expect(line).toContain('"update_plan_targets"');
    expect(line).toContain('"adjust_amount"');
    for (const removed of REMOVED_OPS) {
      expect(line).not.toContain(removed);
    }
  });
});

describe('Phase 1.1 prompt', () => {
  const prompt = buildPrompt(ctx as LoadedContext, OBJECTIVE, nutritionCatalog(ctx));

  it('never names a removed notes operation', () => {
    for (const removed of REMOVED_OPS) {
      expect(prompt).not.toContain(removed);
    }
  });

  it('never names a food-changing operation or a food option', () => {
    for (const forbidden of ['swap_food', 'add_item', 'remove_item']) {
      expect(prompt.toLowerCase()).not.toContain(forbidden);
    }
    expect(prompt).not.toContain('food_option');
  });

  it('states the adapt-only constraint and both allowed operations', () => {
    expect(prompt).toContain('adapting the provided YBS template');
    expect(prompt).toContain('Do not invent foods');
    expect(prompt).toContain('Do not add foods');
    expect(prompt).toContain('Do not swap foods');
    expect(prompt).toContain('update_plan_targets');
    expect(prompt).toContain('adjust_amount');
  });

  it('tells the model not to put operation identifiers in text fields', () => {
    expect(prompt).toContain('Do not place operation identifiers inside text fields');
  });

  it('shows a concrete operation shape rather than an enum union', () => {
    expect(prompt).toContain('"op": "adjust_amount"');
    expect(prompt).toContain('"target_ref"');
    expect(prompt).toContain('"op": "update_plan_targets"');
  });

  it('stays compact and inside the declared input budget', () => {
    // This fixture is deliberately larger than production (8 meals x 6 items and
    // a full summary vs the 5 meals / 20 items and 1,121-char catalog seen in
    // request 382fd3f8), so the absolute number here is not the production one.
    // What must hold is that narrowing the contract did not grow the prompt:
    // the Phase 1 rules block is 9 lines, and the whole request still fits the
    // budget with room to spare.
    const rules = prompt.slice(prompt.indexOf('Create a nutrition plan by adapting'));
    const rulesBlock = rules.slice(0, rules.indexOf('OUTPUT (JSON only'));
    expect(rulesBlock.trim().split('\n').length).toBeLessThanOrEqual(9);
    expect(prompt.length).toBeLessThan(CREATE_PLAN_INPUT_BUDGET.promptBudgetChars);
  });
});

describe('Phase 1.1 validation is unchanged in strictness', () => {
  it('accepts a valid Phase 1.1 proposal end to end', () => {
    const result = validateProposal(proposal(), validationContext());
    expect(result.ok, JSON.stringify(result.errors ?? {})).toBe(true);
  });

  it('accepts a proposal mixing both allowed operations', () => {
    const result = validateProposal(
      proposal({
        operations: [
          { op: 'update_plan_targets', daily_calories: 2300, daily_protein: 190 },
          { op: 'adjust_amount', target_ref: 'item_2', amount: 175, reason: 'More fuel.' },
        ],
      }),
      validationContext(),
    );
    expect(result.ok, JSON.stringify(result.errors ?? {})).toBe(true);
  });

  it('still rejects set_meal_notes at the router gate, not only at final resolution', () => {
    const gate = preflightContextFrom(validationContext());
    const verdict = preflightProposal(
      proposal({
        operations: [
          { op: 'set_meal_notes', target_ref: 'meal_1', notes: 'Client prefers this early.' },
        ],
      }),
      gate,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join(' ')).toContain('not a valid nutrition operation');
  });

  it('still rejects update_plan_notes at the router gate', () => {
    const gate = preflightContextFrom(validationContext());
    const verdict = preflightProposal(
      proposal({ operations: [{ op: 'update_plan_notes', notes: 'Reassess after two weeks.' }] }),
      gate,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join(' ')).toContain('not a valid nutrition operation');
  });

  it('rejects a notes field smuggled onto an allowed operation', () => {
    // The exact shape that broke production, minus the removed op name. The
    // allowed-op key check is unchanged, so this is still a hard rejection.
    const gate = preflightContextFrom(validationContext());
    const verdict = preflightProposal(
      proposal({
        operations: [{ op: 'adjust_amount', target_ref: 'item_1', amount: 150, notes: 'adjust_amount' }],
      }),
      gate,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join(' ')).toMatch(/notes/);
  });

  it('still rejects an out-of-range amount', () => {
    const result = validateProposal(
      proposal({ operations: [{ op: 'adjust_amount', target_ref: 'item_1', amount: -5 }] }),
      validationContext(),
    );
    expect(result.ok).toBe(false);
  });

  it('still rejects an unknown target_ref', () => {
    const result = validateProposal(
      proposal({ operations: [{ op: 'adjust_amount', target_ref: 'item_9999', amount: 150 }] }),
      validationContext(),
    );
    expect(result.ok).toBe(false);
  });
});

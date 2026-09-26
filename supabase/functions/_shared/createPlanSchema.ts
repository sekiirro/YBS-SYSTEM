/**
 * Create Plan V1 — provider-facing response schema + prompt vocabulary.
 *
 * The canonical operation vocabulary lives in `createPlanContract.ts`
 * (`NUTRITION_OP_TYPES` / `TRAINING_OP_TYPES`) and is enforced by
 * `preflightProposal` / `validateProposal`. This module derives the two
 * things the model actually sees from those same constants, so the prompt
 * and the JSON schema can never name an operation the validator rejects:
 *
 *   - `createPlanResponseSchemaFor(kind)` — the response schema sent to the
 *     provider. Its `operations[].op` enum is exactly the canonical list.
 *   - `operationRuleLineFor(kind)` — the compact prompt rule that names the
 *     same list. Interpolated, never hardcoded, so it cannot drift.
 */
import {
  NUTRITION_OP_TYPES,
  OP_KEYS_BY_TYPE,
  PROPOSAL_SCHEMA_VERSION,
  TRAINING_OP_TYPES,
} from './createPlanContract.ts';
import type { PlanKind } from './createPlanContract.ts';

/** The single canonical V1 operation vocabulary, per plan kind. */
export function canonicalOpsFor(kind: PlanKind, allowedOps?: readonly string[]): readonly string[] {
  if (allowedOps) return allowedOps;
  return kind === 'nutrition' ? NUTRITION_OP_TYPES : TRAINING_OP_TYPES;
}

/**
 * Compact prompt rule naming the exact allowed operation values.
 * Positive-only: it never mentions an invalid synonym, so the model is not
 * primed to emit one.
 */
export function operationRuleLineFor(kind: PlanKind, allowedOps?: readonly string[]): string {
  const names = canonicalOpsFor(kind, allowedOps)
    .map((op) => `"${op}"`)
    .join(' | ');
  return (
    `Use ONLY these operation names for "${kind}" operations: ${names}. ` +
    `Never invent operation names or synonyms.`
  );
}

/**
 * Union of the field names every allowed operation may carry.
 *
 * Derived from `OP_KEYS_BY_TYPE` -- the very same table `preflightProposal`
 * enforces with `assertOnlyKeys` -- so the schema can never permit a field the
 * validator would reject, nor omit one it requires.
 *
 * This is what makes a Phase 1.1 `notes` field structurally impossible rather
 * than merely discouraged: `notes` belongs to `set_meal_notes` /
 * `update_plan_notes`, so once those leave the allowed set, `notes` leaves the
 * property list, and `additionalProperties: false` turns any attempt to emit it
 * into a provider-side schema violation before it can reach the validator.
 */
function allowedOperationFields(ops: readonly string[]): string[] {
  const fields = new Set<string>();
  for (const op of ops) {
    for (const key of OP_KEYS_BY_TYPE[op] ?? ['op', 'reason']) fields.add(key);
  }
  return [...fields].sort();
}

/** JSON-Schema type for one operation field, keyed by field name. */
function operationFieldSchema(field: string): Record<string, any> {
  switch (field) {
    case 'target_ref':
    case 'meal_ref':
      return { type: 'STRING' };
    case 'amount':
      return { type: 'NUMBER' };
    case 'unit_ref':
      return { type: 'STRING' };
    case 'reason':
      return { type: 'STRING' };
    case 'daily_calories':
    case 'daily_protein':
    case 'daily_carbs':
    case 'daily_fat':
      return { type: 'NUMBER' };
    default:
      return { type: 'STRING' };
  }
}

/**
 * Response schema for the provider call. `operations[].op` carries exactly
 * the allowed enum, and `operations[]` is closed to the union of those ops'
 * fields so the model cannot invent a shape the validator would reject.
 *
 * Gemini compatibility is handled at the provider boundary by
 * `toGeminiSchema` (see `_shared/aiProviders.ts`), not here, so this stays
 * the single provider-neutral contract.
 */
export function createPlanResponseSchemaFor(
  kind: PlanKind,
  allowedOps?: readonly string[],
): Record<string, any> {
  const ops = canonicalOpsFor(kind, allowedOps);
  const fields = allowedOperationFields(ops);
  const operationsItemProperties: Record<string, any> = {
    op: { type: 'STRING', enum: [...ops] },
  };
  for (const field of fields) {
    if (field === 'op') continue;
    operationsItemProperties[field] = operationFieldSchema(field);
  }

  return {
    type: 'OBJECT',
    properties: {
      schema_version: { type: 'STRING', enum: [PROPOSAL_SCHEMA_VERSION] },
      kind: { type: 'STRING', enum: ['nutrition', 'training'] },
      objective: { type: 'STRING', enum: ['cutting', 'recomp', 'bulking'] },
      selected_template_ref: { type: 'STRING', pattern: '^template_\\d+$' },
      selection_rationale: { type: 'STRING', maxLength: 1200 },
      operations: {
        type: 'ARRAY',
        minItems: 1,
        maxItems: 120,
        items: {
          type: 'OBJECT',
          properties: operationsItemProperties,
          required: ['op'],
          additionalProperties: false,
        },
      },
      coach_notes: {
        type: 'ARRAY',
        maxItems: 40,
        items: {
          type: 'OBJECT',
          properties: {
            code: { type: 'STRING' },
            severity: { type: 'STRING', enum: ['info', 'advisory', 'warning', 'blocking'] },
            message: { type: 'STRING', maxLength: 400 },
            target_ref: { type: 'STRING' },
            suggested_action: { type: 'STRING', maxLength: 400 },
            requires_acknowledgement: { type: 'BOOLEAN' },
          },
          required: ['code', 'severity', 'message'],
          additionalProperties: false,
        },
      },
      unresolved_requirements: {
        type: 'ARRAY',
        maxItems: 20,
        items: { type: 'STRING', maxLength: 300 },
      },
    },
    required: ['kind', 'objective', 'selected_template_ref', 'operations'],
    additionalProperties: false,
  };
}

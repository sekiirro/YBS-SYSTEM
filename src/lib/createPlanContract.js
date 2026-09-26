/**
 * Create Plan V1 — frontend mirror of the shared proposal contract.
 *
 * `supabase/functions/_shared/createPlanContract.ts` is the authority: it owns
 * the strict validation, the run-scoped reference scheme and every number. This
 * file mirrors ONLY the pure constants the UI needs to render, label and style a
 * proposal, so the browser never has to re-implement a rule to display it.
 *
 * This mirrors `src/lib/aiAnalysisCache.js` <-> the edge function's copy of the
 * same helpers: the values below are duplicated deliberately, and the parity
 * between the two files is asserted by the test suite so they cannot drift.
 */

export const PROPOSAL_SCHEMA_VERSION = 'create-plan-v1';

export const PLAN_KINDS = ['nutrition', 'training'];

export const PLAN_OBJECTIVES = ['cutting', 'recomp', 'bulking'];

/** Coach-facing copy. The objective the coach picks is sent verbatim. */
export const OBJECTIVE_META = {
  cutting: {
    label: 'Cutting',
    blurb: 'Fat loss. A calorie deficit with high protein and controlled carbs around training.',
  },
  recomp: {
    label: 'Recomposition',
    blurb: 'Performance first. Maintenance calories, high protein, no aggressive deficit or surplus.',
  },
  bulking: {
    label: 'Bulking',
    blurb: 'Lean gain. A modest surplus with high protein, more food and more training volume.',
  },
};

export const KIND_META = {
  nutrition: { label: 'Nutrition', blurb: 'Meals, portions and daily targets built from your Food Database.' },
  training: { label: 'Training', blurb: 'Sessions, exercises, sets, reps and RIR built from your Exercise Library.' },
};

export const NOTE_SEVERITIES = ['info', 'advisory', 'warning', 'blocking'];

/**
 * Display order for coach notes: anything the coach must act on or acknowledge
 * first. The server already sorts its own notes ahead of the model's; this only
 * decides how a given severity is styled and grouped in the review panel.
 */
export const SEVERITY_ORDER = { blocking: 0, warning: 1, advisory: 2, info: 3 };

export const SEVERITY_STYLES = {
  blocking: { label: 'Blocking', tone: 'red' },
  warning: { label: 'Needs checking', tone: 'amber' },
  advisory: { label: 'Advisory', tone: 'blue' },
  info: { label: 'Info', tone: 'slate' },
};

export const MEAL_ROLES = ['protein', 'carbs', 'fats', 'vegetables', 'fruits', 'other'];

export const DAY_TYPES = ['session', 'rest_day'];

export const CHANGE_SCOPES = {
  plan: 'Plan',
  meal: 'Meal',
  item: 'Food',
  day: 'Session',
  exercise: 'Exercise',
  unit: 'Portion',
  allergen: 'Allergen',
  rir: 'RIR',
  note: 'Note',
};

export function isPlanKind(value) {
  return typeof value === 'string' && PLAN_KINDS.includes(value);
}

export function isPlanObjective(value) {
  return typeof value === 'string' && PLAN_OBJECTIVES.includes(value);
}

/**
 * A stable identity for a proposal, used to tell a genuinely new generation
 * apart from a re-render. Deliberately derived only from fields the coach can
 * see, so it never needs to match anything the server computed.
 */
export function proposalFingerprint(proposal) {
  if (!proposal || typeof proposal !== 'object') return '';
  const operations = Array.isArray(proposal.operations) ? proposal.operations : [];
  return JSON.stringify([
    proposal.schema_version ?? PROPOSAL_SCHEMA_VERSION,
    proposal.kind ?? '',
    proposal.objective ?? '',
    proposal.selected_template_ref ?? '',
    operations,
  ]);
}

/** Sorts a coach-note list for display without mutating the input. */
export function sortCoachNotes(notes) {
  return [...(Array.isArray(notes) ? notes : [])].sort(
    (a, b) => (SEVERITY_ORDER[a?.severity] ?? 9) - (SEVERITY_ORDER[b?.severity] ?? 9),
  );
}

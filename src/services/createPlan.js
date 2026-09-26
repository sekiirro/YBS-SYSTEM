import { supabase } from '@/utils/supabase';
import { PLAN_KINDS, PLAN_OBJECTIVES } from '@/lib/createPlanContract';

/**
 * Create Plan service — thin wrapper around the create-plan edge function.
 *
 * The edge function is read-only by design. It loads the client's own Summary,
 * body data and the workspace's real templates / Food Database / Exercise
 * Library through the caller's RLS-scoped session, makes ONE provider call, and
 * returns a validated draft. Nothing is persisted here: the coach reviews the
 * proposal and then uses the Nutrition planner's "Save Draft" or the Training
 * planner's "Save & Assign", which are the only write paths.
 *
 * The browser sends nothing but ids and the coach's chosen objective, so a
 * tampered client cannot smuggle in a different client, a different workspace or
 * a fabricated macro target.
 */
export class CreatePlanError extends Error {
  constructor(message, code = 'create_plan_failed') {
    super(message);
    this.name = 'CreatePlanError';
    this.code = code;
  }
}

export { PLAN_KINDS, PLAN_OBJECTIVES };

/** Human-readable copy for every error code the function can return. */
const CREATE_PLAN_ERRORS = {
  bad_request: 'That request was not valid. Please try again.',
  unauthorized: 'You need to be signed in to create a plan.',
  assessment_not_found: 'This form could not be found, or you do not have access to it.',
  no_client: 'This form is not linked to a client yet.',
  no_submission: 'Your client has not submitted the required form yet.',
  client_not_found: 'Client not found, or you do not have access to them.',
  no_templates: 'This workspace has no plan templates yet. Create one first.',
  server_not_configured: 'The AI service is not configured.',
  ai_unavailable: 'The AI service is currently unavailable. Please try again.',
  generation_failed: 'The AI could not produce a usable plan proposal. Please try again.',
  load_failed: 'Something went wrong loading the plan data. Please try again.',
  network_error: 'The request could not reach the server. Check your connection and try again.',
};

function messageFor(code, fallback) {
  return CREATE_PLAN_ERRORS[code] || fallback || 'Could not create a plan proposal.';
}

/**
 * Generates a nutrition or training plan proposal for a submitted form.
 *
 * @param {object} params
 * @param {string} params.assessmentId  the submitted form the plan is based on
 * @param {'nutrition'|'training'} params.kind
 * @param {'cutting'|'recomp'|'bulking'} params.objective  coach-selected, authoritative
 * @returns {Promise<{ proposal: Object, draft: Object, meta: Object, catalog: Object }>}
 */
export async function generatePlanProposal({ assessmentId, kind, objective }) {
  if (!assessmentId) {
    throw new CreatePlanError('A form is required to create a plan.', 'bad_request');
  }
  if (!PLAN_KINDS.includes(kind)) {
    throw new CreatePlanError('Choose nutrition or training.', 'bad_request');
  }
  if (!PLAN_OBJECTIVES.includes(objective)) {
    throw new CreatePlanError('Choose a goal before generating a plan.', 'bad_request');
  }

  let data = null;
  let failure = null;
  try {
    const result = await supabase.functions.invoke('create-plan', {
      body: { assessmentId, kind, objective },
    });
    data = result.data;
    failure = result.error;
  } catch {
    // A transport-level failure never reaches the error-object path.
    throw new CreatePlanError(messageFor('network_error'), 'network_error');
  }

  if (failure) {
    // error.context is a raw Response, not parsed JSON.
    let body = null;
    let rawText = null;
    try {
      if (failure?.context && typeof failure.context.json === 'function') {
        body = await failure.context.json();
      }
    } catch {
      // If JSON parsing fails, try to get raw text for debugging.
      try {
        if (failure?.context && typeof failure.context.text === 'function') {
          rawText = await failure.context.text();
        }
      } catch {
        // Ignore text parsing errors too.
      }
    }

    if (import.meta.env.DEV) {
      console.error('[createPlan] invoke failed', {
        errorName: failure?.name,
        httpStatus: failure?.context?.status,
        code: body?.code,
        message: body?.error,
        rawText: rawText?.slice(0, 500),
      });
    }

    // Prefer structured error code/message, fall back to raw text, then generic.
    const fallbackMessage = rawText?.slice(0, 200) || body?.error || 'Could not create a plan proposal.';
    throw new CreatePlanError(
      messageFor(body?.code, fallbackMessage),
      body?.code || 'ai_unavailable',
    );
  }

  if (!data || data.success !== true || !data.draft) {
    throw new CreatePlanError(
      messageFor(data?.code, data?.error),
      data?.code || 'generation_failed',
    );
  }

  return data;
}

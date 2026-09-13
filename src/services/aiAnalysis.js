import { supabase } from '@/utils/supabase';

/**
 * AI analysis service — thin wrapper around the summarize-nutrition and
 * summarize-training edge functions.
 *
 * The edge functions are invoked through the user's own session, so every
 * assessment read and cache write is authorized by the existing RLS policies.
 * The function never accepts arbitrary prompts and never exposes Gemini
 * credentials to the browser.
 */
export class AIAnalysisError extends Error {
  constructor(message, code = 'ai_analysis_error') {
    super(message);
    this.name = 'AIAnalysisError';
    this.code = code;
  }
}

async function invokeAnalysis(functionName, assessmentId) {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: { assessmentId },
  });

  if (error) {
    // error.context is a raw fetch Response object — not parsed JSON.
    // We must await .json() to read the actual edge-function error body.
    let body = null;
    try {
      if (error?.context && typeof error.context.json === 'function') {
        body = await error.context.json();
      }
    } catch {
      // Body unreadable (e.g. network error, relay error). body stays null.
    }

    // Developer diagnostics — safe fields only, no secrets.
    if (import.meta.env.DEV) {
      console.error('[aiAnalysis]', functionName, {
        errorName: error?.name,
        httpStatus: error?.context?.status,
        code: body?.code,
        message: body?.error,
      });
    }

    throw new AIAnalysisError(
      body?.error || 'AI analysis is currently unavailable.',
      body?.code || 'ai_unavailable',
    );
  }

  if (!data || data.success !== true) {
    throw new AIAnalysisError(
      data?.error || 'AI analysis is currently unavailable.',
      data?.code || 'ai_unavailable',
    );
  }

  return data;
}

/**
 * Returns the cached/regenerated nutrition analysis for a submitted form.
 * @param {string} assessmentId
 * @returns {Promise<{ cached: boolean, model: string, analysis: Object, sources: Array }>}
 */
export async function getNutritionAnalysis(assessmentId) {
  return invokeAnalysis('summarize-nutrition', assessmentId);
}

/**
 * Returns the cached/regenerated training analysis for a submitted form.
 * @param {string} assessmentId
 * @returns {Promise<{ cached: boolean, model: string, analysis: Object, sources: Array }>}
 */
export async function getTrainingAnalysis(assessmentId) {
  return invokeAnalysis('summarize-training', assessmentId);
}
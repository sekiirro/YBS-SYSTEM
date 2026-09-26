import { supabase } from '@/utils/supabase';
import { ANALYSIS_TYPES, computeAnalysisFingerprint, restoreFromCacheRow } from '@/lib/aiAnalysisCache';

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

/**
 * Read-only restore path.
 *
 * Returns the persisted analysis for (assessmentId, analysisType) straight out
 * of `public.ai_analysis_cache`, or null when there is nothing valid to show.
 *
 * This is deliberately two plain RLS-scoped SELECTs and NOTHING else:
 *   - it never invokes summarize-nutrition / summarize-training, so mounting
 *     the panel, switching tabs or changing routes can never spend provider
 *     quota or start a regeneration;
 *   - it never writes, so it cannot invalidate or overwrite the cache.
 *
 * Visibility is exactly the cache table's existing SELECT policy (platform
 * owner / workspace owner / assigned YBS coach / client self), so a caller can
 * only ever restore an analysis they were already allowed to generate.
 *
 * The assessment is read only for the columns the stored fingerprint is
 * computed from, then hashed with the same algorithm the edge function used.
 * A mismatch means the submission changed since the analysis was generated, so
 * the stale analysis is discarded and the caller falls back to the
 * "Generate AI Analysis" state.
 *
 * @param {string} assessmentId
 * @param {'nutrition'|'training'} analysisType
 * @returns {Promise<null | { success: true, cached: true, model: string|null,
 *   meta: { provider: string|null, model: string|null, fallbackDepth: number|null, cached: true },
 *   analysis: Object, sources: Array }>}
 */
export async function restoreCachedAnalysis(assessmentId, analysisType) {
  if (!assessmentId || !ANALYSIS_TYPES.includes(analysisType)) return null;

  const [cacheRes, assessmentRes] = await Promise.all([
    supabase
      .from('ai_analysis_cache')
      .select('assessment_id, analysis_type, input_fingerprint, model, provider, fallback_depth, result, sources, updated_at')
      .eq('assessment_id', assessmentId)
      .eq('analysis_type', analysisType)
      .maybeSingle(),
    supabase
      .from('assessments')
      .select('id, questions_snapshot, assessment_responses(id, question_id, question_label, response_value)')
      .eq('id', assessmentId)
      .maybeSingle(),
  ]);

  if (cacheRes.error) throw cacheRes.error;
  if (assessmentRes.error) throw assessmentRes.error;

  const row = cacheRes.data;
  const assessment = assessmentRes.data;
  if (!row || !assessment) return null;

  return restoreFromCacheRow(row, await computeAnalysisFingerprint(assessment));
}
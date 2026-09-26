/**
 * AI Summary restore contract — pure, framework-free, dependency-free.
 *
 * WHY THIS EXISTS
 * The Summary panel used to hold its analysis in component-local state only,
 * so the analysis vanished every time the panel unmounted (switching the
 * Nutrition <-> Training tab, or any route change, unmounts the whole
 * workspace subtree). The analysis itself was never lost: it is persisted in
 * `public.ai_analysis_cache` and served as a cache hit by the summarize-*
 * edge functions. What was missing was a *read* path for it.
 *
 * This module owns the pure half of restoration:
 *   - recomputing the SAME fingerprint the edge function stores, so we can tell
 *     a still-valid cached analysis from one whose assessment has changed;
 *   - mapping a cache row into the exact payload shape the edge function
 *     returns on a cache hit, so a restored panel is indistinguishable from a
 *     freshly returned one;
 *   - formatting provider/model attribution, including the honest handling of
 *     historical rows whose provider / fallback_depth are genuinely NULL.
 *
 * NO I/O HAPPENS HERE. Restoration reads the cache row (see
 * `src/services/aiAnalysis.js`) and passes it to `restoreFromCacheRow`.
 * Nothing in this module — and nothing on the mount path — invokes an edge
 * function, so remounting or navigating tabs can never spend provider quota.
 *
 * This module is imported directly by the test harness, so it must stay free
 * of React, JSX, `@/` aliases and browser-only APIs.
 */

/** The only two analysis types the cache table accepts. */
export const ANALYSIS_TYPES = ['nutrition', 'training'];

/** SHA-256 hex digest of an arbitrary string. */
export async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Fingerprint the EXACT input (snapshot + responses) of an assessment.
 *
 * This is a deliberate, byte-for-byte mirror of `computeInputFingerprint` in
 * `supabase/functions/_shared/genai.ts`, which is what wrote
 * `ai_analysis_cache.input_fingerprint`. The two MUST agree or a perfectly
 * valid cached analysis would be treated as stale and the user would be asked
 * to regenerate it (and the regeneration would then be a cache hit again).
 *
 * The mapped response array is sorted on the response `id` before hashing
 * because `assessment_responses` is read as an embedded relation and
 * PostgreSQL returns it in unspecified order, while JSON.stringify is
 * order-sensitive. The comparator and the mapped tuple shape are copied
 * verbatim from the server implementation — do not "simplify" them here.
 */
export async function computeAnalysisFingerprint(assessment) {
  const snapshot = Array.isArray(assessment?.questions_snapshot) ? assessment.questions_snapshot : [];
  const responses = (Array.isArray(assessment?.assessment_responses)
    ? [...assessment.assessment_responses]
    : [])
    .sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? '')))
    .map((r) => [r.question_id, r.question_label, r.response_value]);
  return sha256Hex(JSON.stringify({ id: assessment?.id, snapshot, responses }));
}

/**
 * Map a persisted `ai_analysis_cache` row into the payload the summarize-*
 * edge functions return on a cache hit, or return null when there is nothing
 * valid to restore.
 *
 * Returns null when:
 *   - there is no row (never generated), or
 *   - the row has no `result` (the generation failed and stored only `error`),
 *     or
 *   - `fingerprint` is provided and does not match `input_fingerprint`, meaning
 *     the underlying assessment changed and the stored analysis is stale.
 *
 * When it returns null the caller shows the "Generate AI Analysis" state; it
 * must NOT start a generation on its own.
 */
export function restoreFromCacheRow(row, fingerprint) {
  if (!row) return null;
  if (!row.result) return null;
  if (typeof fingerprint === 'string' && row.input_fingerprint !== fingerprint) return null;

  return {
    success: true,
    cached: true,
    model: row.model ?? null,
    meta: {
      provider: row.provider ?? null,
      model: row.model ?? null,
      fallbackDepth: typeof row.fallback_depth === 'number' ? row.fallback_depth : null,
      cached: true,
    },
    analysis: row.result,
    sources: Array.isArray(row.sources) ? row.sources : [],
  };
}

/**
 * Provider display names. `novita` is intentionally still listed: rows written
 * before Novita was removed from the active route table are restored with the
 * provider that actually generated them, and the attribution must reflect that
 * rather than being silently dropped or rewritten to a current default.
 */
export const PROVIDER_LABELS = {
  openrouter: 'OpenRouter',
  kilo: 'Kilo',
  novita: 'Novita',
  gemini: 'Gemini',
  nvidia: 'NVIDIA',
};

export function titleize(value) {
  return String(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function prettyModel(model) {
  if (!model) return null;
  return titleize(String(model).split('/').pop().split(':')[0]);
}

/**
 * "Generated by OpenRouter · Ling 3 Flash Sante · Fallback #3"
 *
 * Only ever displays what is actually known:
 *   - a NULL provider renders the bare model, never a "Generated by <provider>"
 *     phrase, so a historical row can never imply a provider that did not
 *     produce it (and in particular can never be mistaken for the current
 *     first-choice route);
 *   - a NULL / depth-1 fallback depth gets no fallback marker.
 * Returns null when there is nothing to show.
 */
export function attributionLine(meta) {
  if (!meta) return null;
  const provider = meta.provider ? PROVIDER_LABELS[meta.provider] || titleize(meta.provider) : null;
  const model = prettyModel(meta.model);
  const parts = [];
  if (provider && model) parts.push(`Generated by ${provider} · ${model}`);
  else if (provider) parts.push(`Generated by ${provider}`);
  // Model with no known provider: show the model on its own. Prefixing it with
  // "Generated by" would fabricate a provider attribution that was never stored.
  else if (model) parts.push(model);
  if (typeof meta.fallbackDepth === 'number' && meta.fallbackDepth > 1) {
    parts.push(`Fallback #${meta.fallbackDepth}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

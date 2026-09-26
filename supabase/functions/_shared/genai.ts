/**
 * Shared plumbing for the YBS AI analysis edge functions
 * (summarize-nutrition / summarize-training).
 *
 * Every function follows the same security contract as the generic `gemini`
 * gateway:
 *   - Provider credentials (Novita / OpenRouter / Kilo / NVIDIA / Gemini) live
 *     exclusively in SUPABASE secrets and are never exposed to the browser,
 *     stored in source, or echoed in logs. Generation itself is delegated to
 *     ./aiRouter.ts, which owns the model order and failover policy; this file
 *     only owns auth, cache, prompts and the YBS response contract.
 *   - Only an authenticated YBS user may invoke the function; their own JWT
 *     builds an RLS-scoped Supabase client, so every assessment read and
 *     every ai_analysis_cache write is authorized by the existing RLS
 *     policies — never by a service role.
 *   - Analysis prompts only ever contain that single client's own form
 *     snapshot + responses (privacy: no other tenant data crosses the wire).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { runFailover } from './aiRouter.ts';
import { extractJsonObject, jsonObjectValidator, PER_ROUTE_TIMEOUT_MS } from './aiProviders.ts';

/**
 * Shared output budget. Nutrition was the last consumer of this default and is
 * the only caller that does not override it (Training passes its own 8192).
 *
 * 2048 -> 8192, from live evidence on 2026-09-25: Ling Sante returned HTTP 200
 * with `finishReason=length`, `budget=2048` and only 889 characters of output,
 * i.e. a syntactically incomplete JSON document. The same model completed the
 * same document correctly minutes earlier, because this budget is shared with
 * the model's thinking tokens -- so the split between "tokens spent reasoning"
 * and "tokens left to write JSON" is nondeterministic, and 2048 sits right on
 * that boundary. At 889 characters the JSON never got a chance to close.
 * Training was already raised to 8192 for exactly this reason.
 */
export const MAX_OUTPUT_TOKENS = 8192;
/** Per-route ceiling; the router enforces the overall failover budget. */
export const GEMINI_TIMEOUT_MS = PER_ROUTE_TIMEOUT_MS;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, apikey, x-client-info, x-supabase-api-version, content-type',
};

export function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export function errorResponse(code: string, message: string, status: number) {
  return json({ success: false, code, error: message }, status);
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Gemini request timed out.')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });
}

export type AuthResult =
  | { ok: true; userId: string; userClient: ReturnType<typeof createClient> }
  | { ok: false; response: Response };

/**
 * Authenticates the caller from their own access token and returns an
 * RLS-scoped Supabase client bound to that token.
 */
export async function authenticateCaller(req: Request): Promise<AuthResult> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return {
      ok: false,
      response: errorResponse('server_not_configured', 'AI service is not configured.', 503),
    };
  }

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return { ok: false, response: errorResponse('unauthorized', 'Missing authorization token.', 401) };
  }

  const callerAuth = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await callerAuth.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, response: errorResponse('unauthorized', 'Invalid authorization token.', 401) };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  return { ok: true, userId: data.user.id, userClient };
}

/** SHA-256 hex digest of an arbitrary string (used for cache fingerprints). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Fingerprint the EXACT input (snapshot + responses) of an assessment.
 *
 * The mapped response array MUST be deterministic. `assessment_responses` is
 * read as an embedded relation, so PostgreSQL returns it in unspecified
 * order, while JSON.stringify is order-sensitive: the same unchanged
 * assessment could hash to a different fingerprint on two consecutive calls
 * and force a redundant regeneration. That was observed live on 2026-09-25 --
 * an identical form was a cache hit at 20:16 and a cache miss at 20:18, and
 * the regenerated request then surfaced a flaky provider failure to the user
 * that the cached copy would have hidden.
 *
 * Sorting on `id` (the primary key: stable and unique) makes the hash
 * order-independent. This is fingerprinting ONLY -- the prompt is built from
 * the assessment separately and is untouched, so nothing the model sees
 * changes.
 */
export async function computeInputFingerprint(assessment: Record<string, any>): Promise<string> {
  const snapshot = Array.isArray(assessment.questions_snapshot) ? assessment.questions_snapshot : [];
  const responses = (Array.isArray(assessment.assessment_responses)
    ? [...assessment.assessment_responses]
    : [])
    .sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? '')))
    .map((r: Record<string, any>) => [r.question_id, r.question_label, r.response_value]);
  return sha256Hex(JSON.stringify({ id: assessment.id, snapshot, responses }));
}

export interface Source {
  title: string;
  url: string;
}

/**
 * Pulls up to `limit` citing web sources from the Gemini response's
 * grounding metadata (Google Search grounding).
 */
export function extractSources(response: unknown, limit = 4): Source[] {
  try {
    const candidates = (response as any)?.candidates;
    if (!Array.isArray(candidates)) return [];
    const firstCandidate = candidates[0];

    // Path 1: groundingChunks from groundingMetadata (Google Search grounding)
    const grounding = firstCandidate?.groundingMetadata;
    const chunks = grounding?.groundingChunks || [];
    const fromChunks = chunks
      .filter((c: any) => c?.web && typeof c.web.url === 'string')
      .slice(0, limit)
      .map((c: any) => ({ title: String(c.web.title || 'Source'), url: c.web.url }));

    // Path 2: url_citation annotations on text content parts (newer Gemini API format)
    const content = firstCandidate?.content;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const fromAnnotations: Source[] = [];
    for (const part of parts) {
      const annotations = Array.isArray(part?.annotations) ? part.annotations : [];
      for (const ann of annotations) {
        if (ann?.type === 'url_citation' && typeof ann?.url === 'string') {
          fromAnnotations.push({ title: String(ann.title || 'Source'), url: ann.url });
        }
      }
      if (fromAnnotations.length >= limit) break;
    }

    // Combine both paths, deduplicate by URL, and return up to limit.
    const seen = new Set<string>();
    const combined: Source[] = [];
    for (const s of [...fromChunks, ...fromAnnotations]) {
      if (!seen.has(s.url) && s.url) {
        seen.add(s.url);
        combined.push(s);
      }
    }
    return combined.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Plain-text prompt body built from a client's submitted assessment.
 * Only that client's own snapshot + responses are included.
 */
export function buildFormPrompt(
  assessment: Record<string, any>,
  introduction: string,
  extraRules: string[] = [],
): string {
  const snapshot = Array.isArray(assessment.questions_snapshot)
    ? [...assessment.questions_snapshot].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      )
    : [];
  const responses = Array.isArray(assessment.assessment_responses)
    ? assessment.assessment_responses
    : [];

  const lines: string[] = [];
  for (const q of snapshot) {
    const resp = responses.find((r) => r.question_id === q.id);
    let value: unknown = resp?.response_value;
    let display: string;
    if (value == null || value === '') {
      display = '(no answer)';
    } else if (Array.isArray(value)) {
      display = value.join(', ');
    } else if (typeof value === 'object') {
      display = JSON.stringify(value);
    } else {
      display = String(value);
    }
    lines.push(`- [${q.label || 'Question'}]`);
    lines.push(`    Answer: ${display}`);
  }

  const rules = extraRules.map((r) => `- ${r}`).join('\n');

  return [
    introduction,
    '',
    'TODAY: ' + new Date().toISOString().split('T')[0],
    '',
    'CLIENT FORM (question -> answer):',
    lines.join('\n') || '(the form has no questions yet)',
    '',
    'COACHING RULES:',
    '- Base every claim strictly on the answers above. Never invent facts that are not in the form.',
    '- If answers contradict each other, call out the contradiction instead of guessing.',
    '- Keep the tone warm, specific and actionable. Prefer short, concrete statements.',
    '- Response must be valid JSON that exactly matches the requested output schema.',
    ...(rules.length ? [rules] : []),
  ].join('\n');
}

export interface RunAnalysisOptions {
  req: Request;
  kind: 'nutrition' | 'training';
  buildPrompt: (assessment: Record<string, any>) => string;
  responseSchema: Record<string, any>;
  /**
   * Per-call output budget override. Omit it to use MAX_OUTPUT_TOKENS.
   * maxOutputTokens is shared with the model's thinking tokens, so a schema
   * that asks for a lot of content (e.g. training) needs a bigger budget than
   * one that does not, otherwise the JSON is cut off mid-document and
   * JSON.parse fails. Kept per-call so each analysis sizes its own budget.
   */
  maxOutputTokens?: number;
}

/**
 * Full analysis request flow shared by both summarizing functions:
 * auth -> RLS-scoped assessment load -> submission check -> fingerprint ->
 * cache lookup -> Gemini (structured JSON output) ->
 * cache upsert -> response.
 */
export async function runAnalysis(opts: RunAnalysisOptions): Promise<Response> {
  const { req, kind, buildPrompt, responseSchema, maxOutputTokens } = opts;

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') {
    return errorResponse('method_not_allowed', 'POST requests only.', 405);
  }

  const auth = await authenticateCaller(req);
  if (!auth.ok) return auth.response;

  let body: { assessmentId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return errorResponse('bad_request', 'Invalid JSON body.', 400);
  }
  const assessmentId = typeof body?.assessmentId === 'string' ? body.assessmentId : '';
  if (!assessmentId) {
    return errorResponse('bad_request', 'An assessmentId is required.', 400);
  }

  // 1. Load the assessment through the caller's RLS-scoped session. When the
  //    caller cannot see the row, RLS hides it and we report not_found —
  //    identical to how the rest of the app behaves.
  const { data: assessment, error: loadErr } = await auth.userClient
    .from('assessments')
    .select('*, assessment_responses(*)')
    .eq('id', assessmentId)
    .maybeSingle();
  if (loadErr) {
    console.error(`${kind} analysis: load failed:`, loadErr.message);
    return errorResponse('load_failed', 'Failed to load the form.', 502);
  }
  if (!assessment) {
    return errorResponse('assessment_not_found', 'Form not found or you do not have access to it.', 404);
  }

  // 2. Only submitted/reviewed forms are analyzed.
  const status = assessment.submission_status;
  if (status !== 'submitted' && status !== 'reviewed') {
    return errorResponse('no_submission', 'Your client has not submitted the required form yet.', 409);
  }

  // 3. Fingerprint the EXACT input (snapshot + responses) to detect changes.
  const fingerprint = await computeInputFingerprint(assessment);

  // 4. Cache hit: same assessment + type + unchanged input -> return stored.
  const { data: cached } = await auth.userClient
    .from('ai_analysis_cache')
    .select('*')
    .eq('assessment_id', assessment.id)
    .eq('analysis_type', kind)
    .maybeSingle();
  if (cached && cached.input_fingerprint === fingerprint && cached.result) {
    return json({
      success: true,
      cached: true,
      model: cached.model,
      meta: {
        provider: cached.provider ?? null,
        model: cached.model,
        fallbackDepth: cached.fallback_depth ?? null,
        cached: true,
      },
      analysis: cached.result,
      sources: Array.isArray(cached.sources) ? cached.sources : [],
    });
  }

  // 5. Generate via the provider failover router.
  //    Model order (owned by ./aiRouter.ts, not by this file):
  //      1. Ling 3.0 Flash Sante   (OpenRouter -> Kilo)
  //      2. Gemini                 (existing model + structured output, unchanged)
  //      3. Nemotron 3.5 Lightning (NVIDIA -> OpenRouter -> Kilo)
  //    NOTE: Google Search grounding (tools: [{ googleSearch: {} }]) is
  //    mutually exclusive with responseSchema / responseMimeType:'application/json'
  //    in the Gemini API — combining them returns a 400 error every time. That
  //    is still true for the Gemini route; the OpenAI-compatible routes receive
  //    the identical contract through a system message instead.
  const prompt = buildPrompt(assessment).slice(0, 30000);
  const budget = maxOutputTokens ?? MAX_OUTPUT_TOKENS;

  const routed = await runFailover({
    task: kind,
    prompt,
    schema: responseSchema,
    maxOutputTokens: budget,
    // A route only counts as a success if it produced a usable JSON object for
    // this schema. This is what lets a truncated 200 from one provider fail
    // over to the next instead of ending the chain.
    validateOutput: jsonObjectValidator(responseSchema),
  });

  if (!routed.ok) {
    // Error codes and HTTP statuses are unchanged from the pre-router code so
    // the frontend needs no change: a completely unconfigured service still
    // reports 503 server_not_configured, every provider outage 502
    // ai_unavailable. Integration/auth/config faults (the `hard` cases) are
    // already logged with their full route chain by the router.
    if (routed.notConfigured) {
      return errorResponse('server_not_configured', 'AI service is not configured.', 503);
    }
    // Every route answered 200 but none produced a usable document. That is a
    // generation problem, not an availability problem, so it keeps the
    // generation_failed contract the UI already renders rather than degrading
    // to the generic unavailable message.
    if (routed.errorClass === 'generation_output_invalid') {
      return errorResponse('generation_failed', 'The AI summary could not be generated. Please try again.', 502);
    }
    return errorResponse('ai_unavailable', 'AI service is currently unavailable.', 502);
  }

  const modelUsed = routed.model;
  const text = typeof routed.text === 'string' ? routed.text.trim() : '';
  const parsed = text ? extractJsonObject(text) : null;
  if (!parsed) {
    // Diagnostics are deliberately bounded and secret-free: provider, model,
    // finish reason, token budget, the head of the model's own output and how
    // many routes it took to get here. The prompt and the client's answers are
    // never logged. finishReason=length / MAX_TOKENS at the budget means the
    // JSON was cut off mid-document.
    console.error(
      `${kind} analysis: empty or non-JSON response.`,
      `provider=${routed.provider}`,
      `model=${modelUsed}`,
      `finishReason=${routed.finishReason}`,
      `budget=${budget}`,
      `len=${text.length}`,
      `routesTried=${routed.attempts.length}`,
      `text=${JSON.stringify(text.slice(0, 200))}`,
    );
    return errorResponse('generation_failed', 'The AI summary could not be generated. Please try again.', 502);
  }

  // Grounding metadata only ever exists on the Gemini route; the
  // OpenAI-compatible payloads simply have no `candidates` and yield [].
  const sources = extractSources(routed.raw, 4);

  // 6. Cache for identical future requests. A failed cache write never fails
  //    the user-facing result.
  const { error: cacheErr } = await auth.userClient.from('ai_analysis_cache').upsert(
    {
      client_id: assessment.client_id,
      assessment_id: assessment.id,
      analysis_type: kind,
      input_fingerprint: fingerprint,
      model: modelUsed,
      provider: routed.provider,
      fallback_depth: routed.attempts.length,
      result: parsed,
      sources,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'assessment_id,analysis_type' },
  );
  if (cacheErr) {
    console.warn(`${kind} analysis: cache write failed (analysis still returned):`, cacheErr.message);
  }

  return json({
    success: true,
    cached: false,
    model: modelUsed,
    meta: {
      provider: routed.provider,
      model: modelUsed,
      fallbackDepth: routed.attempts.length,
      cached: false,
    },
    analysis: parsed,
    sources,
  });
}
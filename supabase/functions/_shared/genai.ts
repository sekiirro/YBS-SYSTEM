/**
 * Shared plumbing for the YBS AI analysis edge functions
 * (summarize-nutrition / summarize-training).
 *
 * Every function follows the same security contract as the generic `gemini`
 * gateway:
 *   - The GEMINI_API_KEY lives exclusively in the SUPABASE secret and is
 *     never exposed to the browser, stored in source, or echoed in logs.
 *   - Only an authenticated YBS user may invoke the function; their own JWT
 *     builds an RLS-scoped Supabase client, so every assessment read and
 *     every ai_analysis_cache write is authorized by the existing RLS
 *     policies — never by a service role.
 *   - Analysis prompts only ever contain that single client's own form
 *     snapshot + responses (privacy: no other tenant data crosses the wire).
 */
import { GoogleGenAI } from 'npm:@google/genai@2.22.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
export const MAX_OUTPUT_TOKENS = 2048;
export const GEMINI_TIMEOUT_MS = 60000;

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

/** Returns a configured Gemini client + model or null when not configured. */
export function getGeminiConfig() {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return null;
  const model = Deno.env.get('GEMINI_MODEL')?.trim() || DEFAULT_GEMINI_MODEL;
  return { ai: new GoogleGenAI({ apiKey }), model };
}

/** SHA-256 hex digest of an arbitrary string (used for cache fingerprints). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
    const grounding = Array.isArray(candidates) ? candidates[0]?.groundingMetadata : undefined;
    const chunks = grounding?.groundingChunks || [];
    return chunks
      .filter((c: any) => c?.web && typeof c.web.url === 'string')
      .slice(0, limit)
      .map((c: any) => ({ title: String(c.web.title || 'Source'), url: c.web.url }));
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
}

/**
 * Full analysis request flow shared by both summarizing functions:
 * auth -> RLS-scoped assessment load -> submission check -> fingerprint ->
 * cache lookup -> Gemini (structured JSON output) ->
 * cache upsert -> response.
 */
export async function runAnalysis(opts: RunAnalysisOptions): Promise<Response> {
  const { req, kind, buildPrompt, responseSchema } = opts;

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
  const snapshot = Array.isArray(assessment.questions_snapshot) ? assessment.questions_snapshot : [];
  const responses = Array.isArray(assessment.assessment_responses)
    ? assessment.assessment_responses.map((r: Record<string, any>) => [
        r.question_id,
        r.question_label,
        r.response_value,
      ])
    : [];
  const fingerprint = await sha256Hex(JSON.stringify({ id: assessment.id, snapshot, responses }));

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
      analysis: cached.result,
      sources: Array.isArray(cached.sources) ? cached.sources : [],
    });
  }

  // 5. Run Gemini with structured JSON output.
  //    NOTE: Google Search grounding (tools: [{ googleSearch: {} }]) is
  //    mutually exclusive with responseSchema / responseMimeType:'application/json'
  //    in the Gemini API — combining them returns a 400 error every time.
  //    We use structured output for reliable coaching data; grounding citations
  //    are not available when responseSchema is in use.
  const gen = getGeminiConfig();
  if (!gen) {
    return errorResponse('server_not_configured', 'AI service is not configured.', 503);
  }

  const prompt = buildPrompt(assessment).slice(0, 30000);
  const generateConfig: Record<string, unknown> = {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    responseMimeType: 'application/json',
    responseSchema,
  };

  let response: Record<string, any> | null = null;
  try {
    response = await withTimeout(
      gen.ai.models.generateContent({
        model: gen.model,
        contents: prompt,
        config: generateConfig,
      }),
      GEMINI_TIMEOUT_MS,
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`${kind} analysis: generation failed:`, detail);
    return errorResponse('ai_unavailable', 'AI service is currently unavailable.', 502);
  }

  const text = typeof response?.text === 'string' ? response.text.trim() : '';
  let parsed: Record<string, any> | null = null;
  if (text) {
    try {
      const candidate = JSON.parse(text);
      if (candidate && typeof candidate === 'object') parsed = candidate;
    } catch {
      // Fall through to generation_failed.
    }
  }
  if (!parsed) {
    console.error(`${kind} analysis: empty or non-JSON response. text=${JSON.stringify(text?.slice(0, 200))}`);
    return errorResponse('generation_failed', 'The AI summary could not be generated. Please try again.', 502);
  }

  // 6. Cache for identical future requests. A failed cache write never fails
  //    the user-facing result.
  const { error: cacheErr } = await auth.userClient.from('ai_analysis_cache').upsert(
    {
      client_id: assessment.client_id,
      assessment_id: assessment.id,
      analysis_type: kind,
      input_fingerprint: fingerprint,
      model: gen.model,
      result: parsed,
      sources: [],
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
    model: gen.model,
    analysis: parsed,
    sources: [],
  });
}
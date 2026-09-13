import { GoogleGenAI } from 'npm:@google/genai@2.22.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

//
// YBS Gemini gateway.
//
// Single, centralized, server-side Gemini configuration point:
//  - the model is fixed server-side (default gemini-3.5-flash; only the
//    GEMINI_MODEL env var may override it). The client can never pick a model.
//  - the API key lives exclusively in the GEMINI_API_KEY Supabase secret and
//    is never exposed to the browser, stored in code, or echoed in logs.
//  - only an authenticated YBS user may invoke this function.
//
// Contract:
//   success -> 200 { success: true, text: "<generated text>" }
//   failure -> 4xx/5xx { success: false, code: "<machine code>", error: "<generic message>" }
//

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const MAX_PROMPT_CHARS = 8000;
const MAX_OUTPUT_TOKENS = 1024;
const GEMINI_TIMEOUT_MS = 25000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, apikey, x-client-info, x-supabase-api-version, content-type',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, message: string, status: number) {
  return json({ success: false, code, error: message }, status);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') {
    return errorResponse('method_not_allowed', 'POST requests only.', 405);
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!apiKey || !supabaseUrl || !anonKey) {
    return errorResponse('server_not_configured', 'AI service is not configured.', 503);
  }

  try {
    // 1. Authenticate the caller from their own access token. Mirrors the
    //    invite functions: the browser never holds a Gemini credential.
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return errorResponse('unauthorized', 'Missing authorization token.', 401);
    }

    const callerAuth = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: callerData, error: callerErr } = await callerAuth.auth.getUser(token);
    if (callerErr || !callerData?.user) {
      return errorResponse('unauthorized', 'Invalid authorization token.', 401);
    }

    // 2. Validate the payload.
    let payload: { prompt?: unknown } = {};
    try {
      payload = await req.json();
    } catch {
      return errorResponse('bad_request', 'Invalid JSON body.', 400);
    }

    const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
    if (!prompt) {
      return errorResponse('invalid_prompt', 'A non-empty prompt is required.', 400);
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return errorResponse('invalid_prompt', 'The prompt is too long.', 400);
    }

    // 3. The one server-side Gemini configuration point.
    const model = Deno.env.get('GEMINI_MODEL')?.trim() || DEFAULT_GEMINI_MODEL;
    const ai = new GoogleGenAI({ apiKey });

    const response = await withTimeout(
      ai.models.generateContent({
        model,
        contents: prompt,
        config: { maxOutputTokens: MAX_OUTPUT_TOKENS },
      }),
      GEMINI_TIMEOUT_MS,
    );

    const text = typeof response?.text === 'string' ? response.text.trim() : '';
    if (!text) {
      return errorResponse('generation_failed', 'AI service unavailable.', 502);
    }

    return json({ success: true, text });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('gemini: request failed:', detail);
    return errorResponse('ai_unavailable', 'AI service unavailable.', 502);
  }
});
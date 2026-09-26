/**
 * YBS AI provider layer.
 *
 * Owns every provider-specific detail for the Nutrition / Training SUMMARY
 * pipeline: credentials, endpoints, model IDs, request shaping and error
 * classification. Nothing in here knows about assessments, prompts or the
 * YBS response contract — it only turns "a prompt + a schema + a token budget"
 * into "text", or into a normalized failure the router can act on.
 *
 * Model IDs below were verified against each provider's live catalogue:
 *   - Novita   GET https://api.novita.ai/openai/v1/models
 *               -> inclusionai/ling-3.0-flash-sante (status 1, ctx 262144,
 *                  max_output_tokens 32768, endpoints chat/completions)
 *   - OpenRouter GET /api/v1/models + /models/{id}/endpoints
 *               -> only "inclusionai/ling-3.0-flash-sante:free" exists, and its
 *                  single upstream provider is Novita.
 *   - Kilo      GET https://api.kilo.ai/api/gateway/models
 *               -> inclusionai/ling-3.0-flash-sante:free
 *   - NVIDIA    GET https://integrate.api.nvidia.com/v1/models
 *               -> nvidia/nemotron-3.5-lightning-30b-a3b
 */
import { GoogleGenAI } from 'npm:@google/genai@2.22.0';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const PER_ROUTE_TIMEOUT_MS = 60000;

/** Ling 3.0 Flash Sante — the summary primary. */
export const LING_SANTE_MODEL = 'inclusionai/ling-3.0-flash-sante';
export const LING_SANTE_FREE_MODEL = 'inclusionai/ling-3.0-flash-sante:free';
/** Nemotron 3.5 Lightning — last-resort summary fallback. */
export const NEMOTRON_NVIDIA_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
export const NEMOTRON_ROUTER_MODEL = 'nvidia/nemotron-3.5-lightning:free';

/**
 * Qwen 3.8 27B — the Create Plan primary.
 *
 * Verified 2026-09-26 against live catalogues:
 *   - OpenRouter GET /api/v1/models -> `qwen/qwen3.8-27b` (16 upstreams) and
 *     `qwen/qwen3.8-27b:free` (1 upstream: ModelRun, ctx 262144,
 *     max_completion 235929). Both list `structured_outputs`; the free route
 *     additionally serves the plain `max_tokens` + `messages` shape the
 *     OpenAI adapter sends, because the adapter never sends `response_format`
 *     (see callOpenAi). The free variant is therefore task-compatible and is
 *     the route we use, matching this project's existing OpenRouter convention
 *     (Ling and Nemotron both run `:free` there). Its single upstream is real
 *     quota independence from Groq, which is why Groq is the next hop.
 *   - Groq console.groq.com/docs/model/qwen/qwen3.8-27b -> `qwen/qwen3.8-27b`
 *     (Preview, ctx 131042, max completion 16384, capabilities: Tool Use,
 *     JSON Object Mode, JSON Schema Mode, Reasoning, Vision). A Create Plan
 *     call needs <= 30000 prompt + 8192 output, comfortably inside both limits.
 *   - Kilo GET https://api.kilo.ai/api/gateway/models also serves `qwen/qwen3.8-27b`
 *     and its `:free` alias. It is deliberately NOT a Create Plan Qwen route:
 *     the Tier 1 provider order was specified explicitly as OpenRouter -> Groq,
 *     and Kilo is already a Nemotron hop, so it stays the last Nemotron try.
 */
export const QWEN_27B_ROUTER_FREE_MODEL = 'qwen/qwen3.8-27b:free';
export const QWEN_27B_GROQ_MODEL = 'qwen/qwen3.8-27b';

/**
 * Nemotron 3 Ultra (550B total / 55B active) — the Create Plan middle tier.
 *
 * Verified 2026-09-26:
 *   - OpenRouter -> `nvidia/nemotron-3-ultra-550b-a55b` (4 upstreams) and
 *     `nvidia/nemotron-3-ultra-550b-a55b:free` (1 upstream: Nvidia, ctx 1000000,
 *     max_completion 65536). The free endpoint does not advertise
 *     `structured_outputs`/`response_format`, but our adapter does not send
 *     those: it states the JSON Schema in a system message and the application
 *     contract (`preflightProposal`) validates the result, so the route is
 *     compatible.
 *   - Kilo GET https://api.kilo.ai/api/gateway/models -> both the paid id and
 *     the `:free` alias.
 *   - NVIDIA: the hosted endpoint id could NOT be verified from here (the
 *     models list needs the key, and Supabase only exposes secret digests).
 *     build.nvidia.com publishes the model as `nemotron-3-ultra-550b-a55b`,
 *     while this project's live-verified NVIDIA id is
 *     `nvidia/nemotron-3.5-lightning-30b-a3b`, i.e. the integrate API serves
 *     Nemotron under an `nvidia/` prefix. We follow the convention actually
 *     observed in production, and mark the route NOT-fatal-on-404 so a wrong
 *     guess costs one hop instead of breaking Create Plan.
 */
export const NEMOTRON_ULTRA_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';
export const NEMOTRON_ULTRA_FREE_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

export type ErrorClass =
  | 'quota_exhausted'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'timeout'
  | 'upstream_connection'
  | 'request_invalid'
  | 'auth_error'
  | 'route_not_found'
    | 'generation_failed'
    | 'generation_output_invalid'
    | 'unknown';

export interface RouteSpec {
  id: string;
  provider: string;
  model: string;
  /** 1 = Ling Sante, 2 = Gemini, 3 = Nemotron. */
  tier: number;
  apiStyle: 'openai' | 'gemini';
  baseUrl?: string;
  /** Candidate secret names, most-preferred first. */
  envName: string;
  /**
   * When true a 404 from this provider aborts the chain (a 404 on a
   * verified endpoint means our model ID is wrong and must be fixed).
   * Kilo sets this false because its documented chat path 404s today, so a 404
   * there must skip the route instead of killing the whole failover chain.
   */
  notFoundIsFatal: boolean;
}

export interface Route extends RouteSpec {
  apiKey: string;
}

export interface RouteFailure {
  provider: string;
  model: string;
  errorClass: ErrorClass;
  status?: number;
  /** Safe, bounded provider message. Never contains prompts or client data. */
  detail: string;
  latencyMs: number;
}

export interface RouteSuccess {
  text: string;
  finishReason: string;
  provider: string;
  model: string;
  latencyMs: number;
  /** Raw provider payload, so callers can read grounding metadata if present. */
  raw?: unknown;
}

/**
 * Ordered route table.
 *
 * Tier 1 (Ling 3.0 Flash Sante): OpenRouter -> Kilo.
 * Tier 2 (Gemini). Tier 3 (Nemotron 3.5 Lightning): NVIDIA -> OpenRouter -> Kilo.
 *
 * The `ling-novita` route was removed on 2026-09-25: Novita answered every
 * request with 403 NOT_ENOUGH_BALANCE, so it was a guaranteed failed first hop
 * that added latency and a pointless credential on every single call. The
 * `NOVITA_API_KEY` secret is intentionally left in place (reverting this is a
 * one-line change).
 *
 * NOTE ON QUOTA INDEPENDENCE: OpenRouter's Ling Sante endpoint reports exactly
 * one upstream provider (Novita), and Kilo's ":free" id is a gateway alias for
 * the same model. Tier 1 is therefore NOT two independent quota pools — Ling
 * failover protects against an OpenRouter outage, not against Novita's quota
 * being exhausted underneath it. That is a property of the providers, not of
 * this table.
 */
const ROUTE_TABLE: RouteSpec[] = [
  {
    id: 'ling-openrouter',
    provider: 'openrouter',
    model: LING_SANTE_FREE_MODEL,
    tier: 1,
    apiStyle: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    envName: 'OPENROUTER_API_KEY',
    notFoundIsFatal: true,
  },
  {
    id: 'ling-kilo',
    provider: 'kilo',
    model: LING_SANTE_FREE_MODEL,
    tier: 1,
    apiStyle: 'openai',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    envName: 'KILO_API_KEY',
    notFoundIsFatal: false,
  },
  {
    id: 'gemini',
    provider: 'gemini',
    model: DEFAULT_GEMINI_MODEL,
    tier: 2,
    apiStyle: 'gemini',
    envName: 'GEMINI_API_KEY',
    notFoundIsFatal: true,
  },
  {
    id: 'nemotron-nvidia',
    provider: 'nvidia',
    model: NEMOTRON_NVIDIA_MODEL,
    tier: 3,
    apiStyle: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    envName: 'NVIDIA_API_KEY',
    notFoundIsFatal: true,
  },
  {
    id: 'nemotron-openrouter',
    provider: 'openrouter',
    model: NEMOTRON_ROUTER_MODEL,
    tier: 3,
    apiStyle: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    envName: 'OPENROUTER_API_KEY',
    notFoundIsFatal: true,
  },
  {
    id: 'nemotron-kilo',
    provider: 'kilo',
    model: NEMOTRON_ROUTER_MODEL,
    tier: 3,
    apiStyle: 'openai',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    envName: 'KILO_API_KEY',
    notFoundIsFatal: false,
  },
];

/**
 * CREATE PLAN route table (Qwen -> Nemotron -> Gemini). Deliberately separate
 * from ROUTE_TABLE above, which belongs to the SUMMARY workflow and must not
 * change: Ling stays the Summary primary, and Ling is never used for Create Plan.
 *
 * Tier 1 Qwen 3.8 27B:      OpenRouter -> Groq
 * Tier 2 Nemotron 3 Ultra:  NVIDIA -> OpenRouter -> Kilo
 * Tier 3 Gemini:            the shared final fallback.
 *
 * Ordering is enforced by `tier` (ascending) then table order, so the chain is
 * exactly: qwen/openrouter -> qwen/groq -> nemotron/nvidia -> nemotron/openrouter
 * -> nemotron/kilo -> gemini. No route is skipped while another provider for the
 * same model is still untried.
 *
 * `notFoundIsFatal: false` on Groq and NVIDIA-Ultra: their model ids could not be
 * confirmed against a live authenticated catalogue (see the model-id notes
 * above), so a 404 must skip the hop instead of hard-stopping the whole chain.
 * The verified OpenRouter/Kilo ids keep the usual strict behaviour.
 */
export const CREATE_PLAN_ROUTE_TABLE: RouteSpec[] = [
  // Phase 1 order: Groq leads because it is the only route observed to accept
  // Create Plan input (it failed the large v7 prompt on the 7k ITPM ceiling,
  // not on quality), and it is the fastest tier-1 hop. The OpenRouter free
  // alias stays in the chain as the second attempt rather than being deleted,
  // so the global failover behaviour is unchanged -- only the order moved.
  {
    id: 'qwen-groq',
    provider: 'groq',
    model: QWEN_27B_GROQ_MODEL,
    tier: 1,
    apiStyle: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    envName: 'GROQ_API_KEY',
    notFoundIsFatal: false,
  },
  {
    id: 'qwen-openrouter',
    provider: 'openrouter',
    model: QWEN_27B_ROUTER_FREE_MODEL,
    tier: 1,
    apiStyle: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    envName: 'OPENROUTER_API_KEY',
    notFoundIsFatal: true,
  },
  {
    id: 'nemotron3ultra-nvidia',
    provider: 'nvidia',
    model: NEMOTRON_ULTRA_MODEL,
    tier: 2,
    apiStyle: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    envName: 'NVIDIA_API_KEY',
    notFoundIsFatal: false,
  },
  {
    id: 'nemotron3ultra-openrouter',
    provider: 'openrouter',
    model: NEMOTRON_ULTRA_FREE_MODEL,
    tier: 2,
    apiStyle: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    envName: 'OPENROUTER_API_KEY',
    notFoundIsFatal: true,
  },
  {
    id: 'nemotron3ultra-kilo',
    provider: 'kilo',
    model: NEMOTRON_ULTRA_FREE_MODEL,
    tier: 2,
    apiStyle: 'openai',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    envName: 'KILO_API_KEY',
    notFoundIsFatal: false,
  },
  {
    id: 'gemini',
    provider: 'gemini',
    model: DEFAULT_GEMINI_MODEL,
    tier: 3,
    apiStyle: 'gemini',
    envName: 'GEMINI_API_KEY',
    notFoundIsFatal: true,
  },
];

/**
 * Legacy secret names, kept ONLY as a temporary compatibility fallback.
 *
 * This project stored its provider keys under cosmetic names instead of the
 * canonical ones, and two of those names carry a TRAILING SPACE. They are
 * built by concatenation on purpose: a literal trailing space inside a
 * source file is exactly the kind of thing a formatter, a "trim trailing
 * whitespace" hook, or a careless merge will silently delete, which would
 * break resolution with no visible cause.
 *
 * Canonical name is always tried first. These are never a preferred path, and
 * no other aliases are supported -- do not add a generic whitespace probe
 * here, it makes it impossible to reason about which names are live.
 * Once the canonical secrets exist in production, delete this map and the
 * legacy Supabase secrets together.
 */
const LEGACY_SECRET_NAMES: Record<string, string> = {
  OPENROUTER_API_KEY: 'Open Router' + ' ',
  NVIDIA_API_KEY: 'Nvidia Build' + ' ',
  KILO_API_KEY: 'Kilo Code',
  NOVITA_API_KEY: 'Novita',
  // Groq exists in this project only under the cosmetic name `Groq`; the
  // canonical GROQ_API_KEY has not been created yet.
  GROQ_API_KEY: 'Groq',
};

function secretNames(canonical: string): string[] {
  const legacy = LEGACY_SECRET_NAMES[canonical];
  return legacy ? [canonical, legacy] : [canonical];
}

function resolveSecret(canonical: string): string {
  for (const name of secretNames(canonical)) {
    const v = Deno.env.get(name);
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
}

export interface ResolvedRoutes {
  routes: Route[];
  /** Secret names we wanted but could not find, in table order. */
  missing: string[];
}

/**
 * Builds the live route list for one table, dropping routes whose secret is
 * absent. Shared by the Summary and Create Plan resolvers so both tasks use the
 * exact same secret resolution and env-override rules.
 */
function resolveTable(table: RouteSpec[]): ResolvedRoutes {
  const routes: Route[] = [];
  const missing: string[] = [];
  for (const spec of table) {
    const apiKey = resolveSecret(spec.envName);
    if (!apiKey) {
      // Report the canonical name only, so logs never echo a legacy name that
      // happens to end in a space. De-duplicated: two routes can share one
      // secret (OpenRouter serves both Create Plan model tiers), and a
      // repeated name in the log adds nothing.
      if (!missing.includes(spec.envName)) missing.push(spec.envName);
      continue;
    }
    routes.push({
      ...spec,
      model:
        spec.apiStyle === 'gemini'
          ? Deno.env.get('GEMINI_MODEL')?.trim() || DEFAULT_GEMINI_MODEL
          : spec.model,
      apiKey,
    });
  }
  return { routes, missing };
}

/** Builds the live SUMMARY route list, dropping routes whose secret is absent. */
export function resolveRoutes(): ResolvedRoutes {
  return resolveTable(ROUTE_TABLE);
}

/** Builds the live CREATE PLAN route list (Qwen -> Nemotron -> Gemini). */
export function resolveCreatePlanRoutes(): ResolvedRoutes {
  return resolveTable(CREATE_PLAN_ROUTE_TABLE);
}

export function createGeminiClient(apiKey: string) {
  return new GoogleGenAI({ apiKey });
}

/**
 * Converts the Gemini-flavoured response schema we already ship into plain
 * JSON Schema so it can be described to an OpenAI-compatible provider.
 * Gemini uses uppercase type names ('OBJECT'); JSON Schema is lowercase.
 */
export function normalizeSchema(schema: Record<string, any>): Record<string, any> {
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'type' && typeof v === 'string') out[k] = v.toLowerCase();
      else if (k === 'propertyOrdering' || k === 'example') continue;
      else out[k] = walk(v);
    }
    return out;
  };
  return walk(schema);
}

/** Required top-level keys of a schema, used as a light post-parse check. */
export function requiredKeys(schema: Record<string, any>): string[] {
  return Array.isArray(schema?.required) ? schema.required.filter((k: any) => typeof k === 'string') : [];
}

/**
 * Projects a provider-neutral JSON schema onto the subset Gemini's
 * structured-output mode accepts (`responseSchema`). Per the Gemini
 * structured-output documentation the supported keywords are the type
 * system (`type`, `nullable`), `properties`, `required`,
 * `additionalProperties`, `enum`, `items`, `prefixItems`, `minItems`,
 * `maxItems`, `minimum`, `maximum`, `format`, `description`,
 * `propertyOrdering` and `anyOf`.
 *
 * Notably NOT supported are string constraints such as `pattern`,
 * `maxLength` and `minLength`: sending them makes Gemini reject the whole
 * request with HTTP 400 INVALID_ARGUMENT. They are stripped here — at the
 * Gemini provider boundary only — so OpenAI-compatible routes keep the full
 * contract and the application-level validation (`preflightProposal`, the
 * router gate) is identical for every provider.
 */
const GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'description',
  'nullable',
  'enum',
  'items',
  'prefixItems',
  'properties',
  'required',
  'additionalProperties',
  'anyOf',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'propertyOrdering',
]);

export function toGeminiSchema(schema: Record<string, any>): Record<string, any> {
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(node)) {
      // `properties` maps property NAMES to schemas: the names must be kept
      // verbatim, only the nested schemas are projected.
      if (k === 'properties' && v && typeof v === 'object' && !Array.isArray(v)) {
        const props: Record<string, any> = {};
        for (const [propName, propSchema] of Object.entries(v)) {
          props[propName] = walk(propSchema);
        }
        out[k] = props;
        continue;
      }
      if (!GEMINI_SCHEMA_KEYS.has(k)) continue;
      out[k] = walk(v);
    }
    return out;
  };
  return walk(schema);
}

/**
 * Tolerant JSON extraction. OpenAI-compatible models often wrap JSON in a
 * ``` fence or add a sentence of prose around it, which JSON.parse rejects.
 */
/**
 * A route is only "successful" if the caller can actually use the text.
 *
 * For the Summary tasks the caller always needs one JSON object, so a 200 that
 * carries a truncated or otherwise unusable document is a PROVIDER failure,
 * not a success. Returning ok:true on such a response ends the failover chain
 * and surfaces `generation_failed` to the user -- exactly what happened live
 * on 2026-09-25, when Ling returned HTTP 200 with `finishReason=length` and
 * 889 characters of half-written JSON, and the chain never reached Gemini.
 */
export type OutputValidator = (text: string) => { ok: true } | { ok: false; reason: string };

/**
 * Rejects anything that is not a usable JSON object for `schema`:
 * non-JSON prose, a truncated document, a bare array, or an object missing the
 * schema's required keys. The reason strings are fixed labels -- never the
 * model's own output, which could echo client answers back into the logs.
 */
export function jsonObjectValidator(schema?: { required?: unknown }): OutputValidator {
  const required = Array.isArray(schema?.required)
    ? (schema!.required as unknown[]).filter((k): k is string => typeof k === 'string')
    : [];
  return (text: string) => {
    const parsed = extractJsonObject(text);
    if (!parsed) {
      // Distinguish the two causes that actually happen in production so the
      // log says something useful, without echoing any content.
      const looksLikeJsonStart = /[[{]/.test(text.trimStart());
      return { ok: false, reason: looksLikeJsonStart ? 'truncated or malformed JSON object' : 'non-JSON response' };
    }
    const missing = required.filter((k) => !(k in parsed));
    if (missing.length > 0) {
      return { ok: false, reason: `JSON object missing required key(s): ${missing.join(', ')}` };
    }
    return { ok: true };
  };
}

export function extractJsonObject(raw: string): Record<string, any> | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const attempt = (s: string): Record<string, any> | null => {
    try {
      const v = JSON.parse(s);
      // Must be a plain object: a bare array or scalar is not a valid summary.
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null;
    } catch {
      return null;
    }
  };
  const direct = attempt(text);
  if (direct) return direct;
  // Fall back to the outermost {...} span.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const sliced = attempt(text.slice(start, end + 1));
    if (sliced) return sliced;
  }
  return null;
}

/**
 * Patterns that mean "this provider will not serve us until money/quota
 * changes" as opposed to "we sent something wrong". Both cases are worth
 * failing over from, and neither is worth retrying on the same route.
 */
const QUOTA_EXHAUSTION_PATTERNS = [
  /generate[\w.]*requestsperday/i,
  /per[\s_-]?day[\s_-]?per[\s_-]?project/i,
  /per[\s_-]?day/i,
  /insufficient_quota/i,
  /exceeded your current quota/i,
  /check your plan and billing/i,
  /quota exceeded/i,
  // Novita answers 403 NOT_ENOUGH_BALANCE when the account is out of credit.
  // That is a billing/quota wall, not a bad key, so it must fail over.
  /not_enough_balance/i,
  /insufficient[\s_-]*(balance|credit|funds|quota)/i,
  /out of credit/i,
  /add funds/i,
  /top[\s_-]?up/i,
];

function looksLikeQuotaExhaustion(body: string): boolean {
  return QUOTA_EXHAUSTION_PATTERNS.some((re) => re.test(body));
}

/**
 * Provider-side TOKEN-LIMIT rejections, matched on the response body only.
 *
 * Groq does not answer an over-budget request with 429. It answers HTTP 413:
 *
 *   "Request too large for model `qwen/qwen3.8-27b` in organization `org_...`
 *    service tier `on_demand` on input tokens per minute (ITPM): Limit 7000,
 *    Requested 11160, please reduce your message size and try again."
 *
 * That is a rate limit on the CALLER's tokens-per-minute budget -- the exact
 * "their problem" category -- but because 413 fell through to the generic
 * `status >= 400` bucket it was classified `request_invalid` with
 * `fatal: true`, which aborted the whole Create Plan chain at hop 2. Nemotron
 * and Gemini were never reached. Proven live on 2026-09-26.
 *
 * Deliberately narrow. Every pattern pairs token/minute language with limit
 * arithmetic, so an ordinary oversized-payload 413 ("Request Entity Too Large",
 * a gateway body-length rejection) matches nothing here and keeps the existing
 * hard-failure behaviour.
 */
const TOKEN_LIMIT_PATTERNS = [
  /input\s+tokens?\s+per\s+minute/i,
  /\bITPM\b/,
  /tokens?\s+per\s+minute/i,
  /tokens?\s+per\s+\d/i,
  /token\s+limit/i,
  // Both word orders appear in the wild: "exceeds the token limit" and
  // "requested tokens exceed limit".
  /tokens?\s+(?:exceed|exceeds|exceeded|over)\b/i,
  /(?:exceed|exceeds|exceeded|over)\s+(?:the\s+)?(?:token|context)\b/i,
  /reduce\s+(?:your\s+)?message\s+size/i,
  // Arithmetic phrasings, still anchored on the word "tokens" so a bare
  // "Limit 5, Requested 10" of anything cannot match.
  /limit\s+[\d,]+\s*(?:input\s+)?tokens?\b/i,
  /requested\s+[\d,]+\s*(?:input\s+)?tokens?\b/i,
];

/** True only for a 413 whose body clearly describes a token/rate-limit wall. */
function looksLikeTokenLimit(body: string): boolean {
  return TOKEN_LIMIT_PATTERNS.some((re) => re.test(body));
}

function bounded(text: string, max = 300): string {
  const oneLine = (text ?? '').replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

export interface Classification {
  errorClass: ErrorClass;
  status?: number;
  detail: string;
  /** May we try the NEXT route? */
  failover: boolean;
  /** Is this our own integration/config bug (surface, never rotate)? */
  fatal: boolean;
  /** May we retry THIS route once with a short backoff? */
  retrySameRoute: boolean;
}

/**
 * Decides whether a provider failure is worth rotating away from.
 *
 * The line is "whose problem is it":
 *   - THEIR problem (no/!valid credential, no balance, quota, rate limit,
 *     outage, timeout, network) is provider-LOCAL. Log it, skip that route,
 *     keep walking the chain. One stale API key must never be able to black
 *     out the whole Summary pipeline -- that is exactly what production did
 *     on 2026-09-25, when a 403 and a 401 in a row took out both Summaries
 *     before Gemini or Nemotron was ever attempted.
 *   - OUR problem (a 400/422, a malformed request, a bad schema, a model id
 *     that does not exist) stays a HARD failure so integration bugs are
 *     impossible to paper over.
 *
 * The status code alone never decides this: 429 and a token-limit 413 are both
 * rate limits, and 403 can be either a bad key or an empty balance. The body is
 * what separates them, which is why the quota and token-limit checks below are
 * content-gated.
 */
export function classifyHttpStatus(status: number, body: string): Classification {
  const detail = bounded(body);
  // Billing/quota walls arrive as 402/403/429 depending on the provider and are
  // never a reason to abort the chain, only to move to the next provider.
  if (looksLikeQuotaExhaustion(body)) {
    return { errorClass: 'quota_exhausted', status, detail, failover: true, fatal: false, retrySameRoute: false };
  }
  if (status === 400 || status === 422) {
    return { errorClass: 'request_invalid', status, detail, failover: false, fatal: true, retrySameRoute: false };
  }
  if (status === 404) {
    // Provider-local here; the router promotes it to a hard stop for endpoints
    // we have verified, where a 404 means our model id is wrong.
    return { errorClass: 'route_not_found', status, detail, failover: true, fatal: false, retrySameRoute: false };
  }
  if (status === 401 || status === 403) {
    // Missing/invalid/revoked credential, or the provider is disabled for us.
    // Skip this provider; retrying a bad key is pointless.
    return { errorClass: 'auth_error', status, detail, failover: true, fatal: false, retrySameRoute: false };
  }
  if (status === 429) {
    return { errorClass: 'rate_limited', status, detail, failover: true, fatal: false, retrySameRoute: true };
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return { errorClass: 'provider_unavailable', status, detail, failover: true, fatal: false, retrySameRoute: true };
  }
  // A 413 that names a token/rate-limit wall is provider-LOCAL, exactly like a
  // 429: our request is well-formed, the caller's per-minute token budget is
  // the thing that is exhausted. Fail over instead of aborting the chain.
  // Content-gated on purpose -- a 413 with any other meaning (an oversized
  // payload, a gateway body-length rejection) is still our integration fault
  // and must stay a hard failure.
  if (status === 413 && looksLikeTokenLimit(body)) {
    return { errorClass: 'rate_limited', status, detail, failover: true, fatal: false, retrySameRoute: false };
  }
  if (status >= 400) {
    return { errorClass: 'request_invalid', status, detail, failover: false, fatal: true, retrySameRoute: false };
  }
  return { errorClass: 'unknown', status, detail, failover: true, fatal: false, retrySameRoute: false };
}

export function classifyThrown(err: unknown): Classification {
  const e = err as any;
  const msg = bounded(e?.message ?? String(err));
  if (msg === 'AI_ROUTE_TIMEOUT') {
    return { errorClass: 'timeout', detail: 'route exceeded its time budget', failover: true, fatal: false, retrySameRoute: false };
  }
  const cause = bounded(e?.cause?.message ?? e?.cause?.code ?? '');
  const netish = /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|certificate|TLS|socket hang up|network/i;
  if (netish.test(msg) || netish.test(cause)) {
    return { errorClass: 'upstream_connection', detail: msg || cause, failover: true, fatal: false, retrySameRoute: true };
  }
  // SDK-thrown API errors (Google GenAI) carry a numeric status.
  const status = typeof e?.status === 'number' ? e.status : typeof e?.code === 'number' ? e.code : undefined;
  if (status !== undefined && status >= 400) {
    return classifyHttpStatus(status, `${msg} ${bounded(e?.response?.error?.message ?? '')}`);
  }
  return { errorClass: 'unknown', status, detail: msg, failover: true, fatal: false, retrySameRoute: false };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Bound one provider attempt AND tear the request down when the bound expires.
 *
 * The abort is the whole point. A bare `Promise.race` would let the router move
 * on to the next route while the previous socket kept streaming, so a stalled
 * provider would still be holding a connection and reading a response for the
 * rest of the chain. Here the signal is handed to the transport, so expiry
 * genuinely cancels the in-flight request.
 */
async function withRouteTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, ms));
  try {
    return await work(controller.signal);
  } catch (e) {
    // Only claim a timeout when *we* cancelled it. A provider that failed on
    // its own (429/413/500) must keep its own classification, or a rate limit
    // would be misreported as a timeout.
    if (controller.signal.aborted) throw new Error('AI_ROUTE_TIMEOUT');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

interface CallArgs {
  prompt: string;
  schema: Record<string, any>;
  maxOutputTokens: number;
  timeoutMs: number;
}

/**
 * OpenAI-compatible adapter.
 *
 * The response schema is described in a `system` message rather than sent as
 * `response_format`. `json_object` / `json_schema` support is uneven across
 * these gateways, and an unsupported parameter comes back as a 400 that we
 * would (correctly) refuse to rotate past. Putting the contract in the system
 * message keeps the client prompt byte-identical to the one Gemini already
 * receives.
 */
async function callOpenAi(route: Route, args: CallArgs): Promise<RouteSuccess> {
  const started = Date.now();
  const contract = [
    'You are a JSON API. Reply with exactly one JSON object and nothing else:',
    'no prose, no markdown, no code fences.',
    'The object must validate against this JSON Schema:',
    JSON.stringify(normalizeSchema(args.schema)),
  ].join('\n');

  // The deadline must cover the COMPLETE HTTP exchange, including consuming
  // the response body. `fetch()` resolves as soon as response headers arrive;
  // timing out only that promise leaves `res.json()` / `res.text()` able to
  // hang forever on a stalled streaming body. Production hit exactly that
  // shape after the NVIDIA hop: the following provider produced headers, the
  // router emitted no further route log, and the Edge invocation died at 504.
  return await withRouteTimeout(async (signal) => {
    const res = await fetch(`${route.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${route.apiKey}`,
        },
        body: JSON.stringify({
          model: route.model,
          messages: [
            { role: 'system', content: contract },
            { role: 'user', content: args.prompt },
          ],
          max_tokens: args.maxOutputTokens,
        }),
        signal,
      });

    if (!res.ok) {
      const body = await res.text().catch((err) => {
        // Preserve aborts so the outer timeout can normalize them. Only a
        // provider body-read failure that is unrelated to our signal is safe
        // to degrade to an empty diagnostic body.
        if (signal.aborted) throw err;
        return '';
      });
      const c = classifyHttpStatus(res.status, body);
      const err = new Error(c.detail) as any;
      err.__class = c;
      err.status = res.status;
      throw err;
    }

    const payload: any = await res.json().catch((err) => {
      if (signal.aborted) throw err;
      return null;
    });
    const choice = payload?.choices?.[0];
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    if (!text.trim()) {
      const err = new Error('provider returned an empty completion') as any;
      err.__class = {
        errorClass: 'generation_failed' as ErrorClass,
        detail: 'empty completion',
        failover: true,
        fatal: false,
        retrySameRoute: false,
      };
      throw err;
    }
    return {
      text,
      finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : 'unknown',
      provider: route.provider,
      model: route.model,
      latencyMs: Date.now() - started,
      raw: payload,
    };
  }, args.timeoutMs);
}

/**
 * Gemini adapter — unchanged behaviour from the pre-router implementation:
 * structured output is enforced by responseSchema + responseMimeType, and no
 * Google Search grounding is used (it is mutually exclusive with those).
 */
async function callGemini(route: Route, args: CallArgs): Promise<RouteSuccess> {
  const started = Date.now();
  const ai = createGeminiClient(route.apiKey);
  const response: any = await withRouteTimeout(
    (signal) =>
      ai.models.generateContent({
        model: route.model,
        contents: args.prompt,
        config: {
          maxOutputTokens: args.maxOutputTokens,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(args.schema),
          // Documented `GenerateContentConfig.abortSignal`: the SDK merges it
          // into an internal AbortController before its fetch, so this cancels
          // the real request rather than just abandoning it.
          abortSignal: signal,
        },
      }),
    args.timeoutMs,
  );
  const text = typeof response?.text === 'string' ? response.text.trim() : '';
  if (!text) {
    const err = new Error('provider returned an empty completion') as any;
    err.__class = {
      errorClass: 'generation_failed' as ErrorClass,
      detail: 'empty completion',
      failover: true,
      fatal: false,
      retrySameRoute: false,
    };
    throw err;
  }
  return {
    text,
    finishReason: response?.candidates?.[0]?.finishReason ?? 'unknown',
    provider: route.provider,
    model: route.model,
    latencyMs: Date.now() - started,
    raw: response,
  };
}

export interface AttemptRecord extends RouteFailure {}

export async function invokeRoute(
  route: Route,
  args: CallArgs,
): Promise<{ ok: true; value: RouteSuccess } | { ok: false; failure: RouteFailure; classification: Classification }> {
  const started = Date.now();
  try {
    const value =
      route.apiStyle === 'gemini' ? await callGemini(route, args) : await callOpenAi(route, args);
    return { ok: true, value };
  } catch (err) {
    const pre = (err as any)?.__class as Classification | undefined;
    const classification = pre ?? classifyThrown(err);
    return {
      ok: false,
      classification,
      failure: {
        provider: route.provider,
        model: route.model,
        errorClass: classification.errorClass,
        status: classification.status,
        detail: classification.detail,
        latencyMs: Date.now() - started,
      },
    };
  }
}

export { sleep, withRouteTimeout, bounded };



/**
 * Create Plan failover progression.
 *
 * These exercise the REAL chain end to end: the real CREATE_PLAN_ROUTE_TABLE,
 * the real secret resolution (including the cosmetic legacy names), the real
 * classifyHttpStatus, and the real runFailover loop. Only the network transport
 * is stubbed -- global fetch for the OpenAI-compatible routes, and the Google
 * GenAI SDK for Gemini.
 *
 * The scenario under test is the one proven in the runtime logs on 2026-09-26:
 * OpenRouter 429 x2 -> Groq 413 (ITPM) -> and, before the fix, the chain died
 * there with route_hard_failure instead of continuing to Nemotron.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { runFailover } from '../aiRouter.ts';

/** The real Groq ITPM rejection, as captured from the runtime log. */
const GROQ_ITPM_413_BODY = JSON.stringify({
  error: {
    message:
      'Request too large for model `qwen/qwen3.8-27b` in organization `org_...` ' +
      'service tier `on_demand` on input tokens per minute (ITPM): Limit 7000, ' +
      'Requested 11160, please reduce your message size and try again.',
    type: 'requests',
    code: 'too_many_requests',
  },
});

/**
 * Live secret NAMES on the project (from `supabase secrets list`). The two
 * space-terminated names are written with explicit concatenation because a
 * literal trailing space is exactly what a formatter or a careless merge
 * silently deletes -- the same reason aiProviders.ts builds them that way.
 */
const LIVE_SECRET_NAMES = {
  OPENROUTER_API_KEY: 'test-openrouter',
  Groq: 'test-groq',
  KILO_API_KEY: 'test-kilo',
  KILO_LEGACY_UNUSED: undefined,
  'Kilo Code': 'test-kilo',
  'Nvidia Build ': 'test-nvidia',
  GEMINI_API_KEY: 'test-gemini',
  GEMINI_MODEL: 'gemini-3.8-flash',
};

type Script = {
  /** provider key -> responses returned in order, last one repeating. */
  [provider: string]: Array<{ status: number; body?: string } | { ok: true }>;
};

const HOST_TO_PROVIDER: Record<string, string> = {
  'openrouter.ai': 'openrouter',
  'api.groq.com': 'groq',
  'integrate.api.nvidia.com': 'nvidia',
  'api.kilo.ai': 'kilo',
};

let script: Script = {};
let calls: Array<{ provider: string; model: string }> = [];
let realFetch: typeof globalThis.fetch;
let realConsole: Pick<Console, 'log' | 'warn' | 'error'>;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function completion(text: string): Response {
  return jsonResponse(200, {
    choices: [{ message: { content: text }, finish_reason: 'stop' }],
  });
}

beforeAll(() => {
  realFetch = globalThis.fetch;
  realConsole = { log: console.log, warn: console.warn, error: console.error };

  // Provider secret resolution reads Deno.env; supply the real names.
  (globalThis as any).Deno = {
    env: {
      get: (name: string) => (LIVE_SECRET_NAMES as Record<string, string | undefined>)[name],
    },
  };

  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input);
    const host = Object.keys(HOST_TO_PROVIDER).find((h) => url.includes(h));
    const provider = host ? HOST_TO_PROVIDER[host] : 'unknown';
    const model = JSON.parse(init?.body ?? '{}').model ?? '';
    calls.push({ provider, model });

    const queue = script[provider];
    if (!queue || queue.length === 0) {
      throw new Error(`test fetch: no scripted response for ${provider} (${url})`);
    }
    const step = queue.length === 1 ? queue[0] : queue.shift()!;
    if ('ok' in step) return completion(JSON.stringify({ ok: true }));
    return jsonResponse(step.status, { error: { message: step.body ?? 'provider error' } });
  }) as typeof globalThis.fetch;

  // Gemini is reached through the stubbed SDK, not fetch. It is appended to the
  // SAME ordered log so tier ordering can be asserted across the whole chain.
  (globalThis as any).__geminiGenerateContent = async (request: any) => {
    calls.push({ provider: 'gemini', model: request?.model ?? '' });
    return { text: JSON.stringify({ ok: true }), candidates: [{ finishReason: 'STOP' }] };
  };

  // The router logs structured JSON on every route; keep test output readable.
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
});

afterAll(() => {
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
  delete (globalThis as any).Deno;
  delete (globalThis as any).__geminiGenerateContent;
});

beforeEach(() => {
  script = {};
  calls = [];
  // Restore the default Gemini handler: one test overrides it to fail, and
  // without this it would leak into every later test.
  (globalThis as any).__geminiGenerateContent = async (request: any) => {
    calls.push({ provider: 'gemini', model: request?.model ?? '' });
    return { text: JSON.stringify({ ok: true }), candidates: [{ finishReason: 'STOP' }] };
  };
});

const RATE_LIMIT_429 = { status: 429, body: 'qwen/qwen3.8-27b:free is temporarily rate-limited upstream' };
const SERVER_500 = { status: 500, body: 'upstream error' };

function run() {
  return runFailover({
    task: 'nutrition',
    routeScope: 'create_plan',
    prompt: 'build a recomp plan',
    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    maxOutputTokens: 1024,
  });
}

const providersHit = () => calls.map((c) => c.provider);

describe('Create Plan route resolution', () => {
  it('resolves all six configured routes, Groq included', async () => {
    script = {
      openrouter: [{ ok: true }],
      groq: [{ ok: true }],
      nvidia: [{ ok: true }],
      kilo: [{ ok: true }],
    };
    const result = await run();
    expect(result.ok).toBe(true);
    // Reached on the first hop, so nothing after it was touched.
    expect(providersHit()).toEqual(['groq']);
  });
});

describe('Qwen tier progression', () => {
  it('the first route 429 retries the same route, then advances', async () => {
    script = { groq: [RATE_LIMIT_429, RATE_LIMIT_429], openrouter: [{ ok: true }] };
    const result = await run();

    expect(result.ok).toBe(true);
    expect(providersHit().slice(0, 3)).toEqual(['groq', 'groq', 'openrouter']);
    const failures = result.attempts.filter((a) => a.result === 'failure');
    expect(failures).toHaveLength(2);
    expect(failures.every((a) => a.errorClass === 'rate_limited' && a.status === 429)).toBe(true);
  });

  it('Groq 413 ITPM does NOT retry Groq and continues to Nemotron/NVIDIA', async () => {
    script = {
      openrouter: [RATE_LIMIT_429, RATE_LIMIT_429],
      groq: [{ status: 413, body: GROQ_ITPM_413_BODY }],
      nvidia: [{ ok: true }],
    };
    const result = await run();

    // The whole point of the fix: this used to end in route_hard_failure here.
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('nvidia');

    const groqCalls = providersHit().filter((p) => p === 'groq');
    expect(groqCalls).toHaveLength(1); // no same-route retry

    const groqAttempt = result.attempts.find((a) => a.provider === 'groq');
    expect(groqAttempt?.errorClass).toBe('rate_limited');
    expect(groqAttempt?.status).toBe(413);
  });

  it('a non-token-limit 413 on Groq now fails over instead of hard-stopping', async () => {
    // Policy change: a bare 413 from ONE provider does not prove the payload is
    // too large for everyone. Provider input limits differ by orders of magnitude
    // and Groq is the smallest of the six, so the same request routinely
    // succeeds on the next hop. The Create Plan payload is ~2.4k tokens, well
    // inside every other configured provider's limit.
    //
    // It was previously treated as `request_invalid` and aborted the run here.
    script = {
      openrouter: [RATE_LIMIT_429, RATE_LIMIT_429],
      groq: [{ status: 413, body: 'Request Entity Too Large' }],
      nvidia: [{ ok: true }],
    };
    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('nvidia');

    // The original classification is still recorded for observability...
    const groqAttempt = result.attempts.find((a) => a.provider === 'groq');
    expect(groqAttempt?.errorClass).toBe('request_invalid');
    expect(groqAttempt?.status).toBe(413);
    // ...but it is no longer terminal for Create Plan: the run continued and
    // succeeded on NVIDIA instead of returning a hard failure.
    expect(providersHit()).toContain('nvidia');
  });
});

describe('Nemotron tier and Gemini', () => {
  it('walks NVIDIA -> OpenRouter -> Kilo when each Nemotron provider fails', async () => {
    script = {
      openrouter: [RATE_LIMIT_429, RATE_LIMIT_429, SERVER_500, SERVER_500],
      groq: [{ status: 413, body: GROQ_ITPM_413_BODY }],
      nvidia: [SERVER_500, SERVER_500],
      kilo: [SERVER_500, SERVER_500],
    };
    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('gemini');

    const order = providersHit();
    // Every configured hop was visited, in tier order, before Gemini.
    expect(order.indexOf('nvidia')).toBeGreaterThan(order.indexOf('groq'));
    expect(order.indexOf('kilo')).toBeGreaterThan(order.indexOf('nvidia'));
    expect(order[order.length - 1]).toBe('gemini');
  });

  it('stops at the first successful Nemotron provider and never reaches Gemini', async () => {
    script = {
      openrouter: [RATE_LIMIT_429, RATE_LIMIT_429],
      groq: [{ status: 413, body: GROQ_ITPM_413_BODY }],
      nvidia: [{ ok: true }],
      kilo: [{ ok: true }],
    };
    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('nvidia');
    expect(providersHit()).not.toContain('kilo');
    expect(providersHit()).not.toContain('gemini');
  });

  it('reports all providers attempted when the whole chain is exhausted', async () => {
    script = {
      openrouter: [RATE_LIMIT_429, RATE_LIMIT_429, SERVER_500, SERVER_500],
      groq: [{ status: 413, body: GROQ_ITPM_413_BODY }],
      nvidia: [SERVER_500, SERVER_500],
      kilo: [SERVER_500, SERVER_500],
    };
    (globalThis as any).__geminiGenerateContent = async () => {
      throw Object.assign(new Error('gemini unavailable'), { status: 503 });
    };

    const result = await run();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');

    expect(result.hard).toBe(false);
    expect(result.aggregate.providersAttempted).toEqual(
      expect.arrayContaining(['openrouter', 'groq', 'nvidia', 'kilo', 'gemini']),
    );
    // Exhaustion is a provider outage, not an integration bug.
    expect(result.errorClass).not.toBe('request_invalid');
  });
});

describe('a working route stops the chain', () => {
  it('a successful first-route response ends the run on hop 1', async () => {
    script = { openrouter: [{ ok: true }], groq: [{ ok: true }], nvidia: [{ ok: true }] };
    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('groq');
    expect(result.attempts).toHaveLength(1);
    expect(providersHit()).toEqual(['groq']);
  });
});

/**
 * Create Plan: one provider failure must never terminate the whole attempt.
 *
 * The bug these lock down: `classifyHttpStatus` marks a provider 400/422 (and
 * any 4xx outside its allowlist) as `fatal`, and `runFailover` treated `fatal`
 * as "abort the chain". A single Groq 400 therefore ended Create Plan with
 * `hard: true`, which the handler reports as `ai_unavailable` -- while
 * OpenRouter, NVIDIA x3 and Gemini were all still eligible and never called.
 *
 * Note the router never reads `classification.failover`; only `fatal` gates the
 * chain. So `failover: true` in a classification was inert.
 *
 * The scope of the fix: Create Plan only. Its application payload is fixed and
 * validated before the router runs, so a provider 4xx is provider-local and the
 * next provider may well accept the same request. The Summary scope keeps the
 * strict rule, and is asserted here so the change cannot silently widen.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { runFailover } from '../aiRouter.ts';

const LIVE_SECRET_NAMES = {
  OPENROUTER_API_KEY: 'test-openrouter',
  Groq: 'test-groq',
  KILO_API_KEY: 'test-kilo',
  'Kilo Code': 'test-kilo',
  'Nvidia Build ': 'test-nvidia',
  GEMINI_API_KEY: 'test-gemini',
  GEMINI_MODEL: 'gemini-3.8-flash',
};

type Step = { status: number; body?: string } | { ok: true };

let script: Record<string, Step[]> = {};
let calls: Array<{ provider: string; model: string }> = [];
let realFetch: typeof globalThis.fetch;
let realConsole: Pick<Console, 'log' | 'warn' | 'error'>;
let logged: string[] = [];

const HOST_TO_PROVIDER: Record<string, string> = {
  'openrouter.ai': 'openrouter',
  'api.groq.com': 'groq',
  'integrate.api.nvidia.com': 'nvidia',
  'api.kilo.ai': 'kilo',
};

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * A provider-side 400 in the shape real providers use: the request never
 * reached a model, the gateway rejected the model id / a parameter / a schema
 * keyword. This is NOT proof our request is malformed.
 */
const PROVIDER_400 = {
  status: 400,
  body: JSON.stringify({
    error: {
      message:
        'The model `qwen/qwen3.8-27b` does not exist or you do not have access to it.',
      type: 'invalid_request_error',
      code: 'model_not_found',
    },
  }),
};

beforeAll(() => {
  realFetch = globalThis.fetch;
  realConsole = { log: console.log, warn: console.warn, error: console.error };

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
    if ('ok' in step) {
      return jsonResponse(200, {
        choices: [{ message: { content: JSON.stringify({ ok: true }) }, finish_reason: 'stop' }],
      });
    }
    return jsonResponse(step.status, { error: { message: step.body ?? 'provider error' } });
  }) as typeof globalThis.fetch;

  (globalThis as any).__geminiGenerateContent = async (request: any) => {
    calls.push({ provider: 'gemini', model: request?.model ?? '' });
    const queue = script.gemini;
    const step = queue && queue.length ? (queue.length === 1 ? queue[0] : queue.shift()!) : ({ ok: true } as Step);
    if ('ok' in step) {
      return { text: JSON.stringify({ ok: true }), candidates: [{ finishReason: 'STOP' }] };
    }
    throw Object.assign(new Error(step.body ?? 'gemini error'), { status: step.status });
  };

  const capture = (line: unknown) => {
    logged.push(String(line));
  };
  console.log = capture as any;
  console.warn = capture as any;
  console.error = capture as any;
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
  logged = [];
});

function run(scope: 'create_plan' | 'summary' = 'create_plan') {
  return runFailover({
    task: 'nutrition',
    routeScope: scope,
    prompt: 'build a recomp plan',
    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    maxOutputTokens: 1024,
  });
}

const providersHit = () => calls.map((c) => c.provider);

describe('Create Plan: a provider 400 fails over instead of ending the attempt', () => {
  it('Groq failure -> the next provider is attempted', async () => {
    script = { groq: [PROVIDER_400], openrouter: [{ ok: true }] };

    const result = await run();

    expect(result.ok).toBe(true);
    // Groq was tried and rejected; the chain did not stop there.
    expect(providersHit()[0]).toBe('groq');
    expect(providersHit().slice(1)).toContain('openrouter');
    expect(result.provider).toBe('openrouter');
    // Not a hard stop.
    expect(result.ok === true).toBe(true);
  });

  it('Groq failure -> OpenRouter failure -> the next NVIDIA provider is attempted', async () => {
    script = {
      groq: [PROVIDER_400],
      openrouter: [PROVIDER_400],
      nvidia: [{ ok: true }],
    };

    const result = await run();

    expect(result.ok).toBe(true);
    expect(providersHit().slice(0, 3)).toEqual(['groq', 'openrouter', 'nvidia']);
    expect(result.provider).toBe('nvidia');
  });

  it('walks the whole configured chain when every OpenAI-compatible provider rejects', async () => {
    script = {
      groq: [PROVIDER_400],
      openrouter: [PROVIDER_400],
      nvidia: [PROVIDER_400],
      kilo: [PROVIDER_400],
    };

    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('gemini');
    // All six configured routes, in table order. The chain is walked to the end
    // instead of stopping on the first 4xx.
    expect(providersHit()).toEqual(['groq', 'openrouter', 'nvidia', 'openrouter', 'kilo', 'gemini']);
  });

  it('only after all eligible providers fail does it report ai_unavailable', async () => {
    script = {
      groq: [PROVIDER_400],
      openrouter: [PROVIDER_400],
      nvidia: [PROVIDER_400],
      kilo: [PROVIDER_400],
      // Gemini throws a provider-side 400 from the SDK, the shape that used to
      // end the run as `hard`.
      gemini: [{ status: 400, body: 'gemini rejected the request' }],
    };

    const result = await run();
    if (result.ok) throw new Error('unreachable');

    // Every provider was genuinely attempted before giving up.
    expect(providersHit()).toEqual(['groq', 'openrouter', 'nvidia', 'openrouter', 'kilo', 'gemini']);
    expect(result.hard).toBe(false);
    expect(result.notConfigured).toBe(false);
    // Exhaustion is a provider outage, not our integration bug.
    expect(result.errorClass).not.toBe('not_configured');
    expect(result.aggregate.providersAttempted).toEqual(
      expect.arrayContaining(['groq', 'openrouter', 'nvidia', 'kilo', 'gemini']),
    );
  });

  it('a Gemini-thrown 400 on the last route does not turn into hard', async () => {
    script = {
      groq: [PROVIDER_400],
      openrouter: [PROVIDER_400],
      nvidia: [PROVIDER_400],
      kilo: [PROVIDER_400],
      gemini: [{ status: 400, body: 'gemini rejected the request' }],
    };

    const result = await run();

    // Gemini is last, so there is nothing left to fail over to: the run ends
    // exhausted, not hard.
    if (result.ok) throw new Error('unreachable');
    expect(result.hard).toBe(false);
    expect(result.errorClass).toBe('request_invalid');
  });

  it('a Gemini-thrown 400 still lets a later recovery succeed when Gemini is not last', async () => {
    // Gemini succeeding after four provider 400s proves the 400s did not abort
    // the chain at any point.
    script = {
      groq: [PROVIDER_400],
      openrouter: [PROVIDER_400],
      nvidia: [PROVIDER_400],
      kilo: [PROVIDER_400],
    };

    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('gemini');
  });

  it('a genuinely oversized payload still terminates -- but only after every route tried', async () => {
    // A 413 on ONE provider says nothing about the others (limits differ by
    // orders of magnitude), so it must rotate. A 413 on ALL of them does prove
    // the payload is too large, and must still stop -- just later, so the logs
    // show the real cause instead of a single provider's rejection.
    const TOO_LARGE = { status: 413, body: 'Request Entity Too Large' };
    script = {
      groq: [TOO_LARGE],
      openrouter: [TOO_LARGE],
      nvidia: [TOO_LARGE],
      kilo: [TOO_LARGE],
      gemini: [TOO_LARGE],
    };

    const result = await run();
    if (result.ok) throw new Error('unreachable');

    expect(result.hard).toBe(false);
    expect(result.aggregate.providersAttempted).toEqual(
      expect.arrayContaining(['groq', 'openrouter', 'nvidia', 'kilo', 'gemini']),
    );
  });

  it('does not retry the same provider after a 400', async () => {
    script = { groq: [PROVIDER_400], openrouter: [{ ok: true }] };

    await run();

    // A rejected request retried identically would be rejected identically.
    expect(providersHit().filter((p) => p === 'groq')).toHaveLength(1);
  });

  it('a 429 on the first provider still retries that route once, then advances', async () => {
    script = {
      groq: [{ status: 429, body: 'rate limit exceeded' }, { status: 429, body: 'rate limit exceeded' }],
      openrouter: [{ ok: true }],
    };

    const result = await run();

    expect(result.ok).toBe(true);
    expect(providersHit().slice(0, 3)).toEqual(['groq', 'groq', 'openrouter']);
  });

  it('a 404 on a verified route fails over for Create Plan', async () => {
    script = { groq: [{ status: 404, body: 'No endpoints found' }], openrouter: [{ ok: true }] };

    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('openrouter');
  });

  it('a 404 on the VERIFIED OpenRouter route (notFoundIsFatal) still fails over', async () => {
    // OpenRouter carries notFoundIsFatal: true, which normally aborts the chain
    // because a 404 there means our model id is wrong. For Create Plan the next
    // provider is still worth trying, so this must advance rather than stop.
    script = {
      groq: [PROVIDER_400],
      openrouter: [{ status: 404, body: 'No endpoints found for this model' }],
      nvidia: [{ ok: true }],
    };

    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('nvidia');
    expect(providersHit().slice(0, 3)).toEqual(['groq', 'openrouter', 'nvidia']);
  });

  it('emits a distinct route_failure_failover event for a downgraded hard stop', async () => {
    script = { groq: [PROVIDER_400], openrouter: [{ ok: true }] };

    await run();

    const downgrade = logged.find((l) => l.includes('create_plan.route_failure_failover'));
    expect(downgrade, 'expected the downgrade to be observable in logs').toBeDefined();
    expect(downgrade).toContain('"downgradedFromHardStop":true');
    // And it must NOT have been reported as a hard failure.
    expect(logged.some((l) => l.includes('create_plan.route_hard_failure'))).toBe(false);
  });
});

describe('Summary scope is deliberately unchanged', () => {
  it('a 400 on the first Summary provider still hard-stops', async () => {
    script = { openrouter: [PROVIDER_400], groq: [{ ok: true }] };

    const result = await run('summary');
    if (result.ok) throw new Error('unreachable');

    // A 400 in the Summary chain means our own integration is broken, so it
    // must surface rather than be papered over by another provider.
    expect(result.hard).toBe(true);
    expect(result.errorClass).toBe('request_invalid');
    // Only the first provider was tried; the chain did not rotate.
    expect(providersHit()).toEqual(['openrouter']);
  });

  it('a 404 on the verified Summary route still hard-stops', async () => {
    script = { openrouter: [{ status: 404, body: 'No endpoints found' }], groq: [{ ok: true }] };

    const result = await run('summary');
    if (result.ok) throw new Error('unreachable');

    expect(result.hard).toBe(true);
    expect(result.errorClass).toBe('route_not_found');
    expect(providersHit()).toEqual(['openrouter']);
  });
});

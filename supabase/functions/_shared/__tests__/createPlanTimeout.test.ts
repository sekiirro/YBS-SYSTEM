/**
 * Create Plan bounded per-route timeout, and real request cancellation.
 *
 * The production incident this covers (v5, requestId 70a6025a): Nemotron on
 * NVIDIA accepted the connection, never answered, and held the chain for
 * 60,005ms. The router logged the timeout but then went silent, the later
 * routes were never attempted, and the edge invocation was eventually killed
 * with a 504 before the function could return anything.
 *
 * Two independent defects are covered here:
 *
 *   1. `create_plan` shared the 60s per-route ceiling even though it walks
 *      three model tiers, so one silent provider could strand the rest.
 *   2. `withRouteTimeout` was a bare `Promise.race` -- it stopped *awaiting*
 *      the provider but never cancelled it, so the stalled request kept its
 *      socket and kept streaming in the background. The tests assert on
 *      `signal.aborted` and on the abort event actually firing, so reverting
 *      to a plain race fails here rather than passing silently.
 *
 * `summary` is asserted to be untouched: same routes, same 60s ceiling.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
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

/** Live secret NAMES on the project. The two space-terminated names are built
 *  by concatenation on purpose -- see the sibling failover test for why. */
const LIVE_SECRET_NAMES = {
  OPENROUTER_API_KEY: 'test-openrouter',
  Groq: 'test-groq',
  KILO_API_KEY: 'test-kilo',
  'Kilo Code': 'test-kilo',
  'Nvidia Build ': 'test-nvidia',
  GEMINI_API_KEY: 'test-gemini',
  GEMINI_MODEL: 'gemini-3.8-flash',
};

type Step = { status: number; body?: string } | { ok: true } | { hang: true } | { bodyHang: true };
type Script = { [provider: string]: Step[] };

const HOST_TO_PROVIDER: Record<string, string> = {
  'openrouter.ai': 'openrouter',
  'api.groq.com': 'groq',
  'integrate.api.nvidia.com': 'nvidia',
  'api.kilo.ai': 'kilo',
};

let script: Script = {};
let calls: Array<{ provider: string; model: string; signal?: AbortSignal; at: number }> = [];
/** Providers whose request was actually torn down via its AbortSignal. */
let aborts: Array<{ provider: string; model: string; at: number }> = [];
/** Every structured line the router logged, so log assertions are real. */
let logLines: string[] = [];
let realFetch: typeof globalThis.fetch;
let realConsole: Pick<Console, 'log' | 'warn' | 'error'>;

const RATE_LIMIT_429 = { status: 429, body: 'qwen/qwen3.8-27b:free is temporarily rate-limited upstream' };
const HANG = { hang: true } as const;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function completion(text: string): Response {
  return jsonResponse(200, { choices: [{ message: { content: text }, finish_reason: 'stop' }] });
}

/** Resolve only when aborted, exactly like a real request that never answers. */
function neverSettles(provider: string, model: string, signal?: AbortSignal): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const onAbort = () => {
      aborts.push({ provider, model, at: Date.now() });
      reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort);
  });
}

/** Headers resolve immediately, but the streaming body never completes. */
function bodyNeverSettles(provider: string, model: string, signal?: AbortSignal): Response {
  const body = new ReadableStream({
    start(controller) {
      const onAbort = () => {
        aborts.push({ provider, model, at: Date.now() });
        controller.error(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function defaultGemini(request: any) {
  return { text: JSON.stringify({ ok: true }), candidates: [{ finishReason: 'STOP' }] };
}

beforeAll(() => {
  realFetch = globalThis.fetch;
  realConsole = { log: console.log, warn: console.warn, error: console.error };

  (globalThis as any).Deno = {
    env: { get: (name: string) => (LIVE_SECRET_NAMES as Record<string, string | undefined>)[name] },
  };

  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input);
    const host = Object.keys(HOST_TO_PROVIDER).find((h) => url.includes(h));
    const provider = host ? HOST_TO_PROVIDER[host] : 'unknown';
    const model = JSON.parse(init?.body ?? '{}').model ?? '';
    const signal: AbortSignal | undefined = init?.signal;
    calls.push({ provider, model, signal, at: Date.now() });

    const queue = script[provider];
    if (!queue || queue.length === 0) {
      throw new Error(`test fetch: no scripted response for ${provider} (${url})`);
    }
    const step = queue.length === 1 ? queue[0] : queue.shift()!;

    if ('hang' in step) return neverSettles(provider, model, signal);
    if ('bodyHang' in step) return bodyNeverSettles(provider, model, signal);
    if ('ok' in step) return completion(JSON.stringify({ ok: true }));
    return jsonResponse(step.status, { error: { message: step.body ?? 'provider error' } });
  }) as typeof globalThis.fetch;

  // Gemini goes through the stubbed SDK. It honours `config.abortSignal` the
  // same way the real SDK does, so its cancellation is testable too.
  (globalThis as any).__geminiGenerateContent = async (request: any) => {
    const model = request?.model ?? '';
    const signal: AbortSignal | undefined = request?.config?.abortSignal;
    calls.push({ provider: 'gemini', model, signal, at: Date.now() });
    if (script.gemini?.[0] && 'hang' in script.gemini[0]) {
      return neverSettles('gemini', model, signal);
    }
    return defaultGemini(request);
  };

  // Capture rather than silence, so `time_budget_exhausted` can be asserted.
  const capture = (line: unknown) => logLines.push(String(line));
  console.log = capture;
  console.warn = capture;
  console.error = capture;
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
  aborts = [];
  logLines = [];
  (globalThis as any).__geminiGenerateContent = async (request: any) => {
    const model = request?.model ?? '';
    const signal: AbortSignal | undefined = request?.config?.abortSignal;
    calls.push({ provider: 'gemini', model, signal, at: Date.now() });
    if (script.gemini?.[0] && 'hang' in script.gemini[0]) {
      return neverSettles('gemini', model, signal);
    }
    return defaultGemini(request);
  };
});

afterEach(() => {
  vi.useRealTimers();
});

function run(scope?: 'create_plan' | 'summary') {
  return runFailover({
    task: 'nutrition',
    ...(scope ? { routeScope: scope } : {}),
    prompt: 'build a recomp plan',
    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    maxOutputTokens: 1024,
  });
}

const providersHit = () => calls.map((c) => c.provider);
const logged = (msg: string) => logLines.some((l) => l.includes(`"msg":"${msg}"`));

describe('Create Plan per-route timeout is bounded below the 60s platform risk', () => {
  it('announces the bounded ceiling and the global budget on route_start', async () => {
    script = { openrouter: [{ ok: true }] };
    await run('create_plan');

    const start = logLines.find((l) => l.includes('"msg":"create_plan.route_start"'))!;
    expect(start).toBeDefined();
    expect(JSON.parse(start).perRouteTimeoutMs).toBe(20000);
    expect(JSON.parse(start).totalBudgetMs).toBe(100000);
  });

  it('does not abort a hanging route one millisecond early', async () => {
    vi.useFakeTimers();
    script = { groq: [HANG], openrouter: [{ ok: true }] };

    const pending = run('create_plan');
    await vi.advanceTimersByTimeAsync(19_999);

    expect(aborts).toHaveLength(0);
    expect(providersHit()).toEqual(['groq']);

    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(aborts.map((a) => a.provider)).toEqual(['groq']);
    // Exactly the Create Plan ceiling, measured on the attempt itself.
    expect(aborts[0].at - calls[0].at).toBe(20_000);
    expect(result.ok).toBe(true);
  });

  it('aborts at the Create Plan ceiling and advances to the next route', async () => {
    vi.useFakeTimers();
    // The production shape: Qwen fails on both providers, then NVIDIA hangs.
    script = {
      groq: [{ status: 413, body: GROQ_ITPM_413_BODY }],
      openrouter: [RATE_LIMIT_429, RATE_LIMIT_429, { ok: true }],
      nvidia: [HANG],
    };

    // 2s of 429 retry backoff runs before NVIDIA is reached, so the window has
    // to clear 22s for the stall to be cut off.
    const pending = run('create_plan');
    await vi.advanceTimersByTimeAsync(25_000);
    const result = await pending;

    // The chain reached Nemotron on OpenRouter instead of dying on NVIDIA.
    expect(result.ok).toBe(true);
    expect(providersHit()).toEqual(['groq', 'openrouter', 'openrouter', 'nvidia', 'openrouter']);

    const nvidiaCall = calls.find((c) => c.provider === 'nvidia')!;
    const nvidiaAbort = aborts.find((a) => a.provider === 'nvidia')!;
    expect(nvidiaAbort.at - nvidiaCall.at).toBe(20_000);
  });

  it('records the hang as a timeout on the Create Plan namespace, not a hard stop', async () => {
    vi.useFakeTimers();
    script = {
      openrouter: [RATE_LIMIT_429, RATE_LIMIT_429, { ok: true }],
      groq: [{ status: 413, body: GROQ_ITPM_413_BODY }],
      nvidia: [HANG],
    };

    const pending = run('create_plan');
    await vi.advanceTimersByTimeAsync(25_000);
    await pending;

    const failure = logLines.find((l) => l.includes('"msg":"create_plan.route_failure"') && l.includes('"provider":"nvidia"'))!;
    expect(failure).toBeDefined();
    const parsed = JSON.parse(failure);
    expect(parsed.errorClass).toBe('timeout');
    expect(parsed.latencyMs).toBe(20_000);
    expect(parsed.attempt).toBe(1);
    // Never labelled as a summary call.
    expect(parsed.task).toBe('nutrition');
    expect(parsed.routeScope).toBe('create_plan');
    // A timeout is transient-ish, so it must not be reported as our own bug.
    expect(logLines.some((l) => l.includes('"msg":"create_plan.route_hard_failure"'))).toBe(false);
  });
});

describe('the timed-out request is genuinely cancelled, not merely ignored', () => {
  it('times out a provider that sends headers but stalls its response body', async () => {
    vi.useFakeTimers();
    script = {
      groq: [{ bodyHang: true }],
      openrouter: [{ ok: true }],
    };

    const pending = run('create_plan');
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(providersHit()).toEqual(['groq', 'openrouter']);
    expect(aborts.map((a) => a.provider)).toEqual(['groq']);
    expect(
      logLines.some(
        (line) =>
          line.includes('"msg":"create_plan.route_failure"') &&
          line.includes('"provider":"groq"') &&
          line.includes('"errorClass":"timeout"'),
      ),
    ).toBe(true);
  });

  it('aborts the signal handed to the provider transport', async () => {
    vi.useFakeTimers();
    script = {
      openrouter: [RATE_LIMIT_429, RATE_LIMIT_429, { ok: true }],
      groq: [{ status: 413, body: GROQ_ITPM_413_BODY }],
      nvidia: [HANG],
    };

    const pending = run('create_plan');
    await vi.advanceTimersByTimeAsync(25_000);
    await pending;

    const nvidiaCall = calls.find((c) => c.provider === 'nvidia')!;
    // Reverting to a bare Promise.race would leave this undefined and the
    // stalled request running, which is exactly the production bug.
    expect(nvidiaCall.signal).toBeDefined();
    expect(nvidiaCall.signal!.aborted).toBe(true);
    // And the transport actually observed the cancellation.
    expect(aborts.map((a) => a.provider)).toEqual(['nvidia']);
  });

  it('gives every OpenAI-compatible call a signal and cancels only the stalled one', async () => {
    vi.useFakeTimers();
    script = {
      openrouter: [RATE_LIMIT_429, RATE_LIMIT_429, { ok: true }],
      groq: [{ status: 413, body: GROQ_ITPM_413_BODY }],
      nvidia: [HANG],
    };

    const pending = run('create_plan');
    await vi.advanceTimersByTimeAsync(25_000);
    await pending;

    // No call may go out un-cancellable, or a later stall would leak again.
    expect(calls.every((c) => c.signal instanceof AbortSignal)).toBe(true);
    // A provider that answered with a real status is not marked aborted.
    expect(calls.filter((c) => c.provider === 'groq')[0].signal!.aborted).toBe(false);
  });

  it('cancels the Gemini request too, not just the fetch-based routes', async () => {
    vi.useFakeTimers();
    script = {
      openrouter: [RATE_LIMIT_429, RATE_LIMIT_429, { status: 500, body: 'x' }, { status: 500, body: 'x' }],
      groq: [{ status: 413, body: GROQ_ITPM_413_BODY }],
      nvidia: [{ status: 500, body: 'x' }, { status: 500, body: 'x' }],
      kilo: [{ status: 500, body: 'x' }, { status: 500, body: 'x' }],
      gemini: [HANG],
    };

    const pending = run('create_plan');
    // 4 routes x 20s, then Gemini hangs for the remainder of its own ceiling.
    await vi.advanceTimersByTimeAsync(100_000);
    const result = await pending;

    expect(result.ok).toBe(false);
    const geminiCall = calls.find((c) => c.provider === 'gemini')!;
    expect(geminiCall).toBeDefined();
    expect(geminiCall.signal).toBeDefined();
    expect(geminiCall.signal!.aborted).toBe(true);
    expect(aborts.map((a) => a.provider)).toContain('gemini');
  });
});

describe('the global budget stays the backstop', () => {
  it('emits time_budget_exhausted when the budget, not a route timeout, is the limit', async () => {
    vi.useFakeTimers();
    // Every route hangs. 5 stalled routes x 20s = the whole 100s budget, so
    // the deadline is reached before Gemini is ever attempted.
    script = {
      openrouter: [HANG],
      groq: [HANG],
      nvidia: [HANG],
      kilo: [HANG],
      gemini: [HANG],
    };

    const started = Date.now();
    const pending = run('create_plan');
    await vi.advanceTimersByTimeAsync(100_000);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.hard).toBe(false);
    expect(result.errorClass).toBe('timeout');
    expect(Date.now() - started).toBe(100_000);

    expect(logged('create_plan.time_budget_exhausted')).toBe(true);
    // The budget ran out first, so the last route was never entered.
    expect(providersHit()).not.toContain('gemini');
    expect(logged('create_plan.all_routes_failed')).toBe(false);
  });

  it('never lets a single route outlive the remaining global budget', async () => {
    vi.useFakeTimers();
    script = { groq: [HANG], openrouter: [{ ok: true }] };

    const pending = run('create_plan');
    // Far beyond both the 20s route ceiling and the 100s global budget.
    await vi.advanceTimersByTimeAsync(250_000);
    const result = await pending;

    expect(result.ok).toBe(true);
    // Only the first route was ever needed: it timed out at 20s, well inside.
    expect(providersHit()).toEqual(['groq', 'openrouter']);
    expect(logged('create_plan.time_budget_exhausted')).toBe(false);
  });
});

describe('summary generation is completely unchanged', () => {
  it('keeps the original 60s per-route ceiling', async () => {
    vi.useFakeTimers();
    script = { openrouter: [HANG], kilo: [{ ok: true }] };

    const started = Date.now();
    const pending = run('summary');
    // The Create Plan ceiling must NOT have leaked into summary.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(aborts).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(40_000);
    const result = await pending;

    expect(Date.now() - started).toBe(60_000);
    expect(aborts.map((a) => a.provider)).toEqual(['openrouter']);
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('kilo');
  });

  it('still logs on the summary namespace', async () => {
    script = { openrouter: [{ ok: true }] };
    await run('summary');

    expect(logged('ai.summary.route_start')).toBe(true);
    expect(logged('create_plan.route_start')).toBe(false);
  });
});

describe('retry and failover semantics are preserved under the bounded ceiling', () => {
  it('the first route 429 still retries the same route once, then advances', async () => {
    script = { groq: [RATE_LIMIT_429, RATE_LIMIT_429], openrouter: [{ ok: true }] };
    const result = await run('create_plan');

    expect(result.ok).toBe(true);
    expect(providersHit()).toEqual(['groq', 'groq', 'openrouter']);
    const failures = result.attempts.filter((a) => a.result === 'failure');
    expect(failures).toHaveLength(2);
    expect(failures.every((a) => a.errorClass === 'rate_limited' && a.status === 429)).toBe(true);
  });

  it('Groq token-limit 413 still fails over with no same-route retry', async () => {
    script = {
      openrouter: [RATE_LIMIT_429, RATE_LIMIT_429],
      groq: [{ status: 413, body: GROQ_ITPM_413_BODY }],
      nvidia: [{ ok: true }],
    };
    const result = await run('create_plan');

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('nvidia');
    expect(providersHit().filter((p) => p === 'groq')).toHaveLength(1);
  });

  it('a timeout is not retried on the same route', async () => {
    vi.useFakeTimers();
    script = {
      openrouter: [RATE_LIMIT_429, RATE_LIMIT_429],
      groq: [HANG],
      nvidia: [{ ok: true }],
    };

    const pending = run('create_plan');
    // 2s of 429 backoff, then Groq's 20s ceiling.
    await vi.advanceTimersByTimeAsync(25_000);
    const result = await pending;

    expect(result.ok).toBe(true);
    // Exactly one Groq attempt: a stalled provider must not be asked twice.
    expect(providersHit().filter((p) => p === 'groq')).toHaveLength(1);
  });

  it('provider-level failover still precedes model-level fallback', async () => {
    vi.useFakeTimers();
    script = {
      openrouter: [RATE_LIMIT_429, RATE_LIMIT_429, HANG],
      groq: [{ status: 413, body: GROQ_ITPM_413_BODY }],
      nvidia: [HANG],
      kilo: [HANG],
    };

    const pending = run('create_plan');
    await vi.advanceTimersByTimeAsync(80_000);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('gemini');

    const order = providersHit();
    // Qwen exhausted on both providers before any Nemotron provider is tried.
    expect(order.indexOf('groq')).toBeLessThan(order.indexOf('nvidia'));
    // All three Nemotron providers are tried before the Gemini fallback.
    expect(order.indexOf('nvidia')).toBeLessThan(order.indexOf('kilo'));
    expect(order.indexOf('kilo')).toBeLessThan(order.indexOf('gemini'));
  });

  it('a successful first route still ends the run immediately', async () => {
    script = { openrouter: [{ ok: true }], groq: [{ ok: true }], nvidia: [{ ok: true }] };
    const result = await run('create_plan');

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('groq');
    expect(result.attempts).toHaveLength(1);
    expect(providersHit()).toEqual(['groq']);
  });
});

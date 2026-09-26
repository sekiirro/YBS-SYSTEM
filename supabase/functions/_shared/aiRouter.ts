/**
 * YBS AI failover router.
 *
 * One router, two route tables. The task decides which table is walked, the
 * retry/budget/classification rules are identical for both, and a task never
 * inherits the other's providers:
 *
 *   - `summary` (default, unchanged): Ling 3.0 Flash Sante (OpenRouter -> Kilo)
 *     -> Gemini -> Nemotron 3.5 Lightning (NVIDIA -> OpenRouter -> Kilo).
 *   - `create_plan`: Qwen 3.8 27B (OpenRouter -> Groq) -> Nemotron 3 Ultra
 *     (NVIDIA -> OpenRouter -> Kilo) -> Gemini.
 *
 * Contract with the caller is unchanged: give it a prompt, a schema and a token
 * budget, get text back. The caller still owns prompts, cache keys, the YBS
 * response contract and parsing.
 */
import {
  invokeRoute,
  resolveRoutes,
  resolveCreatePlanRoutes,
  PER_ROUTE_TIMEOUT_MS,
  type Classification,
  type ErrorClass,
  type OutputValidator,
  type Route,
  type RouteFailure,
  type RouteSuccess,
} from './aiProviders.ts';

/**
 * Which task's route table to walk. `summary` is the default so an existing
 * caller that never sets it keeps today's behaviour exactly.
 */
export type RouteScope = 'summary' | 'create_plan';

function routesFor(scope: RouteScope) {
  return scope === 'create_plan' ? resolveCreatePlanRoutes() : resolveRoutes();
}

/** Log namespace per task, so Create Plan is never labelled `ai.summary.*`. */
function logNamespace(scope: RouteScope): string {
  return scope === 'create_plan' ? 'create_plan' : 'ai.summary';
}

/** Wall-clock ceiling for the whole chain, so the function never hangs. */
const TOTAL_BUDGET_MS = 100000;
/** One short same-route retry, only when the failure is plausibly transient. */
const RETRY_BACKOFF_MS = 2000;

/**
 * Per-attempt wall-clock ceiling, chosen per task.
 *
 * Create Plan walks three model tiers (Qwen -> Nemotron -> Gemini) behind five
 * provider routes, so a single silent provider must not be able to strand every
 * tier behind it: 20s is far above the real completion latency on this chain
 * (observed sub-second on the Qwen hops) while leaving most of the 100s budget
 * for the routes that follow. The summary chain keeps the original 60s ceiling
 * so Nutrition/Training Summary timing is completely unchanged.
 */
const PER_ROUTE_TIMEOUT_BY_SCOPE: Record<RouteScope, number> = {
  summary: PER_ROUTE_TIMEOUT_MS,
  create_plan: 20000,
};

export interface RouterAttempt {
  provider: string;
  model: string;
  result: 'success' | 'failure';
  errorClass?: ErrorClass;
  status?: number;
  latencyMs: number;
}

export interface RouterSuccess {
  ok: true;
  text: string;
  finishReason: string;
  provider: string;
  model: string;
  latencyMs: number;
  raw?: unknown;
  attempts: RouterAttempt[];
  missingSecrets: string[];
}

export interface RouterFailure {
  ok: false;
  /** Our own integration/config fault — must surface, never rotate past. */
  hard: boolean;
  /** No provider secret is configured at all -> 503, not a 502. */
  notConfigured: boolean;
  errorClass: ErrorClass;
  detail: string;
  attempts: RouterAttempt[];
  missingSecrets: string[];
  aggregate: RouterFailureAggregate;
}

/**
 * One normalized description of a dead chain, safe to log and safe to return:
 * provider/model names and normalized error classes only. Never contains API
 * keys, tokens, the prompt, or anything the client typed.
 */
export interface RouterFailureAggregate {
  providersAttempted: string[];
  modelsAttempted: string[];
  routeErrors: {
    provider: string;
    model: string;
    errorClass: ErrorClass;
    status?: number;
  }[];
  finalClassification: {
    errorClass: ErrorClass;
    hard: boolean;
    detail: string;
  };
}

export type RouterResult = RouterSuccess | RouterFailure;

export interface RunFailoverArgs {
  /** 'nutrition' | 'training' — safe to log, identifies the summary layer. */
  task: string;
  /**
   * Which route table to walk. Defaults to `'summary'`; Create Plan passes
   * `'create_plan'` so it never inherits the Ling-based summary chain.
   */
  routeScope?: RouteScope;
  prompt: string;
  schema: Record<string, any>;
  maxOutputTokens: number;
  /**
   * Optional usability gate applied to the completion BEFORE the route counts
   * as a success. A provider that answers 200 with truncated or non-JSON text
   * has failed to produce a result, so the router records a
   * `generation_output_invalid` attempt and moves on to the next route instead
   * of ending the chain and surfacing the raw failure. Omit it (or return
   * ok:true) to accept any non-empty completion.
   */
  validateOutput?: OutputValidator;
}

function log(
  level: 'INFO' | 'WARN' | 'ERROR',
  message: string,
  fields: Record<string, unknown>,
): void {
  // Structured JSON keeps Supabase log search working on the `message` field.
  const payload = { level, msg: message, ...fields };
  const line = JSON.stringify(payload);
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
}

function summarizeAttempts(attempts: RouterAttempt[]): string {
  if (attempts.length === 0) return 'no provider routes attempted';
  return attempts
    .map((a) => `${a.provider}/${a.model}${a.status ? ` ${a.status}` : ''} -> ${a.errorClass ?? a.result}`)
    .join(' | ');
}

function lastFailure(attempts: RouterAttempt[], detail: string): { errorClass: ErrorClass; detail: string } {
  const failed = attempts.filter((a) => a.result === 'failure');
  const last = failed[failed.length - 1];
  return { errorClass: last?.errorClass ?? 'unknown', detail: detail || 'all provider routes failed' };
}

function remainingBudget(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

/**
 * Collapse a dead chain into a single normalized failure. Built only from
 * provider/model names and normalized error classes, so it is safe to log at
 * ERROR and safe to hand back to the caller.
 */
function buildAggregate(
  attempts: RouterAttempt[],
  final: { errorClass: ErrorClass; hard: boolean; detail: string },
): RouterFailureAggregate {
  const failed = attempts.filter((a) => a.result === 'failure');
  return {
    providersAttempted: [...new Set(attempts.map((a) => a.provider))],
    modelsAttempted: [...new Set(attempts.map((a) => a.model))],
    routeErrors: failed.map((a) => ({
      provider: a.provider,
      model: a.model,
      errorClass: a.errorClass ?? 'unknown',
      status: a.status,
    })),
    finalClassification: final,
  };
}

export async function runFailover(args: RunFailoverArgs): Promise<RouterResult> {
  const scope: RouteScope = args.routeScope ?? 'summary';
  const ns = logNamespace(scope);
  const { routes, missing } = routesFor(scope);
  const attempts: RouterAttempt[] = [];
  const started = Date.now();
  const deadline = started + TOTAL_BUDGET_MS;

  if (routes.length === 0) {
    log('ERROR', `${ns}.provider_routes_unavailable`, {
      task: args.task,
      routeScope: scope,
      missingSecrets: missing,
    });
    return {
      ok: false,
      hard: true,
      notConfigured: true,
      errorClass: 'request_invalid',
      detail: 'server_not_configured',
      attempts,
      missingSecrets: missing,
      aggregate: buildAggregate(attempts, {
        errorClass: 'request_invalid',
        hard: true,
        detail: 'server_not_configured',
      }),
    };
  }

  if (missing.length > 0) {
    // Safe: these are secret NAMES from our own table, never values.
    log('INFO', `${ns}.provider_routes_partial`, { task: args.task, routeScope: scope, missingSecrets: missing });
  }

  const tiers = [...new Set(routes.map((r) => r.tier))].sort((a, b) => a - b);
  const routeTimeoutMs = PER_ROUTE_TIMEOUT_BY_SCOPE[scope];

  log('INFO', `${ns}.route_start`, {
    task: args.task,
    routeScope: scope,
    // The chain that will actually be walked, in order. Names only.
    routesPlanned: routes.map((r) => `${r.provider}/${r.model}`),
    routeCount: routes.length,
    tierCount: tiers.length,
    perRouteTimeoutMs: routeTimeoutMs,
    totalBudgetMs: TOTAL_BUDGET_MS,
  });

  for (const tier of tiers) {
    for (const route of routes.filter((r) => r.tier === tier)) {
      if (remainingBudget(deadline) <= 1000) {
        const { errorClass, detail } = lastFailure(attempts, 'overall AI time budget exhausted');
        log('ERROR', `${ns}.time_budget_exhausted`, {
          task: args.task,
          routeScope: scope,
          tier,
          attempts: attempts.length,
          elapsedMs: Date.now() - started,
        });
        return {
          ok: false,
          hard: false,
          notConfigured: false,
          errorClass,
          detail,
          attempts,
          missingSecrets: missing,
          aggregate: buildAggregate(attempts, { errorClass, hard: false, detail }),
        };
      }

      const maxAttempts = 2; // initial + one short retry when transient
      for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
        // A route can never outlive the budget that is left: whichever ceiling
        // is smaller wins, so the global deadline stays the real backstop and
        // still reports itself via `time_budget_exhausted`.
        const timeoutMs = Math.min(routeTimeoutMs, remainingBudget(deadline));
        const result = await invokeRoute(route, {
          prompt: args.prompt,
          schema: args.schema,
          maxOutputTokens: args.maxOutputTokens,
          timeoutMs,
        });

        if (result.ok) {
          const value: RouteSuccess = result.value;

          // Usability gate: HTTP 200 is not the same as "produced a result".
          // A truncated document is a provider failure and must fail over, not
          // be handed to the caller as a success.
          if (args.validateOutput) {
            const verdict = args.validateOutput(value.text);
            if (!verdict.ok) {
              attempts.push({
                provider: value.provider,
                model: value.model,
                result: 'failure',
                errorClass: 'generation_output_invalid',
                status: 200,
                latencyMs: value.latencyMs,
              });
              log('WARN', `${ns}.route_output_invalid`, {
                task: args.task,
                routeScope: scope,
                provider: value.provider,
                model: value.model,
                errorClass: 'generation_output_invalid',
                status: 200,
                finishReason: value.finishReason,
                reason: verdict.reason,
                detailLength: value.text.length,
                latencyMs: value.latencyMs,
                attempt: attemptNo,
                elapsedMs: Date.now() - started,
              });
              // Not retried: a second identical request usually truncates the
              // same way. Go straight to the next route.
              break;
            }
          }

          attempts.push({
            provider: value.provider,
            model: value.model,
            result: 'success',
            latencyMs: value.latencyMs,
          });
          log('INFO', `${ns}.route_success`, {
            task: args.task,
            routeScope: scope,
            provider: value.provider,
            model: value.model,
            finishReason: value.finishReason,
            latencyMs: value.latencyMs,
            attempt: attemptNo,
            routesTried: attempts.length,
            elapsedMs: Date.now() - started,
          });
          return {
            ok: true,
            text: value.text,
            finishReason: value.finishReason,
            provider: value.provider,
            model: value.model,
            latencyMs: value.latencyMs,
            raw: value.raw,
            attempts,
            missingSecrets: missing,
          };
        }

        const { failure, classification } = result;
        attempts.push({
          provider: failure.provider,
          model: failure.model,
          result: 'failure',
          errorClass: failure.errorClass,
          status: failure.status,
          latencyMs: failure.latencyMs,
        });

        log('WARN', `${ns}.route_failure`, {
          task: args.task,
          routeScope: scope,
          provider: failure.provider,
          model: failure.model,
          errorClass: failure.errorClass,
          status: failure.status,
          detail: failure.detail,
          latencyMs: failure.latencyMs,
          attempt: attemptNo,
          elapsedMs: Date.now() - started,
        });

        // A 404 on a verified endpoint means our model id is wrong. On the
        // unverified Kilo route it just means the gateway does not serve that
        // path, so skip instead of aborting the chain.
        const isFatalNotFound = failure.errorClass === 'route_not_found' && route.notFoundIsFatal;

        // Create Plan is the exception to "a 4xx proves our request is broken".
        // By the time the router runs, the application has already validated the
        // client input and the payload is fixed and known-good, so a provider
        // answering 4xx is evidence about THAT provider -- an unknown model id, a
        // schema keyword it does not implement, a parameter it rejects -- and the
        // next configured provider may accept the very same request. Hard-stopping
        // there is what turned one Groq 400 into `ai_unavailable` with five
        // eligible providers never attempted.
        //
        // The Summary scope keeps the strict rule, where a 400 genuinely does mean
        // our own integration is broken and must surface rather than be papered
        // over by a different provider's opinion.
        const shouldFailoverAnyway = scope === 'create_plan' && (classification.fatal || isFatalNotFound);
        if ((classification.fatal || isFatalNotFound) && !shouldFailoverAnyway) {
          log('ERROR', `${ns}.route_hard_failure`, {
            task: args.task,
            routeScope: scope,
            provider: failure.provider,
            model: failure.model,
            errorClass: failure.errorClass,
            status: failure.status,
            detail: failure.detail,
            reason: 'request_or_integration_error',
          });
          return {
            ok: false,
            hard: true,
            notConfigured: false,
            errorClass: failure.errorClass,
            detail: failure.detail,
            attempts,
            missingSecrets: missing,
            aggregate: buildAggregate(attempts, {
              errorClass: failure.errorClass,
              hard: true,
              detail: failure.detail,
            }),
          };
        }

        if (shouldFailoverAnyway) {
          // Distinct event so a downgraded stop is never mistaken for a clean
          // provider-local skip when reading logs after an incident.
          log('WARN', `${ns}.route_failure_failover`, {
            task: args.task,
            routeScope: scope,
            provider: failure.provider,
            model: failure.model,
            errorClass: failure.errorClass,
            status: failure.status,
            detail: failure.detail,
            downgradedFromHardStop: true,
            attempt: attemptNo,
          });
        }

        const canRetry =
          classification.retrySameRoute &&
          attemptNo < maxAttempts &&
          remainingBudget(deadline) > RETRY_BACKOFF_MS + 1000;
        if (canRetry) {
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
          continue;
        }
        break; // move to the next route
      }
    }
  }

  const { errorClass, detail } = lastFailure(attempts, summarizeAttempts(attempts));
  log('ERROR', `${ns}.all_routes_failed`, {
    task: args.task,
    routeScope: scope,
    errorClass,
    chain: summarizeAttempts(attempts),
    providersAttempted: [...new Set(attempts.map((a) => a.provider))],
    modelsAttempted: [...new Set(attempts.map((a) => a.model))],
    routeErrors: attempts
      .filter((a) => a.result === 'failure')
      .map((a) => ({
        provider: a.provider,
        model: a.model,
        errorClass: a.errorClass ?? 'unknown',
        status: a.status,
      })),
    finalClassification: { errorClass, hard: false },
    routesTried: routes.length,
    elapsedMs: Date.now() - started,
  });
  return {
    ok: false,
    hard: false,
    notConfigured: false,
    errorClass,
    detail,
    attempts,
    missingSecrets: missing,
    aggregate: buildAggregate(attempts, { errorClass, hard: false, detail }),
  };
}

export type { Route, RouteFailure, Classification };

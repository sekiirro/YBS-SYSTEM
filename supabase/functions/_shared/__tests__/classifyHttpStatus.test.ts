/**
 * classifyHttpStatus() -- the Create Plan failover decision.
 *
 * Focus: a provider-side TOKEN-LIMIT 413 must be provider-local (fail over),
 * while every other 413 -- and every pre-existing status semantic -- must be
 * unchanged.
 */
import { describe, it, expect } from 'vitest';
import { classifyHttpStatus } from '../aiProviders.ts';

/**
 * Verbatim shape of the real Groq rejection captured in the runtime log on
 * 2026-09-26 (requestId 85478d30 / d5ca2a5e). Org id elided; it is not ours to
 * keep in a test fixture.
 */
const GROQ_ITPM_413 = JSON.stringify({
  error: {
    message:
      'Request too large for model `qwen/qwen3.8-27b` in organization `org_...` ' +
      'service tier `on_demand` on input tokens per minute (ITPM): Limit 7000, ' +
      'Requested 11160, please reduce your message size and try again. ' +
      'Need more tokens? Upgrade to Dev Tier today at ...',
    type: 'requests',
    code: 'too_many_requests',
  },
});

describe('413 with a token/rate-limit body -> provider-local rate limit', () => {
  it('classifies the real Groq ITPM 413 as rate_limited and fails over', () => {
    const c = classifyHttpStatus(413, GROQ_ITPM_413);
    expect(c.errorClass).toBe('rate_limited');
    expect(c.failover).toBe(true);
    expect(c.fatal).toBe(false);
    // Never retry the same Groq route: the budget is per-minute, so an
    // immediate retry just burns the same wall.
    expect(c.retrySameRoute).toBe(false);
    expect(c.status).toBe(413);
  });

  // Each phrase the fix is required to recognise, in isolation.
  it.each([
    ['input tokens per minute', 'exceeded input tokens per minute for this org'],
    ['tokens per minute', 'tokens per minute limit reached'],
    ['ITPM', 'on ITPM: Limit 7000'],
    ['token limit', 'your token limit for this model is 7000'],
    ['reduce your message size', 'please reduce your message size and try again'],
    ['requested tokens exceed limit', 'requested tokens exceed limit of 7000'],
    ['tokens exceed', 'your tokens exceed the per-model allowance'],
    ['Limit <n> tokens', 'Limit 7000 tokens per minute'],
    ['Requested <n> tokens', 'Requested 11160 input tokens'],
  ])('recognises %s', (_label, body) => {
    const c = classifyHttpStatus(413, body);
    expect(c.errorClass).toBe('rate_limited');
    expect(c.fatal).toBe(false);
    expect(c.failover).toBe(true);
  });
});

describe('413 without a token/rate-limit body -> stays a hard failure', () => {
  it.each([
    ['a generic gateway body-length rejection', 'Request Entity Too Large'],
    ['a bare nginx 413', '<html><body><h1>413 Request Entity Too Large</h1></body></html>'],
    ['an unrelated JSON error', '{"error":{"message":"payload too large","code":"payload_too_large"}}'],
    ['an empty body', ''],
    ['a context-length message with no token/minute wording', 'maximum context length exceeded'],
  ])('%s remains request_invalid/fatal', (_label, body) => {
    const c = classifyHttpStatus(413, body);
    expect(c.errorClass).toBe('request_invalid');
    expect(c.fatal).toBe(true);
    expect(c.failover).toBe(false);
  });
});

describe('pre-existing status semantics are unchanged', () => {
  it('400 and 422 stay hard request_invalid', () => {
    for (const status of [400, 422]) {
      const c = classifyHttpStatus(status, '{"error":"bad schema"}');
      expect(c.errorClass).toBe('request_invalid');
      expect(c.fatal).toBe(true);
      expect(c.failover).toBe(false);
    }
  });

  it('401 and 403 stay provider-local auth_error', () => {
    for (const status of [401, 403]) {
      const c = classifyHttpStatus(status, '{"error":"invalid api key"}');
      expect(c.errorClass).toBe('auth_error');
      expect(c.fatal).toBe(false);
      expect(c.failover).toBe(true);
    }
  });

  it('403 with a balance wall stays quota_exhausted', () => {
    const c = classifyHttpStatus(403, '{"error":{"code":"not_enough_balance"}}');
    expect(c.errorClass).toBe('quota_exhausted');
    expect(c.failover).toBe(true);
  });

  it('404 stays route_not_found, never fatal at this layer', () => {
    const c = classifyHttpStatus(404, 'no such model');
    expect(c.errorClass).toBe('route_not_found');
    expect(c.failover).toBe(true);
    expect(c.fatal).toBe(false);
  });

  it('429 stays rate_limited AND still retries the same route', () => {
    const c = classifyHttpStatus(429, 'temporarily rate-limited upstream');
    expect(c.errorClass).toBe('rate_limited');
    expect(c.fatal).toBe(false);
    expect(c.retrySameRoute).toBe(true);
  });

  it('5xx stays provider_unavailable with a same-route retry', () => {
    for (const status of [500, 502, 503, 504]) {
      const c = classifyHttpStatus(status, 'upstream error');
      expect(c.errorClass).toBe('provider_unavailable');
      expect(c.fatal).toBe(false);
      expect(c.retrySameRoute).toBe(true);
    }
  });

  it('other unlisted 4xx stay hard request_invalid', () => {
    for (const status of [405, 409, 418, 451]) {
      const c = classifyHttpStatus(status, 'nope');
      expect(c.errorClass).toBe('request_invalid');
      expect(c.fatal).toBe(true);
    }
  });

  it('a token-limit 413 does not swallow a 400 with the same wording', () => {
    // The new branch is gated on 413 specifically.
    const c = classifyHttpStatus(400, 'input tokens per minute limit exceeded');
    expect(c.errorClass).toBe('request_invalid');
    expect(c.fatal).toBe(true);
  });
});

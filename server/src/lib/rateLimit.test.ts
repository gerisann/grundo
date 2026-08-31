import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from './errors';
import {
  RATE_LIMIT_POLICIES,
  createRateLimitMiddleware,
  evaluateRateLimit,
  parseRateLimitMode,
  rateLimitDocumentId,
  selectAuthenticatedPolicy,
  type RateLimitResult,
} from './rateLimit';

function request(method: string, originalUrl: string): Request {
  return { method, originalUrl } as Request;
}

afterEach(() => vi.restoreAllMocks());

describe('rate limit', () => {
  it('a limitig enged, utána a hátralévő idővel tilt', () => {
    const policy = { name: 'test', limit: 2, windowMs: 60_000 };
    const first = evaluateRateLimit(null, policy, 1_000);
    const second = evaluateRateLimit(first, policy, 2_000);
    const blocked = evaluateRateLimit(second, policy, 3_000);

    expect(first).toMatchObject({ allowed: true, count: 1, remaining: 1 });
    expect(second).toMatchObject({ allowed: true, count: 2, remaining: 0 });
    expect(blocked).toMatchObject({ allowed: false, count: 2, retryAfterSeconds: 58 });
  });

  it('lejárt ablaknál új számlálót kezd', () => {
    const policy = { name: 'test', limit: 1, windowMs: 60_000 };
    const reset = evaluateRateLimit({ count: 1, windowStartedAtMs: 1_000 }, policy, 61_000);
    expect(reset).toMatchObject({ allowed: true, count: 1, windowStartedAtMs: 61_000 });
  });

  it('a dokumentumazonosító stabil, de nem tartalmazza az alanyt', () => {
    const first = rateLimitDocumentId('secret', 'login', 'geri@example.com');
    expect(first).toBe(rateLimitDocumentId('secret', 'login', 'geri@example.com'));
    expect(first).not.toContain('geri');
    expect(first).not.toBe(rateLimitDocumentId('secret', 'login', 'mas@example.com'));
  });

  it('a költséges és író végpontok a megfelelő keretet kapják', () => {
    expect(selectAuthenticatedPolicy(request('POST', '/api/activities')))
      .toBe(RATE_LIMIT_POLICIES.activityUpload);
    expect(selectAuthenticatedPolicy(request('POST', '/api/missions/evaluate')))
      .toBe(RATE_LIMIT_POLICIES.missionEvaluate);
    expect(selectAuthenticatedPolicy(request('GET', '/api/tiles/view?z=15')))
      .toBe(RATE_LIMIT_POLICIES.tiles);
    expect(selectAuthenticatedPolicy(request('GET', '/api/tiles-fake'))).toBeNull();
    expect(selectAuthenticatedPolicy(request('GET', '/api/users/geri'))).toBeNull();
    expect(selectAuthenticatedPolicy(request('DELETE', '/api/users/geri/follow')))
      .toBe(RATE_LIMIT_POLICIES.mutation);
  });

  it('csak a két ismert rollout módot fogadja el', () => {
    expect(parseRateLimitMode('observe')).toBe('observe');
    expect(parseRateLimitMode('enforce')).toBe('enforce');
    expect(parseRateLimitMode('invalid')).toBe('off');
  });

  it('enforce módban 429-cel tiltja a kimerített keretet', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const blocked: RateLimitResult = {
      allowed: false,
      count: 10,
      remaining: 0,
      retryAfterSeconds: 30,
      windowStartedAtMs: 1_000,
    };
    const middleware = createRateLimitMiddleware(
      'enforce',
      'secret',
      () => RATE_LIMIT_POLICIES.login,
      () => 'geri',
      { consume: vi.fn(async () => blocked) },
    );
    const next = vi.fn() as unknown as NextFunction;

    await middleware(request('POST', '/api/auth/login'), {} as Response, next);

    const error = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(429);
  });

  it('observe módban a kimerített keretet is csak naplózza', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const middleware = createRateLimitMiddleware(
      'observe',
      'secret',
      () => RATE_LIMIT_POLICIES.login,
      () => 'geri',
      {
        consume: vi.fn(async () => ({
          allowed: false,
          count: 10,
          remaining: 0,
          retryAfterSeconds: 30,
          windowStartedAtMs: 1_000,
        })),
      },
    );
    const next = vi.fn() as unknown as NextFunction;

    await middleware(request('POST', '/api/auth/login'), {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });
});

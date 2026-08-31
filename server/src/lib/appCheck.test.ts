import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from './errors';
import { createAppCheckMiddleware, parseAppCheckMode } from './appCheck';

function request(token?: string, path = '/activities'): Request {
  return {
    path,
    method: 'POST',
    originalUrl: `/api${path}`,
    header: vi.fn((name: string) => name === 'X-Firebase-AppCheck' ? token : undefined),
  } as unknown as Request;
}

async function run(
  mode: 'off' | 'observe' | 'enforce',
  req: Request,
  verify = vi.fn(async () => ({ appId: '1:123:web:test' })),
) {
  const next = vi.fn() as unknown as NextFunction;
  await createAppCheckMiddleware(mode, verify)(req, {} as Response, next);
  return { next, verify };
}

afterEach(() => vi.restoreAllMocks());

describe('App Check middleware', () => {
  it('ismeretlen módnál biztonságosan kikapcsolt állapotot ad', () => {
    expect(parseAppCheckMode('broken')).toBe('off');
  });

  it('observe módban megjelöli, de átengedi a hiányzó tokent', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const req = request();
    const { next } = await run('observe', req);
    expect((req as Request & { appCheckValid?: boolean }).appCheckValid).toBe(false);
    expect(next).toHaveBeenCalledWith();
  });

  it('enforce módban elutasítja a hiányzó tokent', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { next } = await run('enforce', request());
    const error = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).code).toBe('app_check_required');
  });

  it('érvényes tokent ellenőriz és az appazonosítót továbbadja', async () => {
    const req = request('valid-token');
    const { next, verify } = await run('enforce', req);
    expect(verify).toHaveBeenCalledWith('valid-token');
    expect((req as Request & { appCheckAppId?: string }).appCheckAppId).toBe('1:123:web:test');
    expect(next).toHaveBeenCalledWith();
  });

  it('a scheduler job ága App Check nélkül is elérhető marad', async () => {
    const { next, verify } = await run('enforce', request(undefined, '/jobs/daily-rollover'));
    expect(verify).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });
});

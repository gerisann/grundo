import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { appCheck } from './firebase';
import { HttpError } from './errors';

export type AppCheckMode = 'off' | 'observe' | 'enforce';

export interface AppCheckedRequest extends Request {
  appCheckAppId?: string;
  appCheckValid?: boolean;
}

type VerifyToken = (token: string) => Promise<{ appId: string }>;

export function parseAppCheckMode(value: string | undefined): AppCheckMode {
  if (value === 'observe' || value === 'enforce') return value;
  return 'off';
}

const mode = parseAppCheckMode(process.env.APP_CHECK_MODE);
let lastWarningAt = 0;
let suppressedWarnings = 0;

function warn(selectedMode: AppCheckMode, reason: 'missing' | 'invalid', req: Request): void {
  const now = Date.now();
  suppressedWarnings += 1;
  if (now - lastWarningAt < 60_000) return;
  console.warn('[GRUNDO security]', {
    event: 'app_check_rejected',
    mode: selectedMode,
    reason,
    method: req.method,
    path: req.originalUrl,
    occurrences: suppressedWarnings,
  });
  lastWarningAt = now;
  suppressedWarnings = 0;
}

function rejection(): HttpError {
  return new HttpError(
    401,
    'app_check_required',
    'Az alkalmazás hitelesítése nem sikerült. Frissítsd a GRUNDO-t, majd próbáld újra.',
  );
}

export function createAppCheckMiddleware(
  selectedMode: AppCheckMode,
  verifyToken: VerifyToken,
): RequestHandler {
  return async (rawReq: Request, _res: Response, next: NextFunction) => {
    const req = rawReq as AppCheckedRequest;
    if (selectedMode === 'off' || req.path === '/jobs' || req.path.startsWith('/jobs/')) {
      return next();
    }

    const token = req.header('X-Firebase-AppCheck');
    if (!token) {
      req.appCheckValid = false;
      warn(selectedMode, 'missing', req);
      return selectedMode === 'enforce' ? next(rejection()) : next();
    }

    try {
      const decoded = await verifyToken(token);
      req.appCheckValid = true;
      req.appCheckAppId = decoded.appId;
      return next();
    } catch {
      req.appCheckValid = false;
      warn(selectedMode, 'invalid', req);
      return selectedMode === 'enforce' ? next(rejection()) : next();
    }
  };
}

export const verifyAppCheck = createAppCheckMiddleware(
  mode,
  (token) => appCheck.verifyToken(token),
);

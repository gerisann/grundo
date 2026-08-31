import { createHmac } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { COLLECTIONS, db } from './firebase';
import { HttpError, tooManyRequests } from './errors';

export type RateLimitMode = 'off' | 'observe' | 'enforce';

export interface RateLimitPolicy {
  name: string;
  limit: number;
  windowMs: number;
}

interface RateLimitState {
  count: number;
  windowStartedAtMs: number;
}

export interface RateLimitResult extends RateLimitState {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  consume(key: string, policy: RateLimitPolicy, nowMs: number): Promise<RateLimitResult>;
}

type PolicyResolver = (req: Request) => RateLimitPolicy | null;
type SubjectResolver = (req: Request) => string;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const RATE_LIMIT_POLICIES = {
  login: { name: 'login', limit: 10, windowMs: 15 * MINUTE },
  signInMethod: { name: 'sign_in_method', limit: 20, windowMs: 15 * MINUTE },
  otpSend: { name: 'otp_send', limit: 5, windowMs: HOUR },
  otpVerify: { name: 'otp_verify', limit: 10, windowMs: 15 * MINUTE },
  activityUpload: { name: 'activity_upload', limit: 12, windowMs: HOUR },
  missionGenerate: { name: 'mission_generate', limit: 10, windowMs: 10 * MINUTE },
  missionEvaluate: { name: 'mission_evaluate', limit: 20, windowMs: 10 * MINUTE },
  weather: { name: 'weather', limit: 60, windowMs: HOUR },
  tiles: { name: 'tiles', limit: 300, windowMs: 10 * MINUTE },
  mutation: { name: 'mutation', limit: 120, windowMs: 10 * MINUTE },
} as const satisfies Record<string, RateLimitPolicy>;

export function parseRateLimitMode(value: string | undefined): RateLimitMode {
  if (value === 'observe' || value === 'enforce') return value;
  return 'off';
}

export function evaluateRateLimit(
  current: RateLimitState | null,
  policy: RateLimitPolicy,
  nowMs: number,
): RateLimitResult {
  const active = current && nowMs - current.windowStartedAtMs < policy.windowMs
    ? current
    : { count: 0, windowStartedAtMs: nowMs };
  const resetAt = active.windowStartedAtMs + policy.windowMs;

  if (active.count >= policy.limit) {
    return {
      ...active,
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - nowMs) / 1000)),
    };
  }

  const count = active.count + 1;
  return {
    count,
    windowStartedAtMs: active.windowStartedAtMs,
    allowed: true,
    remaining: Math.max(0, policy.limit - count),
    retryAfterSeconds: 0,
  };
}

class FirestoreRateLimitStore implements RateLimitStore {
  async consume(key: string, policy: RateLimitPolicy, nowMs: number): Promise<RateLimitResult> {
    const ref = db.collection(COLLECTIONS.rateLimits).doc(key);
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const data = snapshot.data() as Record<string, unknown> | undefined;
      const count = typeof data?.count === 'number' ? data.count : null;
      const windowStartedAtMs = typeof data?.windowStartedAtMs === 'number'
        ? data.windowStartedAtMs
        : null;
      const current = count !== null && windowStartedAtMs !== null
        ? { count, windowStartedAtMs }
        : null;
      const result = evaluateRateLimit(current, policy, nowMs);

      if (result.allowed) {
        tx.set(ref, {
          policy: policy.name,
          count: result.count,
          windowStartedAtMs: result.windowStartedAtMs,
          updatedAt: new Date(nowMs),
          // Optional Firestore TTL policy can remove inactive counters.
          expiresAt: new Date(result.windowStartedAtMs + policy.windowMs * 2),
        });
      }
      return result;
    });
  }
}

export function rateLimitDocumentId(
  secret: string,
  policyName: string,
  subject: string,
): string {
  return createHmac('sha256', secret)
    .update(`${policyName}\u0000${subject}`)
    .digest('base64url');
}

function pathOf(req: Request): string {
  return req.originalUrl.split('?', 1)[0] ?? req.originalUrl;
}

function isPathBranch(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function selectAuthenticatedPolicy(req: Request): RateLimitPolicy | null {
  const path = pathOf(req);
  if (req.method === 'POST' && path === '/api/auth/otp/send') return RATE_LIMIT_POLICIES.otpSend;
  if (req.method === 'POST' && path === '/api/auth/otp/verify') return RATE_LIMIT_POLICIES.otpVerify;
  if (req.method === 'POST' && path === '/api/activities') return RATE_LIMIT_POLICIES.activityUpload;
  if (req.method === 'POST' && path === '/api/missions/generate') return RATE_LIMIT_POLICIES.missionGenerate;
  if (req.method === 'POST' && path === '/api/missions/evaluate') return RATE_LIMIT_POLICIES.missionEvaluate;
  if (req.method === 'GET' && isPathBranch(path, '/api/weather')) return RATE_LIMIT_POLICIES.weather;
  if (req.method === 'GET' && isPathBranch(path, '/api/tiles')) return RATE_LIMIT_POLICIES.tiles;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return RATE_LIMIT_POLICIES.mutation;
  return null;
}

function bodySubject(...fields: string[]): SubjectResolver {
  return (req) => {
    const body = req.body as Record<string, unknown> | undefined;
    for (const field of fields) {
      const value = String(body?.[field] ?? '').trim().toLocaleLowerCase('hu-HU');
      if (value) return value;
    }
    return 'missing';
  };
}

const mode = parseRateLimitMode(process.env.RATE_LIMIT_MODE);
const secret = (process.env.RATE_LIMIT_HMAC_KEY ?? '').trim();
const store = new FirestoreRateLimitStore();
let lastWarningAt = 0;

function warn(event: string, details: Record<string, unknown>): void {
  const now = Date.now();
  if (now - lastWarningAt < MINUTE) return;
  console.warn('[GRUNDO security]', { event, mode, ...details });
  lastWarningAt = now;
}

export function createRateLimitMiddleware(
  selectedMode: RateLimitMode,
  selectedSecret: string,
  policyFor: PolicyResolver,
  subjectFor: SubjectResolver,
  selectedStore: RateLimitStore,
): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (selectedMode === 'off') return next();
    const policy = policyFor(req);
    if (!policy) return next();

    if (!selectedSecret) {
      warn('rate_limit_missing_secret', { policy: policy.name });
      return selectedMode === 'enforce'
        ? next(new HttpError(503, 'rate_limit_unavailable', 'A szolgáltatás átmenetileg nem elérhető.'))
        : next();
    }

    const subject = subjectFor(req);
    const key = rateLimitDocumentId(selectedSecret, policy.name, subject);
    try {
      const result = await selectedStore.consume(key, policy, Date.now());
      if (result.allowed) return next();
      warn('rate_limit_exceeded', { policy: policy.name });
      return selectedMode === 'enforce'
        ? next(tooManyRequests('Túl sok kérés. Várj egy kicsit, majd próbáld újra.', result.retryAfterSeconds))
        : next();
    } catch (error) {
      warn('rate_limit_store_error', {
        policy: policy.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return selectedMode === 'enforce'
        ? next(new HttpError(503, 'rate_limit_unavailable', 'A szolgáltatás átmenetileg nem elérhető.'))
        : next();
    }
  };
}

export const loginRateLimit = createRateLimitMiddleware(
  mode,
  secret,
  () => RATE_LIMIT_POLICIES.login,
  bodySubject('username'),
  store,
);

export const signInMethodRateLimit = createRateLimitMiddleware(
  mode,
  secret,
  () => RATE_LIMIT_POLICIES.signInMethod,
  bodySubject('identifier'),
  store,
);

export const authenticatedRateLimit = createRateLimitMiddleware(
  mode,
  secret,
  selectAuthenticatedPolicy,
  (req) => (req as Request & { uid?: string }).uid ?? 'missing',
  store,
);

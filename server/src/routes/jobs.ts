/**
 * Ütemezett feladatok hívási pontja.
 *
 * A Cloud Scheduler HTTP-n keresztül szólít meg minket. Ez a router
 * SZÁNDÉKOSAN nem a `authenticate` middleware mögött van: az ütemezőnek nincs
 * Firebase felhasználója, tehát nem tud ID-tokent hozni.
 *
 * Két út vezet be, és mindkettő kell:
 *   1. **megosztott titok** (`X-Job-Token`) — ezt használja az ütemező;
 *   2. **admin szerepkör** — hogy az admin felületről kézzel is indítható
 *      legyen, ha valami elakadt.
 *
 * ⚠️ Ha a `JOBS_TOKEN` nincs beállítva, a titok-út teljesen zárva marad. Nem
 * generálunk alapértelmezett jelszót és nem engedünk át hitelesítés nélkül:
 * egy hiányzó környezeti változó ne nyisson kaput a pontok osztogatására.
 *
 * docs/06-architektura-es-admin.md → `jobs` (Cloud Scheduler)
 */

import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { AuthedRequest } from '../../server';
import { auth as adminAuth } from '../lib/firebase';
import { badRequest, forbidden, unauthorized } from '../lib/errors';
import { runDailyRollover } from '../jobs/dailyRollover';

export const jobsRouter = Router();

const ADMIN_ROLES = new Set(['owner', 'admin']);

/** Időzítés-független összehasonlítás — a titok kitalálását ne segítsük. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function authorizeJob(req: AuthedRequest): Promise<void> {
  const expected = process.env.JOBS_TOKEN;
  const provided = req.header('X-Job-Token');
  if (expected && provided && secretMatches(provided, expected)) return;

  const header = req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw unauthorized('Ez a végpont ütemezett futtatásra való.');
  }
  const decoded = await adminAuth.verifyIdToken(header.slice(7)).catch(() => null);
  if (!decoded) throw unauthorized('Érvénytelen vagy lejárt azonosítás.');
  const role = typeof decoded.role === 'string' ? decoded.role : undefined;
  if (!role || !ADMIN_ROLES.has(role)) {
    throw forbidden('A jobok kézi indítása adminisztrátori jogosultságot igényel.');
  }
  req.uid = decoded.uid;
  req.role = role;
}

/**
 * POST /api/jobs/daily-rollover
 *
 * Óránként fut. Azokat a felhasználókat dolgozza fel, akiknél lejárt a helyi
 * éjfél. Idempotens: ugyanarra a napra kétszer futtatva nem oszt kétszer.
 */
jobsRouter.post('/daily-rollover', async (req: AuthedRequest, res, next) => {
  try {
    await authorizeJob(req);

    const limitRaw = req.body?.limit ?? req.query.limit;
    let limit: number | undefined;
    if (limitRaw !== undefined && limitRaw !== '') {
      limit = Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
        throw badRequest('invalid_limit', 'A limit 1 és 5000 közötti egész szám lehet.');
      }
    }

    const startedAt = Date.now();
    const summary = await runDailyRollover(new Date(), limit === undefined ? {} : { limit });
    res.json({ ...summary, durationMs: Date.now() - startedAt });
  } catch (error) {
    next(error);
  }
});

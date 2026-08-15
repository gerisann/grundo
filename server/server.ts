/**
 * GRUNDO backend — Cloud Run belépési pont.
 *
 * Ez a szolgáltatás az EGYETLEN hely, ahol játékadat íródik: terület, GP,
 * szint, jelvény, előfizetés, bizalmi pontszám. A kliens ezeket csak olvassa
 * (lásd firestore.rules).
 *
 * Futtatás fejlesztéshez:  npm run dev   (a server/ mappában)
 * Telepítés:               lásd server/README.md
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import { auth as adminAuth, db, FIRESTORE_DATABASE_ID } from './src/lib/firebase';
import { HttpError, unauthorized } from './src/lib/errors';

import { authRouter } from './src/routes/auth';
import { activitiesRouter } from './src/routes/activities';
import { tilesRouter } from './src/routes/tiles';
import { missionsRouter } from './src/routes/missions';

export { db, FIRESTORE_DATABASE_ID };

const app = express();
app.use(express.json({ limit: '10mb' })); // a nyomvonalak nagyok lehetnek

/* ── CORS ─────────────────────────────────────────────────────────────
   A kliens másik eredetről (grundo.ai.studio) hívja a Cloud Run URL-t,
   ezért a böngésző előbb OPTIONS kérést küld. Allowlist, nem `*` — a
   hitelesített kérésekhez amúgy sem működne a csillag.                */

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ?? 'https://grundo.ai.studio,http://localhost:5173'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.header('Origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '3600');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

/* ── Azonosítás ──────────────────────────────────────────────────── */

export interface AuthedRequest extends Request {
  uid?: string;
  role?: string;
}

async function authenticate(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return next(unauthorized('Hiányzó azonosítás.'));
  try {
    const decoded = await adminAuth.verifyIdToken(header.slice(7));
    req.uid = decoded.uid;
    req.role = decoded.role as string | undefined;
    next();
  } catch {
    next(unauthorized('Érvénytelen vagy lejárt azonosítás.'));
  }
}

/* ── Útvonalak ───────────────────────────────────────────────────── */

app.get('/healthz', (_req, res) =>
  res.json({ ok: true, database: FIRESTORE_DATABASE_ID }),
);

app.use('/api/auth', authenticate, authRouter);
app.use('/api/me', authenticate, authRouter); // GET /api/me
app.use('/api/activities', authenticate, activitiesRouter);
app.use('/api/tiles', authenticate, tilesRouter);
app.use('/api/missions', authenticate, missionsRouter);

/* ── Hibakezelés ─────────────────────────────────────────────────────
   A felhasználó mindig érthető magyar üzenetet kap; a részletek a
   szervernaplóba mennek.                                             */

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    const retryAfter = (err as HttpError & { retryAfter?: number }).retryAfter;
    if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
    return res.status(err.status).json({ code: err.code, message: err.message });
  }
  console.error('[GRUNDO]', err);
  res.status(500).json({
    code: 'internal',
    message: 'Váratlan hiba történt. Próbáld újra később.',
  });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`[GRUNDO] backend fut a ${port} porton — adatbázis: ${FIRESTORE_DATABASE_ID}`);
});

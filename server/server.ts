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
import { verifyAppCheck } from './src/lib/appCheck';
import {
  authenticatedRateLimit,
  loginRateLimit,
  signInMethodRateLimit,
} from './src/lib/rateLimit';

import {
  authRouter,
  loginHandler,
  meHandler,
  signInMethodHandler,
} from './src/routes/auth';
import { activitiesRouter } from './src/routes/activities';
import { tilesRouter } from './src/routes/tiles';
import { missionsRouter } from './src/routes/missions';
import { devRouter } from './src/routes/dev';
import { jobsRouter } from './src/routes/jobs';
import { adminRouter } from './src/routes/admin';
import { rulesRouter } from './src/routes/rules';
import { usersRouter } from './src/routes/users';
import { rivalsRouter } from './src/routes/rivals';
import { weatherRouter } from './src/routes/weather';

export { db, FIRESTORE_DATABASE_ID };

const app = express();
app.use(express.json({ limit: '10mb' })); // a nyomvonalak nagyok lehetnek

/* ── CORS ─────────────────────────────────────────────────────────────
   A kliens másik eredetről (grundo.ai.studio) hívja a Cloud Run URL-t,
   ezért a böngésző előbb OPTIONS kérést küld. Allowlist, nem `*` — a
   hitelesített kérésekhez amúgy sem működne a csillag.                */

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ??
    'https://grundo.ai.studio,http://localhost:5173,capacitor://localhost,https://localhost'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.header('Origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    /**
     * ⚠️ A `Content-Encoding` HIÁNYA UGYANÚGY „nincs kapcsolat a szerverrel"
     * HIBÁT AD, MINT A `PUT` HIÁNYA FENT (lásd az ottani megjegyzést,
     * 2026-08-19). Amikor a kliens gzip-tömörítve küldi a nagy aktivitás-
     * nyomvonalakat (`src/lib/api.ts` `compressedJsonBody`), a böngésző
     * ELŐKÉRÉST indít, mert a `Content-Encoding` egyedi fejléc — és ha ez
     * a lista nem engedi, a szerver a valódi kérést SOSEM látja. A tünet a
     * kliensen pontosan úgy néz ki, mintha a hálózat állna, pedig a szerver
     * válaszolt volna, csak a fejlécet utasította el.
     */
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, Content-Encoding, X-Firebase-AppCheck',
    );
    /**
     * A PUT hiánya egyszer már megfogott (2026-08-19): az admin
     * konfiguráció-mentése `PUT`-tal megy, és a böngésző már az előkérésnél
     * elutasította. A felületen ez „Nincs kapcsolat a szerverrel" alakban
     * jelent meg, ami a hálózatra mutatott — pedig a szerver válaszolt, csak
     * nem engedte a metódust. Új metódust ide is fel kell venni.
     */
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '3600');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

/* ── Azonosítás ──────────────────────────────────────────────────── */

export interface AuthedRequest extends Request {
  uid?: string;
  role?: string;
  appCheckAppId?: string;
  appCheckValid?: boolean;
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

/**
 * Életjel.
 *
 * KÉT útvonalon is elérhető, és ennek oka van: a Google Cloud Run frontendje
 * a `/healthz` pontos útvonalat elfogja, mielőtt a konténerhez érne (saját
 * 404-es HTML-t ad rá). A `/healthz/` — záró perjellel — átjut, de erre
 * építeni törékeny. Az `/api/health` a megbízható változat; monitorozáshoz
 * és Cloud Run uptime-ellenőrzéshez ezt használd.
 */
const health = (_req: Request, res: Response) =>
  res.json({ ok: true, database: FIRESTORE_DATABASE_ID });

app.get('/api/health', health);
app.get('/healthz', health);

// The scheduler-only `/api/jobs` branch is exempt inside the middleware. All
// browser and packaged-app endpoints share the same observe/enforce rollout.
app.use('/api', verifyAppCheck);

// Egy szintű útvonal: közvetlenül, nem routeren keresztül. (Lásd a
// `meHandler` fölötti magyarázatot: a `app.use('/api/me', authRouter)`
// alakban ez a végpont némán nem illeszkedett.)
app.get('/api/me', authenticate, authenticatedRateLimit, meHandler);

/**
 * NYILVÁNOS végpont — szándékosan `authenticate` NÉLKÜL.
 *
 * Belépés előtt nincs mit hitelesíteni: ez a kérés épp azért jön, hogy a
 * felhasználó tokenhez jusson. A sorrend számít — ennek az `/api/auth` mount
 * ELŐTT kell állnia, különben a hitelesítés elnyelné, és a felhasználó soha
 * nem tudna belépni a felhasználónevével.
 */
app.post('/api/auth/login', loginRateLimit, loginHandler);

/**
 * Szintén NYILVÁNOS: aki még nem tud belépni, annak nincs tokenje.
 *
 * Ez mondja meg, hogy egy fiókba csak Google-lel lehet-e belépni. A kliens
 * kizárólag SIKERTELEN belépés után hívja, tehát nem lesz belőle szabadon
 * pörgethető névellenőrző.
 */
app.post('/api/auth/method', signInMethodRateLimit, signInMethodHandler);

/**
 * NYILVÁNOS: a szabálymagyarázó felület adatforrása. Nincs benne
 * felhasználói adat, csak a hatályos játékkonstansok és az aktív akciók —
 * lásd `src/routes/rules.ts`.
 */
app.use('/api/rules', rulesRouter);

app.use('/api/auth', authenticate, authenticatedRateLimit, authRouter);
app.use('/api/activities', authenticate, authenticatedRateLimit, activitiesRouter);
app.use('/api/users', authenticate, authenticatedRateLimit, usersRouter);
app.use('/api/rivals', authenticate, authenticatedRateLimit, rivalsRouter);
/**
 * Hitelesítés MÖGÖTT, pedig az időjárás nem személyes adat.
 *
 * A külső hívás pénzbe kerül és kvótás. Nyitva hagyva a végpont ingyenes
 * időjárás-proxy lenne bárkinek, a mi számlánkra.
 */
app.use('/api/weather', authenticate, authenticatedRateLimit, weatherRouter);
app.use('/api/tiles', authenticate, authenticatedRateLimit, tilesRouter);
app.use('/api/missions', authenticate, authenticatedRateLimit, missionsRouter);
app.use('/api/dev', authenticate, authenticatedRateLimit, devRouter);
app.use('/api/admin', authenticate, authenticatedRateLimit, adminRouter);

/**
 * SZÁNDÉKOSAN `authenticate` NÉLKÜL — a router maga engedélyez.
 *
 * A Cloud Scheduler nem Firebase felhasználó, tehát nincs ID-tokenje. A
 * `jobsRouter` megosztott titkot vagy admin szerepkört vár; ha egyik sincs,
 * 401/403 a válasz.
 */
app.use('/api/jobs', jobsRouter);

/* ── Ismeretlen API-útvonal ──────────────────────────────────────────
   Enélkül az Express beépített 404-ese válaszol, ami HTML-t ad. A kliens
   minden válaszról JSON-t feltételez, ezért egy elgépelt vagy rosszul
   bekötött útvonalból „a szerver nem JSON-t adott vissza" lesz — olyan
   hibaüzenet, ami a VITE_API_BASE_URL-re mutat, pedig a baj a szerveren
   van. Ez a fogó a valódi okot mondja meg.                            */

app.use('/api', (req: Request, res: Response) => {
  res.status(404).json({
    code: 'unknown_endpoint',
    message: `Ismeretlen végpont: ${req.method} ${req.originalUrl}`,
  });
});

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

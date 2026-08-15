/**
 * GRUNDO backend — Cloud Run belépési pont.
 *
 * Ez a szolgáltatás az EGYETLEN hely, ahol játékadat íródik: terület, GP,
 * szint, jelvény, előfizetés, bizalmi pontszám. A kliens ezeket csak olvassa
 * (lásd firestore.rules).
 *
 * Futtatás fejlesztéshez:  npm run dev  (a server/ mappában)
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

import { activitiesRouter } from './src/routes/activities';
import { tilesRouter } from './src/routes/tiles';
import { missionsRouter } from './src/routes/missions';

const adminApp = initializeApp({ credential: applicationDefault() });

/**
 * Dedikált Firestore adatbázis. A `getFirestore(app)` a `(default)`
 * adatbázist adná vissza — a GRUNDO adatai a `groundo-db` adatbázisban vannak.
 * Mindig ezt a `db` példányt használd, sose hívj `getFirestore()`-t máshol.
 */
export const FIRESTORE_DATABASE_ID = 'groundo-db';
export const db = getFirestore(adminApp, FIRESTORE_DATABASE_ID);

const app = express();
app.use(express.json({ limit: '10mb' })); // a nyomvonalak nagyok lehetnek

/** Kérésenkénti azonosítás. A token nélküli kérés nem jut tovább. */
export interface AuthedRequest extends Request {
  uid?: string;
  role?: string;
}

async function authenticate(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Hiányzó azonosítás.' });
  }
  try {
    const decoded = await getAuth().verifyIdToken(header.slice(7));
    req.uid = decoded.uid;
    req.role = decoded.role as string | undefined;
    next();
  } catch {
    res.status(401).json({ message: 'Érvénytelen vagy lejárt azonosítás.' });
  }
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use('/api/activities', authenticate, activitiesRouter);
app.use('/api/tiles', authenticate, tilesRouter);
app.use('/api/missions', authenticate, missionsRouter);

// Egységes hibakezelés: a felhasználó mindig érthető magyar üzenetet kap,
// a részletek a szervernaplóba mennek.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[GRUNDO]', err);
  res.status(500).json({ message: 'Váratlan hiba történt. Próbáld újra később.' });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => console.log(`[GRUNDO] backend fut a ${port} porton`));

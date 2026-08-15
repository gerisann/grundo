import { Router, type RequestHandler, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, auth as adminAuth, db } from '../lib/firebase';
import {
  HttpError,
  badRequest,
  conflict,
  notFound,
  tooManyRequests,
  unauthorized,
} from '../lib/errors';
import { createMailer, otpEmail } from '../lib/mailer';
import { canResend, createOtp, verifyOtp, type OtpRecord } from '../lib/otp';
import { displayUsername, newUserDoc, normalizeUsername, validateUsername } from '../lib/user';
import type { AuthedRequest } from '../../server';

export const authRouter = Router();
const mailer = createMailer();

/* ═══════════════════════════════════════════════════════════════════
   GET /api/me — a bejelentkezett felhasználó profilja
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Külön exportált kezelő, NEM a routeren keresztül bekötve.
 *
 * Ennek oka egy már megtörtént hiba: a `server.ts` korábban
 * `app.use('/api/me', authRouter)`-rel próbálta kiszolgálni ezt a végpontot.
 * Az Express a mount-előtagot levágja, tehát a routerbe `/` érkezett, ami a
 * `/me` mintára nem illeszkedik — a kérés kiesett az Express alapértelmezett,
 * HTML-t adó 404-esébe. A kliens így nem `profile_missing`-et látott, hanem
 * „nem JSON" hibát, és a felhasználó profil nélkül esett be az appba.
 *
 * Egy szintű útvonalat közvetlenül kötünk be — nincs mit elrontani rajta.
 */
export const meHandler: RequestHandler = async (req: AuthedRequest, res: Response, next) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.users).doc(req.uid!).get();
    if (!snapshot.exists) {
      // Nem hiba: Firebase-fiók már van, GRUNDO-profil még nincs. A kliens
      // ilyenkor a felhasználónév-választó képernyőre visz.
      throw notFound('profile_missing', 'Még nincs GRUNDO-profilod.');
    }
    res.json({ profile: { uid: req.uid, ...snapshot.data() } });
  } catch (error) {
    next(error);
  }
};

// Másodlagos cím, hogy a kliens régebbi verziói se törjenek el: /api/auth/me
authRouter.get('/me', meHandler);

/* ═══════════════════════════════════════════════════════════════════
   POST /api/auth/login — belépés FELHASZNÁLÓNÉVVEL
   ═══════════════════════════════════════════════════════════════════ */

const SIGN_IN_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';

/**
 * Miért kell ehhez egyáltalán szerver?
 *
 * A Firebase kliensoldali belépése csak e-mail-címet ismer, felhasználónevet
 * nem. A kézenfekvő megoldás — a kliens megkérdezi a szervertől, milyen e-mail
 * tartozik a névhez, majd azzal lép be — **nem járható**: azzal bárki
 * tetszőleges felhasználónévhez megkaphatná a hozzá tartozó e-mail-címet, és
 * pillanatok alatt learathatná az egész tagság címlistáját.
 *
 * Ezért a jelszó-ellenőrzés is itt történik: a szerver oldja fel a nevet
 * e-mailre, a jelszót a Google saját végpontján ellenőrizteti, és sikeres
 * belépés esetén custom tokent ad vissza. Az e-mail-cím soha nem hagyja el a
 * szervert.
 *
 * Az ára: a jelszó áthalad a mi backendünkön. Ezért SOHA nem naplózzuk a kérés
 * törzsét, és a jelszót sehol nem tároljuk — csak továbbadjuk a Google-nak.
 * (E-mail-címmel belépéskor a kliens közvetlenül a Firebase-t hívja, ott ez a
 * kitérő fel sem merül.)
 */
export const loginHandler: RequestHandler = async (req, res, next) => {
  try {
    const body = req.body as { username?: unknown; password?: unknown };
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');

    if (!username || !password) {
      throw badRequest('missing_credentials', 'Add meg a felhasználóneved és a jelszavad.');
    }

    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    if (!apiKey) {
      // Beállítási hiba, nem a felhasználó hibája — mondjuk meg neki, mit tehet.
      console.error('[GRUNDO] FIREBASE_WEB_API_KEY nincs beállítva — a névvel belépés nem megy.');
      throw new HttpError(
        503,
        'login_unavailable',
        'A felhasználónévvel belépés most nem elérhető. Lépj be az e-mail-címeddel.',
      );
    }

    const email = await emailForUsername(username);
    if (!email) throw invalidCredentials();

    const response = await fetch(`${SIGN_IN_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    });
    const data = (await response.json().catch(() => null)) as {
      localId?: string;
      error?: { message?: string };
    } | null;

    if (!response.ok) {
      const reason = data?.error?.message ?? '';
      if (reason.startsWith('TOO_MANY_ATTEMPTS')) {
        throw tooManyRequests(
          'Túl sok próbálkozás. Várj pár percet, vagy állítsd vissza a jelszavad.',
          300,
        );
      }
      if (reason === 'USER_DISABLED') {
        throw new HttpError(
          403,
          'user_disabled',
          'Ez a fiók fel van függesztve. Írj nekünk, ha szerinted tévedés.',
        );
      }
      throw invalidCredentials();
    }

    if (!data?.localId) throw invalidCredentials();

    // A kliens ezzel lép be: signInWithCustomToken. Így a Firebase SDK kezeli a
    // munkamenetet és a token frissítését — nem nekünk kell megoldani.
    res.json({ customToken: await adminAuth.createCustomToken(data.localId) });
  } catch (error) {
    next(error);
  }
};

/**
 * EGYSÉGES hibaüzenet, szándékosan.
 *
 * Nem áruljuk el, hogy a felhasználónév létezik-e: különben a belépőképernyő
 * névellenőrzővé válna, amivel fel lehet térképezni, ki tagja az appnak.
 */
const invalidCredentials = () => unauthorized('Hibás felhasználónév vagy jelszó.');

async function emailForUsername(raw: string): Promise<string | null> {
  const snapshot = await db.collection(COLLECTIONS.usernames).doc(normalizeUsername(raw)).get();
  const uid = snapshot.exists ? (snapshot.data() as { uid?: string }).uid : null;
  if (!uid) return null;
  const record = await adminAuth.getUser(uid).catch(() => null);
  return record?.email ?? null;
}

/* ═══════════════════════════════════════════════════════════════════
   POST /api/auth/register — felhasználónév lefoglalása + profil
   ═══════════════════════════════════════════════════════════════════ */

authRouter.post('/register', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const raw = String((req.body as { username?: unknown }).username ?? '');
    const problem = validateUsername(raw);
    if (problem) throw badRequest('invalid_username', problem);

    // A megjelenítési alak a beírt név; a foglalás a kisbetűs kulcson megy.
    const username = displayUsername(raw);
    const usernameLower = normalizeUsername(raw);
    const userRef = db.collection(COLLECTIONS.users).doc(uid);
    const nameRef = db.collection(COLLECTIONS.usernames).doc(usernameLower);
    const now = new Date();

    /**
     * A név lefoglalása és a profil létrehozása EGY tranzakcióban.
     *
     * Enélkül két egyszerre regisztráló felhasználó ugyanazt a nevet kaphatná
     * meg — és ez utólag sokkal fájdalmasabb, mint most megelőzni.
     */
    const profile = await db.runTransaction(async (tx) => {
      const [userSnap, nameSnap] = await Promise.all([tx.get(userRef), tx.get(nameRef)]);

      if (userSnap.exists) {
        const existing = userSnap.data() as { usernameLower?: string };
        // Idempotens: ugyanazzal a névvel újrahívva nem hiba. Az összevetés a
        // kisbetűs kulcson megy, különben a „Geri" és a „geri" két különböző
        // névnek látszana, és a második hívás hamis ütközést jelentene.
        if (existing.usernameLower === usernameLower) return existing;
        throw conflict('profile_exists', 'Ehhez a fiókhoz már tartozik profil.');
      }

      if (nameSnap.exists && (nameSnap.data() as { uid?: string }).uid !== uid) {
        throw conflict('username_taken', 'Ez a felhasználónév már foglalt.');
      }

      const record = await adminAuth.getUser(uid);
      const doc = newUserDoc(
        {
          uid,
          username,
          email: record.email ?? '',
          // A `displayName` SZÁNDÉKOSAN nincs átadva: a Google-fiók valódi
          // nevét nem vesszük át. A megjelenített név a felhasználónév lesz,
          // amit a felhasználó később a beállításokban felülírhat.
          photoURL: record.photoURL ?? undefined,
        },
        now,
      );

      // A megjelenítési alakot a foglalási dokumentum is megkapja, hogy a
      // névfeloldásnál (belépés felhasználónévvel) ne kelljen a profilt is
      // beolvasni csak azért, hogy megtudjuk, hogyan írjuk ki a nevet.
      tx.set(nameRef, { uid, username, createdAt: now });
      tx.set(userRef, doc);
      return doc;
    });

    res.status(201).json({ profile: { uid, ...profile } });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   POST /api/auth/otp/send
   ═══════════════════════════════════════════════════════════════════ */

authRouter.post('/otp/send', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const record = await adminAuth.getUser(uid);
    const email = record.email;
    if (!email) throw badRequest('no_email', 'Ehhez a fiókhoz nem tartozik e-mail-cím.');
    if (record.emailVerified) {
      return res.json({ alreadyVerified: true, waitSeconds: 0 });
    }

    const otpRef = db.collection(COLLECTIONS.otpCodes).doc(uid);
    const existing = await otpRef.get();
    const current = existing.exists ? (existing.data() as OtpRecord) : null;
    const now = Date.now();

    const check = canResend(current, now);
    if (!check.allowed) {
      throw tooManyRequests(
        `Várj még ${check.waitSeconds} másodpercet az újraküldésig.`,
        check.waitSeconds,
      );
    }

    const { code, record: next } = createOtp(email, now);
    await otpRef.set(next);
    await mailer.send({ to: email, ...otpEmail(code) });

    res.json({
      sent: true,
      waitSeconds: 60,
      // Fejlesztői módban visszaadjuk a kódot, hogy e-mail-szolgáltató nélkül
      // is végig lehessen menni a folyamaton. Élesben SOHA.
      ...(mailer.name === 'console' ? { devCode: code } : {}),
    });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   POST /api/auth/otp/verify
   ═══════════════════════════════════════════════════════════════════ */

authRouter.post('/otp/verify', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const input = String((req.body as { code?: unknown }).code ?? '');
    const otpRef = db.collection(COLLECTIONS.otpCodes).doc(uid);
    const snapshot = await otpRef.get();
    const current = snapshot.exists ? (snapshot.data() as OtpRecord) : null;

    const result = verifyOtp(input, current, Date.now());

    if (result.verdict === 'ok') {
      await Promise.all([
        adminAuth.updateUser(uid, { emailVerified: true }),
        db.collection(COLLECTIONS.users).doc(uid).set(
          { emailVerified: true, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        ),
        otpRef.delete(),
      ]);
      return res.json({ verified: true });
    }

    if (result.record) await otpRef.set(result.record);

    const messages: Record<string, string> = {
      wrong: `Hibás kód. Még ${result.attemptsLeft ?? 0} próbálkozásod van.`,
      expired: 'A kód lejárt. Kérj újat.',
      locked: 'Túl sok hibás próbálkozás. Próbáld újra 15 perc múlva.',
      missing: 'Nincs érvényes kód. Kérj újat.',
    };

    throw badRequest(result.verdict, messages[result.verdict] ?? 'A kód nem érvényes.');
  } catch (error) {
    next(error);
  }
});

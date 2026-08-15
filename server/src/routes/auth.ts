import { Router, type RequestHandler, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, auth as adminAuth, db } from '../lib/firebase';
import { badRequest, conflict, notFound, tooManyRequests } from '../lib/errors';
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

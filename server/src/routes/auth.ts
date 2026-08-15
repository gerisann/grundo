import { Router, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, auth as adminAuth, db } from '../lib/firebase';
import { badRequest, conflict, notFound, tooManyRequests } from '../lib/errors';
import { createMailer, otpEmail } from '../lib/mailer';
import { canResend, createOtp, verifyOtp, type OtpRecord } from '../lib/otp';
import { newUserDoc, normalizeUsername, validateUsername } from '../lib/user';
import type { AuthedRequest } from '../../server';

export const authRouter = Router();
const mailer = createMailer();

/* ═══════════════════════════════════════════════════════════════════
   GET /api/me — a bejelentkezett felhasználó profilja
   ═══════════════════════════════════════════════════════════════════ */

authRouter.get('/me', async (req: AuthedRequest, res: Response, next) => {
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
});

/* ═══════════════════════════════════════════════════════════════════
   POST /api/auth/register — felhasználónév lefoglalása + profil
   ═══════════════════════════════════════════════════════════════════ */

authRouter.post('/register', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const raw = String((req.body as { username?: unknown }).username ?? '');
    const problem = validateUsername(raw);
    if (problem) throw badRequest('invalid_username', problem);

    const username = normalizeUsername(raw);
    const userRef = db.collection(COLLECTIONS.users).doc(uid);
    const nameRef = db.collection(COLLECTIONS.usernames).doc(username);
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
        const existing = userSnap.data() as { username?: string };
        // Idempotens: ugyanazzal a névvel újrahívva nem hiba.
        if (existing.username === username) return existing;
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
          displayName: record.displayName ?? username,
          photoURL: record.photoURL ?? undefined,
        },
        now,
      );

      tx.set(nameRef, { uid, createdAt: now });
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

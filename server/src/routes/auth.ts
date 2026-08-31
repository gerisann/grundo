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
import {
  adminNotifyAddress,
  createMailer,
  newAccountEmail,
  otpEmail,
} from '../lib/mailer';
import { canResend, createOtp, verifyOtp, type OtpRecord } from '../lib/otp';
import { toEarnedBadges } from '../lib/badges';
import { displayUsername, newUserDoc, normalizeUsername, validateUsername } from '../lib/user';
import type { AuthedRequest } from '../../server';
import {
  buildPublicRoutePatch,
  normalizePrivacy,
  validRadius,
  type StoredPrivacy,
} from '../lib/publicRoute';

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
    const userRef = db.collection(COLLECTIONS.users).doc(req.uid!);
    const [snapshot, badgesSnapshot] = await Promise.all([userRef.get(), userRef.collection('badges').get()]);
    if (!snapshot.exists) {
      // Nem hiba: Firebase-fiók már van, GRUNDO-profil még nincs. A kliens
      // ilyenkor a felhasználónév-választó képernyőre visz.
      throw notFound('profile_missing', 'Még nincs GRUNDO-profilod.');
    }
    const data = snapshot.data() as Record<string, unknown>;
    res.json({
      profile: {
        uid: req.uid,
        ...data,
        privacy: { ...((data.privacy ?? {}) as object), ...normalizePrivacy(data.privacy) },
        badges: toEarnedBadges(badgesSnapshot),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Másodlagos cím, hogy a kliens régebbi verziói se törjenek el: /api/auth/me
authRouter.get('/me', meHandler);

/** PATCH /api/auth/privacy — az aktivitás két végének elrejtése. */
authRouter.patch('/privacy', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const body = req.body as Record<string, unknown>;
    if (typeof body.hideStart !== 'boolean' || typeof body.hideEnd !== 'boolean') {
      throw badRequest('invalid_privacy', 'Mindkét privátzóna állapotát meg kell adni.');
    }
    if (!validRadius(body.startRadiusM) || !validRadius(body.endRadiusM)) {
      throw badRequest('invalid_privacy_radius', 'A védőkör 50, 100 vagy 200 méter lehet.');
    }

    const userRef = db.collection(COLLECTIONS.users).doc(uid);
    const user = await userRef.get();
    if (!user.exists) throw notFound('profile_missing', 'Még nincs GRUNDO-profilod.');
    const stored = user.data() as { privacy?: Record<string, unknown> };
    const current = normalizePrivacy(stored.privacy);
    const nextPrivacy: StoredPrivacy = {
      hideStart: body.hideStart,
      startRadiusM: body.startRadiusM,
      hideEnd: body.hideEnd,
      endRadiusM: body.endRadiusM,
      routeRevision: current.routeRevision + 1,
    };

    const activities = await db.collection(COLLECTIONS.activities).where('userId', '==', uid).get();
    const active = activities.docs.filter((doc) => doc.data().deletedAt == null);

    // Előbb eltakarjuk a régi publikus route-okat. Szigorításkor így egy
    // részleges hiba sem hagyhatja kint a korábbi, kevésbé védett változatot.
    for (let start = 0; start < active.length; start += 400) {
      const batch = db.batch();
      for (const doc of active.slice(start, start + 400)) {
        batch.set(doc.ref, {
          route: '',
          routeHidden: true,
          bounds: null,
          routePending: true,
          routePrivacyRevision: nextPrivacy.routeRevision,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();
    }

    const privacyZoneSetAt = stored.privacy?.privacyZoneSetAt ?? FieldValue.serverTimestamp();
    await userRef.set({
      privacy: {
        ...(stored.privacy ?? {}),
        ...nextPrivacy,
        privacyZoneSetAt,
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Visszamenőleg minden aktivitást az új beállítással vágunk. A kis
    // csoportok korlátozzák a memória- és Firestore-terhelést.
    for (let start = 0; start < active.length; start += 12) {
      const group = active.slice(start, start + 12);
      const patches = await Promise.all(
        group.map((doc) => buildPublicRoutePatch(doc.ref, uid, nextPrivacy)),
      );
      const batch = db.batch();
      group.forEach((doc, index) => batch.set(doc.ref, patches[index]!, { merge: true }));
      await batch.commit();
    }

    res.json({ privacy: nextPrivacy, rebuiltActivities: active.length });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/auth/profile — jelenleg a profilkép biztonságos hivatkozása. */
authRouter.patch('/profile', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const raw = (req.body as { photoURL?: unknown }).photoURL;
    const photoURL = raw == null || raw === '' ? null : String(raw);
    if (photoURL && !isOwnAvatarUrl(photoURL, uid)) {
      throw badRequest('invalid_avatar_url', 'A profilkép nem a saját feltöltésedre mutat.');
    }
    const ref = db.collection(COLLECTIONS.users).doc(uid);
    const user = await ref.get();
    if (!user.exists) throw notFound('profile_missing', 'Még nincs GRUNDO-profilod.');
    await ref.set({ photoURL, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ photoURL });
  } catch (error) {
    next(error);
  }
});

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

    const record = await recordForUsername(username);
    /**
     * A GOOGLE-FIÓKOS FELHASZNÁLÓNAK MEGMONDJUK, MI A TEENDŐ.
     *
     * Enélkül csak annyit kapott, hogy „hibás felhasználónév vagy jelszó" —
     * és mivel jelszava sosem volt, ezt a falat nem tudta megkerülni. Az
     * egységes hibaüzenet a NEM LÉTEZŐ fiókot védi; egy létező fiók belépési
     * módját elárulni ennél kisebb ár, mint hogy a felhasználó kizárja magát.
     */
    if (isGoogleOnly(record)) throw useGoogleError();

    const email = record?.email ?? null;
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

/**
 * POST /api/auth/method — Google-fiókos ez az azonosító?
 *
 * MIÉRT KELL KÜLÖN VÉGPONT? Mert e-mail-lel a kliens KÖZVETLENÜL a Firebase-hez
 * fordul, és onnan csak annyit kap, hogy „hibás adat". Azt, hogy a fiókhoz
 * egyáltalán nem tartozik jelszó, csak az Admin SDK tudja megmondani.
 *
 * ⚠️ A KLIENS EZT CSAK SIKERTELEN BELÉPÉS UTÁN HÍVJA. Így nem lesz belőle
 * szabadon pörgethető névellenőrző: aki idáig eljut, az már megadott egy
 * azonosítót és egy jelszót.
 *
 * A válasz SZÁNDÉKOSAN egyetlen logikai érték. Nem mondjuk meg, hogy létezik-e
 * a fiók, csak azt, hogy „ezzel Google-lel kell belépni" — a nem létező és a
 * jelszavas fiók egyformán `false`-t kap.
 *
 * ⚠️ NYILVÁNOS VÉGPONT, hitelesítés nélkül — ahogy a `loginHandler` is. Aki
 * még nem tud belépni, annak épp ezért nincs tokenje. A `server.ts`-ben az
 * `/api/auth` hitelesített mountja ELŐTT kell felfűzni, különben elérhetetlen.
 */
export const signInMethodHandler: RequestHandler = async (req, res, next) => {
  try {
    const identifier = String((req.body as { identifier?: unknown }).identifier ?? '').trim();
    if (!identifier || identifier.length > 320) {
      return res.json({ googleOnly: false });
    }

    const record = identifier.includes('@')
      ? await adminAuth.getUserByEmail(identifier).catch(() => null)
      : await recordForUsername(identifier);

    res.json({ googleOnly: isGoogleOnly(record) });
  } catch (error) {
    next(error);
  }
};

async function recordForUsername(raw: string) {
  const snapshot = await db.collection(COLLECTIONS.usernames).doc(normalizeUsername(raw)).get();
  const uid = snapshot.exists ? (snapshot.data() as { uid?: string }).uid : null;
  if (!uid) return null;
  return adminAuth.getUser(uid).catch(() => null);
}

/**
 * Csak Google-lel lehet belépni ebbe a fiókba?
 *
 * Akkor igaz, ha van Google-szolgáltatója, de jelszava NINCS. Az ilyen
 * felhasználó hiába írja be az e-mail-címét és bármilyen jelszót — a Firebase
 * „hibás adat"-ot mond, mert jelszó egyszerűen nem tartozik a fiókhoz.
 */
function isGoogleOnly(record: { providerData: { providerId: string }[] } | null): boolean {
  if (!record) return false;
  const providers = record.providerData.map((p) => p.providerId);
  return providers.includes('google.com') && !providers.includes('password');
}

/** A Google-fiókosnak szóló üzenet — egy helyen, hogy a két út ugyanazt mondja. */
const useGoogleError = () =>
  new HttpError(
    409,
    'use_google',
    'Ezt a fiókot Google-fiókkal hoztad létre. Lépj be a „Belépés Google-fiókkal" gombbal.',
  );

function isOwnAvatarUrl(raw: string, uid: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com') return false;
    return decodeURIComponent(url.pathname).includes(`/o/avatars/${uid}/`);
  } catch {
    return false;
  }
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

    /**
     * Belső értesítő az új fiókról — A VÁLASZ UTÁN, tűzz-és-felejtsd módon.
     *
     * ⚠️ EGY LEVELEZÉSI HIBA SOHA NEM BUKTATHATJA EL A REGISZTRÁCIÓT. A
     * felhasználó szempontjából a fiók már létrejött; ha az SMTP-szolgáltató
     * éppen nem elérhető, az a mi üzemeltetési gondunk, nem az övé. Ezért van
     * a `res.json` UTÁN, és ezért nyeli el a hibát a naplóba.
     *
     * A `next(error)` sem hívható már itt: a válasz elment, a fejlécek
     * kimentek — egy második `res` hívás futásidejű hibát dobna.
     */
    void (async () => {
      try {
        const record = await adminAuth.getUser(uid);
        await mailer.send({
          to: adminNotifyAddress(),
          ...newAccountEmail({
            uid,
            username,
            email: record.email ?? '',
            providers: record.providerData.map((p) => p.providerId),
            emailVerified: record.emailVerified,
            hasPhoto: Boolean(record.photoURL),
            timezone: (profile as { timezone?: string }).timezone ?? 'Europe/Budapest',
            createdAt: new Date(),
          }),
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[GRUNDO] Az új fiókról szóló értesítő nem ment ki:', error);
      }
    })();
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
    const now = Date.now();
    const { code } = await db.runTransaction(async (tx) => {
      const existing = await tx.get(otpRef);
      const current = existing.exists ? (existing.data() as OtpRecord) : null;
      const check = canResend(current, now);
      if (!check.allowed) {
        throw tooManyRequests(
          `Várj még ${check.waitSeconds} másodpercet az újraküldésig.`,
          check.waitSeconds,
        );
      }

      const created = createOtp(email, now);
      tx.set(otpRef, created.record);
      return { code: created.code };
    });
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
    const result = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(otpRef);
      const current = snapshot.exists ? (snapshot.data() as OtpRecord) : null;
      const verdict = verifyOtp(input, current, Date.now());
      if (verdict.verdict === 'ok') tx.delete(otpRef);
      else if (verdict.record) tx.set(otpRef, verdict.record);
      return verdict;
    });

    if (result.verdict === 'ok') {
      await Promise.all([
        adminAuth.updateUser(uid, { emailVerified: true }),
        db.collection(COLLECTIONS.users).doc(uid).set(
          { emailVerified: true, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        ),
      ]);
      return res.json({ verified: true });
    }

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

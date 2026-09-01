# GRUNDO handoff

> Frissítve: **2026-09-01** · a **#22** beszélgetés vége, átadás **#23**-ra
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`**. A menet induló HEAD-je **`61153e6`** volt (ez volt élesben
> is); jelenlegi HEAD **`c3adb57`**, pusholva.

## ÁLLAPOT

A menet két különálló dolgot vitt: (1) a Codex #25/#26 App Check + rate limit
csomagjának validálása a kódon, (2) egy SOS UI-hiba javítása és élesítése a
rivális-sávon. Az App Check csomag **továbbra sincs telepítve** — ehhez a
menethez nem tartozott Cloud Console-lépés.

### 1. Az App Check/rate limit csomag validálása (nem kódváltozás)

A `d8de34f` commit (App Check, rate limit, OTP-tranzakció) tételes átnézése a
kódban, nem csak a HANDOFF-leírás alapján:

- **Igazolva, pontos:** App Check middleware wiring (`server.ts:121`,
  `/api/jobs` kivételezve), rate limit minden routeren egységesen
  (`server.ts:154-168`), OTP küldés+ellenőrzés valóban Firestore-tranzakcióban
  fut (`auth.ts:463`, `auth.ts:501`), a 12 App Check/rate limit teszt valóban
  létezik. A korábbi, `2ff40b4`/`605736f`/`f80dd37` alatt javított két kritikus
  adatvédelmi hiba (users-doc szétválasztás, aktivitásfotók Storage-
  láthatósága) élesben tényleg megvan.
- **Megerősítve NYITOTT (nem ennek a menetnek a hibája — a #26 eleve nem is
  ígérte):** a korábbi teljes audit HIBA-3 (admin gameplay-config/modifierek
  nem jutnak el a feldolgozásba) és HIBA-4 (Trust Score observe-only) **egy és
  ugyanaz a gyökérok**. Van egy kész, jól működő futásidejű config-feloldó
  (`server/src/lib/gameplayConfig.ts` → `getGameplaySnapshot()`, 60 mp cache,
  hibatűrő), és a játékmotor (`src/game/*`) **már paraméterként fogadja** a
  configot mindenhol (`cfg: GameplayConfig = DEFAULT_GAMEPLAY` minta,
  következetesen). A hiányzó láncszem: `server/src/lib/activityCommit.ts`,
  `activityChunked.ts` és `server/src/trust/score.ts` **sosem hívják meg**
  `getGameplaySnapshot()`-ot, hanem a statikus `GAMEPLAY`-t importálják
  közvetlenül (16 hívási hely összesen), és a `processActivity()`,
  `resolveClaim()`, `mergeClaims()`, `resolveCompactGroup()`,
  `computeActivityGp()`, `computeTrustScore()` hívásoknál nem adják át a
  `cfg`-t. Emiatt az admin `TRUST_OBSERVE_ONLY`-t vagy bármelyik GP-modifiert
  akárhogy állítja, a tényleges feldolgozás nem veszi figyelembe.
  **Javítás terve:** `commitActivity`/`commitChunkedActivity` hívási pontján
  (`server/src/routes/activities.ts:173`, `planActivity()` hívás előtt) egy
  `getGameplaySnapshot()` hívás, a kapott configot betenni az `ActivityPlan`-be
  (`activityCommit.ts` `ActivityPlan` interfész), és onnan mindenhol
  `plan.cfg`-t átadni a fenti hívásoknak a statikus `GAMEPLAY` helyett.
  `computeTrustScore`-nak is kell egy `cfg` paraméter (jelenleg
  `@/config/gameplay`-ből importál közvetlenül `MAX_SPEED_KMH`-t és a
  `TRUST_THRESHOLD_*`-ot, a `verdictFor()` már fogad override paramétert, csak
  senki nem hívja azzal). **Ez félbemaradt vizsgálat — kódváltozás NEM történt,
  csak feltérképezés.** Jó jelölt a #23-ra.
- **Szintén megerősítve NYITOTT:** `server/src/lib/mailer.ts:122-129` — ha
  `MAIL_PROVIDER=smtp`, de hiányzik `SMTP_HOST`, a szerver csendben
  visszaesik `consoleMailer`-re ahelyett, hogy fail-closed módon hibázna.
  Éles hibás konfignál a felhasználó sosem kapná meg az OTP-kódot, mégis
  „elküldve" választ látna. Kis, önálló javítás — nem függ a fenti
  gameplay-config munkától.

### 2. SOS hiba: a rivális-sáv összeugrott a home feeden

A `src/components/RivalRow.tsx` a `conn__row` osztályra épített
(`display:flex; width:100%`), de sosem importálta a `connectionsSheet.css`-t,
amiben az osztály van. Route-szintű kódszétvágásnál ez csak akkor töltődött
be, ha más komponens (pl. a profil `RivalsCard`-ja) már behúzta ugyanazt a
fájlt — ezért működött `/profil`-on, és esett szélesség nélkül pár pixelre a
home feeden. Javítás: egy hiányzó `import './connectionsSheet.css';` sor.

Helyi emulátorban ellenőrizve (Firebase emulátor + backend + Vite dev,
Budapest-seed 100 aktivitással): JS-méréssel a sáv 341/343 px — gyakorlatilag
teljes szélesség. `tsc --noEmit` és konzol tiszta.

**Élesítve: https://grundo.web.app** (`firebase deploy --only hosting`).
Commitok: `41eccea` (a javítás), `c3adb57` (a deploy `npm install`-ja által
finomított `package-lock.json`, külön commitolva, hogy a `deploy.sh` piszkos
munkamásolat miatt legközelebb ne álljon meg).

## ÉLESBEN FUT / TELEPÍTETLEN

- A rivális-sáv javítás **éles** (frontend, `41eccea`).
- Az előző adatvédelmi kiadás változatlanul éles: backend/frontend kód
  `605736f`, Cloud Run `grundo-api-00110-94c`.
- Az iOS háttér-GPS javítás a **TestFlight #27** buildben van, forrása
  `6da0288`; a hosszú készülékes regresszió még hátravan.
- Az Android háttér-GPS javítás a Google Play belső tesztsáv **#14** buildjében
  van, forrása `57f4d5a`; a hosszú készülékes regresszió még hátravan.
- **Az App Check/rate limit/dependency csomag (`d8de34f`) még mindig nincs
  telepítve** — ehhez a menethez nem tartozott Cloud Console-munka, a #26-ban
  leírt teendők változatlanul érvényesek és nyitottak (lásd lent).
- Nincs kötelező adatmigráció, nincs új index a mostani menethez.

## KÖVETKEZŐ MENET

**A) App Check éles bevezetése — változatlanul nyitott a #26 óta:**

1. **Cloud Shell:** `RATE_LIMIT_HMAC_KEY` titok létrehozása, Cloud Run service
   account Secret Manager hozzáférés + `roles/firebaseappcheck.tokenVerifier`.
   Parancsok: `docs/06-architektura-es-admin.md` App Check rollout része.
2. **Firebase/Google Cloud Console:** webes reCAPTCHA Enterprise, Android Play
   Integrity, iOS App Attest providerek regisztrálása. Utána a webes Key ID a
   `VITE_RECAPTCHA_SITE_KEY`-be — jelenleg szándékosan üres.
3. Sorrend: **szabályok** → **backend** (`observe`) → **frontend** → Android
   belső build → iOS TestFlight build.
4. Mindhárom kliensen App Check metrika + 401/429/503 arány ellenőrzés valódi
   eszközön.
5. Csak igazolt lefedettség után `enforce` mód.
6. A 90 perces / 20 km-es iOS és Android háttér-GPS terepteszt is nyitott,
   egyben App Check smoke teszt is lehetne.

**B) Kód-jelöltek a #23-ra (ebben a menetben feltérképezve, nem javítva):**

7. A gameplay-config runtime snapshot bekötése a tényleges aktivitás-
   feldolgozásba — lásd fent, „1. Az App Check/rate limit csomag validálása"
   szakasz a pontos hívási helyekkel. Ez élesíti a Trust Score observe-only
   kikapcsolhatóságát és az admin GP-modifiereket egyszerre.
8. `mailer.ts` fail-closed tétele hiányzó `SMTP_HOST`-ra production módban.

## NYITOTT KISEBB ÜGYEK

- A frontend production Mapbox chunk **1,824 MB**, a Firebase chunk **630 kB**;
  ez meglévő teljesítmény-karbantartási feladat.
- A hat megmaradt backend auditjelzés tranzitív `firebase-admin` függőség;
  upstream frissítést kell figyelni, `--force` downgrade nem elfogadható.
- A Codemagic Google Play ellenőrző parancsában a régi
  `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` név később megszűnik; külön
  üzemeltetési menetben kell átnevezni.
- `emulator-5562 offline` továbbra is látszott Geri gépén; ez a Gradle
  unit/lint ellenőrzést nem akadályozta, de UI-életciklustesztet nem adott.

## 0. MODELLJAVASLAT a folytatáshoz

Attól függ, mit hoz a #23. Ha az App Check éles bevezetése (A szakasz): erős
gondolkodási mélység indokolt, mert hibás sorrenddel a régi kliensek vagy a
közvetlen Firestore/Storage kérések kizárhatók. Ha a gameplay-config bekötés
(B7): szintén erős gondolkodási mélység, mert 16 hívási helyet kell
következetesen átvezetni anélkül, hogy a GP-gazdaság vagy a Trust Score
csendben elromlana — mérés nélkül itt nem szabad megállni. Ha csak a mailer
fail-closed (B8) vagy hasonló kis, önálló javítás: elég a rutin szint.

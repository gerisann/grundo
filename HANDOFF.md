# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #5.** (A számozási konvenció: [AGENTS.md → 7. A
beszélgetések neve](AGENTS.md).)

Az új beszélgetés nyitó üzenete elég, ha erre a fájlra hivatkozik — nem kell
átmásolni a tartalmát.

## ÁLLAPOT

Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`.
A pontos HEAD-et `git log -1`-gyel ellenőrizd — ez a fájl nem tartalmaz
commit-hash-t, mert az a frissítés pillanatában azonnal elavulna.

Utolsó tartalmi commit: **D1 — a `metricsDaily` napi aggregátum megírva, az
admin Áttekintő valódi számokkal.** Csak backendet és frontendet érint
(`server/src/jobs/metricsDaily.ts`, `server/src/routes/admin.ts`,
`src/admin/AdminHomeScreen.tsx`) — **kell hozzá frontend- ÉS backend-telepítés**.
Adatbázis-lépés nincs (nincs új index, a `firestore.rules` már tartalmazta a
`metricsDaily` szabályt).

Tesztek, most mérve: a gyökérből `npm test` → **303 teszt zöld** (23 fájl, 5
emulátoros fájl kihagyva — 3 új teszt a `localDayWindow`-hoz). Emulátoros: a
`metricsDaily.emulator.test.ts` mind a 6 tesztje zöld valódi Firestore ellen
(`npm.cmd run test:emulator`, ami a teljes emulátoros készletet is lefuttatja —
ebben a menetben nem futott újra teljes egészében, csak az új fájl külön).
Typecheck (gyökér ÉS `server/`) és mindkét production build (`npm run build`,
`server` → `tsc && tsc-alias`) hibamentes. A Mapbox-chunk méretfigyelmeztetés
régi, nem ebből a menetből jött.

⚠️ **Az admin felület vizuális ellenőrzése ELMARADT.** A `/admin` bejelentkezést
igényel (Firebase Auth, admin custom claim) — ez nem az olvasó szolgáltatás-
fiókkal megy (az csak a nyers Firestore-t olvassa, HTTP-hitelesítést nem ad), és
jelszót/bejelentkezést nem kezelek. A tartalmi logikát a 6 emulátoros teszt és a
típusellenőrzés fedi, de a tényleges felületet (tile-elrendezés, formázás
képernyőn) Geri nézze meg élesben vagy helyi előnézetben, telepítés után.

## ÉLESBEN FUT

- **Napi forduló**: legutóbb mérve 2026-08-20-án — rendben megy.
- **Admin felület**: `/admin` — játékszabály-szerkesztő, akciók, aktivitás-
  audit, visszajátszó. Az Áttekintő EDDIG a rendszerállapotot mutatta; a most
  megírt kód a napi használati számokat (DAU/WAU/MAU, regisztráció, aktivitás +
  táv, elfoglalt terület, aktív sorozat) is hozzáadja — **de csak telepítés
  UTÁN, a következő napi fordulótól kezdve** lesz adat a `metricsDaily`
  kollekcióban.
- **Futásidejű konfiguráció**: `appConfig/gameplay` a v1-en áll. Fut egy aktív
  akció: „Gazdagrét Rush", globális 2×-es GP-szorzó, 2026-08-20 08:00 –
  2026-08-23 23:59 (Budapest) — ezt telepítés-függetlenül ellenőrizd, hátha
  időközben lejárt.

## TELEPÍTETLEN / NYITOTT KÉRDÉS

- **A `metricsDaily` job ÉS az admin `/api/admin/metrics` végpont kész, de NEM
  telepítve.** Amíg a backend nem frissül, a napi forduló a régi kódot futtatja
  (nem ír `metricsDaily`-t), és az Áttekintő a régi, számok nélküli felületet
  mutatja.
- A korábbi menetről áthozott, még mindig nyitott kérdés: **az F (szabály-
  magyarázó felület) éles telepítési státusza**, valamint a **`c0a20da`**
  (CORS-javítás, akció-szerkesztés, trust-panel) éles állapota — mindkettőt
  Geri tudja megmondani.

## KÖVETKEZŐ: 5. MENET

- **D1 folytatása / E**: a docs/06 §1 Áttekintő listájából még hiányzik a
  Pro-konverzió és lemorzsolódás, a konnektor-hibaarány és a hibás job-futások
  száma — ezekhez ma nincs adatforrás (nincs `subscriptions`-eseménynapló, nincs
  konnektor-hibaszámláló, a `rolloverRuns` csak az utolsó futást tárolja, nem
  sorozatot). Dönteni kell, hogy ezek most kapjanak-e saját számlálót, vagy
  maradjanak a „még nincs adat" feliratnál egy darabig.
- Alternatíva: lépjünk tovább a **2. Felhasználók** admin szekcióra (keresés,
  profil, GP-korrekció, shadowban/felfüggesztés) — ez a docs/06 §2 szerint még
  egyáltalán nincs megírva, és önmagában is jól határolt egység.
- **Vizuális ellenőrzés** az admin Áttekintőn, telepítés után — lásd fent.

## NYITOTT, KISEBB

(változatlan az előző menethez képest)

- **gpLedger-takarítás — elő van készítve, futtatásra vár.**
  `server/src/scripts/cleanGpLedgerJunk.ts` (dry-run alapértelmezett,
  `npm run clean:gp-ledger-junk`). Legutóbb mérve (2026-08-20): 12 sor
  törlésre vár. Az `--apply --allow-production` futtatás Geri saját, író jogú
  hitelesítésével, Cloud Shellben történik.
- Területi hatókörű hold-modifier nem hat: a `zones` kollekció még nincs
  megírva. Kódban és specben rögzítve.
- `gpWeek`/`gpMonth` ablakzárás él, de éles adaton még nem láttuk működni.

## Fejlesztői előnézet — hogyan látunk éles adatot a böngészőben backend nélkül

Változatlan az előző menethez képest — lásd a git történetben a korábbi
`HANDOFF.md`-t, vagy [AGENTS.md](AGENTS.md). Rövid összefoglaló:

1. `.claude/launch.json` a `G:\Saját meghajtó\WORK\CLAUDE` gyökérben — Vite
   dev szerver, port 5173. Már létrehozva.
2. Szerver helyben, csak-olvasó ADC-vel: `server/`-ből
   `GOOGLE_CLOUD_PROJECT=grundo PORT=8080 npx tsx watch server.ts`.
3. `grundo/.env.local`-ban `VITE_API_BASE_URL=http://localhost:8080`.
4. Ez a mód **nem alkalmas admin-felület ellenőrzésére** (lásd fent) — csak a
   nyilvános/hitelesített-de-nem-admin képernyőkhöz.
5. A `.env.local` telepítés előtt vissza kell állítani a valódi Cloud Run
   URL-re (`https://grundo-api-irb5rjve6a-ew.a.run.app`).

## Infrastruktúra: éles, csak olvasó Firestore-hozzáférés

Változatlan. `grundo-reader@grundo.iam.gserviceaccount.com`
(`roles/datastore.viewer`), Geri (`gergely.marthon@gmail.com`)
megszemélyesíti. Nincs kulcsfájl. PowerShellben `gcloud.cmd`, nem `gcloud`.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

Sonnet, normál gondolkodási mélységgel, ha a **2. Felhasználók** szekcióval
folytatjuk — meglévő admin-mintára épül, nincs benne spec-ellentmondás. Ha a
Pro-konverzió/konnektor-hibaarány számlálók bevezetése mellett döntünk, ott
adatmodell-döntés jön (hol és hogyan számláljunk), az inkább Opus.

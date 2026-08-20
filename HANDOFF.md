# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #3.** (A számozási konvenció: [AGENTS.md → 7. A
beszélgetések neve](AGENTS.md).)

Az új beszélgetés nyitó üzenete elég, ha erre a fájlra hivatkozik — nem kell
átmásolni a tartalmát.

## ÁLLAPOT

Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`.
A pontos HEAD-et `git log -1`-gyel ellenőrizd — ez a fájl nem tartalmaz
commit-hash-t, mert az a frissítés pillanatában azonnal elavulna.

Utolsó tartalmi commit: gpLedger-takarító szkript + `gcloud.cmd` az
AGENTS.md-ben. Ez **dokumentáció és egy önálló, a szerverbe nem importált
szkript** — a futó Cloud Run szolgáltatás viselkedését nem érinti, ezért ehhez
**nem kell backend-telepítés**.

Tesztek (GRUNDO #2 végén): 300 frontend, 124 szerver, 58 emulátoros — mind
zöld. Typecheck és production build hibamentes.

## ÉLESBEN FUT

- **Napi forduló**: mérve 2026-08-20-án, `inspect:world`-wel és egy célzott
  diagnosztikai szkripttel — **rendben megy**. A 22:00 UTC-s (=00:00
  Budapest) futás `usersProcessed=3`, `holdGpAwarded=87`, `errors=0`, és a
  `gpLedger`-ben megvannak a `hold_<uid>_20684` tételek, összegük egyezik a
  jelentett `holdGpAwarded`-del.
- **Admin felület**: `/admin` — játékszabály-szerkesztő, akciók,
  aktivitás-audit, visszajátszó.
- **Futásidejű konfiguráció**: `appConfig/gameplay` a v1-en áll (3
  mérföldkő-felülírással). **Éppen fut egy aktív akció**: „Gazdagrét Rush",
  globális 2×-es GP-szorzó, 2026-08-20 08:00 – 2026-08-23 23:59 (Budapest).
  Ez jó teszteset az F menethez (lásd lent).

## TELEPÍTETLEN / NYITOTT KÉRDÉS

- **A `c0a20da` (CORS-javítás, akció-szerkesztés, trust-panel) éles
  telepítési státusza még mindig nem tisztázott.** A kód push-olva van
  (`origin/main`-en rajta), de hogy a Cloud Run futtatja-e már — ezt Geri
  tudja megmondani, innen (olvasó Firestore-hozzáféréssel) nem látszik.

## KÖVETKEZŐ: 4. MENET

- **F**: szabálymagyarázó felület a JÁTÉKOSNAK. A `tunables` sémából
  generálva (`src/config/tunables.ts` — minden kulcshoz van magyar label és
  help), hogy egy átállított szorzó után a magyarázat se hazudjon. Kell hozzá
  egy publikus végpont, ami a hatályos értékeket és az aktív akciókat adja
  vissza. **Élesben most fut egy akció** ("Gazdagrét Rush") — jó élő
  teszteset.
- **D1 + E**: admin áttekintő valódi számokkal. A `metricsDaily` kollekció be
  van jegyezve (`docs/06`), de még nem íródik. A napi forduló írná, Europe/
  Budapest 00:05-kor.
  ⚠️ **Tervezési korlát, mérve**: a `gpLedger`-ben vannak (voltak) a
  determinisztikus azonosítós javítás előtti, `source` mező nélküli sorok.
  A `metricsDaily` aggregációt **`source` mező szerint szűrve** kell építeni,
  NEM nyers `gp.total` összegzéssel az egész kollekción — különben a régi
  sorok (ha még nincsenek eltakarítva, lásd lent) meghamisítanák a napi
  statisztikát.

## NYITOTT, KISEBB

- **gpLedger-takarítás — elő van készítve, futtatásra vár.**
  `server/src/scripts/cleanGpLedgerJunk.ts` (dry-run alapértelmezett,
  `npm run clean:gp-ledger-junk`). Mérve 2026-08-20-án: 12 sor törlésre vár,
  12 marad, önellenőrzés zöld (a megtartott sorok összege minden
  felhasználónál egyezik a tárolt `gpTotal`-lal — a törlés a jelenlegi
  egyenlegeket nem módosítja). Az `--apply --allow-production` futtatás Geri
  saját, író jogú hitelesítésével, Cloud Shellben történik — az agent
  olvasó fiókja szándékosan nem tud írni.
- Területi hatókörű hold-modifier nem hat: a birodalom területi eloszlásához
  a `zones` kollekció kellene, az még nincs megírva. Ma inkább elmarad a
  bónusz, mint hogy rosszul járjon — kódban és specben rögzítve.
- `gpWeek`/`gpMonth` ablakzárás él, de éles adaton még nem láttuk működni.

## Infrastruktúra: éles, csak olvasó Firestore-hozzáférés

2026-08-20-tól az agentnek van csak-olvasó hozzáférése a `grundo` projekt
`grundo-db` adatbázisához: `grundo-reader@grundo.iam.gserviceaccount.com`
(`roles/datastore.viewer`), Geri (`gergely.marthon@gmail.com`)
megszemélyesíti. Nincs kulcsfájl.

Futtatás: `server/` mappában
`$env:GOOGLE_CLOUD_PROJECT="grundo"; npm.cmd run inspect:world` (vagy más
olvasó script). **PowerShellben `gcloud.cmd`, nem `gcloud`** — lásd
[AGENTS.md → 4. Eszközhasználati csapdák](AGENTS.md).

Írós szkriptek (`rollover:run`, `role:set`, `migrate:*`, most már
`clean:gp-ledger-junk --apply`) ezzel a fiókkal szándékosan nem futnak —
azok Geri saját hitelesítésével, Cloud Shellben.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

Sonnet, normál gondolkodási mélységgel. Az F és a D1+E is felület + meglévő
mintát követő végpont/job-bővítés; nincs bennük spec-ellentmondás vagy
algoritmus. Ha a `metricsDaily` aggregáció tervezésénél elágazás jön, ott
váltsunk Opusra.

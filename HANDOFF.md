# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #4.** (A számozási konvenció: [AGENTS.md → 7. A
beszélgetések neve](AGENTS.md).)

Az új beszélgetés nyitó üzenete elég, ha erre a fájlra hivatkozik — nem kell
átmásolni a tartalmát.

## ÁLLAPOT

Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`.
A pontos HEAD-et `git log -1`-gyel ellenőrizd — ez a fájl nem tartalmaz
commit-hash-t, mert az a frissítés pillanatában azonnal elavulna.

Utolsó tartalmi commit: **F — szabálymagyarázó felület a játékosnak** (lásd
lent). Ez frontendet ÉS a backendet is érinti (`server/server.ts`,
`server/src/routes/rules.ts`) — **kell hozzá frontend- ÉS backend-telepítés**.

Tesztek, most mérve (nem a korábbi menetből átvéve): a gyökérből `npm test`
→ **300 teszt zöld** (22 fájl, 4 emulátoros fájl kihagyva). A `server/`
mappából `npm test` → **124 teszt zöld** (a szerveres tesztek ugyanabból a
készletből, nem `300+124` a teljes összeg — a 124 a 300 egy részhalmaza, más
gyökérből futtatva). Emulátoros: az új `rules.emulator.test.ts` mind az 5
tesztje zöld valódi Firestore ellen; a teljes emulátoros készletet
(`test:emulator`) ebben a menetben nem futtattam újra — a többi emulátoros
fájlhoz nem nyúltam. Typecheck és production build hibamentes (a Mapbox-chunk
méretfigyelmeztetés régi, nem ebből a menetből jött).

## ÉLESBEN FUT

- **Napi forduló**: mérve 2026-08-20-án — rendben megy. A 22:00 UTC-s (=00:00
  Budapest) futás `usersProcessed=3`, `holdGpAwarded=87`, `errors=0`.
- **Admin felület**: `/admin` — játékszabály-szerkesztő, akciók,
  aktivitás-audit, visszajátszó.
- **Futásidejű konfiguráció**: `appConfig/gameplay` a v1-en áll (3
  mérföldkő-felülírással). **Fut egy aktív akció**: „Gazdagrét Rush", globális
  2×-es GP-szorzó, 2026-08-20 08:00 – 2026-08-23 23:59 (Budapest).

## TELEPÍTETLEN / NYITOTT KÉRDÉS

- **F kész, de NEM telepítve.** A `GET /api/rules` (publikus, hitelesítés
  nélkül) és a `/beallitasok/szabalyok` felület csak a repóban van meg, az
  éles Cloud Run még a régi kódot futtatja — kipróbáltam helyi backenddel
  (lásd „Fejlesztői előnézet" lent), éles telepítés nélkül.
- **A `c0a20da` (CORS-javítás, akció-szerkesztés, trust-panel) éles
  telepítési státusza még mindig nem tisztázott.** A kód push-olva van, de a
  Cloud Run-státuszt Geri tudja megmondani.

## KÖVETKEZŐ: 4. MENET FOLYTATÁSA

- **D1 + E**: admin áttekintő valódi számokkal. A `metricsDaily` kollekció be
  van jegyezve (`docs/06`), de még nem íródik. A napi forduló írná, Europe/
  Budapest 00:05-kor.
  ⚠️ **Tervezési korlát, mérve**: a `gpLedger`-ben vannak (voltak) a
  determinisztikus azonosítós javítás előtti, `source` mező nélküli sorok.
  A `metricsDaily` aggregációt **`source` mező szerint szűrve** kell építeni,
  NEM nyers `gp.total` összegzéssel az egész kollekción.

## NYITOTT, KISEBB

- **gpLedger-takarítás — elő van készítve, futtatásra vár.**
  `server/src/scripts/cleanGpLedgerJunk.ts` (dry-run alapértelmezett,
  `npm run clean:gp-ledger-junk`). Mérve 2026-08-20-án: 12 sor törlésre vár,
  12 marad, önellenőrzés zöld. Az `--apply --allow-production` futtatás Geri
  saját, író jogú hitelesítésével, Cloud Shellben történik.
- Területi hatókörű hold-modifier nem hat: a `zones` kollekció még nincs
  megírva. Kódban és specben rögzítve.
- `gpWeek`/`gpMonth` ablakzárás él, de éles adaton még nem láttuk működni.

## Fejlesztői előnézet — hogyan látunk éles adatot a böngészőben backend nélkül

Ebben a menetben kellett először éles adaton ellenőrizni egy frontend
képernyőt, és bevált módszer lett, érdemes megismételni:

1. `.claude/launch.json` a `G:\Saját meghajtó\WORK\CLAUDE` gyökérben (a
   Browser-eszköz saját munkakönyvtára, NEM a grundo repo) — egy
   `npm.cmd --prefix "C:\Users\Geri\Documents\GitHub\grundo" run dev`
   konfiguráció, port 5173. Ez már létrehozva, nem kell újra.
2. A szerver HELYBEN, a csak-olvasó ADC-vel (lásd lent): a `server/`
   mappából `GOOGLE_CLOUD_PROJECT=grundo PORT=8080 npx tsx watch server.ts`
   — ez a VALÓDI `grundo-db`-t olvassa, írni nem tud.
3. `grundo/.env.local`-ban `VITE_API_BASE_URL=http://localhost:8080` (csak
   erre az egy sorátírásra), utána a Vite-szervert újra kell indítani, mert az
   env-változót csak induláskor olvassa be.
4. Ellenőrzéshez `mcp__Claude_Browser__read_page` — a `computer` screenshot
   ebben a környezetben NEM működött („the Browser pane is not displayed”),
   tehát pixel-szintű, világos/sötét téma ellenőrzés még hátravan, csak a
   funkcionális/tartalmi rész van lefedve.
5. A `.env.local` most a valódi Cloud Run URL-re áll vissza
   (`https://grundo-api-irb5rjve6a-ew.a.run.app`) — ez az alapértelmezett a
   következő menetnek, nem a helyi backend.

## Infrastruktúra: éles, csak olvasó Firestore-hozzáférés

Az agentnek van csak-olvasó hozzáférése a `grundo` projekt `grundo-db`
adatbázisához: `grundo-reader@grundo.iam.gserviceaccount.com`
(`roles/datastore.viewer`), Geri (`gergely.marthon@gmail.com`)
megszemélyesíti. Nincs kulcsfájl.

Futtatás: `server/` mappában
`$env:GOOGLE_CLOUD_PROJECT="grundo"; npm.cmd run inspect:world` (vagy más
olvasó script, vagy a fenti helyi szerver). **PowerShellben `gcloud.cmd`, nem
`gcloud`** — lásd [AGENTS.md → 4. Eszközhasználati csapdák](AGENTS.md).

Írós szkriptek (`rollover:run`, `role:set`, `migrate:*`,
`clean:gp-ledger-junk --apply`) ezzel a fiókkal szándékosan nem futnak — azok
Geri saját hitelesítésével, Cloud Shellben.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

Sonnet, normál gondolkodási mélységgel. A D1+E felület + job-bővítés meglévő
mintára; nincs benne spec-ellentmondás. Ha a `metricsDaily` aggregáció
tervezésénél elágazás jön (pl. hogyan kerülje ki a `gpLedger` régi sorait,
lásd fent), ott váltsunk Opusra.

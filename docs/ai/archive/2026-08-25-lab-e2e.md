# GRUNDO — Claude handoff: LAB → production rules + E2E production UI

> Frissítve: **2026-08-25 14:31 CEST**  
> Repo: `gerisann/grundo`  
> Lokális projekt: `C:\Users\Geri\Documents\GitHub\grundo`  
> Cloud Shell: `~/grundo`  
> Ág: **`main`**  
> Baseline / HEAD a handoff készítésekor: **`5d06d712d97da23c526866d4ccca9d848ada1a22`** (`fix: type LAB viewport polygon for h3`)  
> Az előző nagy handoff: `HANDOFF.md` — történeti részletekhez továbbra is hasznos, de a jelenlegi munkastátuszban EZ a dokumentum az elsődleges.

---

## 0. START HERE

1. **Olvasd el az `AGENTS.md`-t először.** A projekt architekturális szabályai elsőbbséget élveznek.
2. Geri jelenleg közvetlenül a **`main`** ágon dolgozik, ez szándékos.
3. A kliens activity/claim számítása preview. Normál aktivitásmentésnél **a backend authoritative**, raw trace-ből számol újra mindent.
4. A LAB-ban elkészült compact/hierarchikus nagy-hurok logikát **nem szabad visszaegyszerűsíteni teljes res12 materializációra**. Balaton-méretű területeknél ez milliós cellalistát jelentene.
5. Defense szabály: valódi új traversal ugyanazt a saját területet ismét erősítheti 2×–5×-re. Ne tegyél olyan dedupe/cooldown-t, ami ezt megszünteti.
6. A frontier cleanup snapshot-alapú, **NO CASCADE**. Ne váljon általános world cleanup algoritmussá.
7. Mielőtt production Firestore commitot módosítasz, nézd meg a már meglévő idempotencia/checkpoint/fast-vs-chunked teszteket.

---

# 1. ELLENŐRZÖTT JELENLEGI ÁLLAPOT

Geri a handoff előtt frissen futtatta:

```bash
cd ~/grundo
git pull --ff-only
npm test
npm run build
```

Eredmény:

```text
Test Files  50 passed | 10 skipped (60)
Tests       476 passed | 112 skipped (588)
0 failing

npm run build
→ tsc --noEmit OK
→ vite v5.4.21 production build OK
→ 294 module transformed
→ built in 19.40s
```

**A `#12` menet után (2026-08-25, mérve):**

```text
npm test
Test Files  51 passed | 11 skipped (62)
Tests       480 passed | 119 skipped (599)
0 failing

npm run build
→ tsc --noEmit OK
→ built in 19.78s   (egyetlen figyelmeztetés: a régi Mapbox chunk)

npm run test:emulator
→ 113 passed | 4 failed (117)
→ a 4 bukó a missionEvaluate suite-ban van, és a main-en IS bukik
```

⚠️ **A `#12` MODELLJAVASLATA A KÖVETKEZŐ MENETRE:** ha az E2E LAB izolációja
(10.B) vagy a hiányzó emulátoros esetek jönnek, **Sonnet** elég — meglévő minta
kiterjesztése. Ha a stress/perf mérés (10.A/7) vagy az ismételt körök
szabálykérdése (7.9), akkor **Opus**: mért anomália, illetve játékegyensúly.

---

## A `#12` MENET TOVÁBBI EREDMÉNYEI (2026-08-25)

A compact backend után Geri négy felületi ügyet jelzett. Három lezárult:

| # | Ügy | Állapot | Commit |
|---|---|---|---|
| 1 | Feed 8–10 s betöltés | ✅ | `2bc2f52` |
| 2 | Térkép foltokban eltűnő terület | ✅ | `a855774` |
| 4 | Cellaszín-választás (16 + 8 Pro) | ✅ | `eeeecfc` |
| 3 | LAB E2E hurok/szint anomália | ◐ mérve, döntés kell | lásd 7.9 |

**1. Feed — MÉRVE:** a nézetváltás utáni visszatéréstől a kártyák
megjelenéséig **21,9 másodperc**, miközben az `/api/activities` válasz
**334 ms** alatt megérkezett. Az ok az `ActivityCard` `previewCells` memója
volt: ha az aktivitáson nincs `activityCells` mező (mérve: 0/20 éles
aktivitáson), a kártya a TELJES játékmotort futtatta a nyomvonalon —
kártyánként, a főszálon, olyan adatért, ami alapból rejtve van. Egy kártya
mért költsége 87–478 ms.
⚠️ **Ami nyitva maradt:** a feed továbbra sem használ TanStack Queryt (a
`useActivities` kézi `useState`/`useEffect`), ezért minden nézetváltás újra
lekér. A `staleTime: 30_000` a `main.tsx`-ben rá nem érvényesül.

**2. Térkép — MÉRVE:** a `--defense-alpha-1` értéke **0** volt, tehát az 1-es
szintű terület sosem volt kirajzolva (éles nézetben mind a 93 látható cella
ilyen volt). Emellett a cellánkénti poligonok a Mapbox csempénkénti
méretkorlátjába futottak. Megoldás: `cellsToMultiPolygon` összevonás
szerep+szint+tulajdonos szerint, cellarács csak 15-ös zoom fölött,
átlátszóság 20-40-60-80-100%.

**4. Színválasztás:** az alapértelmezett `purple` hexkódja megegyezik a
korábbi `--territory-own` tokennel, tehát senki térképe nem változik magától.
⚠️ **A Pro-zár a `firestore.rules`-ban van, de NINCS tesztelve** — a
projektben egyetlen Firestore-szabály teszt sincs (`@firebase/rules-unit-testing`
nincs a függőségek között). Külön menetnek való; a `cellColorAllowed()`
működése ma csak annyiban bizonyított, hogy az emulátor betölti a szabályt.

A build egyetlen figyelmeztetése a régóta ismert nagy Mapbox chunk:

```text
mapbox-BmuUWdqE.js  1,865.13 kB │ gzip: 521.57 kB
Some chunks are larger than 600 kB...
```

Ez **nem build failure**, és nem ennek a munkának a blokkolója.

### Fontos a skipped tesztekről

A 112 skipped teszt az emulator suite-okból jön (`*.emulator.test.ts`). A sima `npm test` zöld, de authoritative Firestore bekötés után **kötelező külön emulátoros kapu** is:

```bash
npm run test:emulator
```

Különösen fontos:

- `server/src/routes/activities.emulator.test.ts`
- admin/emulator suite-ok
- grid/ownership/idempotencia/concurrency viselkedés

---

# 2. A MUNKATERV JELENLEGI STÁTUSZA

Az eredeti ötpontos tervhez képest:

| Pont | Állapot | Megjegyzés |
|---|---|---|
| 1. LAB kód átolvasás | ✅ | korábbi handoffban dokumentálva |
| 2. LAB hibajavítás | ✅ | plusz később a Player teszt preview-world hibája is javítva |
| 3. Optimalizálás | ◐ | nagy tételek kész; **P10 `phaseHistory` memória** még nyitott; P8 már core/claim architektúra kérdés |
| 4. Gameplay finomhangolás | ◐ | sok szabály tesztekkel már lefedett, de a teljes regressziós mátrix még nincs végigfuttatva |
| 5. LAB az éles UI-n | ◐ | az első **browser-sandbox E2E production UI** implementáció kész és buildel; még nem authoritative backend sandbox |
| LAB szabályok production backendbe | ✅ | **`#12`-ben bekötve** — route, compact commit-ág, frontier fázis, 7 emulátoros teszt. Lásd 5. szakasz. |

---

# 3. PLAYER TESZT PREVIEW-WORLD HIBA — JAVÍTVA

A LAB-ban a `Player teszt` korábban kiszámolta a solo `ProcessResult`-ot, de a térképi ownership és defense stat a valódi `world` state-ből dolgozott. Emiatt:

- closure látszott;
- új/lopott cellaszám látszott;
- GP látszott;
- **játékosszínű foglalás nem látszott**;
- **Védelmi szint 0 maradt**.

Javítás commit:

```text
a7e4662 fix: show solo LAB claim as preview world
```

Megoldás:

- a Player teszt továbbra is **preview**, nem commit;
- `world` másolatra `applyClaimToWorld()` rávetíti a solo claimet;
- ebből lesz `displayWorld`;
- map + world totals + defense stat ezt használja;
- phase commit továbbra is az authoritative sandbox `world`-öt módosítja.

**Ne változtasd a Player tesztet valódi commitra.** A solo teszt szemantikája továbbra is preview.

---

# 4. PRODUCTION COMPACT CLAIM — MI KÉSZ

A cél: a LAB compact/hierarchikus szabályait átvinni az éles backendbe úgy, hogy nagy területnél se legyen milliós res12 materializáció.

## 4.1 Közös claim-credit primitív

Commitok:

```text
f49d28f feat: add shared compact claim credit transition
f7293f5 test: ...   # claim credit regressziós tesztek
```

Fájl:

```text
src/game/claimCredits.ts
src/game/claimCredits.test.ts
```

A közös primitív kezeli N claim-credit végállapotát egy cellára:

- free capture;
- saját reinforce;
- defense 1–5;
- breakthrough;
- steal;
- lopás utáni további credit már az új tulaj defense-ét építi.

Fontos példa:

```text
rival defense 5 + 6 hit
→ 4 breakthrough + steal + 1 own reinforcement
→ final owner = actor
→ final defense = 2
→ final fate cell-szinten = stolen
```

A publikus claim stat cellánként végső `before → after` állapotból számol, nem minden köztes hitből külön cellának.

## 4.2 Production res9 blokk primitive

Commitok:

```text
2ba6027 feat: add production compact block claim primitive
09535d0 test: cover production compact block claims
1dd7ec8 feat: expose full compact block coverage
```

Fájlok:

```text
server/src/lib/compactBlockClaim.ts
server/src/lib/compactBlockClaim.test.ts
```

Tárolási modellhez igazodik:

```text
production Firestore block = res9
res9 → max 343 res12 child
compact claim parent = tipikusan res10
```

Két út:

1. **Teljes homogén res9 blokk + azonos credit**
   - O(1) transition;
   - nem bontjuk ki 343 childra;
   - `uniform` blokk marad.

2. **Részleges / mixed blokk**
   - csak AZ az egy res9 blokk bomlik ki;
   - max. 343 res12 cella;
   - claim után újratömöríthető uniformra.

A result aggregál:

- free/reclaimed/stolen/breakthrough count;
- victim count;
- weighted claim area;
- gained area;
- exact stolen fine cells;
- whole-block stolen flag.

## 4.3 Compact credit → production block planner

Commitok:

```text
5d24944 feat: group compact claim credits by production block
3405aec test: cover compact production block planner
6d0f422 feat: aggregate compact claim by transaction group
```

Fájlok:

```text
server/src/lib/compactBlockPlan.ts
server/src/lib/compactBlockPlan.test.ts
server/src/lib/compactGroupClaim.ts
```

A compact parent/fine crediteket közvetlenül res9 Firestore blokk workokra csoportosítja.

A cél az, hogy a chunked commit **ne `claimedCells: res12[]` listából** induljon compact aktivitásnál.

## 4.4 Compact frontier planner

Commitok:

```text
7e48e30 feat: plan compact frontier cleanup
eced744 fix: make compact frontier layer explicit
c0fa1e4 test: cover compact frontier planning
272c20e fix: use explicit compact frontier read scope
```

Fájlok:

```text
server/src/lib/compactFrontier.ts
server/src/lib/compactFrontier.test.ts
```

Szabály:

- teljesen ellopott, homogén **belső** res9 blokkot nem szabad 343 res12 childra materializálni;
- csak a geometriai claim-perem bulk blokkjai materializálódnak frontier seednek;
- részleges/mixed blokk exact stolen cellái eleve fine seedek;
- read scope = seed blokkok + szükséges szomszéd blokkgyűrű;
- `scope` explicit, mert a beolvasott **gazdátlan** cella nincs az ownership Mapben, de ettől még beolvasott/ismert cella.

Ez a NO-CASCADE cleanup korrekt scope-jához fontos.

## 4.5 Compact → chunked route predicate

Commitok:

```text
76c9c37 feat: route compact activities to chunked commit
e31dd21 test: compact activities require chunked route
```

Fájl:

```text
server/src/lib/activityRouting.ts
server/src/lib/activityRouting.test.ts
```

Predicate:

```ts
requiresChunkedClaim(loops, fitsByWriteCount)
```

Szabály:

```text
compact loop → ALWAYS chunked
normal + too many writes → chunked
normal + fits → fast path
```

### ⚠️ KRITIKUS: EZ MÉG NINCS BEKÖTVE AZ HTTP ROUTE-BA

A jelenlegi `server/src/routes/activities.ts` továbbra is ezt csinálja:

```ts
const committed = fitsOneTransaction(plan)
  ? await db.runTransaction((tx) => commitActivity(tx, plan))
  : await commitChunkedActivity(plan);
```

Tehát `requiresChunkedClaim()` **még nincs használva** itt.

Továbbá a `commitChunkedActivity()` jelenlegi production útja még nem használja végig a fenti compact block/group/frontier primitíveket.

**Következmény:** a compact production modulok jelenleg infrastruktúra + tesztek, de a tényleges `/api/activities` viselkedés nagy compact loopra még nincs kész.

---

# 5. PRODUCTION BACKEND — KÉSZ ÉS EMULÁTORON BIZONYÍTOTT (2026-08-25, `#12`)

Ez a szakasz korábban a legfontosabb NYITOTT feladatot írta le. Elkészült.

## 5.0 ⚠️ AMI A TERVBŐL HIÁNYZOTT — a `planActivity` is compact-vak volt

Az eredeti terv (5.1 + 5.2) önmagában **nem lett volna elég**, és ezt mérés
mutatta ki, nem olvasás. Egy 5×5 km-es körön (81 023 res12 cella):

| | |
|---|---|
| `plan.candidateCells` (fal + határsáv) | 5 220 |
| ebből számolt `plan.blockIds` | 98 |
| a compact claim VALÓDI blokkszáma | 270 |
| **a `blockIds`-ből hiányzó blokk** | **172 — a terület 64%-a** |

A `commitChunkedActivity` a `plan.blockIds`-ből csoportosít. Ha csak a
route-predikátumot kötöttük volna be, a nagy kör belsejének kétharmada
**némán elveszett volna** — hibaüzenet nélkül, mert a mentés sikeresnek
látszott volna.

Ezért a `planActivity` mostantól compact huroknál a
`buildCompactClaimCredits` → `buildCompactBlockPlan` láncból veszi a
blokklistát, és az `ActivityPlan` új mezője a `compactWorks`.

## 5.1 Route bekötés — KÉSZ

```ts
const committed = requiresChunkedClaim(plan.loops, fitsOneTransaction(plan))
  ? await commitChunkedActivity(plan)
  : await db.runTransaction((tx) => commitActivity(tx, plan));
```

**Miért nem elég az írásszám?** Mérve: a fenti körnél `fitsOneTransaction()`
`true`-t ad (270 blokk bőven az 500 alatt), tehát a gyors útra ment volna —
ahol a `processActivityGeometry` őre compact hurokra szándékosan dob. Élesben
ez 500-as hibát jelentett minden nagy körnél. A predikátum a GEOMETRIÁT nézi.

## 5.2 `commitChunkedActivity()` compact ág — KÉSZ

A háromfázisú szerkezet megmaradt, a 2. fázis ágazik el, és bejött egy 2.5:

```text
1.   FOGLALÁS      változatlan
2.   CSOPORTOK     works ? applyCompactGroup : applyGroup
2.5  FRONTIER      csak compact úton, csak lopás után
3.   KÖNYVZÁRÁS    változatlan
```

A normál chunked path **nincs szétrefaktorálva** — a `blockOfCell` térkép
felépítése is kimarad compact úton, mert ott puszta pazarlás lenne.

Új primitív: `writeBlocks()` a `grid.ts`-ben. A `writeOwnership()` cellánkénti
változásokat kap és maga bontja/tömöríti a blokkot; a compact ág viszont már
KÉSZ blokkalakot ad át. Ha itt is cellatérképen mennénk át, pontosan azt a
materializációt hoznánk vissza, amiért az egész compact ág létezik.

## 5.2.1 A frontier fázis könyvelése

A `claimParts/frontier` részdokumentum alakja MEGEGYEZIK a csoportokéval,
ezért a `closeBooks` külön ág nélkül összegzi.

⚠️ A frontier a cellát ahhoz adja, akinek a legtöbb oldalával érintkezik — ez
**lehet harmadik játékos is**. Olyankor a rács korrigálódik, de a mentés
szereplője nem kap érte sem területet, sem GP-t. Ez szándékosan ugyanaz a
szabály, mint az egytranzakciós úton (`cleanupStolenFrontierOrphans`).

Két új korlát, mindkettő szélsőséges eset ellen:
- `MAX_STOLEN_SEEDS_PER_GROUP = 20 000` — a seedek a részdokumentumba kerülnek
  (hogy egy újraindított mentés ne veszítse el őket), a Firestore-doksi viszont
  1 MB. Túllépésnél `seedsTruncated: true`.
- `MAX_FRONTIER_BLOCKS = 400` — a cleanup tranzakciójának írásszáma.

Mindkettőnél a birtokviszony, a terület és a GP **pontos marad**; csak a
topológiai kozmetika lehet részleges.

## 5.3 Checkpoint/idempotencia

A meglévő chunked activity checkpoint modellt meg kell őrizni:

- group replay idempotens;
- retry ne adjon újra GP-t/territoryt;
- részlegesen kész activity folytatható;
- activityId ownership conflict maradjon védett.

Compact group aggregátumokból a végén ugyanazokat a könyvelési adatokat kell előállítani, mint normál pathon:

- `summary.claimedCells` exact res12-equivalent;
- `areaGainedM2`;
- GP;
- `stolenFrom`;
- `breakthroughFrom`;
- profile territory/cell counters;
- rivals;
- audit;
- notification inputok.

## 5.4 Frontier cleanup production transaction

A cleanup csak post-claim snapshotból dolgozzon.

**NO CASCADE.**

A direkt claim cellákat nem írhatja felül.

A boundary bulk blokkok child materializációja csak ott történjen, ahol a planner indokolja.

## 5.5 Emulator E2E tesztek — RÉSZBEN KÉSZ

Új fájl: `server/src/routes/activitiesCompact.emulator.test.ts` — **7 teszt,
mind zöld** valódi Firestore ellen (fixture: 5 km oldalú, 20 km kerületű kör,
30 km/h bringatempóval, hogy a Trust Score-nak is életszerű legyen).

Lefedve az eredeti listából:

| # | Eset | Állapot |
|---|---|---|
| 1 | compact free capture | ✅ `claimedCells > 40 000`, a profil számlálója egyezik |
| 2 | ugyanaz másodszor → reinforce | ✅ `areaGainedM2 === 0`, cellaszám változatlan |
| 3 | defense 5-ig ismétlés | ✅ hat kör, a rácsban `maxDefense === MAX_DEFENSE` |
| 4 | rival defense 1 steal | ✅ áldozat számlálója csökken, támadóé nő |
| 5 | rival defense 2+ breakthrough | ✅ `areaGainedM2 === 0`, egyik cella sem cserél gazdát |
| 9 | uniform marad uniform | ✅ `uniform > expanded`, tárolt cellák < blokkok×343×0,5 |
| 10 | retry/idempotencia | ✅ a második kérés semmit nem tesz hozzá |
| 12 | nincs milliós materializáció | ✅ ugyanaz a mérés, mint a 9-nél |

**Még NINCS lefedve** (a következő menet dolga): 6. több credit ugyanarra a
cellára egy activityn belül · 7. célzott frontier orphan cleanup ellenőrzés
(a kód FUT a lopásos tesztben, de a viselkedése nincs külön állítva) ·
8. partial res9 blokk vegyes tulajdonnal · 11. fast path vs chunked
ekvivalencia.

### ⚠️ Két buktató, amit MÉRVE találtunk a tesztíráskor

1. **A GP-t ne kösd pontos képlethez nagy fixture-nél.** A kis fixture-ös
   suite `FIRST_ACTIVITY_BADGE_GP = 70`-nel számol; egy 25 km²-es foglalás a
   TERÜLETI jelvényküszöböket is átlépi, és **2 450 GP** bónuszt hozott. A
   helyes teszt relatív: mihez képest nőtt.
2. **A profil nyers m²-t tárol, az összesítő kerekít.** MÉRVE 0,07 m² eltérés
   (`24 881 353,07` vs `24 881 353`) — `Math.round()` kell az összevetéshez.

### Ellenőrző parancsok

```bash
npm test
npm run build
npm run test:emulator
```

⚠️ Git Bash-ből az emulátoros parancs elé kell a Java PATH exportja, különben
félrevezető „Could not spawn java" hiba jön.

---

# 6. E2E LAB → PRODUCTION TRACKING UI — ELSŐ VERZIÓ KÉSZ

A cél az volt, hogy a LAB ne egy külön „ál-éles” tracking UI-t építsen, hanem ugyanazt a production komponensláncot hajtsa meg szimulált GPS-szel.

Az első browser-sandbox verzió elkészült.

## 6.1 Recorder injektálható környezet

Commit:

```text
7304b68 feat: make recorder source storage and upload injectable
```

`useRecorder(source?, options?)` most opcionálisan kap:

```ts
interface RecorderOptions {
  store?: RunStore;
  uploader?: RecorderUploader;
  restoreSavedRun?: boolean;
}
```

Normál appban az alapértelmezés változatlan:

- Browser/Native PositionSource;
- default IndexedDB RunStore;
- production `/api/activities` uploader;
- saved-run restore.

LAB E2E-ben lehet:

- `SimulationPositionSource`;
- memory store;
- sandbox uploader;
- restore kikapcsolva.

## 6.2 Nested izolált `RecorderProvider`

Commit:

```text
937328e feat: support isolated LAB recorder providers
```

LAB tracking saját provider alatt fut.

Fontos:

```tsx
<RecorderProvider
  source={simulationSource}
  options={{ store: memoryStore, uploader: sandboxUploader, restoreSavedRun: false }}
  cloudSync={false}
>
```

Ez megakadályozza, hogy a LAB recorder:

- felülírja a valódi félbehagyott tracking IndexedDB state-et;
- tracking cloud syncot írjon;
- production activity uploadot hívjon.

## 6.3 Tracking environment

Commitok:

```text
827cf5b feat: allow LAB to disable shared position side effects
98f341b feat: add injectable tracking environment
a37a249 fix: honor tracking environment for shared position
```

Fájl:

```text
src/tracking/environment.tsx
```

LAB környezet ad:

- `mode: 'lab'`;
- label/detail;
- synthetic initial map position;
- `sharedPositionEnabled: false`.

A `useSharedPosition(uid, enabled)` LAB alatt nem kér/ír valódi shared-position Firestore state-et.

## 6.4 Ugyanaz a production Dock

Commit:

```text
f1b2915 feat: let production Dock control LAB tracking
```

Nem készült másolat a Play/Pause/Lap/Finish vezérlésből.

LAB fullscreen tracking alatt **ugyanaz a `Dock`** hívja:

```text
begin
pause
resume
markLap
finish
discard
```

mint productionben.

## 6.5 Session transport

Commitok:

```text
5d3430f feat: add LAB E2E tracking session transport
8cd9c9a feat: share E2E sandbox across scenario runs
```

Fájl:

```text
src/admin/labE2eSession.ts
```

A session `sessionStorage`-ban él és tartalmazza:

- scenario/sandbox id;
- phase id/name;
- player id/name;
- player list;
- route;
- GPS config;
- playback rate (`1/10/100/max`).

Azonos mentett scenario E2E runjai ugyanazt a `sandboxId`-t használják, így szekvenciálisan lehet pl.:

```text
Player 1 foglal
→ Player 2 ugyanazon sandboxon támad
→ Player 1 visszatámad
```

## 6.6 Browser sandbox world

Commitok:

```text
c70c373 feat: add isolated E2E LAB sandbox world
5d06d71 fix: type LAB viewport polygon for h3
```

Fájl:

```text
src/admin/labE2eSandbox.ts
```

Két külön world:

```text
foot
bike
```

Tárolás: `sessionStorage`.

Activity commit jelenleg:

```text
raw recorder points
→ buildActivityGeometry
→ processLabActivity
→ applyClaimToWorld
→ browser sandbox world
```

Tehát ez **NEM production backend commit**. A shared/LAB engine fut a böngészőben.

Ez szándékosan első integrációs lépcső volt: a production UI/recorder ellenőrizhető production Firestore szennyezése nélkül.

## 6.7 Production TrackingScreen tile bridge

Commit:

```text
7728a30 feat: scope TrackingScreen tiles to LAB sandbox
```

Fájl:

```text
src/admin/labE2eTileBridge.ts
```

Az E2E route életciklusa alatt a production `TrackingScreen` `api.tiles()` hívását scoped bridge a browser sandbox `tiles()` adapterére irányítja.

Unmount után visszaáll.

Cél: a tracking map se production worldöt mutasson LAB alatt.

## 6.8 Fullscreen E2E tracking screen

Commit:

```text
ef0bb4f feat: run LAB telemetry through production tracking UI
```

Fájl:

```text
src/admin/LabE2eTrackingScreen.tsx
```

Valódi komponenslánc:

```text
saved LAB route/config
        ↓
generateGpsActivity(startAt = Date.now())
        ↓
SimulationPositionSource
        ↓
production useRecorder state machine
        ↓
production GPS filter
        ↓
production TrackingScreen
        ↓
production Dock
        ↓
browser LAB sandbox uploader
```

A képernyőn külön:

```text
LAB / SANDBOX
scenario · phase · player · playback rate
```

banner látszik.

Mentés után LAB-result overlay:

- táv;
- hurkok;
- claim cellák;
- terület;
- GP;
- sandbox world.

Gombok:

- Másik teszt;
- Újra ezen a worldön;
- Sandbox nullázása.

## 6.9 Admin launcher / route / access gate

Commitok:

```text
6e96fb3 feat: add E2E LAB launcher UI
9aa871d feat: route E2E LAB tracking screens
5b30028 fix: render E2E tracking outside admin layout
be9c36e feat: link Scenario LAB to E2E production UI
08d3b76 feat: protect fullscreen admin tools without layout
d75f8ec fix: protect fullscreen E2E LAB route
b4f8914 fix: type E2E launcher children explicitly
```

Fájlok:

```text
src/admin/LabE2eLauncherScreen.tsx
src/admin/AdminAccessGate.tsx
src/admin/index.tsx
src/admin/SimulationLabScreen.tsx
```

Használati terv:

```text
/admin/lab
→ E2E · Éles UI
→ /admin/lab/e2e
→ mentett scenario
→ phase
→ player
→ 1× / 10× / 100× / MAX
→ Indítás éles UI-ban
→ /admin/lab/e2e/:sessionId
```

A fullscreen route nem kap AdminLayout sidebart/headert, de külön `AdminAccessGate` védi ugyanazzal az `/api/admin/status` role checkkel.

---

# 7. E2E LAB — FONTOS NYITOTT HIBÁK / HIÁNYOK

**Ezeket ne tekintsd késznek csak azért, mert buildel.** Manuális E2E validáció még nem történt meg a handoff előtt.

## 7.1 NEM authoritative backend sandbox

Jelenleg:

```text
Tracking UI = production
Recorder = production
GPS filter = production
Game commit = BROWSER processLabActivity
World = browser sessionStorage
```

A kívánt végállapot:

```text
Tracking UI = production
Recorder = production
GPS filter = production
raw trace upload = admin LAB endpoint
Game engine / compact chunked commit = production backend
World = isolated server-side LAB sandbox
```

Ez a legfontosabb következő E2E fejlesztés **a production compact backend bekötése után**.

## 7.2 Production `TrackingScreen` live preview még batch `processActivity()`

A tracking live preview továbbra is a teljes addigi trace-en futó batch core `processActivity()`-t használja minden új H3-cellánál.

Két probléma:

1. hosszú trace-en O(n²)-szerű újraszámítási kockázat;
2. compact nagy loopnál a core guard dobhat, a UI catch miatt a claim preview eltűnik.

A LAB-ban már van `IncrementalActivityGeometry` és `processLabActivity` minta.

Production previewt később incremental geometryre kell vinni, de a final save továbbra is backend-authoritative maradjon.

## 7.3 Timestamp rebasing nincs teljesen megoldva

`LabE2eTrackingScreen` jelenleg renderkor generál:

```ts
generateGpsActivity(session.route, { ...session.config, startAt: Date.now() })
```

A Play gombot a user csak később nyomhatja meg. Ha sokat vár, az első synthetic sample timestampje a recorder valódi `startedAt` értéke előtt lehet.

Korrekt megoldás: a `SimulationPositionSource.start()` pillanatában rebase-eld a teljes telemetry timestamp sorát úgy, hogy az első sample a tényleges recorder start környékéről induljon, miközben a sample-k közti delta változatlan.

Ne a playback rate-tel módosítsd a sample timestampet — 100× csak a faliórát gyorsítja, a recordernek továbbra is a szimulált valós időközöket kell látnia.

## 7.4 Post-save production UI mellékhatás

A production `TrackingScreen` `UploadPanel`-je sikeres upload után normál esetben `SaveActivityForm`-ot is mutathat (`duplicate === false`, van valós uid).

A LAB browser uploader viszont **nem hoz létre production activity dokumentumot**.

Ezért LAB E2E-ben a production utólagos activity metadata/photo szerkesztést explicit le kell tiltani / LAB-aware-é tenni. Ne hagyd, hogy a user egy sandbox activity id-re production PATCH/Storage műveletet próbáljon.

Ez manuális használat előtt javítandó.

## 7.5 SavingPanel / claim progress

A production `SavingPanel` `useClaimProgress(activityId)`-t használ, ami production claim-progress infrastruktúrához kötődik. A browser sandbox upload rövid, ezért ez valószínűleg csak üres read, de a tiszta izoláció érdekében LAB environmentben ennek is legyen no-op/sandbox megfelelője.

## 7.6 Launcher csak MENTETT scenarióból indul

Most az E2E launcher a `grundo.lab.scenarios.v2` localStorage mentéseiből választ.

Nincs még:

- aktuális, el nem mentett Scenario közvetlen „Indítás éles UI-ban”;
- aktív state átadása mentés nélkül.

Ez UX következő lépés.

## 7.7 Phase E2E még nem valódi párhuzamos phase

Most egy kiválasztott player egy route-ja fut E2E-ben.

A scenario sandbox megmarad, ezért egymás után lehet több playerrel támadást tesztelni, de nincs még:

- több `SimulationPositionSource` párhuzamos futtatása;
- `startOffsetMs` szerinti phase scheduling;
- nézett player váltása futó multi-player phase alatt;
- commit order/concurrency E2E.

## 7.8 Részletes event log nincs még

Kívánt admin log minimum:

```text
timestamp
player
raw GPS sample
accepted/rejected + reason
recorder state
H3 transition
closure detected/rejected
claim credits
claim fate
world before/after
GP
level before/after
UI warning/error
```

Ez még nincs kiépítve.

---

# 7.9 ⚠️ ISMÉTELT KÖRÖK VÉDELMI SZINTJE — MÉRVE, NYITOTT

Geri jelezte: négyszer bekerítette ugyanazt a területet a LAB E2E-ben, a
cellák mégis csak **2-es szintre** jutottak. A `#12` menet ezt megmérte, és a
gyanú **nem igazolódott** a motorra:

| Mérés | Hurok-indexek | Max szint |
|---|---|---|
| 4 kör, TÖKÉLETES nyomvonal (azonos waypointok) | `1→48 48→96 96→144 144→191` | **4** ✅ |
| 5 kör, tökéletes | `… 192→239` | **5** ✅ |
| 4 kör, SZIMULÁLT GPS (5 különböző seed) | `1→70 70→147 147→228 228→308` | **4** ✅ |

Zajmentesen és zajjal is helyes: az indexek hézagmentesen követik egymást, a
defense 5-ig épül. **A motor és a traversal-credit szabály tehát jó.**

### Ahol viszont elromlik

Geri LAB-futásának diagnosztikája:

```text
#1  1→47   fal 47  belső 89
#2  18→72  fal 55  belső 105
#3  51→112 fal 62  belső 132
#4  80→144 fal 65  belső 157
```

Két árulkodó jel:

1. **Az indexek ÁTFEDNEK** (`#2` fromIndexe 18 < `#1` toIndexe 47).
2. **A belső cellaszám NŐ** hurkonként: 89 → 105 → 132 → 157.

A második azt jelenti, hogy a körök **nem fedték egymást**: egyre nagyobbak
voltak (spirális/eltolt körözés), nem ugyanaz a fizikai hurok négyszer.

Ilyenkor a bezárás pontja a KORÁBBI kör nyomvonalára esik vissza, ezért a
`fromIndex` visszanyúlik, és a traversal-credit szabály
(`loop.fromIndex >= cellCreditedAt`, lásd `resolveSequentialLoopClaims`)
kihagy krediteket:

```text
#1  1→47   → credit,      creditedAt = 47
#2  18→72  → 18 < 47  → NINCS credit
#3  51→112 → 51 >= 47 → credit, creditedAt = 112
#4  80→144 → 80 < 112 → NINCS credit
```

Négy körből **két** credit — pontosan a panaszolt 2-es szint.

### ⚠️ AMI ITT DÖNTÉST IGÉNYEL, NEM KÓDOT

A jelenlegi szabály a `docs/`-ban nincs leírva, a HANDOFF 4. szakasza viszont
igen, és **szándékos**: egy nagyobb kompozit hurok ne fizesse ki újra a már
bekerített kisebb területet (figure-eight eset). A spirális körözés viszont
ugyanebbe a szűrőbe esik, pedig ott VALÓDI új traversal történt.

A kettőt meg lehet különböztetni (a `#2` hurok toIndexe 25 ponttal a `#1`
toIndexe után van, tehát új szakasz keletkezett), de **ez játékegyensúlyt
érintő szabálymódosítás**, és az `AGENTS.md` szerint nem improvizálható:
el kell dönteni, mi a kívánt viselkedés, ha valaki egyre nagyobb köröket ír le
ugyanazon terület köré.

**A következő menet ezzel kezdjen**, és döntéssel, ne kóddal.

### A másik két bejelentés ugyanebből a körből

- **„Belassul a második körnél"** — ez a 7.2 pont ismert oka: a
  `TrackingScreen` live preview minden új H3-cellánál a TELJES addigi
  nyomvonalon futtatja a batch `processActivity()`-t. A LAB-ban már van
  `IncrementalActivityGeometry` minta hozzá.
- **„Lemarad a hexagon-kirajzolás az útvonaltól"** — ugyanennek a tünete.

---

# 8. P10 — `phaseHistory` MEMÓRIA MÉG NYITOTT

A Scenario LAB `phaseHistory` továbbra is teljes `LabPhaseOutcome[]` objektumokat őriz.

A teljes outcome runonként tartalmazhat:

- generated GPS sample sort;
- recorder pointokat;
- teljes `ProcessResult` Map/Set struktúrákat.

A debug UI ebből lényegében csak ezt használja:

- phase id/name;
- player;
- commit order;
- loops count;
- free/stolen/breakthrough count.

Korrekt fix: könnyű DTO, pl.:

```ts
interface PhaseHistoryEntry {
  phaseId: string;
  name: string;
  runs: Array<{
    runId: string;
    playerId: string;
    commitOrder: number;
    loops: number;
    free: number;
    stolen: number;
    breakthrough: number;
  }>;
}
```

Opcionálisan limitáld az utolsó ~200 phase-re, a teljes run count maradhat külön számláló.

Ez kicsi, zárt perf/memory munka; gameplay szabályt nem érint.

---

# 9. GAMEPLAY REGRESSZIÓS MÁTRIX — MÉG ÉRDEMES VÉGIGVINNI

A következő stabilizációs körben LAB + backend oldalon ugyanazokat a fixture-öket érdemes használni.

## 9.1 11 pontos komplex route

Korábbi handoff szerint ennek **pontosan 4 fizikai closure** az elvárása.

A negyedik valódi új traversal visszafoglalja/erősíti az első területet.

## 9.2 Defense

Ugyanaz a valódi full traversal:

```text
1× → 2× → 3× → 4× → 5×
```

Ne legyen defense farm puszta:

- rávezető szakaszból;
- visszaútból;
- közeli párhuzamos nyomból;
- post-closure sliverből.

## 9.3 Steal / breakthrough

```text
rival defense 1 → owner change / stolen
rival defense >=2 → breakthrough + defense -1
```

Cellánként.

## 9.4 Frontier

Csak stolen frontier után.

Snapshot.

NO CASCADE.

## 9.5 Compact/fine multiplayer

Legalább:

```text
A foglal
B részlegesen lop
C átfed
A visszatámad
```

különböző finish orderrel.

## 9.6 Nagy stress

A korábbi 177,6 km compact stress fixture célja:

- exact res12-equivalent eredmény;
- milliós res12 materializáció nélkül.

---

# 10. JAVASOLT FOLYTATÁSI SORREND

Ne kezdj random UI-polírozásba. A következő sorrend a legkisebb kockázatú:

### A. Production compact backend — ✅ KÉSZ (`#12`)

1. ✅ `activities.ts` → `requiresChunkedClaim()` tényleges használata.
2. ✅ `commitChunkedActivity()` compact ág a block plan/group primitívekkel.
3. ✅ compact frontier cleanup Firestore scope/transaction.
4. ✅ closeBooks / summary / GP / victims összevezetés (a `part` alak azonos).
5. ✅ unit tesztek (`compactActivityPlan.test.ts`, 4 teszt).
6. ◐ emulator E2E — 7 teszt zöld, 4 eset még hátra (lásd 5.5).
7. ❌ **stress/perf mérés még nincs.** A 177,6 km-es fixture-rel meg kell nézni,
   hogy a `MAX_GROUPS = 40` és a Cloud Run időkorlát tartja-e. Az 5 km-es kör
   270 blokk = 1 csoport; a Balaton-kör nagyságrendileg 6 500 blokk = 17 csoport.

**Ami a bekötés közben KIDERÜLT és nem volt a tervben:** a `planActivity` maga
is compact-vak volt, a blokklistából a terület 64%-a hiányzott. Részletek az
5.0 szakaszban — érdemes elolvasni, mielőtt bárki hozzányúl ehhez a lánchoz.

### B. E2E LAB izoláció lezárása

1. timestamp rebase a `SimulationPositionSource.start()` környékére;
2. post-save `SaveActivityForm`/production metadata write tiltása LAB módban;
3. claim progress production read kikapcsolása LAB módban;
4. manuális single-player E2E validáció.

### C. E2E LAB → authoritative server sandbox

1. admin-only LAB activity endpoint;
2. izolált LAB world namespace;
3. ugyanaz a production `planActivity` / compact chunked pipeline;
4. raw recorder trace küldése;
5. browser sandbox csak gyors/local engine módnak maradhat.

### D. Multi-player phase E2E

1. több source;
2. start offsets;
3. background player runok;
4. watched player production UI;
5. commit ordering/concurrency;
6. event log.

### E. P10 + tracking preview perf

1. `phaseHistory` könnyű DTO;
2. TrackingScreen batch preview → incremental geometry;
3. compact-aware live preview.

---

# 11. MIT NE CSINÁLJ

- Ne futtass `npm audit fix --force`-ot. Korábban Vite 8 / React Router 7 / Vitest 4 breaking upgrade-okat kényszerített be; vissza lett állítva.
- Ne migráld most mellékesen React Router 7-re. A jelenlegi production-only audit csak 2 moderate router advisory volt; a migráció külön feladat.
- Ne materializáld a teljes compact interior res12 celláit.
- Ne változtasd a Player tesztet valódi world commitra.
- Ne írd át a production tracking UI-t külön LAB-másolatra. Az egész E2E célja, hogy **ugyanaz a komponens** fusson.
- Ne engedj LAB activityt production feed/profile/territory világba.
- Ne kerüld meg az admin role gate-et csak azért, mert a route frontend-only sandbox.
- Ne tekintsd a sima `npm test` zöldjét emulator-backend bizonyítéknak.

---

# 12. HASZNOS PARANCSOK

Normál checkpoint:

```bash
cd ~/grundo
git pull --ff-only
npm test
npm run build
```

Emulátoros authoritative változás után:

```bash
npm run test:emulator
```

Frontend deploy csak akkor, ha tényleg szükséges:

```bash
~/grundo/scripts/deploy.sh frontend
```

A teljes script argumentum nélkül backendet is deployol, ezért ne használd reflexből:

```bash
~/grundo/scripts/deploy.sh
```

---

# 13. JELENLEGI GIT CHECKPOINT

A handoff készítésekor a releváns legutóbbi commitlánc vége:

```text
5d06d71 fix: type LAB viewport polygon for h3
b4f8914 fix: type E2E launcher children explicitly
d75f8ec fix: protect fullscreen E2E LAB route
08d3b76 feat: protect fullscreen admin tools without layout
be9c36e feat: link Scenario LAB to E2E production UI
5b30028 fix: render E2E tracking outside admin layout
9aa871d feat: route E2E LAB tracking screens
6e96fb3 feat: add E2E LAB launcher UI
ef0bb4f feat: run LAB telemetry through production tracking UI
f1b2915 feat: let production Dock control LAB tracking
7728a30 feat: scope TrackingScreen tiles to LAB sandbox
a37a249 fix: honor tracking environment for shared position
8cd9c9a feat: share E2E sandbox across scenario runs
c70c373 feat: add isolated E2E LAB sandbox world
98f341b feat: add injectable tracking environment
827cf5b feat: allow LAB to disable shared position side effects
5d3430f feat: add LAB E2E tracking session transport
937328e feat: support isolated LAB recorder providers
7304b68 feat: make recorder source storage and upload injectable

e31dd21 test: compact activities require chunked route
76c9c37 feat: route compact activities to chunked commit
272c20e fix: use explicit compact frontier read scope
c0fa1e4 test: cover compact frontier planning
eced744 fix: make compact frontier layer explicit
7e48e30 feat: plan compact frontier cleanup
1dd7ec8 feat: expose full compact block coverage
6d0f422 feat: aggregate compact claim by transaction group
3405aec test: cover compact production block planner
5d24944 feat: group compact claim credits by production block
09535d0 test: cover production compact block claims
2ba6027 feat: add production compact block claim primitive
f49d28f feat: add shared compact claim credit transition
```

A legutóbbi ellenőrzött build/test **ezeken a commitokon** futott zöldre.

---

# 14. EGYMONDATOS ÁLLAPOT (frissítve: `#12`, 2026-08-25)

**A compact foglalás mostantól végig a production `/api/activities` útján megy: a `planActivity` a hurok belsejét is beleveszi a blokktervbe (enélkül a terület 64%-a némán elveszett volna), a `requiresChunkedClaim()` a geometria alapján a darabolt útra küldi, a `commitChunkedActivity` compact ága res9 blokkonként O(1) átmenettel könyvel, és egy külön frontier fázis rendezi a lopás utáni árva peremet — hét emulátoros teszt bizonyítja, hogy egy 25 km²-es kör teljes belseje könyvelődik anélkül, hogy a homogén blokkok cellánként materializálódnának; a következő fő feladat az E2E LAB izolációjának lezárása, majd a browser-sandbox átkötése erre az immár kész, authoritative backend pipeline-ra.**

⚠️ **Az emulátoros kapu NEM teljesen zöld, és ez NEM ennek a menetnek a
műve:** a `server/src/lib/missionEvaluate.emulator.test.ts` négy tesztje a
`main`-en is bukik (`git stash`-sel ellenőrizve), egy cellányi eltéréssel a
küldetés-előrejelzés cellaszámában. Külön ügy, külön menet.

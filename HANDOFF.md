# GRUNDO handoff

> Frissítve: **2026-08-29** · a **GRUNDO #19** menet vége
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · **telepítve és élesben ellenőrizve** (frontend + backend).
> ⚠️ A telepítés kiütötte a Mapbox tokent — javítva, a részletek lent.

## ⚠️ ELSŐ OLVASNIVALÓ

A #19 fő eredménye: **a küldetés-ajánló 62 s-ról 1,6 s-ra gyorsult** (7,5 km
séta), és a kártyák már **0,5 s-nál megjelennek** az útvonaltervvel, a
terület/GP/mező mezők pedig utólag töltődnek ki.

⚠️ **A #18-as HANDOFF diagnózisa TÉVES VOLT.** Nem a flood fill és nem az
értékelés vitte az időt:

| szakasz (bringa 16 km, 2 jelölt) | idő |
|---|---|
| cellalánc (`traceToCellPath`) | 0,01 s |
| **hurokdetektálás (`detectLoopsDetailed`)** | **9,56 s** |
| flood fill (`loopCells`) | 0,00 s |
| claim + GP | 0,20 s |

A drága rész a `loopDetection.ts` `append()`-je, ami **minden cellánál, minden
jelölt kapura teljes `buildLoopInterior` flood fillt futtat** — a flood fill
tehát a detektoron BELÜL fut, sokszor, nem a végén egyszer. Ezért nem a
hosszal arányos az idő, hanem a kontaktfoltok számával. A #18-ban
„értékelés"-nek mért 8,73 s valójában a **duplán lefuttatott hurokdetektálás**
volt (a `processActivity` újra hívta a `buildActivityGeometry`-t).

**A detektorhoz NEM nyúltam** — az az éles mentési út is, és a spec 2. döntése
szerint ugyanannak a motornak kell futnia. A 19-szeres szorzót szüntettem meg.

## AMI ELKÉSZÜLT

### 1. A válogatás a drága geometria ELÉ került (ez a nagy nyereség)

A `selectMissionRoutes` csak `uTurns`/`shortDetours`/`turnCount`-ot néz — mind
a vonalláncból számolható —, a tűréshatár pedig a hosszból. Ezért a válogatás
előrekerült, és a geometria már csak a ténylegesen kártyára kerülő
jelölteken fut le (`MAX_SHAPED_CANDIDATES = 6`, nagy körökre kevesebb).

| | előtte | utána |
|---|---|---|
| gyalog 7,5 km | 62,13 s | **1,58 s** |
| bringa 16 km | ~80 s (#18 mérése) | **5,42 s** |
| bringa 25 km | — | 12,73 s |

⚠️ **Csapda, amit javítottam:** a sorrend megfordításával a `no_fit` diagnózis
elérhetetlenné vált (ha a hossz-szűrés mindent kidobott, a geometriaciklus le
sem fut, tehát `closedLoops === 0`, ami `no_loops`-ot jelentett volna — „az
úthálózat nem ad kört", pedig a méret nem stimmelt). A `no_fit` vizsgálata
most megelőzi a `no_loops`-ot, és a diagnosztika kapott egy `preselected`
mezőt.

### 2. Kétfázisú végpont — a kártya nem várja meg a területszámítást

```
POST /api/missions/generate  { ...input }                  -> teljes válasz (VÁLTOZATLAN)
POST /api/missions/generate  { ...input, phase: 'plan' }   -> gyors: routes[]
POST /api/missions/evaluate  { type, priority, routes[] }  -> lassú: missions[]
```

⚠️ **A `full` az alapértelmezés, szándékosan**: a backend külön települ, és egy
már telepített web/iOS kliens `phase` nélkül hív — annak továbbra is a kész
küldetéslistát kell kapnia.

⚠️ **Miért két kérés, és nem háttérmunka a válasz után?** Cloud Runon a
konténer CPU-ja a válasz elküldése után nem garantáltan fut tovább — egy
„majd befejezem a háttérben" megoldás ott némán félbemaradna. Így minden kérés
önmagában zárt: nincs job-állapot, nincs poll, nincs új adatmodell.

⚠️ **Nincs állapot a két fázis között**: a kliens visszaküldi a vonalláncot, a
hosszt a szerver ABBÓL számolja újra (`polylineLengthM`), nem hisz a kliens
számának. A kvótát csak a `plan` fázis fogyasztja.

A lassú fél egyetlen közös függvényben van (`evaluateShapedCandidates`), hogy a
`full` és a `plan`+`evaluate` út ne csússzon el egymástól.

**Élőben mérve, a böngészőből (MutationObserver-rel):**
```
ms:   18  → pending: 0, done: 0   (kattintás)
ms:  497  → pending: 2, done: 0   (kártyák MEGJELENNEK útvonallal)
ms: 1746  → pending: 0, done: 2   (kész adatok átveszik)
```

### 3. Felület: töltő állapot (Geri kérése)

A kártya azonnal látszik térképpel és hosszal; a hiányzó mezők helyén
„Területszámítás" / „Pontszámítás" / „Cellakalkuláció" felirat pulzál, a
jelvényben forgó gyűrű. Semleges színű kártya (a karaktere még nem dőlt el),
`prefers-reduced-motion` alatt animáció nélkül.

⚠️ **A „NEM BECSLÉS" szabály sértetlen**: a köztes állapotban nincs közelítő
szám, amit később felülírnánk — a mező üres, csak jelezzük, hogy számolunk.

### 4. Célhossz 50 → 300 km (Geri kérése), és a mérés hozzá

| célhossz | tényleges | tervezés | geometria/jelölt | eredmény |
|---|---|---|---|---|
| 50 km | 64,7 km | 0,42 s | 1,05 s | 3 hurok, 16 611 cella |
| 100 km | 130,9 km | 0,31 s | 2,09 s | 2 hurok, 34 567 cella |
| 200 km | 289,6 km | 1,14 s | **15,93 s** | 7 hurok, 80 386 cella |
| 300 km | 435,3 km | 0,90 s | **18,89 s** | 2 hurok, 9 120 cella |

Az előzetes félelem (a `MAX_LOOP_BBOX_CELLS` ≈150 km² miatt minden nagy kör
elutasításra kerül) **nem igazolódott**: a GraphHopper nem tömör nagy kört
tervez, hanem kanyargósat, ami több kisebb hurkot zár be.

Ezért kapott a jelöltszám célhossz-arányos plafont
(`shapedCandidateLimit`): ≤30 km → 6, ≤100 km → 4, felette → 2. Enélkül egy
300 km-es kérés egymagában ~2 perc lenne.

### 5. Léptethető ÉS gépelhető mezők (Geri kérése)

- A tempó/sebesség mezőbe és a célhossz mezőbe **kézzel is lehet írni**
  (eddig csak −/+ volt). Közös `Stepper` komponens.
- Célhossz lépték: **10 alatt 1, 10 fölött 5, 50 fölött 10**. A határon lefelé
  a kisebb lépték érvényes (50 → 45, nem 40; 10 → 9, nem 5). Mérve:
  `5→6→7→8→9→10→15→…→50→60→70→80`, visszafelé szimmetrikusan.

⚠️ **Két hibát a mérés fogott meg, nem a szemem:**
1. A töltő mező színe/mérete némán a kész értékét vette fel — az új CSS-szabály
   a `.mission__stat-value` ELÉ került, és azonos specificitásnál a későbbi
   nyer. (Ezért áll most kommentben, hogy a sorrend kötelező.)
2. A beviteli mező csak a beírt szöveg szélességét foglalta, tehát a doboz nagy
   részére koppintva nem lehetett beleírni. Javítva: a mező `label`, ami a
   saját területén belül bárhol az inputra adja a fókuszt.

Ezen kívül: **mozgásforma-váltáskor a tempómező kiürül**, mert a mértékegysége
más (perc/km ↔ km/h) — a felület egy ideig „5:15 km/h"-t írt ki. (Korábban ez
rejtve maradt: a mező csak olvasható volt, és a `Number('5:15')` NaN-ja miatt
némán a 22-es alapértéket mutatta.)

## FÁJL-ÖSSZEFOGLALÓ

| Fájl | +/− | Mit tartalmaz |
|---|---|---|
| `server/src/routes/missions.ts` | +445/−87 | A válogatás a geometria elé; `phase: 'plan'` ág; új `/evaluate` végpont; közös `evaluateShapedCandidates`; `shapedCandidateLimit`; `MAX_TARGET_KM` 300; `no_fit`/`no_loops` sorrend javítva. |
| `src/screens/MissionsScreen.tsx` | +280/−21 | Kétfázisú hívás; `PendingResults`/`PendingMissionCard`/`PendingStat`; közös gépelhető `Stepper`; `distanceStepKm`; célhossz-stepper; `changeType` (tempó ürítése). |
| `src/screens/missions.css` | +132 | Töltő kártya, forgó gyűrű, pulzáló felirat, `prefers-reduced-motion`, szerkeszthető stepper-mező. |
| `src/lib/api.ts` | +67 | `PlannedRoute`, `MissionPlanResult` típusok; `missionsPlan` és `missionsEvaluate` hívások. |
| `server/src/lib/missionEvaluate.ts` | +32/−4 | `ShapedCandidate.geometry`; `shapeCandidateCells` visszaadja a geometriát; `evaluateCandidate` `processActivityGeometry`-t hív (nem építi újra). |

**Teendők sorrendje**: push → **nincs adatbázis-lépés** → **kész, telepítve**
(frontend és backend).

## NYITOTT ÜGYEK

1. ⚠️ **Nagy körnél a GYORS fázis is lassú**: 300 km-es kérésnél 17 s, mert a
   route-tervezés 8 irányban, két menetben 16 GraphHopper-hívás. A
   szétválasztás előnye ilyenkor elvész. Lehetséges irány: nagy célhossznál
   kevesebb irány (`MISSION_BEARINGS`). Nem kezdtem el — Geri döntése.
2. ⚠️ **Nagy bringakör + meglévő ownership = nincs küldetés.** A
   `processActivityGeometry` compact ága hibát DOB, ha `ownership.size > 0`
   („Compact hurok ownership-feldolgozása csak a blokkos backend útvonalon
   engedett"), az `evaluateCandidate` pedig elnyeli és `null`-t ad. Emulátoron
   reprodukálva 16 km-es bringakörrel. **Ez NEM az én változtatásom**:
   ellenőriztem, a régi `full` út ugyanezt adja ugyanazokkal a paraméterekkel.
   Éles hiba lehet, külön menetet érdemel.
3. A „Sík / Mászás" választó (a #18-as kérés) — még nincs kidolgozva.
4. GraphHopper élesítés (konténer, `_GRAPHHOPPER_URL`) — továbbra is nyitott,
   élesben még a Mapbox-ág fut.

## ÉLESBEN FUT — TELEPÍTVE ÉS ELLENŐRIZVE

A #19 anyaga **élesben fut** (frontend + backend telepítve 2026-08-29).
Éles méréssel igazolva a `grundo.web.app/kuldetesek` oldalon:

| | |
|---|---|
| gyors fázis (`phase: 'plan'`) | 680 ms |
| lassú fázis (`/evaluate`) | 1 833 ms |
| **teljes** | **2,5 s** |
| felületen: töltő kártya megjelenik | **1,0 s** |
| felületen: kész kártya | 2,0 s |

- A `GRAPHHOPPER_URL` élesben **továbbra is üres**, tehát a Mapbox-ág fut. A
  gyorsítás ezen az ágon is érvényes — a szűk keresztmetszet a geometria volt,
  nem a tervező.

### ⚠️ A TELEPÍTÉS KIÜTÖTTE A MAPBOX TOKENT — ÚJ CSAPDA

A backend telepítése után a küldetés-generálás **`no_routes`-t adott**: a
`cloudbuild.yaml`-ban `_MAPBOX_TOKEN: ''` az alapértelmezés, és a
`--set-env-vars` a szolgáltatás TELJES környezetét felülírja. Az élesbe így
egy rossz (403 Forbidden) token került.

Amit tudni kell:
- A tünet félrevezető: nem 503 („az útvonaltervező nincs beállítva"), hanem
  **200 + `no_routes`** — mert a `directionsConfigured()` csak azt nézi, hogy
  a token NEM ÜRES, azt nem, hogy érvényes-e.
- A hiba a #17-ben már előfordult, a #18-ban javítva lett, és a #19-es
  telepítés **visszahozta**. Ez tehát nem egyszeri baleset: minden
  `gcloud builds submit` megismétli, ha nincs átadva a substitution.
- Javítás újratelepítés nélkül (ez futott le, `grundo-api-00098-g8h`):
  `gcloud run services update grundo-api --region europe-west1 --update-env-vars MAPBOX_TOKEN=pk.…`
  ⚠️ `--update-env-vars`, NEM `--set-env-vars` — az utóbbi elvinné az SMTP-t
  és az `ALLOWED_ORIGINS`-t is.
- Élesben most a **kliens** token fut szerveroldalon (az egyetlen, ami 200-at
  ad). Működik, de a `cloudbuild.yaml` kommentje jogosan kér külön,
  korlátozás nélküli szerver tokent: ha a kliens tokenre valaha URL-korlátozás
  kerül (a böngészős térképek miatt ésszerű), a küldetés-generálás azonnal
  elhasal. **Nyitott ügy** — érdemes a tokent Secret Managerbe tenni, vagy a
  `_MAPBOX_TOKEN` alapértékét kivenni a felülírásból.

## ELLENŐRZÉSEK

- `npx tsc --noEmit` mindkét oldalon tiszta.
- Teljes `npx vitest run`: **556 sikeres, 122 kihagyva** — ugyanaz, mint a #18
  végén, nincs regresszió.
- Emulátoros készlet: 120 sikeres, **2 bukó** az
  `activitiesCompact.emulator.test.ts`-ben. ⚠️ **NEM regresszió**: `git
  stash`-sel ellenőriztem, a tiszta HEAD-en ugyanaz a 2 teszt bukik ugyanazon
  az emulátoron (időtúllépés). Az ok a #18 óta futó, kézi tesztadattal teli
  emulátor — friss `emulators:exec` indítással érdemes újramérni.
- Élő böngészős ellenőrzés emulátoron: kétfázisú betöltés (0,5 s / 1,75 s),
  világos és sötét téma, stepper-léptékek, kézi beírás, a töltő felirat
  elfér (77 px a 125 px-es dobozban), és a kártya **nem ugrik** (töltő 56 px =
  kész 56 px).
- Production build **nem futott** (nem volt csomagméretet érintő változás).

## HELYI KÖRNYEZET

Fut (a #18 óta): Firestore/Auth emulátor, `server/`
(`GRAPHHOPPER_URL=http://localhost:8989`), GraphHopper, és a #19-ben indított
Vite. Indítás, ha nem futnak:

```bash
export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"
```
```bash
cd graphhopper && java -Xmx4g -jar graphhopper-web-11.0.jar server config-grundo.yml
```
```bash
firebase.cmd emulators:start --only auth,firestore --project demo-grundo
```
```bash
cd server && GRAPHHOPPER_URL=http://localhost:8989 npm run dev:emulator
```
```bash
npm run dev:emulator
```

Belépés: `geri@grundo.local` / `grundo-emulator`. Geolokáció a böngészőben:
```js
navigator.geolocation.getCurrentPosition = (s) => s({ coords: { latitude: 47.4979, longitude: 19.0537, accuracy: 10 } });
```

⚠️ A #19-ben a tesztek futtatása **törölte az emulátor felhasználóit** — a
profilt újra létre kellett hozni a felületen. A kvóta nullázása méréshez (a
`firestore.rules` megkerülésével, ezért csak emulátoron működik):
```bash
curl -s -X PATCH "http://localhost:8081/v1/projects/demo-grundo/databases/grundo-db/documents/users/demo-geri?updateMask.fieldPaths=missionQuota" -H "Authorization: Bearer owner" -H "Content-Type: application/json" -d '{"fields":{"missionQuota":{"mapValue":{"fields":{"week":{"integerValue":"0"},"used":{"integerValue":"0"}}}}}}'
```

Mérőszkriptek a `tmp/`-ben (nem verziókövetett), a `server/` mappából
futtatva `npx tsx ../tmp/<fájl>`:
`measure-mission-perf.ts`, `measure-geometry-reuse.ts`, `measure-phase-split.ts`
(ez mutatta meg, hol az idő), `measure-endpoint.ts`, `measure-huge-loops.ts`.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

- **A 2. nyitott ügy (compact + ownership) hibakeresése: Opus, emelt mélység**
  — mért anomália a játékmotor magjában.
- A „Sík/Mászás" választó vagy a GraphHopper élesítése: **Sonnet**, normál
  mélység (meglévő minta kiterjesztése).

## FORRÁSOK SORRENDJE

1. `AGENTS.md` — különösen a Munkamódszer szakasz
2. `HANDOFF.md` (ez a fájl)
3. `server/src/routes/missions.ts` — a kétfázisú lánc és a plafonok
4. `src/screens/MissionsScreen.tsx` — a kétfázisú hívás és a töltő kártya
5. `src/game/loopDetection.ts` — a valódi szűk keresztmetszet (`append`)
6. `docs/02-funkcionalis-spec.md` → Küldetés-ajánló

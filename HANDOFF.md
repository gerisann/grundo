# GRUNDO handoff

> Frissítve: **2026-08-29** · átadás a **#21**-re
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · két párhuzamos menet összeolvasztva:
> **Android zárolt képernyős élő mérés** (Codex, #20) +
> **kétfázisú küldetés-ajánló** (Claude, #19).
>
> ⚠️ **A kettő telepítési állapota KÜLÖNBÖZŐ** — lásd „ÉLESBEN FUT /
> TELEPÍTETLEN". A küldetés-ajánló már élesben fut és ellenőrizve van; az
> Android rész még nincs készüléken.

## ÁLLAPOT

### 1. Android zárolt képernyős élő mérés (Codex, #20)

Elkészült az iOS Live Activity Android megfelelője a már működő location
foreground service-re építve.

- A kompakt notification mutatja a távot, időt és sebességet.
- A kibontott/zárolt képernyős nézet mutatja a mozgásformát, az `Élő` /
  `Szünet` állapotot, valamint külön oszlopban a távot, időt és sebességet.
- Az időt natív Android `Chronometer` rajzolja, ezért lezárt képernyőn és
  felfüggesztett WebView mellett is tovább jár; szünetnél megáll.
- A háttér-GPS a WebView nélkül is frissíti a távot és sebességet. Előtérben a
  közös TypeScript recorder visszaszinkronizálja a pontos, szűrt állapotot.
- A notification állapota `SharedPreferences`-ben is megmarad, ezért a
  foreground service rendszer általi újraindítása után helyreáll.
- Android 13+-on a rögzítés indításakor a plugin kéri a
  `POST_NOTIFICATIONS` engedélyt. Megtagadáskor a GPS-rögzítés nem áll le, de
  a kártya nem jelenik meg a notification drawerben.
- A Beállítások → Értesítések → „Élő mérés a zárolt képernyőn” kapcsoló már
  Androidon is megjelenik. Kikapcsolva a következő rögzítés csak a kötelező,
  egyszerű foreground service értesítést használja.
- Új notification channel: `grundo_tracking_live_v2`.

Android 12+ alatt teljesen egyedi notification nem készíthető: a rendszer a
saját app-fejlécét, ikonját és kibontó vezérlőjét kötelezően hozzáadja. A
csatolt iOS-kártya adatai és hierarchiája átvihető, de a pixelpontos külső nem.

### 2. Kétfázisú és felgyorsított küldetés-ajánló (Claude, #19)

A küldetés-ajánló 7,5 km-es sétánál **62,13 s-ról 1,58 s-ra gyorsult**, és a
kártyák az útvonaltervvel **fél másodpercen belül megjelennek**; a
terület/GP/cella mezők utólag töltődnek ki.

#### A mért szűk keresztmetszet

⚠️ **A #18-as HANDOFF diagnózisa téves volt.** Nem a végső flood fill és nem a
GraphHopper volt lassú. Bringa 16 km, két jelölt:

| szakasz | idő |
|---|---:|
| cellalánc (`traceToCellPath`) | 0,01 s |
| **hurokdetektálás (`detectLoopsDetailed`)** | **9,56 s** |
| végső flood fill (`loopCells`) | 0,00 s |
| claim + GP | 0,20 s |

A detektor (`loopDetection.ts` → `append`) **minden cellánál, minden jelölt
kapura** teljes `buildLoopInterior` flood fillt futtat — a flood fill tehát a
detektoron BELÜL fut, sokszor. Ezért az idő nem a hosszal arányos, hanem a
kontaktfoltok számával. A #18-ban „értékelés"-nek mért 8,73 s valójában a
**duplán lefuttatott hurokdetektálás** volt.

**A közös játékmotorhoz nem nyúltunk** (az az éles mentési út is, és a spec 2.
döntése szerint ugyanannak a motornak kell futnia). A fölösleges, 19 jelöltre
futó és később duplázott geometriamunkát szüntettük meg.

#### Elkészült változások

- A `selectMissionRoutes` válogatása a drága geometria elé került. A geometria
  csak a ténylegesen megjelenő jelölteken fut (`shapedCandidateLimit`:
  ≤30 km → 6, ≤100 km → 4, felette → 2).
- A geometria nem épül fel kétszer: az `evaluateCandidate` a kész geometriát
  kapja meg (`processActivityGeometry`). Mérve: a cella/GP/terület bitre
  azonos maradt.
- ⚠️ A `no_fit` diagnózis ismét helyes: a sorrend megfordításával
  elérhetetlenné vált volna (ha a hossz-szűrés mindent kidobott, a
  geometriaciklus le sem fut, tehát `closedLoops === 0`, ami `no_loops`-ot
  jelentett volna — „az úthálózat nem ad kört", pedig a méret nem stimmelt).
  A `no_fit` vizsgálata most megelőzi a `no_loops`-ot; a diagnosztika
  `preselected` mezőt kapott.
- Kétfázisú API készült:
  - `POST /api/missions/generate` változatlanul teljes választ ad régi
    klienseknek (⚠️ a `full` az alapértelmezés, mert a backend külön
    települ, és a már telepített web/iOS kliens `phase` nélkül hív);
  - `phase: 'plan'` gyorsan visszaadja a `routes[]` listát;
  - `POST /api/missions/evaluate` végzi a lassú geometriát és értékelést.
- ⚠️ **Miért két kérés, és nem háttérmunka a válasz után?** Cloud Runon a
  konténer CPU-ja a válasz elküldése után nem garantáltan fut tovább — egy
  „majd befejezem a háttérben" megoldás ott némán félbemaradna. Így minden
  kérés önmagában zárt: nincs job-állapot, nincs poll, nincs új adatmodell.
- Nincs állapot a két fázis között: a kliens visszaküldi a vonalláncot, a
  szerver pedig abból újraszámolja a hosszt (`polylineLengthM`), nem hisz a
  kliens számának. A kvótát csak a `plan` fogyasztja. A lassú fél egyetlen
  közös függvényben van (`evaluateShapedCandidates`), hogy a két út ne
  csússzon el egymástól.
- A köztes kártyák **nem mutatnak becslést**: „Területszámítás”,
  „Pontszámítás” és „Cellakalkuláció” töltőállapot látszik, majd a valódi
  érték veszi át. (A „NEM BECSLÉS" szabály sértetlen.)
- A tempó/sebesség és célhossz mező gépelhető és léptethető közös `Stepper`
  komponenssel. A célhossz maximuma 300 km; lépték 10 km alatt 1, 10 fölött
  5, 50 fölött 10 (a határon lefelé a kisebb lépték: 50 → 45, 10 → 9).
  Mozgásforma-váltáskor a tempómező kiürül, mert más a mértékegysége
  (perc/km ↔ km/h) — a felület egy ideig „5:15 km/h"-t írt ki.
- A töltő animáció támogatja a `prefers-reduced-motion` beállítást, a kártya
  töltés közben nem ugrik (mérve: töltő 56 px = kész 56 px).

⚠️ **Két hibát a mérés fogott meg, nem a szem:**
1. A töltő mező színe/mérete némán a kész értékét vette fel — az új
   CSS-szabály a `.mission__stat-value` ELÉ került, és azonos specificitásnál
   a fájlban későbbi nyer. (Ezért áll kommentben, hogy a sorrend kötelező.)
2. A beviteli mező csak a beírt szöveg szélességét foglalta, tehát a doboz
   nagy részére koppintva nem lehetett beleírni. Javítva: a mező `label`, ami
   a saját területén belül bárhol az inputra adja a fókuszt.

#### Teljesítménymérések

| eset | eredmény |
|---|---:|
| gyalog 7,5 km | 1,58 s |
| bringa 16 km | 5,42 s |
| bringa 25 km | 12,73 s |

Nagy célhossznál a mért tervezés/geometria:

| célhossz | tényleges | tervezés | geometria/jelölt | eredmény |
|---|---:|---:|---:|---|
| 50 km | 64,7 km | 0,42 s | 1,05 s | 3 hurok, 16 611 cella |
| 100 km | 130,9 km | 0,31 s | 2,09 s | 2 hurok, 34 567 cella |
| 200 km | 289,6 km | 1,14 s | **15,93 s** | 7 hurok, 80 386 cella |
| 300 km | 435,3 km | 0,90 s | **18,89 s** | 2 hurok, 9 120 cella |

Az előzetes félelem (a `MAX_LOOP_BBOX_CELLS` ≈150 km² miatt minden nagy kör
elutasításra kerül) **nem igazolódott**: a GraphHopper nem tömör nagy kört
tervez, hanem kanyargósat, ami több kisebb hurkot zár be. Ezért kapott a
jelöltszám célhossz-arányos plafont — enélkül egy 300 km-es kérés egymagában
~2 perc lenne.

## ÉLESBEN FUT / TELEPÍTETLEN

⚠️ **A két menet állapota eltér — ezt a #21 elején tisztán kell látni.**

### A küldetés-ajánló MÁR ÉLESBEN FUT (telepítve 2026-08-29)

Frontend + backend telepítve, és éles méréssel igazolva a
`grundo.web.app/kuldetesek` oldalon:

| | |
|---|---:|
| gyors fázis (`phase: 'plan'`) | 680 ms |
| lassú fázis (`/evaluate`) | 1 833 ms |
| **teljes** | **2,5 s** |
| felületen: töltő kártya megjelenik | **1,0 s** |
| felületen: kész kártya | 2,0 s |

Ehhez a részhez tehát **nem kell újratelepítés**. A `GRAPHHOPPER_URL` élesben
továbbra is üres, tehát a Mapbox-ág fut — a gyorsítás ezen az ágon is
érvényes, mert a szűk keresztmetszet a geometria volt, nem a tervező.

### Az Android rész TELEPÍTETLEN

- Codemagic **GRUNDO Android Release** build és készülékre telepítés kell.
- Külön backend nem kell hozzá.
- Adatbázis-, Firestore-szabály- és indexváltozás egyik menetben sincs.

### ⚠️ A TELEPÍTÉS KIÜTI A MAPBOX TOKENT — VISSZATÉRŐ CSAPDA

A #19-es backend-telepítés után a küldetés-generálás **`no_routes`-t adott**: a
`cloudbuild.yaml`-ban `_MAPBOX_TOKEN: ''` az alapértelmezés, és a
`--set-env-vars` a szolgáltatás TELJES környezetét felülírja. Az élesbe így
egy rossz (403 Forbidden) token került.

Amit tudni kell:
- A tünet félrevezető: nem 503 („az útvonaltervező nincs beállítva"), hanem
  **200 + `no_routes`** — mert a `directionsConfigured()` csak azt nézi, hogy
  a token NEM ÜRES, azt nem, hogy érvényes-e.
- A hiba a #17-ben már előfordult, a #18-ban javítva lett, és a #19-es
  telepítés **visszahozta**. Ez tehát nem egyszeri baleset: **minden
  `gcloud builds submit` megismétli**, ha nincs átadva a substitution.
- Javítás újratelepítés nélkül (ez futott le, `grundo-api-00098-g8h`):
  `gcloud run services update grundo-api --region europe-west1 --update-env-vars MAPBOX_TOKEN=pk.…`
  ⚠️ `--update-env-vars`, NEM `--set-env-vars` — az utóbbi elvinné az SMTP-t
  és az `ALLOWED_ORIGINS`-t is.
- Élesben most a **kliens** token fut szerveroldalon (az egyetlen, ami 200-at
  ad). Működik, de a `cloudbuild.yaml` kommentje jogosan kér külön,
  korlátozás nélküli szerver tokent: ha a kliens tokenre valaha URL-korlátozás
  kerül (a böngészős térképek miatt ésszerű), a küldetés-generálás azonnal
  elhasal.

## FÁJL-ÖSSZEFOGLALÓ

### Android (Codex, #20)

| Fájl | +/− | Mit tartalmaz |
|---|---|---|
| `android/…/TrackingLocationService.java` | +168/−16 | Élő notification, `Chronometer`, `SharedPreferences` állapot, háttér-GPS frissítés. |
| `android/…/BackgroundLocationPlugin.java` | +81/−3 | `POST_NOTIFICATIONS` engedélykérés Android 13+-on, folytatás-callbackek. |
| `android/…/notification_tracking_expanded.xml` | +112 | Kibontott/zárolt képernyős nézet. |
| `android/…/notification_tracking_compact.xml` | +41 | Kompakt notification nézet. |
| `android/…/TrackingNotificationFormatterTest.java` | +41 | 3 JUnit teszt a formázóra. |
| `android/…/TrackingNotificationFormatter.java` | +29 | Táv/idő/sebesség formázás natív oldalon. |
| `docs/08-android-codemagic.md` | +13/−3 | Az Android build és a notification leírása. |
| `docs/02-funkcionalis-spec.md` | +9/−3 | Az élő mérés specifikációja. |
| `src/screens/settings/NotificationsScreen.tsx` | +5/−3 | A kapcsoló Androidon is megjelenik. |
| `android/…/values/strings.xml` | +5 | Notification szövegek. |
| `src/tracking/types.ts` | +1/−1 | Típus a natív állapothoz. |
| `src/tracking/nativeSource.ts` | +1 | Natív állapot átvezetése. |

### Küldetés-ajánló (Claude, #19)

| Fájl | +/− | Mit tartalmaz |
|---|---|---|
| `server/src/routes/missions.ts` | +445/−87 | A válogatás a geometria elé; `phase: 'plan'` ág; új `/evaluate` végpont; közös `evaluateShapedCandidates`; `shapedCandidateLimit`; `MAX_TARGET_KM` 300; `no_fit`/`no_loops` sorrend javítva. |
| `src/screens/MissionsScreen.tsx` | +280/−21 | Kétfázisú hívás; `PendingResults`/`PendingMissionCard`/`PendingStat`; közös gépelhető `Stepper`; `distanceStepKm`; célhossz-stepper; `changeType`. |
| `src/screens/missions.css` | +132 | Töltő kártya, forgó gyűrű, pulzáló felirat, `prefers-reduced-motion`, szerkeszthető stepper-mező. |
| `src/lib/api.ts` | +67 | `PlannedRoute`, `MissionPlanResult` típusok; `missionsPlan` és `missionsEvaluate` hívások. |
| `server/src/lib/missionEvaluate.ts` | +32/−4 | `ShapedCandidate.geometry`; `shapeCandidateCells` visszaadja a geometriát; `evaluateCandidate` `processActivityGeometry`-t hív. |

## ELLENŐRZÉSEK

Az Android commit önálló ellenőrzései:

- `npm run typecheck`: sikeres.
- Teljes `npm test`: **556 sikeres**, 122 emulátoros teszt kihagyva.
- `npm run build`: sikeres production build.
- `npx cap sync android`: sikeres, 4 plugin felismerve.
- Android JUnit: **3 sikeres**.
- Android `lintDebug`, `lintRelease`, `assembleRelease`, `bundleRelease`:
  sikeres.
- Csatlakoztatott Android készülék nem volt, ezért a lock-screen megjelenés
  még nincs vizuálisan ellenőrizve.

A küldetés-ajánló commit önálló ellenőrzései:

- Kliens- és szerver-TypeScript tiszta.
- Teljes Vitest: **556 sikeres**, 122 kihagyva.
- Élő böngészős ellenőrzés emulátoron: kétfázisú betöltés, világos/sötét téma,
  stepper, kézi beírás és stabil kártyamagasság sikeres.
- Éles ellenőrzés a `grundo.web.app`-on: a kétfázisú betöltés a fenti
  időkkel működik.
- Az emulátoros készletben 120 sikeres és 2, már a tiszta alap-HEAD-en is
  reprodukálható `activitiesCompact` timeout volt; `git stash`-sel igazolva,
  hogy **nem regresszió** (az ok a régóta futó, tesztadattal teli emulátor).

A két ág összeolvasztása után külön `npm run build` futott: a TypeScript és a
Vite production build is sikeres; a meglévő nagy chunk figyelmeztetés maradt.

## KÖVETKEZŐ MENET — #21

1. Geri pusholja az összeolvasztott commitot.
2. Nincs adatbázis-lépés.
3. ⚠️ **A küldetés-ajánlóhoz nem kell telepítés** — az már élesben fut. Ha
   mégis megy backend-telepítés (bármi másért), utána **ellenőrizni kell a
   Mapbox tokent**, mert a `--set-env-vars` kiüti (lásd fent).
4. Codemagicben készüljön **GRUNDO Android Release**, majd az APK kerüljön
   valódi Android készülékre.
5. Androidon legalább 3 perces és 100 méteres rögzítés közben ellenőrizendő:
   kijelzőzár, kompakt/kibontott notification, táv/idő/sebesség, 30 mp szünet,
   folytatás, notification-koppintás és feloldás után hézagmentes nyomvonal.
6. A kapcsolót kikapcsolva új rögzítésnél csak az egyszerű foreground
   notification maradjon.

## NYITOTT ÜGYEK

1. ⚠️ **Nagy bringakör + meglévő ownership = nincs küldetés.** A
   `processActivityGeometry` compact ága hibát dob, ha `ownership.size > 0`
   („Compact hurok ownership-feldolgozása csak a blokkos backend útvonalon
   engedett"), az `evaluateCandidate` pedig elnyeli és `null`-t ad. 16 km-es
   bringakörrel reprodukálható emulátoron, és a régi `full` út is ugyanígy
   viselkedik — **nem a #19 okozta**. Külön, Opus-szintű menet kell.
2. 300 km-es kérésnél a **gyors `plan` fázis is kb. 17 s** lehet a 16
   GraphHopper-hívás miatt (8 irány × 2 menet). Ilyenkor a szétválasztás
   előnye elvész. Lehetséges irány: nagy célhossznál kevesebb bearing
   (`MISSION_BEARINGS`).
3. **Külön, korlátozás nélküli Mapbox szerver token** — élesben most a kliens
   token fut szerveroldalon. Érdemes Secret Managerbe tenni, vagy a
   `_MAPBOX_TOKEN` alapértékét kivenni a `--set-env-vars` felülírásából.
4. A „Sík / Mászás” választó még nincs kidolgozva.
5. GraphHopper élesítése (`_GRAPHHOPPER_URL`) továbbra is nyitott.
6. Az Android notification tényleges mérete és alapértelmezett kibontottsága
   OEM-függő; készülékes képernyőkép alapján lehet finomhangolni.
7. Samsung/Xiaomi/Huawei akkumulátorkezelésnél lezárt képernyős terepi teszt
   kell; nyitott továbbá a csak hozzávetőleges hely, helymegtagadás, appváltás,
   offline pontsor, force stop és Active apps → Stop.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

- Android készülékes megjelenéshez vagy kisebb layout-finomításhoz:
  **Sonnet, normál mélység**.
- Compact + ownership anomáliához vagy Android háttérben elcsúszó idő/táv
  hibához: **Opus, emelt mélység**.
- „Sík/Mászás” választóhoz vagy GraphHopper élesítéshez:
  **Sonnet, normál mélység**.

## FORRÁSOK SORRENDJE

1. `AGENTS.md`
2. `HANDOFF.md` (ez a fájl)
3. `server/src/routes/missions.ts`
4. `src/screens/MissionsScreen.tsx`
5. `server/src/lib/missionEvaluate.ts`
6. `src/game/loopDetection.ts`
7. `android/app/src/main/java/app/grundo/android/TrackingLocationService.java`
8. `android/app/src/main/java/app/grundo/android/BackgroundLocationPlugin.java`
9. `docs/08-android-codemagic.md`
10. `docs/02-funkcionalis-spec.md`

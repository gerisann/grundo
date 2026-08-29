# GRUNDO handoff

> Frissítve: **2026-08-29** · átadás a **GRUNDO #20** menetből a **#21**-re
>
> Repo: `C:\Users\Geri\Documents\ChatGPT\GRUNDO` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · a #20 két párhuzamos eredménye összeolvasztva:
> **Android zárolt képernyős élő mérés** + **kétfázisú küldetés-ajánló**

## ÁLLAPOT

### 1. Android zárolt képernyős élő mérés

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

### 2. Kétfázisú és felgyorsított küldetés-ajánló

A küldetés-ajánló 7,5 km-es sétánál **62,13 s-ról 1,58 s-ra gyorsult**, és a
kártyák élő böngészős mérésben **0,5 s-nál megjelentek** az útvonaltervvel; a
terület/GP/cella mezők 1,75 s körül töltődtek ki.

#### A mért szűk keresztmetszet

Nem a végső flood fill vagy a GraphHopper volt lassú. Bringa 16 km, két
jelölt mérése:

| szakasz | idő |
|---|---:|
| cellalánc (`traceToCellPath`) | 0,01 s |
| **hurokdetektálás (`detectLoopsDetailed`)** | **9,56 s** |
| végső flood fill (`loopCells`) | 0,00 s |
| claim + GP | 0,20 s |

A detektor minden jelölt kapunál belső flood fillt futtat. Magához a közös
játékmotorhoz nem nyúltunk; a fölösleges, 19 jelöltre futó és később duplázott
geometriamunkát szüntettük meg.

#### Elkészült változások

- A `selectMissionRoutes` válogatása a drága geometria elé került. A geometria
  csak a ténylegesen megjelenő jelölteken fut (`shapedCandidateLimit`:
  ≤30 km → 6, ≤100 km → 4, felette → 2).
- A `no_fit` diagnózis ismét helyes: a hosszilleszkedést a `no_loops` előtt
  vizsgáljuk; a diagnosztika `preselected` mezőt kapott.
- Kétfázisú API készült:
  - `POST /api/missions/generate` változatlanul teljes választ ad régi
    klienseknek;
  - `phase: 'plan'` gyorsan visszaadja a `routes[]` listát;
  - `POST /api/missions/evaluate` végzi a lassú geometriát és értékelést.
- Nincs háttérjob és új adatmodell: a kliens visszaküldi a vonalláncot, a
  szerver pedig abból újraszámolja a hosszt. A kvótát csak a `plan` fogyasztja.
- A köztes kártyák nem mutatnak becslést: „Területszámítás”, „Pontszámítás” és
  „Cellakalkuláció” töltőállapot látszik, majd a valódi érték veszi át.
- A tempó/sebesség és célhossz mező gépelhető és léptethető közös `Stepper`
  komponenssel. A célhossz maximuma 300 km; lépték 10 km alatt 1, 10 fölött
  5, 50 fölött 10. Mozgásforma-váltáskor a tempómező kiürül.
- A töltő animáció támogatja a `prefers-reduced-motion` beállítást, a kártya
  töltés közben nem ugrik.

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
| 200 km | 289,6 km | 1,14 s | 15,93 s | 7 hurok, 80 386 cella |
| 300 km | 435,3 km | 0,90 s | 18,89 s | 2 hurok, 9 120 cella |

## ÉLESBEN FUT / TELEPÍTETLEN

- A két változás összeolvasztott commitja még nincs pusholva.
- A küldetés-ajánló kliens- és szerveroldala miatt **frontend- és
  backendtelepítés kell**.
- Adatbázis-, Firestore-szabály- és indexváltozás nincs.
- Az Android zárolt képernyős nézethez Codemagic **GRUNDO Android Release**
  build és készülékre telepítés kell; külön backend nem kell hozzá.
- Élesben a `grundo-api` továbbra is a Mapbox-ágat használja, mert a
  `GRAPHHOPPER_URL` üres. A küldetésgyorsítás ezen az ágon is érvényes.

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
- Az emulátoros készletben 120 sikeres és 2, már a tiszta alap-HEAD-en is
  reprodukálható `activitiesCompact` timeout volt; nem regresszió.

A két ág összeolvasztása után külön `npm run build` futott: a TypeScript és a
Vite production build is sikeres; a meglévő nagy chunk figyelmeztetés maradt.

## KÖVETKEZŐ MENET — #21

1. Geri pusholja az összeolvasztott commitot.
2. Nincs adatbázis-lépés.
3. Telepítési sorrend: **backend → frontend** a kétfázisú API visszafelé
   kompatibilis szerződése miatt.
4. Codemagicben készüljön **GRUNDO Android Release**, majd az APK kerüljön
   valódi Android készülékre.
5. Androidon legalább 3 perces és 100 méteres rögzítés közben ellenőrizendő:
   kijelzőzár, kompakt/kibontott notification, táv/idő/sebesség, 30 mp szünet,
   folytatás, notification-koppintás és feloldás után hézagmentes nyomvonal.
6. A kapcsolót kikapcsolva új rögzítésnél csak az egyszerű foreground
   notification maradjon.
7. Éles telepítés után a küldetés-ajánlón ellenőrizendő a gyors kártyamegjelenés
   és az utólag betöltődő terület/GP/cella érték.

## NYITOTT ÜGYEK

1. **Nagy bringakör + meglévő ownership = nincs küldetés.** A
   `processActivityGeometry` compact ága hibát dob, ha `ownership.size > 0`,
   az `evaluateCandidate` pedig `null`-t ad. 16 km-es bringakörrel
   reprodukálható, és a régi `full` út is ugyanígy viselkedik. Külön,
   Opus-szintű hibakeresési menet kell.
2. 300 km-es kérésnél a gyors `plan` fázis is kb. 17 s lehet a 16
   GraphHopper-hívás miatt. Lehetséges irány: nagy célhossznál kevesebb bearing.
3. A „Sík / Mászás” választó még nincs kidolgozva.
4. GraphHopper élesítése (`_GRAPHHOPPER_URL`) továbbra is nyitott.
5. Az Android notification tényleges mérete és alapértelmezett kibontottsága
   OEM-függő; készülékes képernyőkép alapján lehet finomhangolni.
6. Samsung/Xiaomi/Huawei akkumulátorkezelésnél lezárt képernyős terepi teszt
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

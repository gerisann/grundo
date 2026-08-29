# GRUNDO handoff

> Frissítve: **2026-08-29** · átadás a **GRUNDO #18** menetből a **#19**-re
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · kód változott, de **nincs mit telepíteni** — a GraphHopper
> csak localhoston fut, az élesben futó szerver változatlanul a Mapbox-ágon
> megy tovább (lásd lent, „ÉLESBEN FUT / TELEPÍTETLEN").

## ⚠️ ELSŐ OLVASNIVALÓ

**A #19 fő feladata: a küldetés-ajánló válaszideje TÚL LASSÚ nagy körökre.**
Mérve élő GraphHopperrel, bringa 16 km, „hosszú egyenesek" karakter:

| szakasz | idő |
|---|---|
| GraphHopper (route-tervezés, 19 jelölt) | 0,72 s |
| **Cellafeldolgozás (flood fill, mind a 19 jelölten)** | **1:09,78** |
| Birtokviszony betöltése (Firestore) | 0,09 s |
| **Értékelés (GP/claim, csak a 3 kiválasztotton)** | **8,73 s** |
| **ÖSSZESEN** | **~80 s** |

Futásra/sétára kisebb, de ott is ~15–20 s. Geri kifejezetten kimondta: erre
**másodpercek** vannak, nem percek — jelenleg webes kérésként ez élesben
időtúllépést vagy egyszerűen elfogadhatatlan várakozást jelentene.

**A ok NEM a GraphHopper.** A route-tervezés 0,7 másodperc. A teljes idő a
**cellafeldolgozásban** (flood fill a hexrácson) és az **értékelésben** megy
el — ez ARÁNYOS a bezárt terület méretével (egy 16-18 km-es bringakör
15 000+ cellát zár be *jelöltenként*), és ma **mind a 19 nyers jelölten**
lefut, mielőtt a legjobb 3-4-et kiválasztanánk.

**A megbeszélt irány (Geri döntése, 2026-08-29):** a route-tervezést
(gyors) és a terület/cella-számítást (lassú) SZÉT KELL VÁLASZTANI — gyors
útvonal-lista azonnal a felhasználónak, a terület/GP a háttérben számolódik,
és a felület utólag frissül, amint kész. **Ez adatmodell- és API-szerződés-
döntés** (mit ad vissza azonnal a `/api/missions/generate`, kell-e
poll-végpont vagy valami más frissítési mechanizmus a kliensen, hogyan néz ki
a „még számol" kártyaállapot) — az AGENTS.md 0. pontja szerint ez **Opus,
emelt mélység**, nem rutin kiterjesztés.

⚠️ **A „NEM BECSLÉS" szabály (AGENTS.md 2. döntés) idekerül a döntés
közepébe** — eddig a küldetés-kártya MINDIG a valódi motor pontos eredményét
mutatta. A szétválasztás nem ezt a szabályt töri meg (a végleges szám
továbbra is a valódi motorból jön, csak később), hanem az eddigi „egy
kérés → egy azonnali, teljes válasz" mintát. Első lépésként érdemes
tisztázni Gerivel: a gyors fázis milyen adatot mutasson a kártyán a lassú
fázis befejezéséig (semmit? útvonal + hossz, terület nélkül? egy laza
becslés, amit a végleges felülír?) — ez már önmagában ütközhet a szabállyal,
ha „laza becslés" irányba mennénk.

**Egy olcsó, kockázatmentes RÉSZLEGES javítás is elérhető, ha a teljes
szétválasztás nem fér bele egy menetbe**: a 19 nyers jelöltet ingyenes
jelekből (hosszeltérés a célhossztól, U-fordulás, kanyarszám — mind a
polyline-ból, cella nélkül számolható) 5-6-ra szűrni A CELLAFELDOLGOZÁS
ELŐTT. Ez nagyjából harmadára-negyedére vágja a nagy körök idejét
(~80 s → ~20-25 s) anélkül, hogy bármit is becslne — de a Geri által kért
„pár másodperc"-et önmagában NEM éri el.

## MÁSODIK NYITOTT KÉRÉS EBBŐL A MENETBŐL

Geri: a részletes keresőbe kerüljön egy **„Sík / Mászás" választó**, ahol a
felhasználó megadhatja, hogy sík terepet vagy sok szintkülönbséget keres.
Még nincs kidolgozva — se UI, se szerver oldalon. Jó eséllyel a GraphHopper
egyedi modell egy `elevation`/`average_slope`-szerű OSM-alapú szabályával
oldható meg, hasonlóan a kanyargós/egyenes kapcsolóhoz, de ehhez a
`graph.encoded_values` listát bővíteni kell (`average_slope` vagy hasonló
kódolt érték felvétele + újraimportálás), és meg kell nézni, van-e elég
domborzati adat a magyar OSM-kivonatban. **Nem méretezve, nem kezdve.**

## ÉLESBEN FUT / TELEPÍTETLEN

- Élesben (`grundo-api`, Cloud Run) **változatlanul a Mapbox-ág fut** —
  a `#17`-ben talált token-hiba (rossz, URL-korlátozott token volt
  beállítva) javítva van (`grundo-server-directions` tokenre cserélve,
  ellenőrizve `curl`-lal, 200 OK).
- A GraphHopper **csak localhoston** fut ebben a menetben. A
  `cloudbuild.yaml` `_GRAPHHOPPER_URL` substitution előkészítve, de
  **üresen** — élesítés a `#19` UTÁNI menet feladata (korábbi tervben
  `#19` volt, most csak azért csúszik, mert a teljesítmény-kérdés elébe
  került).
- **Kód készen áll, de NINCS mit push/deploy-olni ezen felül** — a
  `directions.ts` GraphHopper-ága és a felületi kapcsoló a `main`-en van,
  de amíg a `GRAPHHOPPER_URL` élesben üres, a szerver a régi Mapbox-utat
  használja. Semmi nem törik el attól, ha ez a commit push-olva/deployolva
  lesz — csak nem aktiválódik semmi új.

## A #18 MENETBEN KÉSZ ÉS ÉLŐBEN TESZTELT

1. **GraphHopper bekötve** (`server/src/lib/directions.ts` → `planMissionLoop`):
   `algorithm=round_trip`, irányonként 3 mag, Mapbox-tartalék változatlan
   marad, ha a `GRAPHHOPPER_URL` üres vagy a GraphHopper nem ad jelöltet.
2. **A kanyargós ↔ hosszú egyenesek kapcsoló** működik — a felületen
   (részletes kereső, séta esetén rejtve) és a szerveren (a kérésbe ágyazott
   `turn_penalty` szakasz csak `straight`-nál kerül be). ÉLŐ teszttel
   igazolva: ugyanaz a hely/hossz, kanyargós vs. egyenes karakterrel
   **láthatóan más geometriát** ad (kevesebb kanyar, hosszabb szakaszok).
3. **Két, korábban rejtve maradt GraphHopper-config hiba javítva**
   (`graphhopper/config-grundo.yml`, most 5 dokumentált buktató):
   - `custom_model_files` rossz fájlnévre mutatott (`foot.json`/`bike.json`
     nem létezett; a valódiak `grundo_run.json`/`grundo_bike.json`);
   - a szerver szintű alapmodellnek kötelező `speed` szakasza is — enélkül
     a szerver INDULÁSKOR elhasal. Hozzáadva mindkét `custom_models/*.json`-hoz
     (`foot_average_speed`/`bike_average_speed`).
   Mindkettőt élő szerver-indítással fedeztem fel és igazoltam a javítást.
4. **`turnCount`/`measureStraightness`** új mérték a `routeShape.ts`-ben —
   gyenge súlyú tiebreaker a válogatásban, nem írja felül a játékértéket.
5. `.gitignore` kiegészítve — a GraphHopper jar (~47 MB), az OSM-kivonat
   (~320 MB) és a `graph-cache/` **korábban NEM volt kizárva**, majdnem
   bekerültek volna a repóba. Most `graphhopper/*.jar`, `*.osm.pbf`,
   `graph-cache/`, `*.log`.

## FÁJL-ÖSSZEFOGLALÓ

| Fájl | +/− | Mit tartalmaz |
|---|---|---|
| `server/src/lib/directions.ts` | +226/−17 | Új `planMissionLoop` (GraphHopper elsőként, Mapbox tartalékban), a régi `planLoop` (Mapbox) érintetlen. |
| `server/src/lib/directions.test.ts` | +74 | 4 új teszt: GraphHopper-hívás alakja, straight/twisty, Mapbox-fallback, egyik motor sincs beállítva. |
| `server/src/routes/missions.ts` | +18/−9 | A régi `loopWaypoints`-hívás lecserélve `planMissionLoop`-ra, `routeCharacter` bemenet. |
| `server/src/lib/missionEvaluate.ts` | +3 | `turnCount` mező átvezetve `ShapedCandidate`-en. |
| `src/game/missions.ts` | +2 | `turnCount?` a `MissionCandidate`-en. |
| `src/game/routeShape.ts` | +50/−3 | Új `measureStraightness` export, `routeDefectScore` kiterjesztve. |
| `src/lib/api.ts` | +9 | `RouteCharacter` típus, `generateMissions` bemenet bővítve. |
| `src/screens/MissionsScreen.tsx` | +28/−1 | „Kanyargós / Hosszú egyenesek” kapcsoló a részletes keresőben (séta esetén rejtve). |
| `graphhopper/config-grundo.yml` | +17/−9 | `custom_model_files` javítva, öt dokumentált buktató. |
| `graphhopper/custom_models/grundo_run.json`, `grundo_bike.json` | +3/+3 | `speed` szakasz hozzáadva. |
| `graphhopper/README.md` | +14 | A szerver bekötésének leírása (`GRAPHHOPPER_URL`). |
| `cloudbuild.yaml` | +10/−1 | `_GRAPHHOPPER_URL` substitution előkészítve, üresen. |
| `.gitignore` | +8 | GraphHopper jar/pbf/graph-cache/log kizárva. |

**Teendők sorrendje**: push → **nincs adatbázis-lépés** → **nincs
telepítés szükséges** (a `GRAPHHOPPER_URL` élesben üres marad, amíg a
teljesítmény-kérdés meg nem oldódik és a motor élesítve nincs).

## HELYI KÖRNYEZET — LEHET, HOGY MÉG FUT

Ebben a menetben a localhoston egyszerre futott: Firestore/Auth emulátor,
`server/` (`GRAPHHOPPER_URL=http://localhost:8989`-cel indítva), és a
GraphHopper maga (Magyarország importálva, `graph-cache/` már kész — **nem
kell újraimportálni**, csak újraindítani). Ha a folyamatok még futnak (a
munkamenet háttérfolyamataiként), a #19 rögtön tud rajtuk mérni; ha nem,
indítás:

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

Belépés: `geri@grundo.local` / `grundo-emulator`. Böngészőből geolokáció
nélkül teszteléshez (a headless böngésző nem ad valódi pozíciót):
```js
navigator.geolocation.getCurrentPosition = (s) => s({ coords: { latitude: 47.4979, longitude: 19.0537, accuracy: 10 } });
```

A `tmp/verify-planMissionLoop.ts` egy kész, élő GraphHopper elleni
ellenőrző szkript (`npx tsx tmp/verify-planMissionLoop.ts` a `server/`
mappából) — gyors szemrevételezéshez kód nélkül is futtatható, nem
verziókövetett.

## NYITOTT KÉRDÉSEK A #19-HEZ

- **Milyen adatot mutasson a kártya a gyors fázis után, a lassú fázis
  végéig?** (Ez az első döntés — lásd fent, „NEM BECSLÉS" ütközés.)
- **Frissítési mechanizmus**: polling (`GET /api/missions/{jobId}`), SSE,
  vagy valami egyszerűbb (pl. csak a kis körökre menjen szinkron, a nagyokra
  adjon vissza egy `pending` állapotot)?
- **Meddig „kicsi” egy kör, ami még szinkron elfér pár másodpercben?** Ezt
  méréssel kell megállapítani (a mai adat csak két pontot ad: 7,5 km ~15-20 s,
  16-18 km ~80 s).
- A korábbi #18-as tervben szereplő „élesítés” (GraphHopper konténerbe,
  Cloud Run/VM) ez után a menet után jön — a teljesítmény-architektúra
  eldöntése előtt nincs értelme élesíteni.
- A „Sík/Mászás” kapcsoló (lásd fent) — külön menet, miután a #19
  lezárult, vagy bele fér a #19-be, ha a teljesítmény-döntés gyorsan megy?
  Geri döntése.

## ELLENŐRZÉSEK

`npx tsc --noEmit` mindkét oldalon tiszta. Teljes `npx vitest run`: **556
sikeres, 122 kihagyva** (emulátoros). Élő, valódi GraphHopper elleni teszt:
futás 2,5 km (kanyargós/egyenes) és bringa 16-18 km (kanyargós/egyenes) —
mind helyes, bezáruló geometriát adott, a Missions képernyőn keresztül
végigvíve a böngészőben.

Production build **nem futott** ebben a menetben (nem volt csomagméretet
érintő változás).

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**#19 — a route-tervezés/terület-számítás szétválasztása: Opus, emelt
mélység.** Ez adatmodell- és API-szerződés-döntés (mit ad vissza azonnal a
végpont, kell-e új frissítési mechanizmus, hogyan él ez együtt a „NEM
BECSLÉS" szabállyal) — pontosan az AGENTS.md 0. pontjában megnevezett eset,
nem rutin kiterjesztés.

## FORRÁSOK SORRENDJE

1. `AGENTS.md` — különösen a Munkamódszer szakasz
2. `HANDOFF.md` (ez a fájl)
3. `server/src/routes/missions.ts` — a mért szűk keresztmetszet pontosan itt van (`shapeCandidateCells` a `withLoops` ciklusban, majd `evaluateCandidate`)
4. `server/src/lib/directions.ts` fejléce — a GraphHopper/Mapbox kettősség
5. `graphhopper/README.md` — a motor, a mért számok és a buktatók
6. `docs/02-funkcionalis-spec.md` → Küldetés-ajánló

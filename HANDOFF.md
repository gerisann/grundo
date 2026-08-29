# GRUNDO handoff

> Frissítve: **2026-08-29** · a **#20** menet vége, átadás **#21**-re
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` (EGYETLEN klón — a második
> `Documents\ChatGPT\GRUNDO` törölve) · GitHub: `gerisann/grundo`
>
> Ág: **`main`**, MÉG NEM pusholva (Geri dolga). **GraphHopper élesítve és
> bizonyítottan működik.** A #20 menetben javítva: GPS-drift hamis
> aktivitás, a cellák látható betöltődése, a nagy bringakör+meglévő birtok
> "nincs küldetés" hibája (ÉLŐ PREVIEW ÉS A KÜLDETÉS-AJÁNLÓ IS), admin
> oldalak szélessége, dock háttere/border-je. `npx tsc --noEmit` tiszta,
> teljes `npx vitest run`: 559/682 sikeres (123 kihagyva, nincs
> regresszió — egy ÚJ teszt emulátor hiányában kihagyva, lásd lent).

## #20 MENETBEN JAVÍTVA

### GPS-drift hamis aktivitás — MEGOLDVA

A #19 diagnózisa (telefont zárolt képernyővel egy órán át hagyva, meg sem
mozdulva, az app 2,99 km futást és 703 m emelkedést rögzített) alapján:

- **Horgony (anchor) alapú távolságszámítás.** Új tunable:
  `GAMEPLAY.GPS_STATIONARY_RADIUS_M = 12` (`src/config/gameplay.ts`). Amíg
  egy minta ezen a körön belül marad egy rögzített horgonyhoz képest, a táv
  nem nő és a horgony nem mozdul — csak TARTÓS elmozdulásnál "ébred fel".
  Ez a régi pontpáronkénti `MIN_MOVE_M` szűrő hibáját oldja: egy 5-15 m-es
  beltéri ugrás önmagában mindig "elfogadható" volt, és sok ilyen összeadva
  adta a hamis kilométereket.
  - `src/tracking/recorder.ts`: `applySample` (O(1) append eset) és az új
    `anchoredTotal()` (újraszámolási eset + `currentSpeedMps`) — utóbbi
    javítja az induláskori hamis 10-20 km/h-t is.
  - `src/tracking/filter.ts`: `FILTER.STATIONARY_RADIUS_M` a közös
    konstansra mutat.
  - `src/game/splits.ts`: `computeSplits` és `elevationProfile` UGYANEZT a
    horgonyt használja — ez oldja az `ELEVATION_NOISE_M` hamis emelkedését
    is, horizontális elmozdulás nélkül nincs szintszámítás.
  - Új tesztek: `src/tracking/recorder.test.ts` ("GPS-horgony" leírás, 2
    teszt: egy órányi beltéri zajra 0 a táv, valódi 200 m-es séta viszont
    pontosan mérve) és `src/game/presentation.test.ts` (beltéri zaj sem
    táv-, sem szintsort nem ad).
  - **NEM lett bevezetve**: `altitudeAccuracy` a típuslánchoz — a horgony
    már horizontális szinten kiszűri az indoor esetet, ez elegendőnek tűnt
    a mért esetre. Ha később kiderül, hogy VALÓDI (kültéri, mozgó) aktivitás
    ad hamis emelkedést, ez még mindig nyitott továbblépés.

### Grund-térkép: cellák látható betöltődése — MEGOLDVA

`src/screens/TerritoryScreen.tsx`: új `padView()` a `loadTiles()`-ban, a
`tiles`-hívás határát 2,5×-ösére tolja ki minden irányban
(`TILE_PREFETCH_PAD = 0.75`, azaz +75% mindkét oldalon), MIELŐTT elmegy a
szerverre — a `blobs`-hívás változatlan (előszámolt egység, nem kell). A
válaszméret-hatást (nagy nagyításnál sok cella, kicsi nagyításnál nagy
terület) **még nem mértük élesben** — érdemes ránézni, ha a `/api/tiles`
válaszidő vagy méret gyanúsan megnő.

### Nagy bringakör + meglévő birtok = nincs küldetés — MEGOLDVA (KÉT HELYEN)

A gyanú beigazolódott, és KÉT különálló helyen ugyanaz a gyökérok
jelentkezett — a motor (`src/game/index.ts` `processActivityGeometry`)
SZÁNDÉKOSAN dob, ha a hurok compact belsejű (nagy hurok, `hasCompactLoop`)
ÉS `ownership.size > 0` — ez majdnem MINDIG igaz, mihelyt a játékosnak van
bármi birtoka a közelben, hiszen a valódi elszámolás csak a szerver
blokkos útján (`server/src/routes/activities.ts` `requiresChunkedClaim`)
történhet.

1. **Élő preview rögzítés közben** — `src/screens/TrackingScreen.tsx`
   `preview` (kb. 190. sortól) VALÓDI `nearby` ownershippel hívta a motort;
   a `catch` ág ezt "GPS-ugrásnak" félreértelmezve némán nullázta a
   preview-t (0 claim, 0 GP), miközben a feltöltés után a terület
   ténylegesen bekerült.
2. **A KÜLDETÉS-AJÁNLÓ maga** — ez a SÚLYOSABB, mert Geri screenshotjain
   ez látszott: 50 km és 150 km célhossznál a jelöltek geometriája/távja
   kiszámolt (a "SZÁMÍTÁS" kártyák helyes km-t mutattak), de a VÉGSŐ lista
   üres lett, "Most nincs ajánlható küldetés" — mert `server/src/lib/
   missionEvaluate.ts` `evaluateCandidate` a jelöltet VALÓDI (Firestore-ból
   olvasott) ownershippel adta át a motornak, ami minden nagy hurkos
   jelöltre dobott; a `catch` ág `null`-t adott vissza MINDEGYIKRE, a
   `pickMissions` pedig üres listát ad, ha nincs egyetlen használható
   jelölt sem.

Mindkét helyen ugyanaz a javítás: ha a geometria compact belsejű
(`hasCompactInterior`), üres `Map()` ownershippel hívjuk a motort — ez az
"üres világ" (LAB-szerű) becslést adja, pontos GP-vel és cellaszámmal,
csak a lopott/visszafoglalt cella MEGKÜLÖNBÖZTETÉSE (és ezáltal a `raid`/
`fortify` küldetés-karakter) vész el nagy huroknál. Élő preview-nál ez a
térképen csak a hurok fal/határsávjának kirajzolását jelenti (a compact
belső parent-cellák vizuális megjelenítése nincs bekötve — lásd NYITOTT
ÜGYEK).

⚠️ **Új emulátoros regressziós teszt íródott** (`server/src/lib/
missionEvaluate.emulator.test.ts` → "nagy (compact belsejű) hurok MEGLÉVŐ
birtok mellett is ad küldetést"), DE a #20 menetben a Firestore emulátor
8081-es portja már foglalt volt (másik munkamenet futtatta) — a tesztet
NEM sikerült lefuttatni éles emulátor ellen, csak `tsc` igazolja, hogy
fordul. **Első dolog #21-ben**: `firebase.cmd emulators:exec --only
firestore --project demo-grundo "npx vitest run server/src/lib/
missionEvaluate.emulator.test.ts"` (a Java PATH-csapdára lásd AGENTS.md).

### Admin oldalak szélesség-maximalizálása — MEGOLDVA

`src/admin/admin.css` `.admin__body`: a `max-width: 900px; margin: 0 auto;`
törölve. A `/admin/lab` már korábban is felülírta ezt (`simulation-
lab.css` `:has(.lab-shell)`), az a szabály most redundáns, de nem árt.

### `.dock` háttér/border — MEGOLDVA

`src/components/Dock.css:19-21`: `background: none; border: none;` (a
`border-radius`, `box-shadow`, `backdrop-filter` és a `.dock--blend`/
`.dock--paused` állapotváltozatok érintetlenek, mert Geri kifejezetten csak
a háttért és a bordert kérte).

## NYITOTT TÉMA — küldetés-ajánló finomítás

Geri visszajelzései (#21, GraphHopper élesítés UTÁN kezdhetők):

1. **Találatszám 1–5, állítható a részletes keresőben.** Geri döntése: a
   beállítás felső korlát; ha az átfedés-szűrés (`MAX_MISSION_OVERLAP = 0.6`
   a `src/game/missions.ts`-ben) miatt kevesebb jönne ki a kértnél, a szűrés
   LAZULJON a szám eléréséért; csak ha úgy sem megy, adjon kevesebbet és
   mondja meg miért. Geri szerint városban „kizárt", hogy ne legyen 5 érdemi
   variáció — a mai mérés (5-6 útvonalból 1 kártya) ezt alátámasztja: a
   szűk keresztmetszet a válogatás, nem az úthálózat.
2. **GPS-ingadozás → más eredmény ugyanarra a kérésre.** Mérve: 10-20 m
   eltolt kiindulópont 1 vs. 3 kártyát ad. Javaslat (még nem kezdve): a
   kiindulópont rácsra kerekítése a küldetés-generáláshoz.
3. **Sík / emelkedős választó.** GraphHopperrel megoldható, de domborzati
   adat (SRTM) és TELJES újraimportálás kell hozzá — külön, hosszabb kör.

## ÉLESBEN FUT — ELLENŐRIZVE

### GraphHopper (ÚJ ebben a menetben, működik)

Külön Cloud Run szolgáltatás (`grundo-graphhopper`), a gráf BUILD KÖZBEN
épül fel (`graphhopper/Dockerfile` → `import`), `--no-allow-unauthenticated`.
A `grundo-api` Google-aláírt ID-tokennel hívja a metaadat-szervertől
(`server/src/lib/directions.ts` → `graphhopperIdToken`, saját kulcs/Secret
Manager nélkül).

**Élőben igazolva**: `POST /route` → `200 OK` a `grundo-graphhopper`
naplójában, pontosan a küldetés-generálás időpontjában. Kanyargós/egyenes
karakter eltérő útvonal-hosszakat ad (7,3/6,9/6,9 vs 7,2/8,2/7,5 km).

⚠️ **Telepítés csak ritkán, külön paranccsal**:
```bash
~/grundo/scripts/deploy.sh graphhopper
```
NEM része az `all` módnak — a gráf csak OSM-frissítésnél vagy a
`graphhopper/` mappa változásakor épül újra (percekig tart).

**Egyszeri beüzemelés (MÁR MEGTÖRTÉNT, dokumentálva ha meg kell ismételni):**
1. `gcloud run services add-iam-policy-binding grundo-graphhopper --region=europe-west1 --member="serviceAccount:65689674957-compute@developer.gserviceaccount.com" --role="roles/run.invoker"`
2. Backend újratelepítése `--substitutions=_GRAPHHOPPER_URL=https://…`

⚠️ **Csapda, amibe belefutottunk és javítva**: a `deploy.sh` mód-ellenőrzése
a `git pull` ELŐTT volt, ezért egy elavult helyi másolat sosem jutott el
odáig, hogy frissítse magát — új módot (mint a `graphhopper`) a régi
szkript nem ismert, és azonnal elhalt, `info` sorok nélkül. JAVÍTVA
(`de98101`): az ellenőrzés a dispatch `case` végén van, a pull UTÁN.
**Ha ismét „Ismeretlen mód" jön minden `▸` sor nélkül**: `cd ~/grundo &&
git pull` kézzel, utána a szkript már önmagától is frissül.

Mért hidegindítás: ~8-15 s hosszú szünet után (nullára skálázva), utána
percekig meleg. Összemérhető a backend saját hidegindításával (~12 s).

### Küldetés-ajánló (a #19-ből, változatlanul él)

Gyors fázis + lassú fázis szétválasztva, ~0,7-0,8 s meleg állapotban. Lásd
a #19/#20-as HANDOFF-tartalmat a git történetben, ha a részletek kellenek
(`git show b149cdf:HANDOFF.md` stb.) — ez a fájl a hellyel spórolva csak a
MOST aktuális állapotot tartja.

### Mapbox token — megoldva, Secret Managerből jön

`MAPBOX_TOKEN` a Secret Managerből (`--set-secrets`), a telepítés nem tudja
kiütni. Csere: `gcloud secrets versions add MAPBOX_TOKEN --data-file=-` +
újratelepítés, kódváltozás nélkül. Élesben a KLIENS token fut szerveroldalon
(közös, nem korlátozott) — külön szerver token még nyitott, kis prioritású
ügy.

## KISEBB, KÉSZ JAVÍTÁS EBBEN A MENETBEN

**Stepper mezők** (`src/screens/MissionsScreen.tsx`, `missions.css`):
kézzel gépelhetők (eddig csak −/+), és az érték a doboz KÖZEPÉN áll, nem a
szélén (`size` attribútum a tartalomhoz igazítva, mérve: 0 px eltérés a
középtől minden értéknél).

## NYITOTT ÜGYEK

1. 300 km-es kérésnél a gyors fázis is ~17 s (16 GraphHopper-hívás egyszerre)
   — GraphHopper élesítése után érdemes újramérni, lehet, hogy javult. Még
   nem mérve.
2. Android: Codemagic build + készülékes teszt még nem történt meg.
3. **A nagy/compact hurok élő preview-ja csak a fal/határsávot rajzolja ki**
   (lásd fent, „Nagy bringakör…" — MEGOLDVA rész). A GP-szám pontos, de a
   compact belső parent-cellák vizuális kirajzolása nincs bekötve. Ha Geri
   ezt is látni akarja élőben: `result.compactClaim` kellene átadni a
   `HexMap`-nek/`MapView`-nak, réteges (parent-szintű) rendereléssel. Nincs
   megbecsülve, mekkora munka.

## ELLENŐRZÉSEK

- `npx tsc --noEmit` mindkét oldalon tiszta.
- Teljes `npx vitest run`: 559 sikeres, 123 kihagyva — nincs regresszió (4 új
  teszttel bővült: `recorder.test.ts` GPS-horgony leírás [2], `presentation.
  test.ts` beltéri zaj eset [1], `missionEvaluate.emulator.test.ts` nagy
  compact hurok + meglévő birtok [1, emulátor nélkül kihagyva — lásd fent]).
- GraphHopper Dockerfile: NEM lett helyben lebuildelve (nincs helyi Docker),
  csak a `gcloud builds submit` igazolta — az sikerrel lefutott élesben.
- Éles kéréssel igazolva: küldetés-generálás, kanyargós/egyenes eltérés,
  Cloud Run napló (`POST /route` → 200).
- A #20 menet fenti javításai (GPS-horgony, tiles-bbox, compact-preview,
  admin szélesség, dock) valós telefonon/böngészőben MÉG NINCSENEK
  kipróbálva — csak tsc + vitest igazolja őket.

## FORRÁSOK SORRENDJE

1. `AGENTS.md` — Munkamódszer szakasz, és az ÚJ „natív appok" rész
2. `HANDOFF.md` (ez a fájl)
3. `src/config/gameplay.ts` → `GPS_STATIONARY_RADIUS_M` — a GPS-drift javítás
   közös konstansa
4. `src/tracking/recorder.ts` — `applySample`, `anchoredTotal`,
   `currentSpeedMps`
5. `src/game/splits.ts` — `computeSplits`, `elevationProfile`
6. `server/src/lib/missionEvaluate.ts` — `evaluateCandidate` (a küldetés-
   ajánló "nincs küldetés" hibájának VALÓDI helye)
7. `graphhopper/README.md` → Élesítés — ha a GraphHopper-t kell újratelepíteni
8. `server/src/lib/directions.ts` → `graphhopperIdToken`

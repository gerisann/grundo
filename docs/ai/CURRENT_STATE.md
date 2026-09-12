# Jelenlegi állapot

> Frissítve: **2026-09-12** · Menetszám: **#48 · lezárva**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **main** · HEAD: **e100e50**
> Utoljára dolgozott: **Claude (Opus, High)**
> Átadva: **Claude**

## Jelenlegi cél

Az **A→B útvonaltervezés végig elkészült és élesben fut**: backend, felület,
navigáció. Verzió **1.3.5**, frontend és backend telepítve, a Changelog
szinkronizálva.

A következő lépés a **készülékes ellenőrzés** (TestFlight / Android Release) —
a menet több platform-érzékeny dolgot érintett (térképi koppintás,
helymeghatározás a tervezőben, mentés-panel átfedések), amit böngészőben nem
lehet igazolni.

Spec: [`../routing/point-to-point.md`](../routing/point-to-point.md) ·
adatforrások és mérések:
[`../routing/data-sources.md`](../routing/data-sources.md).

## Elkészült

- **`POST /api/routes/plan`** — hitelesítés, a küldetés-ajánlóval KÖZÖS heti
  keret (`missionQuota`), 100 km-es légvonal-plafon, őszinte nemleges válasz.
  A válasz vezethető: vonallánc + manőverek, `outboundPoints` (oda/vissza
  töréspont) és `roadClasses` (vonalvastagsághoz).
- **Zsákmány-előnézet** minden tervhez: cellaszám új/elvett bontásban, terület,
  GP, top 3 rivális. ⚠️ Felső határ, nem ígéret — a felület ezt ki is mondja.
- **`GET /api/routes/geocode`** — két Mapbox-forrás uniója, távolság szerint
  rendezve, gyorsítótárral. A találatot NEM tároljuk el.
- **Geometria külön szálon** (`lib/geometryOffThread.ts`), 30 s időkorláttal.
  A `grundo-api` mostantól `--cpu=2`, a `grundo-graphhopper` pedig
  `min-instances=1` (lásd Nyitott ügyek → miért).
- **Felület**: `Barangolás | Útvonal` választó, teljesképernyős tervező
  (címkereső kiemeléssel, térképi kijelölés, jelenlegi pozíció), „Zsákmány"
  panel, hatszöges betöltő, átvezető animáció a Play gombig.
- **Útvonalrajz**: kétszínű (odaút/visszaút), ritkítás nélkül, út-osztályhoz
  igazított vastagsággal.
- **Banda-képfeltöltés 2 MB → 5 MB.**

## Módosított fájlok

`git diff --stat 7a57bc8..e100e50` — 37 fájl, +5010 / −265 sor. A főbbek:
`server/src/routes/routes.ts` (új végpontok), `src/components/RoutePlannerSheet.tsx`,
`RouteRewardPanel.tsx`, `HexWorkOverlay.tsx`, `Icon.tsx`,
`src/hooks/useRoutePlanner.ts`, `src/screens/TrackingScreen.tsx`,
`src/components/MapView.tsx`.

## Élesben fut / telepítetlen

**Élesben fut minden** (verzió 1.3.5): frontend, backend, Cloud Run-beállítások.
Telepítetlen változás nincs.

⚠️ **Natív build NEM készült** ebből a menetből — a TestFlight/APK a `e100e50`
commitról indítható.

## Ellenőrzések

- `npm run test`: **966 zöld**, 189 kihagyva.
- `npx tsc --noEmit` gyökér és `server/` külön: **zöld**.
- Emulátoros készlet (`routesPlan.emulator`): **8/8 zöld**.
- **Valódi végponti próba**: kliens → helyi backend → éles Firestore →
  GraphHopper. Mérve egy Deák tér → Hősök tere körön: 10,6 km, 9109 mező,
  2,797 km², 201 GP, valódi riválisnevekkel; a tulajdonosi fiók nem fogyasztott
  keretet.

**Amit NEM ellenőriztem:**
- **készüléken semmit** (iOS/Android) — a menet platform-érzékeny részeit
  (térképi koppintás, helymeghatározás, safe area) csak böngészőben láttam;
- a **kihívások oldalán a betöltő animációt** működés közben (a böngésző
  megtagadta a helymeghatározást, a generálás el sem indult);
- a **`prefers-reduced-motion`** ágat élesben (a kód kezeli, de nem kapcsoltam
  be a rendszerbeállítást);
- a **beszívódás-animáció látványát** a valódi folyamatban (a böngésző-
  munkamenet elvesztette a bejelentkezést; a CSS bekerült a bundle-be).

## Nyitott ügyek

1. **A hurokdetektálás a valódi szűk keresztmetszet.** Mérve: ugyanaz a
   Balaton-kör 3 megállóval 778 s, 4 megállóval 50 s; egy 42 km-es budapesti
   körön a kerékpárút-preferencia 171 ms → 11 417 ms. A költség az ALAKTÓL függ,
   nem a hossztól. Ez `src/game/loopDetection.ts`, nem a labor. Külön menet,
   Opus/High.
2. **A `min-instances=1` folyamatos költség** (2 vCPU / 2 GiB állandóan fut).
   Ez szüntette meg a körtervezés élesbeli elhasalását (hidegindítás + 20
   párhuzamos hívás). Ha a számla soknak bizonyul, előbb mérni kell, mielőtt
   visszavesszük.
3. **A Codemagic `grundo_ios` env-csoportjában ellenőrizni kell a
   `VITE_MAPBOX_TOKEN`-t**: a WEBES token kell (`grundo-web`,
   `cmt4k1tg00ehh2zs97coz0gpq`), NEM a szerveroldali
   (`grundo-server-directions`, `cmt4jw2111cid30qtgzmfam14`). A böngésző-bundle
   már a webest viszi; a natív buildek a Codemagic saját változóiból kapják.
4. **Gyalogos „Jelleg"** — mérve egyik állás sem változtat az útvonalon, ezért
   kiszürkítve, „Hamarosan" felirattal. Más adatforrás kell hozzá (EEA
   zajtérképek, Copernicus/Sentinel-2); a PZU-térkép mérése is a
   `data-sources.md`-ben.
5. **Útvonal-könyvtár** ([`../routing/route-library.md`](../routing/route-library.md))
   — változatlanul nyitva.

## Modelljavaslat

Készülékes ellenőrzés és apró UI-javítás → **Sonnet**. A hurokdetektálás
gyökérok-vizsgálata (1. pont) → **Opus, emelt**.

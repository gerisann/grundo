# GRUNDO handoff

> Frissítve: **2026-08-29** · átadás a **GRUNDO #19** menetből a **#20**-ra
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · ebben a menetben **nem változott kód** (csak mérés és
> döntés) — a #18 óta a HEAD-en lévő GraphHopper-kód változatlanul él,
> lásd lent, „ÉLESBEN FUT / TELEPÍTETLEN".

## ⚠️ ELSŐ OLVASNIVALÓ

**A #20 fő feladata: a küldetés-ajánló route-tervezésének és
terület/cella-számításának SZÉTVÁLASZTÁSA.** A #19-ben megmértük a
küszöböt és Geri döntött a felületi viselkedésről — a tervezés kész, a
megvalósítás a #20 feladata. **AGENTS.md 0. pont szerint Opus, emelt
mélység** — ez adatmodell- és API-szerződés-döntés, nem rutin kiterjesztés.

### A mérés (#19-ben végzett)

Egyetlen irányban (2 jelölt/irány), `straight` karakterrel, élő helyi
GraphHopperrel, csak a nehéz fél (`shapeCandidateCells` +
`evaluateCandidate`):

| táv | terv | cellafeldolg | értékelés | ÖSSZ (2 jelölt) |
|---|---|---|---|---|
| gyalog 2 km | 0,11s | 0,18s | 0,12s | 0,41s |
| gyalog 4 km | 0,04s | 0,25s | 0,31s | 0,60s |
| gyalog 6 km | 0,07s | 1,42s | 1,42s | 2,90s |
| gyalog 8 km | 0,08s | 3,87s | 3,87s | 7,82s |
| gyalog 10 km | 0,09s | 2,85s | 3,06s | 6,00s |
| gyalog 12 km | 0,10s | 1,23s | 1,57s | 2,91s |
| bringa 4 km | 0,13s | 1,03s | 1,12s | 2,27s |
| bringa 8 km | 0,06s | 3,15s | 3,30s | 6,51s |
| bringa 12 km | 0,07s | 5,08s | 5,30s | 10,45s |
| bringa 16 km | 0,09s | 9,52s | 9,68s | 19,29s |

Tanulságok:
- A route-terv (GraphHopper) mindig elhanyagolható (~0,1s) — **nem a
  GraphHopper a szűk keresztmetszet**, a HANDOFF #19-es diagnózisa helyes
  volt.
- A gyalog 8/10 km sorrend fordított a 6/12-höz képest — **nem mérési
  hiba**: az idő a **bezárt cellák számával** arányos, nem a km-rel
  (ugyanolyan hosszú kör más helyen más méretű területet zárhat be).
- A tábla **csak 1 irányt, 2 jelöltet** mér. Az éles kérés 8 irányban, két
  menetben, akár **19 jelölttel** fut — a teljes idő ennek kb.
  **8-9-szerese** ugyanerre a távra (ez magyarázza a #18-as 80s-os mérést
  16 km bringára, `twisty` karakterrel).
- **Küszöb**, ha a cél "pár másodperc" a TELJES kérésre: jelöltenként kb.
  0,2-0,3s büdzsé fér bele. Ez alapján gyalog/futásra kb. **4-5 km** az,
  ami még szinkron elfér — **bringára gyakorlatilag semmi**, már a 4 km-es
  kör is ~1,1s/jelölt, ami 8 iránnyal 8-10s fölé megy.
- Az olcsó előszűrés (19→5-6 jelölt, cella nélküli jelekből) ÖNMAGÁBAN
  **nem elég** bringára, ahogy a #18-as HANDOFF is sejtette.

### A döntés (Geri, 2026-08-29)

**A kártyák jelenjenek meg AMILYEN GYORSAN LEHET, az útvonaltervvel** (a
gyors fázis: route-tervezés, ~0,1-0,7s). Amelyik mező még nem kész
(terület, cella, GP, stb.), ott **helyőrző szöveg + animáció** menjen:
„terület számítás", „cella kalkulálás" (vagy hasonló, mezőnként külön
felirat), amíg a lassú fázis be nem fejeződik és a kártya frissül a
végleges számmal.

Ez **nem sérti** az AGENTS.md „NEM BECSLÉS" szabályát (2. döntés) — nincs
laza becslés, a mező egyszerűen üres/töltő állapotban van, amíg a valódi
motor nem ad számot. A #19-ben felvetett kérdés („mit mutasson a kártya a
köztes állapotban") ezzel eldőlt: **semmit, csak töltő jelzést**.

### Ami a #20-ban MÉG NYITOTT (a tervezés első lépései)

- **API-szerződés**: mit adjon vissza AZONNAL a `POST
  /api/missions/generate`? Valószínűleg: a küldetés-lista route-tervvel
  (polyline, distanceKm, bearing, kind) + egy azonosító (jobId vagy
  missionId), terület/cella/GP mezők nélkül vagy `null`-lal/`pending`
  jelzéssel.
- **Frissítési mechanizmus**: polling (`GET
  /api/missions/{jobId}/status` vagy hasonló), SSE, vagy valami
  egyszerűbb. Polling a legkisebb kockázatú első lépésnek tűnik (a repo
  már használ TanStack Query-t a kliensen), de Geri döntése.
- **Hol fut a lassú fázis?** Ugyanabban a Cloud Run kérésben
  (`res.write`/streaming?), külön háttérfolyamatban (Cloud Tasks?), vagy
  egyszerűen a kliens indít egy második kérést, ami szinkron vár, amíg a
  szerver az első válasz visszaküldése UTÁN elvégzi a számítást és
  Firestore-ba írja az eredményt? Ez a legfontosabb architektúra-döntés,
  Opus-szintű mérlegelést igényel (Cloud Run kérés-időkorlát, memória,
  hidegindítás hatása).
- **Melyik jelölteken fusson a lassú fázis?** A gyors fázis a jelenlegi 8
  irány × 2 menet route-jait adja vissza — a lassú fázisnak nem kell
  MIND a 19-et feldolgoznia, ha a gyors fázis már kiszűrte, melyik
  kerül ténylegesen kártyára (`selectMissionRoutes` már most
  karakterenkénti legjobbat választ INNEN). Érdemes a szűrést (kanyar/
  hossz-eltérés alapú, cella nélküli) a gyors fázisba tenni, és a lassú
  fázis csak a ténylegesen megjelenő 3-4 kártyára fusson — ez már
  önmagában a 19-ből 3-4-re vágja a drága munkát, a teljes
  átszervezés mellett.
- A „Sík/Mászás" választó (lásd #18-as HANDOFF) — külön menet marad, a
  teljesítmény-architektúra után.

## ÉLESBEN FUT / TELEPÍTETLEN

Változatlan a #18 óta:
- Élesben (`grundo-api`, Cloud Run) a Mapbox-ág fut, a token-hiba javítva.
- A GraphHopper csak localhoston fut. `cloudbuild.yaml`
  `_GRAPHHOPPER_URL` substitution előkészítve, üresen.
- Kód a `main`-en, de amíg a `GRAPHHOPPER_URL` élesben üres, semmi új nem
  aktiválódik. Push/deploy bármikor biztonságos, csak nem történik tőle
  semmi látható.

## FÁJL-ÖSSZEFOGLALÓ (#19 menet)

| Fájl | +/− | Mit tartalmaz |
|---|---|---|
| `HANDOFF.md` | felülírva | Ez a fájl — mérési eredmények, felületi döntés, #20 terve. |
| `tmp/measure-mission-perf.ts` | új, NEM verziókövetett | A fenti mérést végző szkript, élő GraphHopper ellen. Újrafuttatható: `npx tsx ../tmp/measure-mission-perf.ts` a `server/` mappából. |

**Kódváltozás nem történt ebben a menetben** — csak mérés és tervezési
döntés. **Teendők sorrendje**: push (a `HANDOFF.md` miatt) → nincs
adatbázis-lépés → nincs telepítés szükséges.

## HELYI KÖRNYEZET — LEHET, HOGY MÉG FUT

Ugyanaz, mint a #18-ban: Firestore/Auth emulátor, `server/`
(`GRAPHHOPPER_URL=http://localhost:8989`-cel indítva), GraphHopper
(Magyarország importálva, `graph-cache/` kész). A #19-ben mindhárom élt a
mérés alatt. Ha nem futnak, indítás:

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
nélkül teszteléshez:
```js
navigator.geolocation.getCurrentPosition = (s) => s({ coords: { latitude: 47.4979, longitude: 19.0537, accuracy: 10 } });
```

`tmp/verify-planMissionLoop.ts` (a #18-ból) és `tmp/measure-mission-perf.ts`
(a #19-ből) mindkettő kód nélkül futtatható ellenőrzéshez, egyik sem
verziókövetett.

## ELLENŐRZÉSEK

Nem futott ebben a menetben teszt/build (nem történt kódváltozás). A #18
végén: `npx tsc --noEmit` tiszta, `npx vitest run` 556 sikeres/122
kihagyva.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**#20 — a route-tervezés/terület-számítás tényleges szétválasztása:
Opus, emelt mélység.** A célfelület-viselkedés már eldőlt (lásd fent), de
az API-szerződés, a frissítési mechanizmus és a lassú fázis futtatási
helye (Cloud Run kérésen belül vs. külön) architektúra-döntés — pontosan
az AGENTS.md 0. pontjában megnevezett eset.

## FORRÁSOK SORRENDJE

1. `AGENTS.md` — különösen a Munkamódszer szakasz
2. `HANDOFF.md` (ez a fájl) — a mérés és a felületi döntés itt van
3. `server/src/routes/missions.ts` — a szétválasztandó folyam pontosan itt van (`withLoops` ciklus + az azt megelőző `planned` lista)
4. `server/src/lib/missionEvaluate.ts` — `shapeCandidateCells`, `evaluateCandidate` (a lassú fél)
5. `tmp/measure-mission-perf.ts` — a mérőszkript, újrafuttatható más távokra/irányokra
6. `docs/02-funkcionalis-spec.md` → Küldetés-ajánló

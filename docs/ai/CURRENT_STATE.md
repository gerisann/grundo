# Jelenlegi állapot

> Frissítve: **2026-09-04** · GRUNDO **#37**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**
> Állapot: minden commitolva és pusholva.
> Utoljára dolgozott: **Claude (Opus, High)** · Átadva: **Claude — GRUNDO #38**

## Jelenlegi cél

A rögzítés közbeni akadozás megszüntetése. A #36-ban kiadott mérőeszközzel
Geri két készülékkel terepen mért; ez a menet a mérés kiértékelése és a
belőle következő javítások. **A munka kódszinten kész, de TELEPÍTETLEN és
készüléken nincs ellenőrizve** — ehhez új mobilbuild kell.

## Elkészült

1. **A terepi mérés kiértékelése.** Két 8,6–9,0 km-es kör, ~40 perc, Samsung
   SM-G780F és iPhone (iOS 18.7). Teljes elemzés:
   [`archive/2026-09-04-terepi-fosszal-meres.md`](archive/2026-09-04-terepi-fosszal-meres.md).
   A lényeg: az összköltség elhanyagolható (0,1% kitöltés), a baj egyetlen
   **859 ms**-os blokk a főszálon, a háttérből visszatéréskor. A költség 80%-a
   a `preview.geometry`, annak 99,5%-a a hurokkeresés — az elszámolás és a
   körüljárás együtt csak 2,6–2,8 ms, vagyis **eddig rossz komponenst
   céloztunk**.

2. **Az előnézet levétele a főszálról** (Web Worker). A számítás a
   `workers/previewWorker.ts`-be került; a cellalánc — a rajzolt nyom és a
   lépéshang forrása — szándékosan a főszálon maradt. Mérve böngészőben, a
   valódi terepi nyomvonalon: a főszál a teljes körre **22 ms**-ot fizet
   (átlag 0,04 ms/frissítés, max 0,2 ms). Az eredmény betűre egyezik a
   szinkron úttal (518 cella, 10 hurok, GP 180,0 — utóbbi az éles aktivitás
   mentett GP-jével is stimmel).

3. **A hurokkeresés olcsóbbá tétele.** A durva kitöltés-előkészület memoizálva
   (`loops.ts` `coarseContextOf`): böngészőben **−55%**, Node-ban −30%, bitre
   azonos eredménnyel. ⚠️ Ez enyhíti, de nem oldja meg a növekedést — lásd a
   nyitott ügyek 2. pontját.

4. **A mérő részletessé tétele.** Láthatóság szerinti bontás, a háttérből
   VISSZATÉRŐ futások külön, a legdrágább futások teljes körülménnyel
   (időbélyeg, láthatóság-átmenet, cella-/hurokszám), és percenkénti bontás.
   Emulátoron végigpróbálva: egy háttérben indult, előtérben befejeződött
   futás `háttér→előtér` jelöléssel jelenik meg. A 859 ms-hoz hasonló eset
   mostantól **mérve** lenne, nem következtetve.

## Módosított fájlok (négy commit: `5fb3454`…`4f0e90c`)

19 fájl, +2553/−238. Ami a folytatáshoz kell:

| Fájl | Állapot | Tartalom |
|---|---|---|
| `src/lib/previewEngine.ts` (+351) | ÚJ | `PreviewSession` + `planDispatch` — a worker és a szinkron tartalék KÖZÖS magja. |
| `src/workers/previewWorker.ts` (+78) | ÚJ | A worker belépési pontja. |
| `src/workers/previewProtocol.ts` (+53) | ÚJ | Üzenettípusok, külön fájlban a modulhatár miatt. |
| `src/hooks/usePreviewEngine.ts` (+361) | ÚJ | Worker-életciklus, összevonás, szinkron tartalék ág. |
| `src/lib/perfMeter.ts` (+329/−…) | MÓDOSÍTOTT | A négy új bontás; `perfVisibility()` a hívónak. |
| `src/game/loops.ts` (+163) | MÓDOSÍTOTT | `coarseContextOf` memoizálás; `ReadonlySet` a kültéren. |
| `src/screens/TrackingScreen.tsx` (−199) | MÓDOSÍTOTT | A `useMemo` és a két gyorsítótár kikerült. |
| `server/src/routes/admin.ts` (+103) | MÓDOSÍTOTT | A részletes mérés tárolása, saját plafonokkal. |
| `src/admin/PerfHistoryScreen.tsx` (+153) | MÓDOSÍTOTT | 4 új szakasz + „Nyers JSON másolása". |
| `vite.config.ts` (+15) | MÓDOSÍTOTT | `worker.format: 'es'` a `type: 'module'` párjaként. |

## Élesben fut / telepítetlen

- **TELEPÍTETLEN, frontend ÉS backend kell** a #37 egésze. Ezen felül a #36-ból
  is kint van még: `b2e0c98`, `39d821a`, `8d8ff77` (banda-backfill logika,
  hangjavítás, teljes bandás kör, értesítések).
- **A worker és a mérő csak ÚJ MOBILBUILDDEL jut el a készülékekre** — a
  Capacitor a beépített felületet futtatja. iOS és Android build egyaránt kell.
- **`backfill:banda-stats --apply --allow-production`**: még nem futott.
- **`grundo-banda-daily` Scheduler-job**: nincs bejegyezve.

## Ellenőrzések

- Kliens és szerver `tsc` tiszta. Kliens **792/792**, szerver **229/229** zöld,
  `npm run build` hibátlan. Emulátoros `admin.emulator.test.ts` **39/39**.
- **Böngészőben, a valódi terepi nyomvonallal**: a worker elindul, a protokoll
  végigmegy 580 körbefordulást, az eredmény azonos a szinkron úttal.
- **Emulátoron, a rögzítő képernyőn**: a worker elindul, az előnézet élőben
  frissül, a hurkok bezárnak, konzolhiba nincs; a mentés feltölt, és az
  `/admin/teljesitmeny` a bontásokkal megjeleníti.
- **NEM ellenőrizve**: (a) **készüléken semmi** — a modul-worker natív
  webnézetben az egyetlen tényleges kockázat (iOS 15+/Chrome 80+ tudja; ha
  mégsem, a hook némán a szinkron ágra vált, és a `preview.dispatch` a teljes
  számítás idejét mutatja 0,0x ms helyett — ebből ismerhető fel); (b) a #36
  hangjavítása és bandás köre készüléken.
- ⚠️ **Idegen, NEM ehhez a körhöz tartozó bukás**: az emulátoros
  `activityMedia.emulator.test.ts` (a #36 is így adta át) és
  `bandas.emulator.test.ts` — utóbbiban az üzenőfal sorrendje
  (`wall.items[1]`); a #36 változtatta a fal-sorrendet, és a teszt láthatóan a
  RÉGI sorrendet rögzíti. Egyik fájlt sem érinti ez a kör.

## Nyitott ügyek — #38-nak

1. **Telepítés + mobilbuild, majd terepi mérés.** Ez a menet minden eredménye
   ezen áll vagy bukik. A mérésnél nézni: **`preview.dispatch` ~0** (ha a
   teljes számítás idejét mutatja, a worker nem indult el); a **„visszatérés"
   oszlop** (a workerrel ennek nem szabad fagyást okoznia, akármekkora); a
   **percenkénti bontás** (mennyire nő a költség); és érdemes megismételni
   ugyanazt a **háttér→előtér váltogatást**, ami a hibát kiváltotta.
2. **A jelöltek SZÁMÁNAK csökkentése — GERI DÖNTÉSE, nem optimalizálás.**
   518 cellára 499 jelöltvizsgálat jut, ebből 10 lesz elfogadott hurok; a
   többi 491 valódi hurok, ami a MÁR MEGSZERZETT területet zárja be újra. A
   biztonságos szűrőket végigmértem, egyik sem működik (`DECISIONS.md`). Ami
   maradna: kevesebb jelölt — de az elvehet egy bezárást, amit a szabályok
   szerint el kellene ismerni. Konkrét kérdés: *ha ugyanazt a kört ötször
   futod meg, mind az öt bezárás számítson-e?* Ma igen. **Amíg erre nincs
   válasz, ne nyúlj a detektorhoz.**
3. A **`bandas.emulator.test.ts`** fal-sorrend bukása (lásd fent).
4. A hangok és a bandás kör **készülékes ellenőrzése** az új buildekben.

## Modelljavaslat

**Sonnet, Medium** a telepítéshez, a mobilbuildhez és a mérés beolvasásához.
**Opus, High** csak akkor, ha a 2. pontra megvan Geri döntése — a hurokdetektor
jelöltszűrése játékszabály-érzékeny terület, ahol egy „optimalizálás" csendben
elvehet egy bezárást.

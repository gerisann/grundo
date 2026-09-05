# Jelenlegi állapot

> Frissítve: **2026-09-05** · Menetszám: **#42, lezárva**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **main** · HEAD: **9601b6f**
> Utoljára dolgozott: **Claude (Sonnet 5)**
> Átadva: **Claude vagy Codex** — nincs folyamatban lévő munka, bármelyik felveheti

## Jelenlegi cél

A hét teljesítmény-cél (`docs/ai/PERFORMANCE_GOALS.md`) rendszeres mérése és
javítása. Nincs kényszerítő következő lépés — Geri adja meg, mi jöjjön.

## Elkészült

- **1. cél** (gyors indulás): mérve, 5 minta, medián **3232 ms**.
- **6–7. cél** (screen-off / ébredés): első valódi minta, könnyű terheléssel,
  nem fagyott le.
- **Aktivitás-térkép mélyzoomos ÖSSZEOMLÁSA javítva és készülékesen
  igazolva** — durva (res8) vödrözés a viewport-szűrés előtt
  (`mapRender.ts`). Jamal 148 717 cellás aktivitásán tesztelve: hexagon mód
  + mélyzoom + gyors pásztázás, a folyamat PID-je végig azonos maradt.
- **PerfOverlay teljes képernyős panelre alakítva** — a korábbi lebegő kártya
  sem szélességben, sem magasságban nem fért a láthatóság-bontás
  táblázatának.
- **Game Loop ramp-lejátszás** (1000×→1×, új scenario 4) — sikeresen
  lefutott: valós (1×) ütemben, már 17 hurkos/14 799 cellás állapotban is
  tiszta maradt a főszál (`preview.total` worker szálon, max 194,7 ms).
- **Gyökérok azonosítva**: a rögzítés/lejátszás közbeni akadás a
  **térképrajzolásból** (Mapbox GPU) jön, NEM a worker-oldali
  preview-számításból — élő A/B teszttel igazolva (hexagon réteg ki → ~2×
  gyorsabb, teljes térkép ki → tovább gyorsul).

## Módosított fájlok (16 commit, `6091d5d..HEAD`)

| Fájl | Mit |
|---|---|
| `src/lib/mapRender.ts` (+105), `.test.ts` (+61) | durva vödrözés, `cellInBounds`/`filterCellsToBounds` |
| `src/components/MapView.tsx` | a fenti logika kiszervezve, importálva |
| `src/components/perfOverlay.css` | teljes képernyős panel |
| `src/hooks/useRecorder.ts` | `tracking.timeToFirstFix` mérőpont |
| `src/tracking/simulationSource.ts` (+55) | ramp-lejátszás (`twoStagePlaybackRate`) |
| `src/admin/labE2eSession.ts` (+42), `.test.ts` (ÚJ, +90) | `"gyors>lassú@arány"` séma |
| `src/admin/gameLoopScenarios.ts`, `LabE2eLauncherScreen.tsx`, `LabE2eTrackingScreen.tsx` | scenario 4, 25 km a LAB launcherben, ramp-címke |
| `android/app/src/debug/AndroidManifest.xml` + `res/drawable-nodpi/grundo_app_icon.png` (ÚJ) | `com.google.test.loops` 3→4, saját debug-ikon |

## Élesben fut / telepítetlen

- **A kód a `main`-en van, de 16 commit MÉG NINCS PUSH-OLVA** az
  `origin/main`-hez képest — Geri kérésére vár.
- Az éles app (`app.grundo.android`) a telefonon **változatlan**, nem
  érintettük.
- A debug app (`app.grundo.android.debug`) a mai javításokkal települt a
  Samsung SM-G780F-re, és rajta lett tesztelve minden fenti pont.

## Ellenőrzések

- `tsc --noEmit` (kliens **és** szerver): zöld.
- `npm run test`: 815 zöld, 181 skip.
- Készülékes teszt: a térkép-crash-javítás és a ramp-scenario is sikeresen,
  hiba nélkül lefutott valódi telefonon.

## Nyitott ügyek

- **Push még nem történt meg.**
- A térképrajzolás (Mapbox `setData`/GPU) önálló mérőszáma hiányzik a
  `perfMeter`-ből — ma csak A/B megfigyelés van rá, nem szám.
- 2. cél: valódi, nem szimulált hosszú terepi validálás még hiányzik.
- 4. cél (sima mérés): nincs önálló mérési helyzet.

## Modelljavaslat

Sonnet, normál mélység elég a folytatáshoz — méréshez és rutin javításhoz
nem kell emelt szint.

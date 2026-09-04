# Jelenlegi állapot

> Frissítve: **2026-09-04** · GRUNDO **#35**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**
> Állapot: ez a kör most kerül commitolásra és pusholásra.
> Utoljára dolgozott: **Claude (Sonnet 5, Medium)** · Átadva: **Claude — GRUNDO #36**

## Jelenlegi cél

A #34-es handoff 5 nyitott pontjából a 3. (Főszál-mérő mentése) és az 5.
(banda backfill + Cloud Scheduler előkészítés) elkészült ebben a körben. A 2.
(főszálas költség tovább csökkentése) és a 4. (körbe-körbe futás cache-hiánya)
szándékosan NEM indult el — Geri Opus/High-ot kért rájuk, ez Sonnet Medium
kör volt.

## Elkészült

1. **Főszál-mérő előzmény** (`src/lib/perfMeter.ts`): `savePerfSnapshot()` /
   `readPerfHistory()` / `clearPerfHistory()` — a mérést `localStorage`-ba
   menti (max 30 bejegyzés, eszköz-platformmal és időbélyeggel). A
   `PerfOverlay`-ban új „Mentés" gomb. Admin nézet: `/admin/teljesitmeny`
   (`src/admin/PerfHistoryScreen.tsx`) — ⚠️ csak AZON az eszközön mutat
   valamit, amelyiken a mérés készült (nincs szerveroldali szinkron).
2. **Banda-rollover kézi indítás**: a `POST /api/jobs/banda-rollover`
   végpont már létezett, de admin gomb nélkül csak `curl`/Scheduler tudta
   hívni. Most van gomb az Áttekintőn (`api.adminRunBandaRollover()`), és a
   `docs/06-architektura-es-admin.md`-ben a hiányzó job-sor + a kész
   `gcloud scheduler jobs create` parancs.
3. **Banda profil-/borítókép éles feltöltés** — Geri megerősítette a
   chatben, hogy éles környezetben működik. A #31 óta nyitott 3 tételből ez
   lezárva.

## Módosított fájlok (most commitolva, pusholva)

| Fájl | Állapot | +/− | Tartalom |
|---|---|---:|---|
| `src/lib/perfMeter.ts` | MÓDOSÍTOTT | +87 | Előzmény-mentés (`savePerfSnapshot`/`readPerfHistory`/`clearPerfHistory`). |
| `src/lib/perfMeter.test.ts` | MÓDOSÍTOTT | +61 | 4 új teszt az előzményre, `localStorage`-mockkal (node env). |
| `src/components/PerfOverlay.tsx` | MÓDOSÍTOTT | +17 | „Mentés" gomb. |
| `src/components/perfOverlay.css` | MÓDOSÍTOTT | +4 | Mentés-visszajelzés stílusa. |
| `src/admin/PerfHistoryScreen.tsx` | ÚJ | +117 | Mentett mérések admin nézete. |
| `src/admin/index.tsx` | MÓDOSÍTOTT | +2 | Route: `/admin/teljesitmeny`. |
| `src/admin/AdminLayout.tsx` | MÓDOSÍTOTT | +1 | Nav-tétel „Teljesítmény". |
| `src/admin/AdminHomeScreen.tsx` | MÓDOSÍTOTT | +48/−1 | „Banda-összesítés futtatása" gomb. |
| `src/lib/api.ts` | MÓDOSÍTOTT | +15 | `BandaRolloverResult`, `adminRunBandaRollover()`. |
| `docs/06-architektura-es-admin.md` | MÓDOSÍTOTT | +9 | `banda-rollover` job-sor + bekötő `gcloud` parancs. |

## Élesben fut / telepítetlen

- **TELEPÍTETLEN, frontend kell**: a most commitolt kör (perf-előzmény,
  banda-rollover gomb), ÉS a #34-ből örökölt `6d1030b` (claim-cache) is —
  egyik sem ment ki még. Backend/szabályok/indexek nem érintettek.
- **`backfill:banda-stats --apply --allow-production`**: Geri lefuttatta
  (2026-09-04). Eredmény: 11 felhasználó, 0 hiányzó `bandaStats` — tehát
  mindenkinél már megvolt (korábbi körben vagy `newUserDoc`-ból). Nincs
  teendő vele.
- **`gcloud scheduler jobs create ... grundo-banda-rollover`**: Geri
  lefuttatta (2026-09-04), a job **ENABLED**, első futás
  `2026-09-04T14:00:00Z`. A `bandas/*/totals` mostantól óránként frissül
  magától — az admin „Banda-összesítés futtatása" gomb csak vésztartalék.

## Ellenőrzések

- Kliens `tsc --noEmit` és szerver `tsc --noEmit` tiszta. Kliens teszt
  **762/762** zöld, szerver teszt **225/225** zöld, `npm run build` hibátlan.
- **NEM ellenőrizve**: az admin felület valódi böngészőben — bejelentkezést
  és admin szerepkört igényel, ezt a munkamenetben nem lehetett auth nélkül
  kipróbálni. A `/admin/teljesitmeny` és a banda-rollover gomb éles
  kipróbálása a telepítés utáni első feladat.

## Nyitott ügyek — #36-nak

1. **Frontend telepítés**, majd: (a) a #34 teleport-fix + claim-cache
   telefonos újramérése a LAB-útvonalon, (b) `/admin/teljesitmeny` és a
   banda-rollover gomb kipróbálása élesben, (c) `2026-09-04T14:00:00Z` után
   ellenőrizni, hogy a `grundo-banda-rollover` Scheduler-job tényleg lefutott
   és a `bandas/*/totals` frissült (Cloud Logging vagy Firestore-nézet).
2. **Főszálas költség tovább csökkentése** (körüljárás + `resolveClaim`,
   asztali legrosszabb eset 24,4 ms) — **Opus, High**, mért anomáliára épülő
   architektúra-döntés.
3. **Körbe-körbe futásnál a cache sosem talál** — dokumentált korlát, nincs
   olcsó javítás; ha mégis foglalkozunk vele, ez is **Opus, High**.

A #31 óta nyitott 3 tétel (banda kép, backfill, Scheduler) mindegyike
**lezárva** ebben a körben.

## Modelljavaslat

**Sonnet, Medium** az 1–2. ponthoz (telepítés-kiértékelés, utókövetés).
**Opus, High** a 3–4. ponthoz — ugyanaz az indoklás, mint a #34 handoffban:
mért anomáliára épülő algoritmus-/architektúra-munka.

# Jelenlegi állapot

> Frissítve: **2026-09-04** · GRUNDO **#32**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**
> Állapot: a munkafa **tiszta**, a `main` egyezik az `origin/main` ággal.
> Utoljára dolgozott: **Claude (Opus, High)** · Átadva: **Claude — GRUNDO #33**

## Jelenlegi cél

A 10 km-es városi rögzítésnél tapasztalt teljes app-lassulás gyökéroka
**megvan és meg van mérve**, de a javítás még NINCS meg. A #33 feladata:
**Geri telefonos mérési számainak kiértékelése, majd a
`processActivityGeometry()` hurok-elszámolásának inkrementálissá tétele az
élő preview-hoz.**

## Elkészült

- **A #31 három gyanúsítottja lemérve** (mérőpadok: `tmp/measure-preview-cost.test.ts`,
  `tmp/measure-loop-claim-cost.test.ts`; 12 km / 2397 minta):
  - `IncrementalActivityGeometry.update()` — 2 µs → 0 µs, **lapos. A #31 fix működik.**
  - `visibleTrackSegments()` — 40 µs → 32 µs, **lapos. Nem szűk keresztmetszet.**
  - `applySample()` — 3 µs → 6 µs. **Nem szűk keresztmetszet.** A #31 átadója
    tévesen írta, hogy minden mintánál IndexedDB-írás történik: a
    `createRunPersister` 2000 ms-onként ír.
- **A VALÓDI gyökérok: `processActivityGeometry()`, és a HUROKZÁRÁS hajtja,
  nem a pontszám.** Hurok nélkül 0,95 ms; 1 huroknál 5,34 ms; 6 huroknál
  (2536 fal- + 6979 belső cella) **23,16 ms hívásonként** — kb. 3,3 µs/belső
  cella, és minden újraszámolásnál a TELJES hurokkészletre lefut, pedig a
  korábban bezárt hurkok már nem változnak. (A preview nem minden GPS-mintánál
  fut, hanem új H3 cellánál vagy 25 méterenként — `cellRevision` /
  `distanceBucket`.)
- **Mérőfelület valódi eszközre** (`5d469fb`): `lib/perfMeter.ts` +
  admin-only `components/PerfOverlay.tsx` a rögzítő képernyőn, plusz kódban
  élő teszt-útvonal a LAB E2E indítójában (`admin/labPerfScenario.ts`) — a
  mentett scenariók `localStorage`-ban élnek, telefonon nem érhetők el.
- **Mellékesen javítva:** a `tmp/` scratch mappa kizárva a tesztkészletből
  (`vite.config.ts`) — eddig bármely ottani `*.test.ts` elronthatta az
  `npm run test`-et.

## Módosított fájlok (`5d469fb`, pusholva)

| Fájl | Állapot | +/− | Tartalom |
|---|---|---:|---|
| `src/lib/perfMeter.ts` | ÚJ | +165 | Mérőóra ringpufferrel: átlag, p95, teljes max, gyakoriság. |
| `src/components/PerfOverlay.tsx` | ÚJ | +149 | Admin-only kijelzés, alapból ⏱ pöttyre csukva. |
| `src/components/perfOverlay.css` | ÚJ | +152 | Tokenalapú stílus; a LAB sávja miatt lejjebb csúszik. |
| `src/lib/perfMeter.test.ts` | ÚJ | +102 | 9 teszt a ring/ablak/p95 aritmetikára. |
| `src/admin/labPerfScenario.ts` | ÚJ | +103 | Beépített ~6/12 km-es városi mérő-útvonal. |
| `src/admin/LabE2eLauncherScreen.tsx` | MÓDOSÍTOTT | +70/−55 | Beépített scenario a lista élén, 1× alapértelmezett lejátszás. |
| `src/screens/TrackingScreen.tsx` | MÓDOSÍTOTT | +38/−17 | A preview-lánc négy szakasza külön mérve. |
| `docs/ai/DECISIONS.md` | MÓDOSÍTOTT | +27/−0 | A mért eredmények tartós rögzítése. |
| `vite.config.ts` | MÓDOSÍTOTT | +11/−1 | `tmp/**` kizárva a tesztkészletből. |

## Élesben fut / telepítetlen

- **Codemagicben FUT egy iOS és egy Android build** az `5d469fb` commitból
  (Geri indította a menet végén). A mérőfelület ezekben utazik.
- **Telepítetlen: backend és frontend.** Geri intézi. A `szabalyok` és az
  `indexek` NEM érintettek (utoljára 09-03-án, a Banda-körben változtak) —
  hogy azok ki lettek-e akkor telepítve, innen nem ellenőrizhető.
- A perf-mérőhöz egyik deploy sem kell: teljesen kliensoldali, a natív build
  a repóból csomagolja.

## Ellenőrzések

- Kliens **747/747** zöld (738 volt + 9 új `perfMeter` teszt). Mindkét
  typecheck tiszta. `npm run build` rendben. Világos és sötét téma helyes.
- **Emulátoros felületen ellenőrizve** (LAB E2E, 10× lejátszás): a hurok
  bezárásakor a kijelzésen az „· elszámolás" 0,22 ms → 3,15 ms-ra, a „Teljes
  preview" 0,25 → 4,13 ms-ra (max 14,7) ugrott — a mérő megfogja a jelenséget.
- **NEM ellenőrizve:** bármi valódi iOS/Android eszközön. A mérő iOS-en még
  soha nem futott. Szerver oldalt ez a menet nem érintette.

## Nyitott ügyek — #33-nak

1. **Kérd el Geri telefonos számait** (LAB E2E → beépített mérő-útvonal, 1×,
   a hurok bezárása utáni értékek). Asztali referencia ugyanezen az
   útvonalon: elszámolás **3,15 ms** átlag 3 huroknál.
2. **Ha a szám igazolja: tedd inkrementálissá a hurok-elszámolást** az élő
   preview-hoz — a már bezárt hurkok claim-eredményét gyorsítótárazni,
   mintánként csak az ÚJ hurkot feldolgozni; a `fates`-ciklust
   (`TrackingScreen`) szintén csak az új cellákra. ⚠️ A `src/game/` KÖZÖS a
   szerverrel: a batch szerveroldali út viselkedése nem változhat, csak új,
   opcionális inkrementális belépési pont jöhet mellé.
3. **Nyitva a #31 óta, Gerinek/külön menetnek:** Banda profil-/borítókép éles
   feltöltés visszaigazolása, `backfill:banda-stats` produkciós futtatása,
   `bandaRollover` Cloud Scheduler bekötése.

## Modelljavaslat

**Opus, High** — a 2. pont algoritmus-átalakítás a közös játékmotorban,
teljesítménnyel és helyességi kockázattal. Ha csak a számok kiértékelése
történik és a javítás külön menetre marad, arra a **Sonnet, Medium** is elég.

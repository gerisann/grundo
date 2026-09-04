# Jelenlegi állapot

> Frissítve: **2026-09-04** · GRUNDO **#33**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**
> Állapot: a munkafa **tiszta**, a `main` = `origin/main` (`6d1030b`, pusholva).
> Utoljára dolgozott: **Claude (Sonnet → Opus, High)** · Átadva: **Claude — GRUNDO #34**

## Jelenlegi cél

A #32 gyökérok-vizsgálatára épülő javítás **elkészült és pusholva van**, de
**élesben még nincs telepítve, és valódi telefonon nincs lemérve**. A #34
feladata: **frontend telepítés, majd telefonos újramérés ugyanazon a
LAB-útvonalon** — az alábbi számokkal összevetve.

## Mit mutatott Geri telefonos mérése (#33 bemenete)

Három képernyőkép a Főszál-mérőről (a számok nem kerülnek adatbázisba, csak
élőben látszanak — lásd Nyitott ügyek 3.):

| Mérés | Hurok | elszámolás átl / p95 / max | Teljes preview átl / p95 / max |
|---|---:|---|---|
| valós séta (69 pont) | 1 | 0,65 / 3,70 / 3,70 ms | 5,79 / 48,5 / 48,5 ms |
| valós séta (73 pont) | 1 | 0,45 / 2,00 / 2,00 ms | 2,72 / 8,00 / 32,0 ms |
| beépített LAB-útvonal, ~6 km | 3 | 2,48 / 6,00 / 8,00 ms | 4,07 / 12,0 / 18,0 ms |

**Következtetés:** a telefon és az asztali gép ugyanannál a hurokszámnál
nagyságrendileg egyezik (asztali referencia 3 huroknál 3,15 ms) — tehát a
lassulást a HUROKSZÁM hajtja, nem a telefon gyengesége. A valós séták viszont
csak 1 hurokig jutottak, a 10 km-es panasz esetét nem fedik le.

## Elkészült (`6d1030b`)

### 1. A tényleges szűk keresztmetszet más volt, mint amit a #32 sejtett

A #32 a hurkonkénti claim-elszámolást jelölte meg. Fázisokra bontva (mérőpad:
`tmp/measure-claim-phases.test.ts`) kiderült, hogy 6 huroknál a 18,3 ms-ból
**14,1 ms a `windingCounts()`**, azon belül **9,1 ms a falcellák öröklése** —
miközben maga a körüljárás-számítás 0,3 ms. Az ok: falcellánként három
`gridDisk(cell, 1..3)` WASM-hívás, 7+19+37 új stringgel, minden frissítésnél.

### 2. Falcella-öröklés: `gridDisk` → memoizált gyűrű-kiterjesztés

A korongokat a már meglévő, memoizált `ringOf` kiterjesztése adja, és a tágabb
korongok maximumát cellánként megjegyezzük (`disk₂(c) = ⋃ disk₁(n)`, tehát a
maximum összerakható a szomszédok részeredményeiből). **Mérve, 24 km-es
városi nyomvonal, 9 hurok, 1445 falcella: az öröklési menet 19,75 → 3,00 ms.**

### 3. Új: `IncrementalActivityClaims` — az elszámolás újrahasználása

Két bezárás KÖZÖTT az elszámolás bemenete (hurkok, birtokviszony, konfiguráció,
körüljárás) változatlan, tehát az eredmény is. Az osztály ezt nem elhiszi,
hanem ellenőrzi: új hurok zárt-e, lépett-e a nyomvonal ÚJ claim-cellába,
nőtt-e a körüljárás bármelyik régió képviselőjén. Ha nem, a korábbi eredményt
adja vissza, csak a GP-t számolja újra (az a távolsággal nő).

⚠️ **A szerver nem használja** — a hiteles feldolgozás továbbra is egyetlen
batch `processActivity()`. Cache-tévesztéskor pontosan ugyanaz a
`processActivityGeometry()` fut, tehát az előnézet eredménye SOSEM egy
párhuzamos megvalósításból jön.

### Mért végeredmény (asztali, 24 km, 9 hurok, 16 898 belső cella)

| | hívásonként | teljes rögzítés főszálon | legrosszabb hívás |
|---|---:|---:|---:|
| #32 állapot | 40,4 ms (csúcs) | 1141 ms | 33,3 ms |
| #33 után | 1,40 ms átlag | **669 ms** | 24,4 ms |

A 478 előnézet-hívásból 391-ben még nincs hurok (eleve olcsó); a hurkos
hívások **86%-a (75/87) újrahasználható** volt.

## Módosított fájlok (`6d1030b`, pusholva)

| Fájl | Állapot | +/− | Tartalom |
|---|---|---:|---|
| `src/game/winding.ts` | MÓDOSÍTOTT | +122/−19 | `createInheritedTurns` (memoizált korong-maximumok), `windingBreakdown`, `encirclementsFor`. |
| `src/game/incrementalClaims.ts` | ÚJ | +233 | Az elszámolás újrahasználása + a három érvénytelenítő feltétel. |
| `src/game/index.ts` | MÓDOSÍTOTT | +25/−2 | `LoopClaimResolution.windingRegions`, `ProcessTrace` (a `ProcessResult` alakja változatlan). |
| `src/screens/TrackingScreen.tsx` | MÓDOSÍTOTT | +37/−23 | Az előnézet a gyorsítótárat hívja; `nearbyOwnership` stabil referencia, `EMPTY_OWNERSHIP` állandó. |
| `src/game/incrementalClaims.test.ts` | ÚJ | +215 | Lépésről lépésre a batch úttal méri össze magát (rivális birtokkal is). |
| `src/game/winding.inherit.test.ts` | ÚJ | +115 | A gyorsított öröklés a `gridDisk`-es referenciával egyezik. |

Mérőpadok a `tmp/` alatt (nem verziókövetett): `bench.vitest.config.ts` (a
gyökér konfig kizárja a `tmp/**`-ot, ezért kell külön), `measure-claim-phases`,
`measure-winding-phases`, `measure-inherit`, `measure-incremental-claims`,
`measure-miss-reasons`.

## Élesben fut / telepítetlen

- **TELEPÍTETLEN: a teljes `6d1030b` — frontend kell.** Backend/szabályok/
  indexek NEM érintettek. Adatbázis-lépés nincs.
- A #32 mérőfelülete (`5d469fb`) natív buildekben utazik; hogy azok kimentek-e,
  innen nem ellenőrizhető.

## Ellenőrzések

- Kliens **755/755** zöld (747 volt + 8 új). Mindkét typecheck tiszta
  (gyökér és `server/`). `npm run build` rendben.
- **NEM ellenőrizve:** bármi valódi eszközön vagy böngészőben. A rögzítő
  képernyő bekötése (a `claimsCache` és a `nearbyOwnership` referencia-
  stabilitása) csak típus- és tesztszinten igazolt — **élő rögzítéssel nem**.

## Nyitott ügyek — #34-nek

1. **Frontend telepítés, majd telefonos újramérés** a beépített LAB-útvonalon,
   1× lejátszással. A várt kép: a „· elszámolás" és a „Teljes preview" átlaga
   érdemben lejjebb, a p95 viszont maradhat — a bezárás pillanata továbbra is
   drága (asztali legrosszabb 24,4 ms).
2. **A megmaradt költség helye** (asztali, 9 hurok, tévesztéskor): körüljárás
   9,5 ms (ebből régió-felbontás 4,0, vetítés 2,0), hurkonkénti `resolveClaim`
   7,6 ms. Ha ez is kell: a vetítés triviálisan inkrementálissá tehető, a
   régió-felbontás nem (a nyomvonal növekedésével átrendeződhet).
3. **A Főszál-mérőnek nincs mentése** — Geri jogos észrevétele: a számok csak
   élőben látszanak, elemzésre nem menthetők. Érdemes az utolsó N mérést
   `localStorage`-ba tenni vagy exportálhatóvá tenni, ahogy a GPX-exportnál.
4. **Körbe-körbe futásnál a gyorsítótár sosem talál** (minden kör új hurkot
   zár) — mérve, rögzítve a tesztben. Ez a minta marad drága.
5. **Nyitva a #31 óta:** Banda profil-/borítókép éles feltöltés visszaigazolása,
   `backfill:banda-stats` produkciós futtatása, `bandaRollover` Cloud Scheduler
   bekötése.

## Modelljavaslat

**Sonnet, Medium** — a telepítés és a telefonos mérés kiértékelése rutinmunka.
Ha a 2. pont (további algoritmus-átalakítás a közös motorban) is előkerül,
arra **Opus, High**.

# Jelenlegi állapot

> Frissítve: **2026-09-04** · GRUNDO **#31**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**
> Állapot: a munkafa tiszta lesz e commit után, a `main` egyezik az `origin/main` ággal.
> Utoljára dolgozott: **Claude (Sonnet, Medium)** · Átadva: **Claude (Opus, High) — GRUNDO #32**

## Jelenlegi cél

Geri jelezte: egy 10 km-es városi Android-rögzítés érezhetően belassította a
TELJES appot (animáció, kirajzolás, minden), nem csak a térképet. Az Explore
ügynök megtalálta és e menet megjavította az egyik konkrét gyökérokot; **#32
feladata a maradék két, kisebb hatású forrás felmérése és — szükség esetén —
javítása, majd VALÓDI Android-eszközös igazolás.**

## Elkészült

- **Munkafolyamat:** a `CURRENT_STATE.md` fejlécében mostantól kötelező az
  „Utoljára dolgozott" / „Átadva" mező; a `grundo-handoff`/`grundo-session-start`
  skillek névtáblázatot kaptak (Claude: Sonnet/Opus + Low/Medium/High/Extra;
  Codex: Luna/Terta/Sol + Alacsony/Közepes/Erős).
- **GPX-terepteszt export:** `/admin/lab/scenario` „GPX exportálása" gombja +
  recept (`docs/08-android-codemagic.md`) — valódi eszközön, hamis helyadat
  appal reprodukálható a lezárt képernyős GPS-teszt.
- **Aktivitás-diagnosztika:** eszköz/OS/app-verzió + előtér-háttér idővonal
  rögzítése mentéskor, kizárólag a privát `private/track` dokumentumban (a
  `userAgent` azonosításra alkalmas, ezért NEM a nyilvános dokumentumon).
  Admin panel: `/admin/aktivitasok`.
- **Teljesítmény-gyökérok #1 (megjavítva):** `IncrementalActivityGeometry.update()`
  (`src/game/index.ts`) minden GPS-mintánál a TELJES nyomvonalat újraszámolta
  (`traceToCellPath`) és a teljes korábbi cellaláncot végigolvasta (`isPrefix`)
  — ez a GRUNDO #21 energiaelemzés által már egyszer megoldott hiba
  megismétlődése volt, csak egy szinttel feljebb (GP/claim preview). Mostantól
  a meglévő `IncrementalCellPath`-ra épül, O(1) folytatás-felismeréssel.

## Módosított fájlok (e menet, még nem pusholva)

| Fájl | Állapot | +/− | Tartalom |
|---|---|---:|---|
| `src/game/index.ts` | MÓDOSÍTOTT | +40/−15 | `IncrementalActivityGeometry` valódi inkrementálissá tétele. |

(A korábbi 2 commit — workflow + GPX/diagnosztika — már push-olva: `42b8109`, `9b1d37d`.)

## Élesben fut / telepítetlen

- A workflow- és diagnosztika-commitok push-olva, **nincs deploy** hozzájuk
  (kliens-oldali/admin-only kód, backend route-bővítés — a következő
  frontend+backend telepítéssel mehet, önmagában nem sürgős).
- A teljesítmény-javítás e menet végén commitolva/pusholva lesz, de **natív
  build még nem készült belőle** — Android APK-ban élesben nem volt tesztelve.

## Ellenőrzések

- Kliens typecheck ✅. Kliens egységtesztek: **738/738** ✅ (nincs regresszió).
- **NEM ellenőrizve:** a fix tényleges hatása valódi Android-eszközön/hosszú
  (10 km+) rögzítésnél — csak unit teszttel és típusellenőrzéssel igazolt,
  profilozás (DevTools/Android Studio profiler) nem történt.
- **NEM készült célzott regressziós teszt** arra, hogy az `IncrementalActivityGeometry`
  ténylegesen O(1)/hívás költséggel fut hosszú nyomvonalon (a meglévő
  `src/game/incrementalGeometry.test.ts` az eredmény-egyezést nézi, a
  hívásköltséget nem méri).
- Szerver oldalt e menetben nem érintettük (a diagnosztika-commit szerver
  tesztjei a `9b1d37d`-nél már lefutottak: 225/225 ✅).

## Nyitott ügyek — #32-nek (Opus, High)

1. **Profilozd a mostani fixet.** Mérd meg ténylegesen (pl. Android Studio
   profiler vagy a LAB GPX-exporttal reprodukált hosszú, sűrű városi kör),
   hogy az `IncrementalActivityGeometry` javítása után eltűnik-e a lassulás.
2. **Másodlagos forrás:** `src/lib/mapRender.ts` `visibleTrackSegments()` a
   teljes nyomvonalat végigscanneli minden throttolt `setData`-hívásnál
   (O(n) bemenet, bár a kimenet már sugár-vágott). Érdemes-e inkrementálisra
   váltani, vagy a jelenlegi throttling (`trackSyncIntervalMs`) elég?
3. **Harmadlagos forrás:** `src/tracking/recorder.ts` minden elfogadott
   mintánál másolja a teljes `points` tömböt (`[...state.points, point]`), és
   `useRecorder.ts` minden mintánál ír az IndexedDB-be (`persister.save`).
   Lineáris, nem kvadratikus — érdemes-e mégis kötegelni/ritkítani hosszú
   (1+ órás) aktivitásoknál?
4. Régebbi, Banda-menetekből még nyitva: Banda profil-/borítókép éles
   feltöltés visszaigazolása, `backfill:banda-stats` produkciós futtatása,
   `bandaRollover` Cloud Scheduler bekötése — ezek Gerinek/külön menetnek
   valók, nem blokkolják a teljesítmény-munkát.

## Modelljavaslat

**Opus, High.** Gyökérok-elemzés és mért teljesítmény-anomália — a
`grundo-session-start` saját táblázata is ezt javasolja. Geri kifejezetten
emiatt zárta le ezt a menetet Sonnet Medium-on, és nyit új beszélgetést
Opus High-on (#32) a folytatásra.

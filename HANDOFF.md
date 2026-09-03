# GRUNDO handoff

> Frissítve: **2026-09-03** · átadás a **GRUNDO #27** menetből a következőre
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · HEAD: ennek az átadónak a commitja · munkamásolat tiszta

## ÁLLAPOT

Elkészült a rögzítés Mapbox-nézetének négy finomítása.

- A helyjelölő a két elfogadott GPS-minta között kérésenként animálódik. Az
  átmenet hossza a minták időbélyegéből következik, korlátokkal: nem lehet
  túl rövid, nem nyúlhat a következő mintára, és hosszú háttérszünet után
  röviden felzárkózik.
- A követő kamera ugyanazzal az időzítéssel, lineáris átmenettel követi a
  jelölőt. Így a ritkább minta sem ugró pozícióként látszik.
- A kézi térképmozgás megállapítása `movestart`-on történik; az esemény
  tényleges felhasználói bemenetét ellenőrzi. Ez egységesen lefedi a húzást,
  csippentést, görgős zoomot és forgatást, ezért a visszaközpontosító gomb
  megbízhatóbban jelenik meg.
- Rögzítéskor az alsó jobb gomb az észak-fent / haladási-irány-fent módot
  váltja. Észak-fent állapotban iránytű, követő módban navigációs ikon látszik.
  A visszaközpontosító gomb a fölötte lévő, meglévő pozícióban maradt.
- A menetirányhoz használt alapvonal 25 m-ről 15 m-re csökkent, a simítás
  súlya 0,4-ről 0,65-re nőtt: a kamera két-három minta alatt fordul a kanyarba,
  miközben a rövid, zajos pontok nem fordítják el önmagukban.
- A mozgásra érzékeny rendszerbeállítás (`prefers-reduced-motion`) esetén a
  marker és a kamera azonnal vált pozíciót.

## ÉLESBEN FUT / TELEPÍTETLEN

- Ez a Mapbox-változás még nincs telepítve.
- Adatmigráció, Firestore-szabály- és indextelepítés nem kell.
- Kiadáshoz **frontend** telepítés kell. A backend nem változott.
- A változás Capacitor-webcsomagban él, ezért az új viselkedés iOS- és
  Android-buildben is csak az új HEAD-ből jelenik meg.

## ELLENŐRZÉSEK

- Célzott `mapMotion` és menetirány tesztek: **19 zöld**.
- Gyökér typecheck: sikeres.
- Teljes normál Vitest: **657 zöld**, 133 emulátoros kihagyva.
- Production build: sikeres; a meglévő nagy chunk figyelmeztetés maradt.
- `git diff --check`: sikeres.
- Vizuális QA: a rögzítés térképén világos témában az új iránytűgomb és
  akadálymentes címkéi megjelentek. Az automatizált böngésző nem továbbította
  a Mapbox fölötti vezérlő kattintását, ezért a két állás valós készülékes
  próbája még szükséges. Sötét témás külön kézi QA nem történt; az ikon a
  meglévő, tokenes vezérlő színeit használja.

## KÖVETKEZŐ LÉPÉSEK

1. Nincs adatbázis-lépés.
2. Ha Geri kéri a kiadást: **frontend** telepítés.
3. Az új HEAD-ből iOS- és Android-build készítendő.
4. Készüléken ellenőrizendő: ritka GPS-mintán a marker/kamera folytonossága,
   kézi mozgatás után a visszaközpontosító megjelenése, valamint az iránytű két
   állása világos és sötét témában.
5. Következő nagy fejlesztés: szerveroldali inkrementális geometriai
   részszámítás.

## NYITOTT ÜGYEK

1. A szerveroldali inkrementális geometria még nincs megtervezve vagy kódolva.
   Fontos csapda a sorrenden kívül érkező natív GPS-minta: ilyenkor a
   részállapot érvénytelenné válhat, és kell a mai teljes újraszámolási ág.
2. A hosszú mentés és aktivitáshangok natív készülékes ellenőrzése az új
   buildre vár.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Opus, emelt mélység** — a szerveroldali részszámítás új állapot-életciklust,
átmeneti tárolót, sorrenden kívüli pontok miatti visszaesési ágat és a kritikus
`activityCommit.ts`/`activityChunked.ts` út átalakítását igényli.

## FORRÁSOK SORRENDJE

1. `AGENTS.md`
2. `HANDOFF.md` (ez a fájl)
3. `src/lib/mapMotion.ts`
4. `src/lib/mapMotion.test.ts`
5. `src/lib/heading.ts`
6. `src/components/MapView.tsx`
7. `src/screens/TrackingScreen.tsx`
8. `src/game/index.ts` (`IncrementalActivityGeometry`)
9. `src/game/loopDetection.ts` (`IncrementalLoopDetector`)
10. `src/game/cells.ts` (`IncrementalCellPath`)
11. `server/src/lib/activityCommit.ts`
12. `server/src/lib/activityChunked.ts`

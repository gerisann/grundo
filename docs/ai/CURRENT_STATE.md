# Jelenlegi állapot

> Frissítve: **2026-09-04** · GRUNDO **#37**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**
> Állapot: ⚠️ a #37 munkája **COMMITOLATLAN** a munkakönyvtárban (a #36 utolsó
> commitja `03f6b83`). Kliens `tsc` tiszta, **782/782** teszt zöld, `npm run
> build` hibátlan.
> Utoljára dolgozott: **Claude (Opus, High)**

## A #37 menet

1. **A terepi mérés kiértékelése** — lásd a nyitott ügyek 1. pontját és a
   [`meres-2026-09-04-terepi-fosszal.md`](meres-2026-09-04-terepi-fosszal.md)-t.
2. **Az előnézet levétele a főszálról** (Web Worker) — a mérés által
   megfordított sorrend szerint ez lett az első lépés, nem az algoritmus
   olcsóbbá tétele. Új fájlok: `src/lib/previewEngine.ts`,
   `src/workers/previewWorker.ts`, `src/workers/previewProtocol.ts`,
   `src/hooks/usePreviewEngine.ts`, `src/lib/previewEngine.test.ts` (13 eset).
   A `TrackingScreen` −193 sorral rövidebb.

⚠️ **A LÁNC LEGTÖRÉKENYEBB PONTJA**, ha valaki hozzányúl: a worker felé
KÜLÖNBSÉGET küldünk, nem a teljes pontsort. A `structuredClone` minden pontot
új objektummá másol, az inkrementális gyorsítótár viszont az objektum-
azonosságból ismeri fel a folytatást — teljes listával minden frissítés a
nulláról építene (mérve: 2,6 ms → 1 248 ms). A `previewEngine.test.ts`
„nem épül újra" és „ugyanazokat az objektumokat" esetei ezt őrzik.

## A #36 menet célja (lezárva)

A #35 handoff 1. pontja (telepítés + utókövetés) lezárult, a 2–3. pont
(főszálas költség, cache-hiány) **nem indult el**: Geri terepi mérésre ment
két készülékkel, és a döntés az ő adatára vár. Helyette négy, menet közben
érkezett feladat készült el.

## Elkészült

1. **Főszál-mérések szinkronja a szerverre.** A `PerfOverlay` „Mentés" gombja
   a helyi mentés után feltölti a mérést (`POST /api/admin/perf-snapshots`);
   a `/admin/teljesitmeny` a szerver és a helyi előzmény uniója, és
   megnyitáskor pótolja az elmaradt feltöltéseket. Megadható rövid **jelölés**
   („háttér" / „előtér"), mert két készülék adata különben csak időbélyegben
   térne el. ⚠️ Emulátoros teszt fogott egy éles hibát: a Firestore nem tárol
   beágyazott tömböt, a mérő `[[kulcs, érték], …]` kísérőszámai 500-zal
   buktak volna — objektumként mennek be, olvasáskor állnak vissza párokká.
2. **Banda-ranglista visszaszámolása.** A `backfill:banda-stats` eddig csak
   NULLÁKKAL hozta létre a `bandaStats` mezőt — ezért mutatott a ranglista
   minden tagnál 0 km²-t és 0 GP-t. A bontás megvan az aktivitás-
   dokumentumokban (`type`, `areaGainedM2`, `gp`); az új
   `aggregateBandaStatsFromActivities` ebből számol. **A szkript még nem
   futott élesben.**
3. **iOS-hangok.** A `ac1ea9e` szinkron `pause()`-a megszakítja a `play()`-t,
   mielőtt elindulna — iOS-en emiatt az `AVAudioSession` nem aktiválódik, és
   minden hang néma marad. A `pause()` visszakerült a promise-ba; a hangzavart
   a `currentTime` ugratása kerüli el (a hang utolsó 50 ms-e szólal meg).
4. **Bandák — Geri 12 pontos listája, mind.** A tartalmi újdonságok: meghívókód
   MINDEN bandának (a régiek első megnyitáskor pótolják); publikus bandához a
   banda oldaláról is lehet csatlakozni; a meghívó-értesítés a
   `/kozosseg/bandak`-ra visz (ott fogadható el); és a **csengő** bandánkénti
   némítással, három új értesítéssel (új poszt, fal-reakció, napi mérleg). A
   többi megjelenés: profilkép a listákban, fedésmentes fejléc, szűrő-
   megjegyzés, üzenőfal-sorrend, arany alapító, profil KLÁNOK → BANDÁK.

## Módosított fájlok (öt commit: `b8791cb`…`8d8ff77`)

35 fájl, +1391/−134. A tételes bontás a git logban; ami a folytatáshoz kell:

| Fájl | Állapot | Tartalom |
|---|---|---|
| `src/lib/sound.ts` (+41/−15) | MÓDOSÍTOTT | A feloldás valódi lejátszással, a hang legvégén. |
| `src/screens/BandaScreen.tsx` (+135/−24) | MÓDOSÍTOTT | Csengő, csatlakozás, szűrő-megjegyzés, kód. |
| `server/src/routes/bandas.ts` (+125/−13) | MÓDOSÍTOTT | Kód minden bandának, csengő, 3 értesítés, fal-sorrend. |
| `server/src/lib/bandas.ts` (+79) | MÓDOSÍTOTT | `aggregateBandaStatsFromActivities`. |
| `server/src/scripts/backfillBandaStats.ts` (+113/−12) | MÓDOSÍTOTT | Számol, nem nulláz; idempotens. |
| `server/src/jobs/bandaDailyDigest.ts` (+99) | ÚJ | Napi banda-mérleg értesítés. |
| `server/src/routes/admin.ts` (+117) | MÓDOSÍTOTT | `POST`/`GET /api/admin/perf-snapshots`. |
| `src/admin/PerfHistoryScreen.tsx` (+102/−18) | MÓDOSÍTOTT | Szerver + helyi uniója, feltöltés pótlása. |

## Élesben fut / telepítetlen

- **TELEPÍTETLEN, backend ÉS frontend kell**: a `b2e0c98`, `39d821a` és
  `8d8ff77` commit (banda-backfill logika, hangjavítás, teljes bandás kör,
  értesítések). A `b8791cb`/`d57fade` perf-szinkron már kiment
  (`grundo-api-00137-k8f` + Hosting).
- **A hangjavítás és a bandás kör csak ÚJ MOBILBUILDDEL jut el a
  készülékekre** — a Capacitor a beépített felületet futtatja. iOS és Android
  build egyaránt kell.
- **`backfill:banda-stats --apply --allow-production`**: még nem futott. Utána
  a banda-rollover (admin gomb vagy Scheduler) számolja újra a `totals`-t.
- **`grundo-banda-daily` Scheduler-job**: nincs bejegyezve; a parancs a
  `docs/06-architektura-es-admin.md`-ben. Ütem 21:00 UTC — ⚠️ szándékosan a
  napi forduló ELŐTT, különben minden bandáról nullát jelentene.

## Ellenőrzések

- Kliens `tsc` és szerver `tsc` tiszta. Kliens **769/769**, szerver **229/229**
  zöld, `npm run build` hibátlan.
- **Emulátoron, két felhasználóval végigpróbálva**: publikus banda kap
  meghívókódot; a fejléc borítóképpel sem kerül fedésbe; csatlakozás a banda
  oldaláról; szűrő-megjegyzés újratöltés után; legújabb üzenet elöl, írás
  fölötte; a csengő állapota megmarad; poszt-, válasz- és szív-értesítés
  megérkezik a másik fiókhoz; a napi mérleg 1,234 km²/420 GP-vel kiment.
- **NEM ellenőrizve**: (a) **a hangok készüléken** — teszt ezt nem bizonyítja,
  és ez a hiba már kétszer csúszott át; (b) a moderátor-lila (a tesztben nem
  volt moderátor); (c) a meghívó-értesítés koppintása élesben.
- ⚠️ **Ismert, NEM ehhez a körhöz tartozó bukás**: az emulátoros
  `activityMedia.emulator.test.ts` „a látható képet binárisan adja vissza"
  esete elhasal (`body.activity` undefined a fotófeltöltés után). Külön
  fájlban futtatva is bukik; a kör diffje ezt az útvonalat nem érinti.

## Nyitott ügyek — #37-nek

1. ~~**A terepi mérés kiértékelése**~~ — **KÉSZ, 2026-09-04**. Két 8,6–9,0 km-es
   kör, ~40 perc, Samsung SM-G780F és iPhone (iOS 18.7). A teljes elemzés a
   számokkal: [`meres-2026-09-04-terepi-fosszal.md`](meres-2026-09-04-terepi-fosszal.md).
   Az újrajátszó szkriptek (csak olvasnak): `tmp/replay-field-track.ts`,
   `tmp/replay-field-phases.ts`, `tmp/replay-field-rejections.ts`.
   ⚠️ **A mérő csak összesítést ment**, ezért a 859 ms-ot csak abból lehetett a
   háttérváltáshoz kötni, hogy `lastMs === maxMs`. Ha újra mérünk, bontsa a
   mintákat `document.visibilityState` szerint.
2. **Az előnézet levétele a főszálról** — ~~**KÉSZ, 2026-09-04**~~, de
   **TELEPÍTETLEN és KÉSZÜLÉKEN NEM ELLENŐRZÖTT**. A számítás a
   `workers/previewWorker.ts`-be került; a `TrackingScreen` a
   `usePreviewEngine` hookon át eteti, KÜLÖNBSÉG-alapú protokollal. A
   cellalánc (a rajzolt nyom és a lépéshang) szándékosan a főszálon maradt.
   Mérve böngészőben, a valódi terepi nyomvonalon (580 pont):
   **a főszál összesen 18 ms**-ot fizet a teljes körre (átlag 0,03 ms /
   frissítés, max 0,6 ms), a számítás pedig a workerben 2 841 ms — vagyis
   pontosan az a munka, ami eddig a főszálat fagyasztotta. Az eredmény
   betűre egyezik a szinkron úttal (518 cella, 10 hurok, GP 180,0 — ez utóbbi
   az éles aktivitás mentett GP-jével is stimmel).
3. **A hurokkeresés olcsóbbá tétele** — **Opus, High**, még NEM indult. A
   worker megszünteti a fagyást, de nem a növekedést: a hívásonkénti költség
   8,6 km alatt ×5,6-ra nőtt, és egy 25 km-es kör ennek a többszöröse lesz. A
   célpont **NEM a körüljárás** (telefonon a teljes `preview.process` csak
   2,6–2,8 ms), hanem az `interior_too_small` jelöltek korai kiszűrése a
   `buildLoopInterior` feltöltés ELŐTT (`src/game/loopDetection.ts`,
   `IncrementalLoopDetector.append`): 10 elfogadott hurokra 499–547
   elutasított jelölt jut, átlagosan 167 cellás fallal — 247–293× hiábavaló
   feltöltés.
4. ~~**Körbe-körbe futásnál a cache sosem talál**~~ — **TÉVES DIAGNÓZIS**, a
   mérés cáfolta: a gyorsítótár végig működött (egy hideg teljes újraépítés
   asztalon 1 248–1 389 ms lenne, a mért csúcs 859 ms). Ami az ismételt
   bejárásnál drágul, az a jelöltkeresés — lásd a 3. pontot.
5. **A worker készülékes ellenőrzése.** ⚠️ Az egyetlen tényleges kockázat a
   **modul-worker** (`{ type: 'module' }`) natív webnézetben: iOS 15+ és
   Chrome 80+ tudja, tehát a mért készülékeken mennie kell — de ha mégsem, a
   hook némán a szinkron ágra vált, és minden a régi módon működik tovább (a
   `preview.dispatch` ilyenkor a teljes számítás idejét mutatja, nem 0,03
   ms-ot; ebből lehet felismerni). ÚJ mobilbuild kell hozzá.
6. **A mérő bontsa a mintákat láthatóság szerint** (`document.visibilityState`)
   — enélkül a következő terepi mérés sem tudja majd megmondani, mi történt
   pontosan a háttér-előtér váltásnál. Kicsi, de a 2. pont bizonyításához kell.
7. A hangok és a bandás kör **készülékes ellenőrzése** az új buildekben.

## Modelljavaslat

**Sonnet, Medium** a 6. ponthoz és a telepítés-utókövetéshez.
**Opus, High** a 3. ponthoz: a hurokdetektor jelöltszűrése játékszabály-
érzékeny terület, ahol egy „optimalizálás" csendben elvehet egy bezárást.

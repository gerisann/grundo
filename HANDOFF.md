# GRUNDO handoff

> Frissítve: **2026-09-02** · átadás a **GRUNDO #26** menetből a **#27**-re
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · HEAD: ennek az átadónak a commitja · munkamásolat tiszta

## ÁLLAPOT

Elkészült az aktivitásvezérlés hat új hangja és a telepítő félrevezető
Secret Manager-ellenőrzésének javítása.

### Telepítő

- A `scripts/deploy.sh` nem módosítja többé a gép globális gcloud-projektjét;
  a `grundo` projektet csak a saját folyamatára állítja be. Ettől megszűnik az
  Application Default Credentials eltérő quota projektjéről szóló zajos
  figyelmeztetés.
- A backend előtt mind a négy Cloud Run-titkot ellenőrzi: `SMTP_PASSWORD`,
  `JOBS_TOKEN`, `MAPBOX_TOKEN`, `RATE_LIMIT_HMAC_KEY`.
- Csak a valódi `NOT_FOUND` jelent hiányzó titkot. Auth-, hálózati vagy
  jogosultsági hibánál az eredeti gcloud hiba látszik; nem ad többé téves
  titoklétrehozási utasítást.

### Kliens

- Szüneteltetéskor `pause-activity.mp3`, folytatáskor
  `resume-activity.mp3`, új körnél `new-lap.mp3` szól.
- A húzásos és a nyomva tartós befejezés sikeres gesztusa után
  `finish-activity.mp3` szól, még a mentési folyamat indítása előtt.
- Nyomva tartás közben a `pressing-finish-activity.mp3` fut. Felengedéskor
  megáll és megőrzi a pozícióját; újranyomáskor innen folytatódik. Sikeres
  befejezéskor vagy a gomb megszűnésekor megáll és nullára áll.
- Az `activity-saved.mp3` nem az űrlap elküldésekor szól: a mentésből érkező
  aktivitás-részletező sikeres adatbetöltése váltja ki. A navigációs jelző
  egyszer használatos, ezért frissítés vagy visszalépés nem ismétli meg.
- A Hangok képernyőn új, külön kapcsolható „Aktivitásvezérlés” csoport van,
  mind a hat hang meghallgatható.
- A régi `localStorage` beállítások mezőnként migrálódnak; az új csoport
  alapértelmezetten be van kapcsolva.
- A hat forrásfájl és a `public/sounds`, illetve a production build példányai
  SHA-256 szerint bitre azonosak.

## ÉLESBEN FUT / TELEPÍTETLEN

- A hosszúmentés `c33a935` és a hangok `7e9b396` commitja már a GitHubon van,
  de a telepítés a hibás Secret Manager-előellenőrzésnél megállt.
- A telepítőjavítás commitja még nincs pusholva és nincs telepítve.
- A változások kiadásához **backend, majd frontend** telepítés kell.
  A backend az előző commit miatt szükséges; a hangos commit önmagában csak
  kliensoldali.
- Adatmigráció, Firestore-szabály- és indextelepítés nem kell.
- Az új hangok natív használatához az új HEAD-ből iOS- és Android-build kell;
  a már futó korábbi buildek nem tartalmazzák az MP3-fájlokat.

## ELLENŐRZÉSEK

- Gyökér typecheck: sikeres.
- Célzott hangtesztek: **16 zöld**.
- Teljes normál Vitest: **650 zöld**, 133 emulátoros kihagyva.
- Production build: sikeres; a meglévő nagy chunk figyelmeztetés maradt.
- A hat MP3 forrás → public → dist SHA-256 egyezése sikeres.
- Vizuális QA: az új Hangok csoport világos témában rendben, 720 px széles
  nézetben sem lóg ki. Külön sötét ellenőrzés ebben a menetben nem történt;
  CSS nem változott, az új sorok a meglévő tokenes komponenseket használják.
- Natív készülékes hang- és életcikluspróba csak az új buildből lehetséges.
- A telepítő Bash szintaxisellenőrzése sikeres.
- Git Bashből, folyamatlokális `grundo` projektbeállítással mind a négy
  szükséges Secret Manager-titok elérhető; a `MAPBOX_TOKEN` ténylegesen
  létezik és az éles `grundo-api` is ezt használja.

## KÖVETKEZŐ LÉPÉSEK

1. Geri pusholja a telepítőjavítás commitját.
2. Nincs adatbázis-lépés.
3. Telepítési sorrend: **backend → frontend**.
4. Az új HEAD-ből iOS- és Android-build készítendő.
5. Készüléken ellenőrizendő mind a hat esemény, különösen a nyomva tartás
   felengedés/újranyomás folytonossága és a mentési hang késleltetett időzítése.
6. Következő fejlesztési menet: szerveroldali inkrementális geometriai
   részszámítás.

## NYITOTT ÜGYEK

1. A szerveroldali inkrementális geometria még nincs megtervezve vagy kódolva.
   Fontos csapda a sorrenden kívül érkező natív GPS-minta: ilyenkor a
   részállapot érvénytelenné válhat, és kell a mai teljes újraszámolási ág.
2. Az előző commit `activityUploads` sikertelen életjelei a következő
   próbálkozáskor felülíródnak, de külön időalapú takarító job még nincs.
3. A hosszú mentés és az új hangok natív készülékes ellenőrzése az új buildre
   vár.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Opus, emelt mélység** — a szerveroldali részszámítás új állapot-életciklust,
átmeneti tárolót, sorrenden kívüli pontok miatti visszaesési ágat és a kritikus
`activityCommit.ts`/`activityChunked.ts` út átalakítását igényli.

## FORRÁSOK SORRENDJE

1. `AGENTS.md`
2. `HANDOFF.md` (ez a fájl)
3. `src/lib/sound.ts`
4. `src/components/Dock.tsx`
5. `src/components/FinishGestureButtons.tsx`
6. `src/screens/TrackingScreen.tsx`
7. `src/screens/ActivityScreen.tsx`
8. `src/lib/feedbackSettings.ts`
9. `src/game/index.ts` (`IncrementalActivityGeometry`)
10. `src/game/loopDetection.ts` (`IncrementalLoopDetector`)
11. `src/game/cells.ts` (`IncrementalCellPath`)
12. `server/src/lib/activityCommit.ts`
13. `server/src/lib/activityChunked.ts`

# GRUNDO handoff

> Frissítve: **2026-09-03** · átadás a **GRUNDO #25** menetből a következőre
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · HEAD: ennek az átadónak a commitja · munkamásolat tiszta
>
> ⚠️ A sorszám a BESZÉLGETÉSEKÉ: Geri ezt a menetet **#25**-ként adta át, az
> előző átadó viszont #27-et írt. Az AGENTS.md 7. pontja szerint a chat száma
> az igazság, ezért állt vissza a számozás.

## ÁLLAPOT

Két éles szerverhiba javítva, telepítve, és a miattuk beragadt aktivitás
helyreállítva.

**A kiváltó eset**: jamal 143 km-es, 12,8 órás bringakörét (`ebb3c240…`,
2026-09-02) az app nem tudta elmenteni; az újrapróbálás
`undefined is not an object (evaluating 'i.distanceM')` hibával elszállt, az
aktivitás mégis megjelent — 0 GP-vel és 0 területtel.

**1. Miért veszett el a terület és a GP.** A darabolt foglalás első
blokkcsoportja `INVALID_ARGUMENT: Transaction too big` hibával elhasalt (éles
napló, 21:55:12), így a könyvzárás sosem futott le, és a kör örökre
`claimStatus: 'pending'` állapotban maradt. A tranzakciót MÉRVE nem az adat
fújta fel: a nyers payload 1,48 MB volt, a 10 MiB-os korlát töredéke. Az ok az
INDEXBEJEGYZÉS: egy kibontott rácsblokk `cells` mezője 343 cella × 3 almező,
mindegyikre két index — blokkonként ~2 000 bejegyzés, a 400-as csoportban
~160 000. Ugyanez a hibaminta már szerepelt a repóban az `activityCells`
tömbnél (2026-09-01), csak a rácsblokkokra nem terjedt ki.

**2. Miért szállt el a kliens.** A `beginActivityUpload` és a
`/upload-status` az aktivitás dokumentum LÉTEZÉSÉT tekintette késznek. A
darabolt úton viszont a dokumentum már az első fázisban létrejön, a `summary`
csak a könyvzáráskor — így az újraküldés `{ status: 'done', summary:
undefined }` választ kapott, a kliens pedig `summary.distanceM`-nél elszállt
(`TrackingScreen.tsx:1747`). Ráadásul az újraküldést duplikátumnak vette,
ezért a kör magától soha nem tudott elkészülni.

⚠️ **Fontos a szereposztáshoz**: jamal a **#29-es** kliensbuildet használta, a
SZERVER viszont már az aznap délutáni kódot futtatta (`00116` revízió,
16:01 UTC) — a hiba szerveroldali volt, nem a régi buildé.

## ÉLESBEN FUT / TELEPÍTETLEN

- **Telepítve** (2026-09-03): `indexek` (a `grid.cells` és `grid.ownerCounts`
  kizárása — a Firestore-ban ellenőrizve, hogy létrejött) és `backend`
  (`grundo-api-00117-9s2` revízió aktív).
- **Helyreállítva**: `ebb3c240…` újraszámolva a tárolt nyomvonalból — 28 hurok,
  192 023 cella, **58,97 km²**, **1 523 GP**, 3 károsult, területfoltok
  újraszámolva mind a négy érintettnek. A művelet 12 mp alatt lefutott, és a
  csoportot NEM kellett felezni (`group-0..3` + `frontier`), tehát a 200-as
  méret és az indexkizárás együtt elég volt.
- ⚠️ **TELEPÍTETLEN a 2026-09-02-i FRONTEND-csomag**: Mapbox-mozgásfinomítás,
  aktivitáshangok, a hosszú mentés kliensoldali „Nyugodtan bezárhatod"
  állapotkezelése. Ezek `main`-en vannak, de nem mentek ki — **frontend**
  telepítés kell hozzájuk, plusz iOS/Android build az új HEAD-ből.

## ELLENŐRZÉSEK

- Teljes normál Vitest: **665 zöld** (657 + 8 új egységteszt).
- Teljes emulátoros készlet: **137 zöld** (133 + 4 új).
- Gyökér és `server/` typecheck: mindkettő tiszta.
- A folytatás-tesztet KÜLÖN igazoltam: a javítás kikapcsolásával elbukik
  (200 „duplikátum" a várt 201 helyett), tehát valódi bizonyíték.
- Éles adaton ellenőrizve a helyreállítás előtt: mind a 45 aktivitás közül
  EGYETLEN volt hiányos (a beragadt kör), tehát a szigorúbb „kész" feltétel
  nem minősít tévesen befejezetlennek régi mentést.

## KÖVETKEZŐ LÉPÉSEK

1. Nincs adatbázis-lépés; a helyreállítás lefutott.
2. Ha Geri kéri: **frontend** telepítés a tegnapi csomaghoz, majd iOS/Android
   build az új HEAD-ből.
3. ⚠️ Az ADC a helyreállításhoz saját felhasználói hitelesítésre lett váltva.
   Vissza a csak olvasó alapállapotba (Git Bash, bárhonnan):
   `gcloud auth application-default login --impersonate-service-account=grundo-reader@grundo.iam.gserviceaccount.com`

## NYITOTT ÜGYEK

1. **`cellCount: 0` a darabolt úton.** A könyvzárás nem írja felül az első
   fázis nulláját, ezért az aktivitás részletezője „útvonalmező: 0"-t mutat
   MINDEN nagy körnél (`ActivityScreen.tsx:392`). A gyors út
   `result.cellPath.length`-t ír. Egysoros javítás, de a `plan`-ből elő kell
   venni a nyomvonal cellaláncát.
2. **A darabolt út NEM ír auditnaplót.** A `buildActivityAudit` csak az
   egytranzakciós úton fut, ezért az admin felület minden nagy aktivitásra azt
   írja, hogy „az auditnapló bevezetése előtt készült" — tévesen. A
   `/admin/aktivitasok` ilyenkor a nyomvonalból ÚJRASZÁMOLT becslést mutatja,
   nem a valódi könyvelést (ezért látszott 9 hurok a tényleges 28 helyett).
3. **Kliensoldali védőháló hiánya.** A `TrackingScreen` továbbra is védtelenül
   olvassa a `summary.distanceM`-et. A szerver most már garantálja, hogy `done`
   válasz `summary` nélkül nem létezik, de öv és nadrágtartó kellene.
4. **Geri nyitott kérdései ebből a menetből**: Simulation Lab scenario
   készítése egy valós aktivitásból; a `/aktivitas/:id` oldal lassú betöltése
   (gyanú: a több tízezer elemű `activityCells` és a kliensoldali
   újraszámolás — MÉG NEM MÉRVE); a rögzítés helyi megőrzése úgy, hogy az app
   bezárható és a feltöltés bármikor újrapróbálható (a kliensoldala részben
   megvan a telepítetlen csomagban).
5. **Szerveroldali inkrementális geometria** — a korábbi menet nagy tétele,
   érintetlen. Csapda: a sorrenden kívül érkező natív GPS-minta.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Sonnet, normál mélység** az 1–3. nyitott ügyre (kis, jól körülhatárolt
javítások meglévő mintára). A 4. pont méréssel kezdődik, az is Sonnet. Az 5.
(inkrementális geometria) továbbra is **Opus, emelt mélység**.

## FORRÁSOK SORRENDJE

1. `AGENTS.md`
2. `HANDOFF.md` (ez a fájl)
3. `server/src/lib/activityChunked.ts` (felezés, folytatás, könyvzárás-őr)
4. `server/src/lib/activityUploads.ts` (`isSettledActivity`)
5. `server/src/scripts/resumeStuckActivities.ts` (helyreállító eszköz)
6. `firestore.indexes.json` (`fieldOverrides` — a `grid` bejegyzések)
7. `server/src/lib/activityChunked.test.ts`
8. `server/src/routes/activitiesCompact.emulator.test.ts`

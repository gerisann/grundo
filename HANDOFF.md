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

Egy éles adatvesztés kivizsgálása, javítása és helyreállítása, majd az abból
következő LAB- és teljesítmény-munka.

**A kiváltó eset**: jamal 143 km-es, 12,8 órás bringakörét (`ebb3c240…`,
2026-09-02) az app nem tudta elmenteni; az újrapróbálás
`undefined is not an object (evaluating 'i.distanceM')` hibával elszállt, az
aktivitás mégis megjelent — 0 GP-vel és 0 területtel. jamal a **#29-es**
kliensbuildet használta, a SZERVER viszont már az aznap délutáni kódot
futtatta (`00116` revízió): a hiba szerveroldali volt.

**1. Miért veszett el a terület és a GP.** A darabolt foglalás első
blokkcsoportja `INVALID_ARGUMENT: Transaction too big` hibával elhasalt (éles
napló, 21:55:12), így a könyvzárás sosem futott le. A tranzakciót MÉRVE nem az
adat fújta fel: a nyers payload 1,48 MB volt, a 10 MiB-os korlát töredéke. Az
ok az INDEXBEJEGYZÉS — egy kibontott rácsblokk `cells` mezője 343 cella × 3
almező, mindegyikre két index, blokkonként ~2 000 bejegyzés. Ugyanez a
hibaminta már szerepelt a repóban az `activityCells` tömbnél (2026-09-01),
csak a rácsblokkokra nem terjedt ki.

**2. Miért szállt el a kliens.** A `beginActivityUpload` és a
`/upload-status` az aktivitás dokumentum LÉTEZÉSÉT tekintette késznek, holott
a darabolt úton a dokumentum már az első fázisban létrejön, a `summary` pedig
csak a könyvzáráskor. Az újraküldés így `{ status: 'done', summary: undefined }`
választ kapott — és duplikátumnak minősült, ezért a kör magától soha nem tudott
elkészülni.

**3. Miért nyílt lassan az aktivitás adatlapja.** Az `ActivityScreen` MINDEN
megnyitáskor lefuttatta a teljes hurokfelismerést a böngészőben, majd eldobta
az eredményt, ha a szerver küldött cellákat (2026-08-29 óta mindig küld).
MÉRVE ugyanezen a körön: **68 456 ms** egy asztali gépen, a fő szálon.

## ÉLESBEN FUT / TELEPÍTETLEN

- **Telepítve** (2026-09-03): `indexek` (`grid.cells` + `grid.ownerCounts`
  kizárása, a Firestore-ban ellenőrizve), `backend` (`grundo-api-00117-9s2`),
  `frontend` (a `99cf2e5` HEAD-ből; az éles oldal betölt, konzolhiba nincs).
- **Helyreállítva**: `ebb3c240…` újraszámolva a tárolt nyomvonalból — 28 hurok,
  192 023 cella, **58,97 km²**, **1 523 GP**, 3 károsult, területfoltok
  frissítve. 12 mp alatt lefutott, felezés NÉLKÜL (`group-0..3` + `frontier`).
- **iOS TestFlight build FUT** a `99cf2e5` commitból (2026-09-03).
- ⚠️ **Android build MÉG NEM készült** ebből a HEAD-ből.
- ⚠️ **Készüléken MÉG NEM ellenőrzött**: a hat aktivitáshang, a Mapbox-mozgás
  finomításai (marker/kamera interpoláció, iránytű két állása világos ÉS sötét
  témában), a hosszú mentés a javított szerverrel, a stat panel új tördelése.

## ELLENŐRZÉSEK

- Teljes normál Vitest: **667 zöld** (657 + 10 új), emulátoros: **137 zöld**
  (133 + 4 új). Gyökér és `server/` typecheck tiszta. Production build tiszta,
  a Firebase-konfig beépülése a `dist`-ben ellenőrizve.
- A folytatás-tesztet KÜLÖN igazoltam: a javítás kikapcsolásával elbukik
  (200 „duplikátum" a várt 201 helyett) — valódi bizonyíték, nem díszlet.
- Éles adaton a helyreállítás előtt: mind a 45 aktivitás közül EGYETLEN volt
  hiányos, tehát a szigorúbb „kész" feltétel nem minősít tévesen
  befejezetlennek régi mentést.

## KÖVETKEZŐ LÉPÉSEK

1. Nincs adatbázis-lépés, nincs függő telepítés.
2. Az iOS build végeztével a fenti készülékes lista végigpróbálása.
3. Ha kell, **Android** build ugyanebből a HEAD-ből.

## NYITOTT ÜGYEK

1. **`cellCount: 0` a darabolt úton.** A könyvzárás nem írja felül az első
   fázis nulláját, ezért az adatlap „útvonalmező: 0"-t mutat MINDEN nagy
   körnél (`ActivityScreen.tsx:392`). A gyors út `result.cellPath.length`-t ír.
2. **A darabolt út NEM ír auditnaplót.** A `buildActivityAudit` csak az
   egytranzakciós úton fut, ezért az admin felület minden nagy aktivitásra azt
   írja, hogy „az auditnapló bevezetése előtt készült" — tévesen. Ilyenkor a
   `/admin/aktivitasok` a nyomvonalból ÚJRASZÁMOLT becslést mutat, nem a valódi
   könyvelést (ezért látszott 9 hurok a tényleges 28 helyett).
3. **Kliensoldali védőháló hiánya.** A `TrackingScreen` továbbra is védtelenül
   olvassa a `summary.distanceM`-et (`:1747`). A szerver most már garantálja,
   hogy `done` válasz `summary` nélkül nem létezik, de öv és nadrágtartó kellene.
4. **Az adatlap válasza 767 kB** ezen a körön (42 666 cellaazonosító). A 68
   másodperces számítás kiesett, de a letöltés és a JSON-elemzés megmaradt —
   érdemes lehet a `activityCells`-t is compactolva küldeni, ahogy a
   `activityCellParents` megy. MÉG NEM MÉRVE, mennyit érne.
5. **Simulation Lab scenario valós aktivitásból** — Geri egyelőre elhalasztotta.
6. **Szerveroldali inkrementális geometria** — a korábbi menet nagy tétele,
   érintetlen. Csapda: a sorrenden kívül érkező natív GPS-minta.

## AMI ÚJ ESZKÖZ LETT

- `server/src/scripts/resumeStuckActivities.ts` — beragadt darabolt mentés
  folytatása a tárolt nyomvonalból, kliens nélkül. Alapból száraz futás.
  ⚠️ Íráshoz ADC-váltás kell (a gépen a csak olvasó `grundo-reader` az alap).
- A LAB e2e rögzítésben a **mentés is szimulálható**: azonnali / lassú /
  újrapróbálható hiba / végleges hiba / nincs kapcsolat, állítható hosszal. A
  szünet valódi szünet lett, a mentőlap sandboxba ír, az eredménypanel
  bezárható.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Sonnet, normál mélység** az 1–3. nyitott ügyre (kicsi, jól körülhatárolt
javítások meglévő mintára). A 4. pont méréssel kezdődik, az is Sonnet. A 6.
(inkrementális geometria) továbbra is **Opus, emelt mélység**.

## FORRÁSOK SORRENDJE

1. `AGENTS.md`
2. `HANDOFF.md` (ez a fájl)
3. `server/src/lib/activityChunked.ts` (felezés, folytatás, könyvzárás-őr)
4. `server/src/lib/activityUploads.ts` (`isSettledActivity`)
5. `server/src/scripts/resumeStuckActivities.ts`
6. `firestore.indexes.json` (`fieldOverrides` — a `grid` bejegyzések)
7. `src/screens/ActivityScreen.tsx` (a 68 mp-es ág feltétele)
8. `src/admin/labE2eSandbox.ts` (mentés-szimuláció)
9. `src/tracking/simulationSource.ts` (valódi szünet)

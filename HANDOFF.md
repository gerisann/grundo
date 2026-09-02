# GRUNDO handoff

> Frissítve: **2026-09-02** · átadás a **GRUNDO #25** menetből a **#26**-ra
>
> Repo: `C:\Users\Geri\Documents\ChatGPT\GRUNDO` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · HEAD: ennek az átadónak a commitja · munkamásolat tiszta

## ÁLLAPOT

Elkészült a hosszú aktivitásmentések „Nyugodtan bezárhatod” kezelése.

### Kliens

- A befejezett, még nem igazoltan feltöltött teljes pontsor IndexedDB-ben
  korlátlan ideig megmarad; nem esik bele az aktív mérés egyórás folytatási
  ablakába.
- A panel csak a sikeres helyi írás után mondja, hogy az app bezárható. Ha az
  IndexedDB-írás elhasal, a szöveg várakozást kér és a `beforeunload` védelem
  megmarad.
- Újranyitáskor a kliens előbb lekéri a szerver státuszát. `done` esetén az
  eredményt mutatja, `processing` esetén ötmásodpercenként követi,
  `missing` esetén ugyanazzal az idempotens `activityId`-val újraküldi.
- Hálózati vagy 5xx POST-hiba többé nem végleges „nem sikerült” hiba: a kliens
  előbb ellenőrzi, hogy a szerver tovább dolgozik-e.
- A mentési panel világos és sötét témában vizuálisan ellenőrizve.

### Backend

- Új server-only `activityUploads/{activityId}` életjel választja szét a
  „szerver még dolgozik” és a „kérés el sem indult” állapotot.
- Az életjel nem tartalmaz geometriát és nem módosít birtokviszonyt. A végleges
  aktivitáscommit továbbra is a meglévő egytranzakciós/darabolt úton történik.
- Tranzakciós lease akadályozza meg ugyanazon drága geometria párhuzamos
  futtatását. A 30 perces lease lejárta után a kérés átvehető.
- Minden feldolgozási kísérlet egyedi tokent kap, ezért egy lejárt régi worker
  nem törölheti vagy írhatja felül az őt átvevő új worker státuszát.
- Új `GET /api/activities/:id/upload-status` végpont csak a saját aktivitás
  durva állapotát adja; más felhasználó mentését `missing` mögé rejti.
- Az új kliens `POST /api/activities?async=1` képességjelzővel kérhet 202-es
  `processing` választ. A régi kliens ugyanerre 503-as, újrapróbálható hibát
  kap, így a telepítési sorrend visszafelé kompatibilis.

## ÉLESBEN FUT / TELEPÍTETLEN

- Geri visszajelzése szerint a korábbi `4a2f017` backendje és frontendje már
  telepítve van; ezt ebben a menetben nem mértük vissza.
- Az előző commitból iOS- és Android-build fut. Ezek a mostani
  mentés/helyreállítás változást **még nem tartalmazzák**.
- A mostani commit még nincs pusholva és nincs telepítve.
- Ehhez a változáshoz **backend, majd frontend** telepítés kell.
- Adatmigráció, Firestore-szabály- és indextelepítés nem kell. Az új kollekció
  Admin SDK-only; a szabályok alapértelmezetten tiltják a klienselérést.
- A natív appokban való használathoz a mostani commitból később új iOS- és
  Android-build szükséges.

## ELLENŐRZÉSEK

- Gyökér typecheck: sikeres.
- Szerver typecheck: sikeres.
- Célzott kliens tesztek: **19 zöld**.
- Teljes normál Vitest: **647 zöld**, 132 emulátoros kihagyva.
- Teljes emulátoros készlet: **132 zöld**; az ezután hozzáadott tokenes
  versenyteszttel az aktivitás-végpont célzott suite-ja **23 zöld**.
- Production build: sikeres; a meglévő nagy chunk figyelmeztetés maradt.
- Vizuális QA: mentési panel világos és sötét témában rendben.

## KÖVETKEZŐ LÉPÉSEK

1. Geri pusholja ezt a commitot.
2. Nincs adatbázis-lépés.
3. Telepítési sorrend: **backend → frontend**.
4. Böngészőben mérendő: hosszú mentés közben kapcsolat megszakítása vagy
   lapbezárás, újranyitás, `processing` követés, végül automatikus eredmény.
5. A mostani commitból készülő következő iOS/Android buildben ugyanez mérendő
   appkilövéssel és újranyitással; a kész aktivitás értesítése nyissa meg az
   adatlapot.
6. Következő fejlesztési menet: szerveroldali inkrementális geometriai
   részszámítás.

## NYITOTT ÜGYEK

1. A szerveroldali inkrementális geometria még nincs megtervezve vagy kódolva.
   Fontos csapda a sorrenden kívül érkező natív GPS-minta: ilyenkor a
   részállapot érvénytelenné válhat, és kell a mai teljes újraszámolási ág.
2. Az `activityUploads` sikertelen életjelei a következő próbálkozáskor
   felülíródnak, de külön időalapú takarító job még nincs. Jelenleg legfeljebb
   egy kis dokumentum maradhat egy félbehagyott aktivitásazonosítónként.
3. A natív készülékes bezárás/újranyitás csak a következő, ezt a commitot
   tartalmazó buildben igazolható.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Opus, emelt mélység** — a szerveroldali részszámítás új állapot-életciklust,
átmeneti tárolót, sorrenden kívüli pontok miatti visszaesési ágat és a kritikus
`activityCommit.ts`/`activityChunked.ts` út átalakítását igényli.

## FORRÁSOK SORRENDJE

1. `AGENTS.md`
2. `HANDOFF.md` (ez a fájl)
3. `src/hooks/useRecorder.ts`
4. `src/tracking/storage.ts`
5. `server/src/lib/activityUploads.ts`
6. `server/src/routes/activities.ts`
7. `server/src/lib/activityCommit.ts`
8. `server/src/lib/activityChunked.ts`
9. `src/game/index.ts` (`IncrementalActivityGeometry`)
10. `src/game/loopDetection.ts` (`IncrementalLoopDetector`)
11. `src/game/cells.ts` (`IncrementalCellPath`)
12. `docs/02-funkcionalis-spec.md`
13. `docs/05-adatmodell.md`

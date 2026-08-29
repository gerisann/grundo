# GRUNDO handoff

> Frissítve: **2026-08-29** · átadás a területmegjelenítés átépítése után
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · implementációs HEAD: **`d0f97f0`**
> (`Profil fülsáv: az aktív fül középre kerül`) · pusholva, `origin/main` egyezik

## ⚠️ ELSŐ OLVASNIVALÓ — ÉLESBEN EL VAN TÖRVE A TERÜLETMEGJELENÍTÉS

A kód kint van (frontend és backend is), de a **Firestore composite index nincs
kitelepítve**, ezért a `/api/tiles/blobs` végpont MINDEN hívása hibára fut
élesben. Éles adaton lefuttatva pontosan azt a lekérdezést, amit a végpont
használ:

```
FAILED_PRECONDITION — The query requires an index.
```

A kliens `Promise.allSettled`-del kezeli, tehát nem omlik össze, csak néma:
közelre zoomolva a hatszögek még látszanak a régi `/api/tiles`-ból, kizoomolva
viszont **egyetlen terület sem jelenik meg**.

Javítás (Cloud Shell, repo gyökere) — ez a következő menet első dolga:

```bash
scripts/deploy.sh indexek
```

Az index elkészülte UTÁN a backfill is kell, különben csak azoknak lesz
foltjuk, akik a backend telepítése óta mentettek kört:

```bash
cd ~/grundo/server && npm run backfill:territory-blobs
cd ~/grundo/server && npm run backfill:territory-blobs -- --apply --allow-production
```

## ÁLLAPOT

### A területmegjelenítés átépítése (a menet fő munkája)

A térkép korábban a BETÖLTÖTT cellákból vonta össze a területfoltokat menet
közben. Három hiba jött ebből, mindet Geri jelezte: a folt széle ott tört el,
ahol a betöltési ablak véget ért; pásztázáskor ugyanarra a területre más-más
folt rajzolódott („ugráltak"); kizoomolva pedig elfogyott az adat.

Mostantól a folt **világ-szintű, állandó egység**: mentéskor kiszámoljuk és
eltároljuk (körvonal + pontos km² + tulajdonos), a térkép ezt kéri le.
Akárhonnan nézzük, ugyanaz a folt ugyanakkora.

- `src/game/territoryBlobs.ts` — összefüggő komponensek a hatszögrácson,
  Douglas–Peucker körvonal-egyszerűsítés (15 m tűrés), pontos terület a
  cellaszámból. 11 egységteszt.
- `src/game/territoryScale.ts` — a méret szerinti láthatóság KÖZÖS szabálya
  kliensnek és szervernek. 9 egységteszt.
- `server/src/lib/territoryBlobStore.ts` — tárolás, méret szerinti szintek,
  lekérdezés, és az összevonó háttérsor.
- `GET /api/tiles/blobs` — nézettől független foltok, a méretszűrés a szerveren.
- `server/src/scripts/backfillTerritoryBlobs.ts` — a meglévő területekhez.

Egy korábbi, elvetett kísérlet tanulsága: a `/api/tiles` végpontban próbáltunk
durva, blokkonkénti hatszögeket visszaadni távoli nézetre. Pontatlan volt és
pásztázáskor villódzott — ez a megközelítés ki lett vezetve, ne térjen vissza.

### A méretskála (Geri döntése)

- **70 km nézetszélességig NEM szűrünk semmit** — a 10-es nagyítás mérve
  ~66 km, tehát zoom 10-en és közelebb MINDEN folt látszik.
- Azon túl a küszöb nulláról indul és simán nő (arány: 0,012). Nem a teljes
  nézetszélességhez mérünk, hanem a túllépéshez — enélkül a küszöb ugrana, és
  a foltok zöme egyetlen görgetésnyi mozdulattól eltűnne.
- Mérve: zoom 10 → 0 m², zoom 9 → 0,56 km², zoom 8 → 5,4 km².
- Egyetlen szám hangolja: `TERRITORY_VISIBILITY_RATIO`.

### Teljesítményjavítás a mentési úton

Terhelési méréssel kiderült, hogy a foltok újraszámolása a kérés útján futott,
és felhasználónként ~2,1 másodperc (400 blokk olvasása 630 ms, kibontás 240 ms,
komponensek 500 ms, körvonalak 730 ms, ~80 000 cellás területnél). Egy aktivitás
a támadót és 3-4 áldozatot is érint → **a mentés ~9 másodpercet várt**.

Megoldás: összevonó háttérsor (`scheduleTerritoryBlobRecompute`). A kérés nem
várja meg, és az ugyanarra a felhasználóra érkező igényekből egyetlen ismétlés
elég. Mérve: **6,7 → 40 aktivitás/perc**.

Vállalt kockázat: a folt rövid ideig elavult lehet, és a folyamat leállása
elveszíthet egy frissítést. Megjelenítési adat — a következő aktivitás úgyis
újraszámolja, és ott a backfill szkript is.

### Egyéb elkészült dolgok

- **Új app ikon** minden platformon, egyetlen forrásból:
  `assets/app-icon-source.png` + `npm run icons:generate` (20 fájl).
  A régi `favicon.svg` TÖRÖLVE — a böngésző a vektorosat részesíti előnyben,
  tehát a PNG-k cseréje után is a régi logó látszott volna. Az Android adaptív
  háttér fehérről `#131314`-re váltott, a forráskép saját háttérszínére.
- **Riválisok fül**: a doboz 448 helyett 224 pixelre ugrott össze. Ok: az alap
  `.conn` teljes képernyős rétegre készült, és a `margin-inline: auto`
  RÁCSELEMEN KIKAPCSOLJA A NYÚJTÁST. A `max-width` ártatlan volt.
- **Profil fülsáv**: fülváltáskor visszaugrott az elejére (minden fül külön
  képernyő, a sáv újraépül). Most az aktív fül középre görget, a sáv határaira
  vágva — ettől a szélső fülek a szélükön maradnak, a középsők középre kerülnek.
- **Telefonos fejlesztői elérés**: a kliens négy helyen beégetett `localhost`-ot
  használt; most `location.hostname`. Az emulátorok `0.0.0.0`-n hallgatnak, a
  `dev:emulator` felveszi a gép LAN-címeit a CORS-listára és ki is írja.
- A cellánkénti területréteg (`AREA_SOURCE`) csak zoom 14-től rajzol — korábban
  `minzoom` nélkül minden nagyításon látszott a nyers hatszög-fűrészfog.
- A menet első felében: feed-fotógaléria, mentés-panel, indítási folyamat
  (3-2-1 + RAJT), statisztika-panel harmadik nézete, húzásos befejezés-gesztus,
  időjárás-widget szélessége. Ezek élesben vannak és visszaigazoltak.

## ÉLESBEN FUT / TELEPÍTVE

Ellenőrizve 2026-08-29-én, nem feltételezve:

- **Frontend telepítve.** A `MapView-*.js` darabban ott a `grundo-blobs` réteg,
  az `index-*.js`-ben a `tiles/blobs` hívás, és az `index.html`-ben az új
  ikonhivatkozások (`favicon-32.png`, `apple-touch-icon.png`).
- **Backend telepítve.** `grundo-api-00094-r5s`, létrehozva
  2026-08-28 23:34 CEST — az utolsó szerveroldali commit (`71deda0`, 18:47)
  után. A `territoryBlobs` kollekcióban vannak élesben írt dokumentumok.
- Minden commit pusholva; `origin/main` = `d0f97f0`.
- Az éles frontend a `https://grundo.web.app` címen fut. A
  `https://grundo.ai.studio` 404-et ad — nem ez a kiszolgált cím.

## TELEPÍTETLEN / MŰKÖDÉSKÉPTELEN

- **Firestore index: NINCS kitelepítve** — lásd a fájl elején. A definíció
  bent van a feltolt `firestore.indexes.json`-ban, csak a deploy hiányzik.
  (23 másik composite index READY, `territoryBlobs` nincs köztük.)
- **Backfill nem futott** élesben. Enélkül csak a backend telepítése óta
  mentett körökhöz tartozik folt.
- A **natív alkalmazások** ikonja csak új buildben cserélődik (`npx cap sync`
  + Codemagic build).

## ELLENŐRZÉSEK

- `npx tsc --noEmit` (kliens és `server/` is): sikeres.
- Kliens `vitest`: **387 sikeres**. Szerver `vitest`: **165 sikeres**,
  122 emulátoros kihagyva.
- **Terhelési próba helyi emulátoron: 1000 aktivitás, 0 hiba**, 26 perc 39 mp
  (~1,6 s/kör), 170 folt, ~2100 km² átfedésekkel. Öt teszt-felhasználó,
  mindegyik saját cellaszínnel.
- Térkép-válaszidő 1000 aktivitás mellett — **nem nő a kizoomolással**:

  | nézet | válasz | méret | foltok | küszöb |
  |---|---|---|---|---|
  | 2 km | 87 ms | 7 KB | 1 | 0 |
  | 15 km | 98 ms | 258 KB | 153 | 0 |
  | 66 km (zoom 10) | 97 ms | 295 KB | 170 (mind) | 0 |
  | 132 km | 87 ms | 235 KB | 33 | 0,55 km² |
  | 264 km | 55 ms | 77 KB | 8 | 5,4 km² |

- **Stabilitás**: ±8 km pásztázás azonos nagyításon — a mindenhol látható
  foltok területe ÉS teljes körvonala bitre azonos. Ugyanaz a folt
  3/10/30/60/120 km-es nézetben egységesen 7,296 km², 215 pontos körvonal.
  170 folt, 170 egyedi azonosító, nincs duplikátum.
- **Nem ellenőrzött**: a térkép TÉNYLEGES kinézete. A fejlesztői böngészőablak
  nem kompozitál, ezért a Mapbox el sem indul benne — az adatutat és a
  `MapView` propjait mértem helyette. A vizuális ellenőrzés Gerire vár.

## KÖVETKEZŐ MENET — CLAUDE ELSŐ FELADATA

1. **Index telepítése és ellenőrzése.** `scripts/deploy.sh indexek`, majd
   győződj meg róla, hogy a `territoryBlobs` index READY állapotú.
2. **Backfill futtatása** élesben, előbb szárazon, majd `--apply
   --allow-production`. Jegyezd fel, hány felhasználót és foltot érintett.
3. **Éles ellenőrzés** a `/grund` oldalon: kizoomolva látszanak-e a területek,
   zoom 10-en minden folt megjelenik-e, pásztázáskor stabil-e a kép.
4. Ha Geri visszaigazolta, rögzítsd az eredményt ebben a fájlban, és töröld a
   fájl elejéről a figyelmeztető szakaszt.

## HELYI FEJLESZTŐI KÖRNYEZET

Négy dolog kell, ebben a sorrendben:

```bash
firebase.cmd emulators:start --only auth,firestore --project demo-grundo
```

```bash
cd server && npm run dev:emulator
```

```bash
cd server && npm run seed:emulator
```

```bash
npm run dev:emulator
```

Teszt-világ Budapest fölé (a `server/` mappából), 0,1–10 km² közötti, szögletes
utcakövető körökkel:

```bash
npm run seed:budapest -- --reset --count 1000
```

Kapcsolók: `--spread` (gócpontok szórása km-ben), `--clusters`, `--jitter`,
`--count`, `--reset`. A szkript a végén felhasználónként újraszámolja a
foltokat, hogy a mért végállapot biztosan helyes legyen.

Belépés: `geri@grundo.local` / `grundo-emulator`, vagy a böngészőkonzolból
`await __grundoDevSignIn()`.

Telefonról: `http://<gép-IP>:5173` — a backend induláskor kiírja a pontos
címet. ⚠️ A `firebase.json` `host: 0.0.0.0` beállítása csak az emulátorok
ÚJRAINDÍTÁSA után lép életbe; enélkül az oldal betöltődik, de a belépés némán
lóg. HTTP-n a telefon böngészője letiltja a helymeghatározást, tehát
GPS-rögzítést így nem lehet próbálni.

## NYITOTT KISEBB ÜGYEK

- **295 KB-os válaszcsúcs** a 33–66 km-es sávban, minden térképmozgatásnál.
  Wi-Fi-n észrevehetetlen, mobiladaton érezhető. Két olcsó út, ha szűkíteni
  kell: erősebb körvonal-egyszerűsítés távoli nézetre (a nagy foltok viszik a
  méret nagy részét), vagy kliensoldali gyorsítótár. Geri egyelőre nem kérte.
- A háttérsor Cloud Runon elveszíthet egy frissítést, ha a példány a válasz
  után leáll. Ha ez gondot okoz, a `backfill:territory-blobs` időzített
  futtatása a legegyszerűbb védőháló.
- A `MAX_BLOCKS_PER_USER = 400` korlát a foltszámolásban: nagyon nagy
  birodalomnál a folt hiányos lehet. Ma nem éles probléma.

### Korábbi menetből áthozva (nem ehhez a munkához tartozik)

- A natív **Android Google-belépés** készülékes eredményéről még nincs
  visszaigazolás, és a meglévő e-mail/jelszavas fiók Google-fiókkal való
  összekapcsolása sincs készüléken ellenőrizve.
- **Google Play Console / Play App Signing** beállítása szándékosan későbbre
  maradt; az AAB még nincs feltöltve. Play App Signing bekapcsolása után a Play
  által adott **app signing certificate SHA-1**-et is fel kell venni a Firebase
  Android apphoz, majd frissíteni a `google-services.json`-t a Codemagic
  Secretben — enélkül a Playből telepített app Google-belépése elbukik.
- Windows alatt az iOS Swift Package Manager auth-plugin symlink `EPERM` hibával
  kimaradt; a macOS Codemagic `npx cap sync ios` lépésének kell létrehoznia.
- Android 13+ engedélyág, lezárt kijelzős 3+ perces út, appváltás,
  szünet/folytatás, offline pontsor, FCM, és az OEM akkumulátorkezelés
  (Samsung/Xiaomi/Huawei) terepi ellenőrzése.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

- Index- és backfill-telepítés, éles ellenőrzés: **Sonnet, normál mélység**.
- Ha a foltok élesben sem jelennek meg az index után, vagy geometriai/
  teljesítménybeli hibát kell keresni: **Opus, emelt mélység**.

## FORRÁSOK SORRENDJE

1. `AGENTS.md` — különösen a Munkamódszer szakasz
2. `HANDOFF.md` (ez a fájl)
3. `src/game/territoryBlobs.ts` és `src/game/territoryScale.ts` fejlécei
4. `server/src/lib/territoryBlobStore.ts` fejléce
5. `docs/README.md` és a kapcsolódó funkcionális/architektúra dokumentumok

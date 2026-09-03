# Tartós döntések

Amit **nem szabad visszacsinálni**, és amiért. Ez a fájl lassan nő: csak olyan
kerül bele, ami hónapok múlva is korlátozza a megoldásteret. A napi állapot a
[`CURRENT_STATE.md`](CURRENT_STATE.md)-ben van, a történet a git logban.

> A játékszabályok és a spec forrása a `docs/` — ez a fájl azokat nem
> ismétli, csak azokat a **megvalósítási** döntéseket rögzíti, amiket egy
> friss munkamenet nem tudna kitalálni a kódból.

## Geometria és területszámítás

- **H3 hexrács, res 12, poligon-algebra nélkül.** Nincs PostGIS, nincs turf.js
  boolean. (`docs/README.md` 1. döntés)
- **Compact / hierarchikus nagy-hurok logika — nem szabad visszaegyszerűsíteni
  teljes res12 materializációra.** Balaton-méretű területnél ez milliós
  cellalistát jelentene. Forrás: `#12` menet (LAB → production).
- **A frontier cleanup snapshot-alapú, NO CASCADE.** Ne váljon általános world
  cleanup algoritmussá.
- **A kliens activity/claim számítása előnézet.** Normál aktivitásmentésnél a
  **backend az authoritative**, nyers trace-ből újraszámol mindent.

## Megerősítés (védelem) — a `#13` menet döntése

- **A védelem NEM a bezárások számából jön**, hanem abból, hogy a nyomvonal
  hányszor **kerülte meg** a cellát (körüljárási szám,
  `src/game/winding.ts`). A hurokdetektor dönti el, MELY cellák jönnek szóba; a
  körüljárás azt, HÁNYSZOR.
- A körüljárás **nyitott nyomvonalon, záró húr nélkül** számolódik — záró
  húrral egy hosszú hazasétálás hamis körüljárást vinne be (mérve: két cella
  esett ki emiatt egy bezárt területből).
- **Racsni, nem szögösszeg**: valahányszor az elfordulás egy teljes kört
  összegyűjt — bármelyik irányban —, az egy bekerítés. Így az ellentétes irányú
  körök nem oltják ki egymást, a félkör nem lép, és a kör utáni elsétálás nem
  teker vissza.
- **Régiónként számolunk, nem cellánként** (836 cellás nyom + 3544 claim-cella:
  66 ms → 26 ms). A falcellák a szomszédos régióktól öröklik az értéket.
- ⚠️ **Ne told vissza az index-alapú heurisztikákat** (`creditedAt`,
  `actorAcquiredAt`, `lastReinforcement`, `sameTraversalReinforcement`,
  `closureBlock` 75%-os ablak). Mind a **bejárás irányától** függött; ez volt a
  hiba forrása. Törölve, és a „first wins" probléma velük együtt megszűnt.
- ⚠️ **Ne írj tesztet kézzel gyártott `DetectedLoop`-ból nyomvonal nélkül.** A
  megerősítés geometriából jön — nyomvonal nélkül nincs mit mérni.
- **Valódi új traversal ugyanazt a saját területet ismét erősítheti 2×–5×-re.**
  Ne tegyél olyan dedupe/cooldown-t, ami ezt megszünteti.

## Adattárolás

- **Dedikált Firestore adatbázis: `grundo-db`** — nem a `(default)`. Három
  helyen kell egyeznie (`firebase.json`, `src/lib/firebase.ts`,
  `server/server.ts`). Egy hiányzó második paraméter csendben a `(default)`-ra
  ír. Részletek: `CLAUDE.md`.
- **A kliens soha nem ír játékadatot**, a Firestore-szabályok ezt
  kikényszerítik.

## Profilpreferenciák

- **Egyetlen mező mentése nem töltheti újra a teljes profilt.** A területszín
  Firestore-írása után a `ProfileProvider` csak a helyi `cellColor` mezőt
  módosítja. A `reload()` itt tiltott, mert `loading` állapotba teszi a teljes
  profilfüggő felületet, és látható oldalfrissülést okoz.

## Térképi teljesítmény

- **Az elszámolási adat és a render-munkakészlet külön életű.** Hosszú
  rögzítésnél a teljes nyomvonal és cellageometria megmarad a közös
  játékmotornak, de Mapbox GeoJSON-ba csak a kamera FOV-ja + előtöltési
  ráhagyás, legfeljebb a pozíció körüli beállított sugár kerül. Ezt nem szabad
  a teljes nyomvonal visszarajzolására egyszerűsíteni: Android WebViewben a
  `GeoJSONSource.setData()` teljes tesszellálást és GPU-feltöltést indít, így
  a költség korábban a megtett távval folyamatosan nőtt.
- **A render-sugár és a 3D látótávolság két külön beállítás.** A render-sugár
  a GeoJSON munkakészletet korlátozza; a 250–5000 m-es Viewing Distance a
  döntött kamera zoomját adja meg. A Mapbox ködtartománya perspektívarelativ,
  ezért a méteres értéket a kamera zoomjára képezzük, a távoli peremen pedig
  témaszínű szürke köd ad fokozatos átmenetet. 2D-re váltva mindig az
  alaptérkép eredeti ködbeállítása áll vissza.
- **A rögzítési zoomgomb nem szakítja meg a pozíciókövetést.** A `+ / −`
  programozott kameramozgás, ezért nem állítja `followPaused` állapotba a
  térképet; csak a DOM `originalEvent`-tel érkező valódi felhasználói gesztus
  teszi ezt. A következő GPS-frissítés középen tartja a pozíciót, de megőrzi a
  gombbal választott zoomot.

## Munkamódszer

- **Egy klón, egy mappa:** `C:\Users\Geri\Documents\GitHub\grundo`. 2026-08-29:
  egy második klón (`Documents\ChatGPT\GRUNDO`) kézzel feloldandó
  merge-konfliktust okozott; törölve.
- **Telepítés a fejlesztői gépről**, nem Cloud Shellből (2026-08-29, kvóta).
- **A commit és a push az ügynöké**, de minden push után szólni kell.
- **A natív app nem kerül külön repóba** — a `src/game/` motor közössége miatt.

## Ügynök-konfiguráció betöltése (2026-09-03, mérve a 2.1.255 binárison)

- **A `.claude/rules/` MINDEN fájlja Project-memóriaként töltődik be**, és
  `paths:` frontmatter nélkül `session_start` okkal, azaz minden menetben. ⚠️
  **Ne tegyél scope nélküli fájlt a `.claude/rules/`-ba.** Egyszer már
  megtörtént: 536 sornyi szabály ült minden menet kontextusában.
  `paths:` esetén a betöltés oka `path_glob_match`, tehát csak akkor jön be,
  amikor Claude az illeszkedő fájlhoz nyúl.
- **A Claude Code NEM tölti be az `AGENTS.md`-t.** A memóriabetöltő csak a
  `CLAUDE.md`-t, a `.claude/CLAUDE.md`-t, a `CLAUDE.local.md`-t és a
  `.claude/rules/`-t ismeri; az `AGENTS.md` a binárisban csak a
  Codex-migrációban és az `/init`-ben szerepel. Az `AGENTS.md` ezért **a
  Codexnek és más ügynököknek** szól, és csak átirányítás — ne kerüljön bele
  önálló tartalom, mert az azonnal duplikáció lesz.
- **Eljárás- és referenciaanyag skillbe megy**, nem szabályfájlba: telepítés,
  menetindítás, menetzárás, mért tanulságok. A skill neve és leírása kerül csak
  a rendszerpromptba, a törzse hívásra.
- Cél: a **mindig betöltött** instrukció a projekt `CLAUDE.md`-jére (≈100 sor)
  és a globális `~/.claude/CLAUDE.md`-re (≈50 sor) szorítkozzon.

## Bandák (`#29` menet)

- **Nem Pro-funkció.** A korábbi Klub-spec Pro-gate-jét (`+ Létrehozás [Pro]`)
  elvetettük — bárki hozhat létre bandát. Geri jóváhagyta 2026-09-03.
- **A `totals` előszámított, rollup jobból jön, nem élő olvasáskori
  szumma.** A `BandaScreen` megnyitása ne fizessen egy N-tagos `getAll`-t
  minden alkalommal. Lásd `server/src/jobs/bandaRollover.ts`.
- **`users/{uid}/bandas/{bandaId}` tükör-alkollekció** a `bandas/{id}/members`
  felől, a `following`/`followers` mintájára — a „saját bandáim" lista így
  egyetlen, saját-magam-alatti olvasás, NEM collectionGroup-lekérdezés (ami
  külön engedélyezett indexet igényelne). Ne told vissza collectionGroup-ra:
  az app egyetlen más helyen sem szűr collectionGroup-lekérdezéssel, csak
  szűretlenül olvas ki mindent (`blocks`, `blockIndex` backfill-szkriptek).
- **Nincs `joinRequests`.** A régi Klub-séma admin-jóváhagyásos
  csatlakozási kérést tartalmazott; a Bandáknál publikus csatlakozás
  azonnali, privátnál kizárólag meghívókóddal/meghívással — sosem a
  csatlakozni akaró kezdeményez jóváhagyást igénylő kérést.

## Archívum

A `#12`–`#13` menetek részletes átadói a
[`archive/`](archive/) mappában vannak. **Alapból ne olvasd be őket** — csak
akkor, ha a compact backend, a LAB E2E vagy a körüljárás részleteire van
szükség, és akkor is célzottan (`grep`-pel a fejezetcímre).

| Fájl | Miről szól |
|---|---|
| `archive/2026-08-25-lab-e2e.md` | compact claim primitívek, chunked route, LAB → production tracking UI, gameplay regressziós mátrix |
| `archive/2026-08-25-reinforcement.md` | a körüljárás bevezetése, a mérések, a nyitott szálszabály és nyomvonal-vékonyítás |

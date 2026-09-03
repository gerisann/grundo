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

## Munkamódszer

- **Egy klón, egy mappa:** `C:\Users\Geri\Documents\GitHub\grundo`. 2026-08-29:
  egy második klón (`Documents\ChatGPT\GRUNDO`) kézzel feloldandó
  merge-konfliktust okozott; törölve.
- **Telepítés a fejlesztői gépről**, nem Cloud Shellből (2026-08-29, kvóta).
- **A commit és a push az ügynöké**, de minden push után szólni kell.
- **A natív app nem kerül külön repóba** — a `src/game/` motor közössége miatt.

## Archívum

A `#12`–`#13` menetek részletes átadói a
[`archive/`](archive/) mappában vannak. **Alapból ne olvasd be őket** — csak
akkor, ha a compact backend, a LAB E2E vagy a körüljárás részleteire van
szükség, és akkor is célzottan (`grep`-pel a fejezetcímre).

| Fájl | Miről szól |
|---|---|
| `archive/2026-08-25-lab-e2e.md` | compact claim primitívek, chunked route, LAB → production tracking UI, gameplay regressziós mátrix |
| `archive/2026-08-25-reinforcement.md` | a körüljárás bevezetése, a mérések, a nyitott szálszabály és nyomvonal-vékonyítás |

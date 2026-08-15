# AGENTS.md — GRUNDO

Ez a fájl az AI ügynöknek szól. **Olvasd el teljesen, mielőtt bármit írsz.**

## Mi ez a projekt

A GRUNDO közösségi mozgás-app: futás, séta és kerékpározás közben a felhasználók **területet foglalnak el egy hexagon-rácson**. A cél nem elsősorban a versengés, hanem hogy **mozgásra ösztönözze az embereket** — ezért a területfoglalás mellett egy különálló pontrendszer (GP) is fut, ami az aktivitást önmagában jutalmazza.

> Fuss, sétálj vagy bringázz → zárd a kört → urald a területet → védd meg, ami a tiéd.
> És közben minden méter pontot ér — akkor is, ha nem zárul a kör.

## A teljes specifikáció

A `docs/` mappában van, magyarul. **Ez az igazság forrása.** Ha a kód és a spec eltér, a spec nyer — vagy szólj, hogy a spec hibás.

| Fájl | Mit tartalmaz |
|---|---|
| `docs/README.md` | Index, alapkonstansok, a 11 rögzített döntés |
| `docs/01-kepernyoterkep.md` | Képernyők, navigáció, design-nyelv |
| `docs/02-funkcionalis-spec.md` | Képernyőnkénti funkciók, privát zóna, Pro, értesítések |
| `docs/03-jatekszabalyok.md` | **A hexrács, a bezárás, a védelem, a Trust Score** |
| `docs/04-pontrendszer.md` | A GP-képlet számpéldákkal |
| `docs/05-adatmodell.md` | Firestore séma, indexek, biztonsági szabályok |
| `docs/06-architektura-es-admin.md` | Szolgáltatások, jobok, admin, ütemterv |

## A tíz legfontosabb szabály, amit sosem szabad megsérteni

1. **A terület hexagon-cellák halmaza**, nem szabad alakú poligon. H3 res 12, cellánként 307,09 m². Soha ne vezess be poligon-algebrát (turf.js boolean műveletek) a területszámításba.
2. **A bezárás = önmetszés.** Nem kell visszaérni a rajthoz. A belső cellákat flood fill adja meg. Egy aktivitás alatt több bezárás is lehet.
3. **A területszámítás mindig a TELJES nyomvonalból megy**, a privát zóna levágásától függetlenül. A levágás kizárólag megjelenítési művelet.
4. **A `src/game/` modul közös a kliens és a szerver között.** Ugyanaz a kód fut mindkét oldalon, ezért az élő előnézet és a végleges eredmény bitre azonos. Ne ágazz el platform szerint ebben a modulban, és ne használj benne se DOM-ot, se Firebase-t, se Node-specifikus API-t.
5. **A kliens soha nem ír játékadatot.** Terület, GP, szint, jelvény, előfizetés, bizalmi pontszám: kizárólag szerveroldalról (`server/`). A Firestore-szabályok ezt kikényszerítik — ne lazíts rajtuk.
6. **A Trust Score sosem publikus.** Se a szám, se a részjelek nem kerülhetnek kliensre. Csak a verdikt (`trusted` / `pending_review` / `rejected`).
7. **A gyanús aktivitás látszik, de nem módosít birtokviszonyt.** Nem tüntetjük el a felhasználó futását.
8. **A Pro nem ad játékbeli előnyt.** Se több pontot, se erősebb védelmet. Csak kényelmi és közösségi funkciókat.
9. **Terület mértékegysége m²**, 1 000 000 m² fölött km². Használd a `src/lib/format.ts` `formatArea()` függvényét — sehol ne formázz kézzel.
10. **Minden játékkonstans a `src/config/gameplay.ts`-ben van.** Soha ne írj be számot közvetlenül a logikába.

## Nevek — olvasd el, mielőtt bármit beírsz

A projektben **három, egymáshoz megtévesztően hasonló név** van. Nem elírás, mindegyik szándékos:

| Név | Mi ez | Hol szerepel |
|---|---|---|
| **GRUNDO** | az app / termék neve | felületi szövegek, `metadata.json`, `index.html` |
| **`grundo`** | a Firebase **projekt** azonosítója | `.firebaserc`, `VITE_FIREBASE_PROJECT_ID`, authDomain, storage bucket |
| **`grundo-db`** | a Firestore **adatbázis** neve | `firebase.json`, `getFirestore(…)` hívások |

Ha valahol bizonytalan vagy, **ne találgass** — a `.env.example` fejlécében is ott van mindhárom.

## Firestore: dedikált adatbázis

A GRUNDO **nem** az alapértelmezett Firestore adatbázist használja, hanem egy dedikáltat:

```
grundo-db
```

Ez három helyen van rögzítve, és **mindháromnak egyeznie kell**:

| Fájl | Amit tartalmaznia kell |
|---|---|
| `firebase.json` | `"firestore": [{ "database": "grundo-db", ... }]` — **tömb** alak, ez a többadatbázisos mód |
| `src/lib/firebase.ts` | `getFirestore(app, 'grundo-db')` |
| `server/server.ts` | `getFirestore(adminApp, 'grundo-db')` |

> Ha a második paraméter lemarad, a hívás csendben a `(default)` adatbázisra megy.
> Minden „működni fog", csak rossz helyen keletkeznek az adatok — és ez tipikusan
> hetekkel később, éles adaton derül ki. Soha ne hívj `getFirestore()`-t máshol;
> mindig a `db` példányt importáld.

## Technikai konvenciók

- **Nyelv:** TypeScript, `strict: true`. `any` nem elfogadható.
- **UI nyelve:** magyar. A kód, a változónevek és a kommentek angolul.
- **Stílus:** CSS-változók a `src/styles/tokens.css`-ből. **Két téma: világos (alapértelmezett) és sötét.**
  Ne írj beégetett színt, és **minden képernyőt nézz meg mindkét témában**, mielőtt késznek nyilvánítod.
  A témalogika a `src/lib/theme.ts`-ben van (mód, napnyugta-számítás, DOM-alkalmazás) — ne duplikáld máshol.
- **Térkép:** Mapbox GL. A tokent környezeti változóból vedd.
- **Állapot:** TanStack Query a szerveradatra, `zustand` a helyi UI-állapotra. Ne vezess be Redux-ot.
- **Firestore:** olvasás közvetlenül a kliensről, írás csak a saját, engedélyezett mezőkre. Minden más a `server/` HTTP-végpontjain át.
- **Hibakezelés:** minden szerverhívás hibája felhasználónak érthető magyar üzenetet kapjon. Ne dobj nyers stack trace-t a felületre.

## Mappaszerkezet

```
src/
  config/     játékkonstansok (gameplay.ts) — a spec 04. fejezetéből
  game/       A JÁTÉKMOTOR. Tiszta függvények, közös a szerverrel. Ide ne kerüljön I/O.
  lib/        firebase, mapbox, formázás, segédfüggvények
  screens/    a képernyők (Home, Territory, Tracking, Community, Profile, Settings…)
  components/ újrahasznosítható UI-elemek
  hooks/      React hookok
  store/      zustand store-ok
  types/      közös típusok
  styles/     tokens.css + globális stílus
server/
  server.ts   Cloud Run belépési pont
  src/routes/ HTTP-végpontok (activities, tiles, missions)
  src/trust/  Trust Score számítás
  src/jobs/   ütemezett feladatok (napi forduló, ranglista…)
scripts/      egyszeri és üzemeltetési szkriptek
public/       statikus fájlok, ikonok, manifest
tmp/          átmeneti fájlok — soha ne kerüljön verziókövetésbe
_archive/     leváltott kód, amit még nem törlünk
vendor/       harmadik féltől származó, módosított kód
```

## Hol tartunk

A váz üres. A `src/game/` motor és a konfiguráció **kész és működik** — erre lehet építeni. A képernyők üres helyőrzők.

**A javasolt sorrend** (részletesen: `docs/06-architektura-es-admin.md` ütemterv):

1. **F0** — belépés/regisztráció + OTP, profil, dock-navigáció, designrendszer
2. **F1** — tracking (háttér-GPS!), aktivitás mentése, aktivitás részletek, feed
3. **F2** — a játék: `geo-service`, Terület képernyő, ranglisták, GP, napi jobok
4. **F2.5** — küldetés-ajánló
5. **F3** — közösség · **F4** — Pro és statisztikák · **F5** — konnektorok · **F6** — indulás

**A legkockázatosabb rész a háttér-GPS.** Ezt kell először valós terepen kipróbálni, mert minden más azon áll vagy bukik.

## Amit kérdezz meg, ne találj ki

- Ha egy játékszabály nincs a `docs/` alatt, **ne improvizálj** — kérdezd meg. A játékegyensúly nem tetszőleges.
- Ha egy külső szolgáltatás kulcsa kell (Mapbox, Firebase, konnektorok), kérd el; ne generálj helyőrzőt, ami később élesben marad.
- Ha a spec két helyen ellentmond magának, jelezd, ne válassz magadtól.

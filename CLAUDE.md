# CLAUDE.md — GRUNDO

Ez a fájl minden munkamenet elején betöltődik. **Rövid szándékosan.** A
részletek hivatkozott fájlokban vannak — csak azt olvasd be, amire az aktuális
feladathoz szükség van.

## Munkamenet indítása

1. ez a fájl (automatikusan betöltődik),
2. `docs/ai/CURRENT_STATE.md` — hol tartunk, mi a következő lépés,
3. `git status` + `git diff --stat`,
4. csak ezután nyiss meg forrásfájlt, célzott kereséssel.

**Ne olvasd végig a repót**, és ne töltsd be a teljes `docs/` fát. A
kontextus-szabályok: [`.claude/rules/context-efficiency.md`](.claude/rules/context-efficiency.md).

## Mi ez a projekt

Közösségi mozgás-app: futás, séta, kerékpározás közben a felhasználók
**területet foglalnak egy H3 hexagon-rácson**. A cél nem a versengés, hanem a
mozgásra ösztönzés — ezért a terület mellett egy különálló pontrendszer (GP) is
fut, ami az aktivitást önmagában jutalmazza.

**Capacitor-app, EGY repóban:** web + `server/` (Cloud Run) + natív Android
(Java) + natív iOS (Swift). Külön repóba semmit nem viszünk — a `src/game/`
motor mindhárom oldalon ugyanaz a kód.

## A specifikáció

A `docs/` mappa **az igazság forrása**. Ha a kód és a spec eltér, a spec nyer —
vagy szólj, hogy a spec hibás. Index és alapkonstansok: `docs/README.md`.
Célzottan nyisd meg azt a fejezetet, ami kell:

| Téma | Fájl |
|---|---|
| Képernyők, navigáció, design-nyelv | `docs/01-kepernyoterkep.md` |
| Képernyőnkénti funkciók, privát zóna, Pro | `docs/02-funkcionalis-spec.md` |
| Hexrács, bezárás, védelem, Trust Score | `docs/03-jatekszabalyok.md` |
| GP-képlet számpéldákkal | `docs/04-pontrendszer.md` |
| Firestore séma, indexek, szabályok | `docs/05-adatmodell.md` |
| Szolgáltatások, jobok, admin, ütemterv | `docs/06-architektura-es-admin.md` |
| iOS / Android kiadás (Codemagic) | `docs/07-…`, `docs/08-…` |

## A tíz szabály, amit sosem szabad megsérteni

1. **A terület hexagon-cellák halmaza**, nem szabad alakú poligon. H3 res 12,
   307,09 m²/cella. Soha ne vezess be poligon-algebrát (turf.js boolean) a
   területszámításba.
2. **A bezárás = önmetszés.** Nem kell visszaérni a rajthoz; a belső cellákat
   flood fill adja. Egy aktivitás alatt több bezárás is lehet.
3. **A területszámítás mindig a TELJES nyomvonalból megy**, a privát zóna
   levágásától függetlenül. A levágás kizárólag megjelenítési művelet.
4. **A `src/game/` közös a klienssel és a szerverrel.** Ne ágazz el platform
   szerint benne, és ne használj DOM-ot, Firebase-t vagy Node-API-t. Ezért
   azonos bitre az élő előnézet és a végleges eredmény.
5. **A kliens soha nem ír játékadatot.** Terület, GP, szint, jelvény,
   előfizetés, bizalmi pontszám: kizárólag `server/`-ből. A Firestore-szabályok
   ezt kikényszerítik — ne lazíts rajtuk.
6. **A Trust Score sosem publikus.** Se a szám, se a részjelek. Csak a verdikt
   (`trusted` / `pending_review` / `rejected`).
7. **A gyanús aktivitás látszik, de nem módosít birtokviszonyt.** Nem tüntetjük
   el a felhasználó futását.
8. **A Pro nem ad játékbeli előnyt.** Csak kényelmi és közösségi funkciókat.
9. **Terület mértékegysége mindig km²**, 3 tizedessel. Mindig a
   `src/lib/format.ts` `formatArea()`-ját használd, sehol ne formázz kézzel.
10. **Minden játékkonstans a `src/config/gameplay.ts`-ben van** — soha ne írj
    számot közvetlenül a logikába. A hangolható konstansokat élesben az
    `appConfig/gameplay` felülírhatja (séma: `src/config/tunables.ts`); a
    szerkezetiek (H3 felbontás, cellaterület, `MAX_DEFENSE`, hurokküszöbök,
    szintlépcső) NEM hangolhatók. A motor a konfigurációt **paraméterként**
    kapja (`cfg`), és egy aktivitás a legelején pillanatképet vesz — egy futás
    soha ne számoljon félig régi, félig új szabállyal.

## Három megtévesztően hasonló név

| Név | Mi ez | Hol |
|---|---|---|
| **GRUNDO** | az app / termék neve | felületi szövegek, `metadata.json`, `index.html` |
| **`grundo`** | a Firebase **projekt** azonosítója | `.firebaserc`, `VITE_FIREBASE_PROJECT_ID` |
| **`grundo-db`** | a Firestore **adatbázis** neve | `firebase.json`, `getFirestore(…)` |

⚠️ A GRUNDO **nem** az alapértelmezett Firestore adatbázist használja. A
`grundo-db` három helyen van rögzítve, és mindháromnak egyeznie kell:
`firebase.json` (tömb alak), `src/lib/firebase.ts`, `server/server.ts`. Ha a
második paraméter lemarad, a hívás **csendben** a `(default)`-ra megy: minden
„működni fog", csak rossz helyen keletkeznek az adatok. Soha ne hívj
`getFirestore()`-t máshol — mindig a `db` példányt importáld.

## Technikai konvenciók

- **TypeScript, `strict: true`.** `any` nem elfogadható.
- **UI nyelve magyar**, a kód / változónév / komment **angol**.
- **Stílus:** CSS-változók a `src/styles/tokens.css`-ből. Két téma (világos az
  alapértelmezett). Ne írj beégetett színt, és minden képernyőt nézz meg
  **mindkét témában**, mielőtt késznek nyilvánítod. Témalogika:
  `src/lib/theme.ts` — ne duplikáld.
- **Térkép:** Mapbox GL, a token környezeti változóból.
- **Állapot:** TanStack Query a szerveradatra, `zustand` a helyi UI-állapotra.
  Redux nincs.
- **Hibakezelés:** minden szerverhívás hibája érthető **magyar** üzenetet
  kapjon; nyers stack trace nem mehet a felületre.

## Mappaszerkezet

```
src/config/   játékkonstansok      src/game/     A JÁTÉKMOTOR (tiszta fv., I/O nélkül)
src/lib/      firebase, mapbox…    src/screens/  képernyők
src/tracking/ GPS-rögzítő          src/store/    zustand
server/       Cloud Run: routes/, trust/, jobs/, lib/
android/      Capacitor + natív Java     ios/     Capacitor + natív Swift
scripts/  graphhopper/  public/  vendor/  _archive/  tmp/ (sosem verziókövetett)
```

## Fontos parancsok

| Mit | Parancs (Git Bash, repo gyökér) |
|---|---|
| Fejlesztői szerver | `npm run dev` |
| Célzott teszt | `npx vitest run <útvonal>` |
| Teljes teszt (commit előtt egyszer) | `npm run test` |
| Emulátoros teszt (csak Firestore-változásnál) | `npm run test:emulator` |
| Típusellenőrzés | `npx tsc --noEmit` **és külön** `cd server && npx tsc --noEmit` |
| Build | `npm run build` |

⚠️ A gyökér `tsc --noEmit` **nem** nézi a `server/` mappát. Ez már engedett át
valódi típushibát.

## Szabályok — csak akkor olvasd be, ha az adott témához nyúlsz

| Fájl | Mikor kell |
|---|---|
| [`.claude/rules/context-efficiency.md`](.claude/rules/context-efficiency.md) | **mindig** — keresés, olvasás, kimenetkezelés |
| [`.claude/rules/workflow.md`](.claude/rules/workflow.md) | **mindig** — modellválasztás, haladásjelzés, menetzárás, feladatbontás |
| [`.claude/rules/testing.md`](.claude/rules/testing.md) | teszt vagy build futtatása előtt |
| [`.claude/rules/git-and-deploy.md`](.claude/rules/git-and-deploy.md) | commit, push, telepítés |
| [`.claude/rules/native-and-release.md`](.claude/rules/native-and-release.md) | `android/`, `ios/`, GPS, értesítés, kiadás |
| [`.claude/rules/tooling-traps.md`](.claude/rules/tooling-traps.md) | fájlírás, PowerShell, YAML/JSON szerkesztés |
| [`.claude/rules/lessons.md`](.claude/rules/lessons.md) | ha magyarázatot adnál mérés helyett |

## Amit kérdezz meg, ne találj ki

- Ha egy játékszabály nincs a `docs/` alatt, **ne improvizálj** — a
  játékegyensúly nem tetszőleges.
- Külső szolgáltatás kulcsát kérd el; ne generálj helyőrzőt, ami élesben marad.
- Ha a spec két helyen ellentmond magának, jelezd, ne válassz magadtól.
- Ha egy név ellentmond annak, amit Geri mondott, **állj meg és kérdezz** — ez
  egyszer már egy fölösleges, második Firestore adatbázist eredményezett.

⚠️ **Minden ügynök ebből az egy mappából dolgozik:**
`C:\Users\Geri\Documents\GitHub\grundo`. Ne hozz létre másik klónt. Ha a
munkamenet más útvonalon indul, **állj meg és szólj** — 2026-08-29-en két klón
egy kézzel feloldandó merge-konfliktust eredményezett.

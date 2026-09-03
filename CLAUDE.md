# CLAUDE.md — GRUNDO

Ez az egyetlen fájl, ami minden munkamenetben automatikusan betöltődik.
**Szándékosan rövid.** A többi szabály vagy **útvonalhoz kötött** (akkor
töltődik be, amikor az adott mappához nyúlsz), vagy **skillként** hívható.

## Menetindítás

1. `docs/ai/CURRENT_STATE.md` — hol tartunk, mi a következő lépés
2. `git status` + `git diff --stat` — **a repóban más forrás is dolgozik**
3. célzott keresés (`rg`), és csak a releváns tartomány olvasása

Teljes indítási eljárás menetszámmal és modelljavaslattal:
**`/grundo-session-start`**. Menetzárás: **`/grundo-handoff`**.

## Mi ez a projekt

Közösségi mozgás-app: futás, séta, kerékpározás közben a felhasználók
**területet foglalnak egy H3 hexagon-rácson**. A cél nem a versengés, hanem a
mozgásra ösztönzés — ezért a terület mellett egy különálló pontrendszer (GP) is
fut, ami az aktivitást önmagában jutalmazza.

**Capacitor-app, EGY repóban:** web + `server/` (Cloud Run) + natív Android
(Java) + natív iOS (Swift). A `src/game/` motor mindhárom oldalon ugyanaz a kód
— ezért azonos bitre az élő előnézet és a végleges eredmény.

```
src/config/  játékkonstansok     src/game/     A JÁTÉKMOTOR (tiszta fv., I/O nélkül)
src/lib/     firebase, mapbox…   src/screens/  képernyők
src/tracking/ GPS-rögzítő        src/store/    zustand
server/      Cloud Run: routes/, trust/, jobs/, lib/
android/     natív Java          ios/          natív Swift
scripts/  graphhopper/  public/  vendor/  _archive/  tmp/ (sosem verziókövetett)
```

## A sérthetetlen szabályok — röviden

A részletük ott töltődik be, ahol számít (lásd a táblázatot lent).

1. A terület **hexagon-cellák halmaza**, nem poligon. Poligon-algebra soha.
2. A bezárás **önmetszés**; a területszámítás a **teljes** nyomvonalból megy.
3. A `src/game/` **közös** a szerverrel: nincs DOM, Firebase, Node-API, és
   nincs platform szerinti elágazás.
4. **A kliens soha nem ír játékadatot** — terület, GP, szint, jelvény,
   előfizetés, Trust Score csak `server/`-ből.
5. **A Trust Score sosem publikus**, csak a verdikt.
6. **A Pro nem ad játékbeli előnyt.**
7. **Terület mindig km²**, 3 tizedessel, `formatArea()`-val.
8. **Minden játékkonstans a `src/config/gameplay.ts`-ben** — soha ne írj számot
   a logikába.
9. ⚠️ A Firestore adatbázis **`grundo-db`**, nem a `(default)`. Egy hiányzó
   második paraméter csendben rossz helyre ír.
10. **TypeScript `strict`, `any` nem elfogadható.** UI magyarul, kód angolul.

## A specifikáció

A `docs/` mappa **az igazság forrása**. Ha a kód és a spec eltér, a spec nyer —
vagy szólj, hogy a spec hibás. Index: `docs/README.md`. Célzottan nyisd meg,
ami kell: `01` képernyők · `02` funkciók · `03` játékszabályok (hexrács,
bezárás, védelem, Trust Score) · `04` pontrendszer · `05` adatmodell · `06`
architektúra és admin · `07`–`08` iOS/Android kiadás.

Tartós megvalósítási döntések (**mit nem szabad visszacsinálni**):
`docs/ai/DECISIONS.md`.

## Parancsok (Git Bash, repo gyökér)

| Mit | Parancs |
|---|---|
| Fejlesztői szerver | `npm run dev` |
| Célzott teszt | `npx vitest run <útvonal>` |
| Teljes teszt (commit előtt egyszer) | `npm run test` |
| Típusellenőrzés | `npx tsc --noEmit` **és külön** `cd server && npx tsc --noEmit` |
| Build | `npm run build` |

⚠️ A gyökér `tsc --noEmit` **nem** nézi a `server/` mappát — ez már engedett át
valódi típushibát.

## Ami magától betöltődik, amikor odanyúlsz

| Útvonal | Szabályfájl |
|---|---|
| `src/game/**`, `src/config/**` | `.claude/rules/game-engine.md` |
| `server/**` | `.claude/rules/server.md` |
| `src/screens/**`, `components`, `styles`, `lib`, `hooks`, `store` | `.claude/rules/frontend.md` |
| `android/**`, `ios/**`, `src/tracking/**` | `.claude/rules/native.md` |
| `firebase.json`, `*.rules`, `.env*`, `src/lib/firebase.ts` | `.claude/rules/firebase-config.md` |
| `**/*.test.ts` | `.claude/rules/testing.md` |

## Skillek (kézzel hívhatók)

`/grundo-session-start` · `/grundo-handoff` · `/grundo-deploy` (telepítés,
kiadás) · `/grundo-lessons` (mért tanulságok) · `/task-plan` · `/context-check`

## Amit kérdezz meg, ne találj ki

- Ha egy játékszabály nincs a `docs/` alatt, **ne improvizálj** — a
  játékegyensúly nem tetszőleges.
- Külső szolgáltatás kulcsát kérd el; ne generálj helyőrzőt, ami élesben marad.
- Ha a spec két helyen ellentmond magának, jelezd, ne válassz magadtól.

⚠️ **Minden ügynök ebből az egy mappából dolgozik:**
`C:\Users\Geri\Documents\GitHub\grundo`. Ne hozz létre másik klónt; ha a
munkamenet más útvonalon indul, **állj meg és szólj**.

---
description: Kliensoldali UI-szabályok — témák, tokenek, formázás, állapotkezelés
paths:
  - "src/screens/**"
  - "src/components/**"
  - "src/styles/**"
  - "src/hooks/**"
  - "src/store/**"
  - "src/lib/**"
---

# Frontend

- **Két téma: világos (alapértelmezett) és sötét.** A színek CSS-változóból
  jönnek (`src/styles/tokens.css`) — **ne írj beégetett színt**, és **minden
  képernyőt nézz meg mindkét témában**, mielőtt késznek nyilvánítod. A
  témalogika a `src/lib/theme.ts`-ben van (mód, napnyugta-számítás,
  DOM-alkalmazás) — ne duplikáld máshol.
- **Terület mértékegysége mindig km², 3 tizedessel** — nincs
  mértékegység-váltás. Mindig a `src/lib/format.ts` `formatArea()`-ját használd,
  sehol ne formázz kézzel.
- **Állapot:** TanStack Query a szerveradatra, `zustand` a helyi
  UI-állapotra. Redux nincs.
- **Firestore:** olvasás közvetlenül a kliensről, írás **csak** a saját,
  engedélyezett mezőkre — minden más a `server/` HTTP-végpontjain át.
- **A UI nyelve magyar**, a kód, a változónevek és a kommentek angolul.
- **Hiba esetén érthető magyar üzenet** jelenjen meg, ne nyers hibaszöveg.
- **A Pro nem ad játékbeli előnyt** — se több pontot, se erősebb védelmet. Csak
  kényelmi és közösségi funkciókat.
- **Térkép:** Mapbox GL, a token környezeti változóból. A render-teljesítmény
  döntései (munkakészlet, ködtartomány, zoomgomb és pozíciókövetés) a
  [`docs/ai/DECISIONS.md`](../../docs/ai/DECISIONS.md) „Térképi teljesítmény"
  szakaszában — nézd meg, mielőtt a térképhez nyúlsz.
- **Profilmező mentése nem tölthet újra teljes profilt** (lásd ugyanott,
  „Profilpreferenciák").

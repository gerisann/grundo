---
description: A játékmotor és a játékkonstansok sérthetetlen szabályai
paths:
  - "src/game/**"
  - "src/config/**"
  - "server/src/lib/activity*.ts"
---

# Játékmotor

- **A `src/game/` közös a klienssel és a szerverrel.** Ne ágazz el platform
  szerint, és ne használj benne DOM-ot, Firebase-t vagy Node-API-t. Ez a
  garancia arra, hogy az élő előnézet és a végleges eredmény bitre azonos.
  Tiszta függvények, I/O nélkül.
- **A terület hexagon-cellák halmaza**, nem szabad alakú poligon. H3 res 12,
  307,09 m²/cella. **Soha ne vezess be poligon-algebrát** (turf.js boolean).
- **A bezárás = önmetszés.** Nem kell visszaérni a rajthoz; a belső cellákat
  flood fill adja. Egy aktivitás alatt több bezárás is lehet.
- **A területszámítás mindig a TELJES nyomvonalból megy**, a privát zóna
  levágásától függetlenül — a levágás kizárólag megjelenítési művelet.

## Konstansok

- **Minden játékkonstans a `src/config/gameplay.ts`-ben van** — soha ne írj
  számot közvetlenül a logikába.
- A **hangolható** konstansokat élesben az `appConfig/gameplay` felülírhatja;
  a sémájuk a `src/config/tunables.ts`-ben van, magyar leírással (ugyanabból él
  az admin szerkesztő és a felhasználói szabálymagyarázó).
- A **szerkezeti** konstansok NEM hangolhatók, ne vedd fel őket a `TUNABLES`
  közé: H3 felbontás, cellaterület, `MAX_DEFENSE`, hurokküszöbök, szintlépcső.
- A motor a konfigurációt **paraméterként** kapja (`cfg`), nem importként. Egy
  aktivitás feldolgozása a legelején pillanatképet vesz, és végig azzal számol —
  **egy futás soha ne számoljon félig régi, félig új szabállyal.**

## Megerősítés (védelem)

A védelem a **körüljárási számból** jön (`src/game/winding.ts`), nem a
bezárások számából. A részletes indoklás és a tiltólista (mit ne told vissza)
a [`docs/ai/DECISIONS.md`](../../docs/ai/DECISIONS.md) „Megerősítés" szakaszában
van — **olvasd el, mielőtt ehhez nyúlsz.**

## Mérés

Ne magyarázz mérés helyett. Eszközök: `src/game/fixtures.ts`, a Firestore
emulátor, `npm run inspect:world`, `npm run replay:world`,
`npm run inspect:payload`, az `/admin/aktivitasok` auditnézet.

# Kezdő prompt az AI Studio-hoz

Ezt a szöveget másold be az **új, üres AI Studio projekt** első üzenetébe.
A cél: **ne építsen semmit** — csak egy csupasz, futtatható környezetet kapjunk,
amit utána a `grund.zip` tartalmával töltünk fel.

---

## A prompt (másolható)

> Egy meglévő projektet fogok feltölteni, ezért **ne generálj alkalmazás-kódot**.
> A feladatod kizárólag egy üres, futtatható környezet felállítása.
>
> **Amit csinálj:**
>
> 1. Hozz létre egy üres **React + TypeScript + Vite** projektet.
> 2. Kapcsold hozzá a **Firebase**-t, és **hozz létre egy dedikált Firestore adatbázist `groundo` néven** — NE az alapértelmezett `(default)` adatbázist használd. A Firestore-hívásoknak explicit módon a `groundo` adatbázisra kell mutatniuk (`getFirestore(app, 'groundo')`).
> 3. Engedélyezd a Firebase **Authentication** (e-mail + jelszó) és a **Cloud Storage** szolgáltatást.
> 4. Állítsd be a `@/*` → `src/*` útvonal-aliast a `tsconfig.json`-ban és a `vite.config.ts`-ben.
> 5. Kapcsold be a TypeScript `strict` módot.
>
> **Amit NE csinálj:**
>
> - Ne generálj példakomponenst, demo oldalt, „Hello World" felületet, counter-t, sablon-CSS-t, logót vagy bármilyen kezdő tartalmat.
> - Ne találj ki funkciókat, ne tervezz adatmodellt, ne írj biztonsági szabályokat.
> - Ne telepíts olyan csomagot, amit nem kértem.
> - Ne kezdj el semmilyen alkalmazás-logikát írni.
>
> A `src/` mappa legyen üres (legfeljebb egy `main.tsx`, ami egy üres `<div>`-et rendereltet). Minden további fájlt én töltök fel a következő lépésben, és **azok felülírják, amit most létrehozol** — ezért is ne dolgozz feleslegesen.
>
> Amikor kész vagy, csak annyit írj vissza, hogy melyik Firebase projektben és melyik adatbázisban dolgozunk, és hogy a környezet készen áll a fájlok fogadására.

---

## A feltöltés után

A `grund.zip` tartalmának feltöltése után add ki a második promptot:

> Feltöltöttem a projekt vázát. **Olvasd el a `CLAUDE.md`-t teljes egészében, mielőtt bármit írsz** — abban vannak a projekt szabályai és a specifikáció útmutatója.
>
> A `docs/` mappában van a teljes, magyar nyelvű specifikáció. **Ez az igazság forrása**: ha a kód és a spec eltér, a spec nyer.
>
> Még ne írj kódot. Először foglald össze 10 mondatban, hogy mit értettél meg a projektből, és sorold fel, hol látsz ellentmondást vagy hiányzó információt.

Ez a „még ne írj kódot" lépés szándékos: így derül ki, hogy tényleg elolvasta-e
a specifikációt, mielőtt rossz irányba indulna el.

---

## Amit soha ne hagyj kihagyni

**A `groundo` adatbázisnév.** Ha ez lemarad, minden „működni fog", csak az
adatok a `(default)` adatbázisba kerülnek — és ezt hetekkel később, éles
adaton veszed észre. Három helyen kell egyeznie:

| Hely | Mit kell tartalmaznia |
|---|---|
| `firebase.json` | `"firestore": [{ "database": "groundo", ... }]` (tömb alak!) |
| `src/lib/firebase.ts` | `getFirestore(app, 'groundo')` |
| `server/server.ts` | `getFirestore(adminApp, 'groundo')` |

Mindhárom benne van a feltöltött vázban — de ha az AI Studio újragenerálja
valamelyiket, ellenőrizd.

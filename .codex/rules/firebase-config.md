---
description: A grundo-db dedikált adatbázis és a három hasonló név
paths:
  - "firebase.json"
  - ".firebaserc"
  - "firestore.rules"
  - "firestore.indexes.json"
  - "storage.rules"
  - "src/lib/firebase.ts"
  - "server/server.ts"
  - ".env*"
---

# Firebase-konfiguráció

## ⚠️ Dedikált Firestore adatbázis

A GRUNDO **nem** az alapértelmezett adatbázist használja, hanem a `grundo-db`-t.
Ez három helyen van rögzítve, és **mindháromnak egyeznie kell**:

| Fájl | Amit tartalmaznia kell |
|---|---|
| `firebase.json` | `"firestore": [{ "database": "grundo-db", … }]` — **tömb** alak (többadatbázisos mód) |
| `src/lib/firebase.ts` | `getFirestore(app, 'grundo-db')` |
| `server/server.ts` | `getFirestore(adminApp, 'grundo-db')` |

Ha a második paraméter lemarad, a hívás **csendben** a `(default)` adatbázisra
megy. Minden „működni fog", csak rossz helyen keletkeznek az adatok — és ez
tipikusan hetekkel később, éles adaton derül ki. **Soha ne hívj
`getFirestore()`-t máshol**; mindig a `db` példányt importáld.

## Három megtévesztően hasonló név

| Név | Mi ez | Hol |
|---|---|---|
| **GRUNDO** | az app / termék neve | felületi szövegek, `metadata.json`, `index.html` |
| **`grundo`** | a Firebase **projekt** azonosítója | `.firebaserc`, `VITE_FIREBASE_PROJECT_ID`, authDomain, bucket |
| **`grundo-db`** | a Firestore **adatbázis** neve | `firebase.json`, `getFirestore(…)` |

Ha bizonytalan vagy, **ne találgass** — a `.env.example` fejlécében is ott van
mind a három. Ha egy név ellentmond annak, amit Geri mondott, **állj meg és
kérdezz**: ez egyszer már egy fölösleges, második adatbázist eredményezett.

## Telepítés

A `firestore.rules` / `storage.rules` a **„szabalyok"**, a
`firestore.indexes.json` a **„indexek"** — ⚠️ **két külön lépés**, a
„szabalyok" nem tartalmazza az indexeket. A teljes eljárás: `$grundo-deploy`.

---
description: Szerveroldali (Cloud Run) szabályok és a külön typecheck
paths:
  - "server/**"
---

# Szerver (`server/`, Cloud Run)

- **A kliens soha nem ír játékadatot.** Terület, GP, szint, jelvény,
  előfizetés, bizalmi pontszám: kizárólag innen. A Firestore-szabályok ezt
  kikényszerítik — **ne lazíts rajtuk.**
- **A Trust Score sosem publikus.** Se a szám, se a részjelek nem kerülhetnek
  kliensre; csak a verdikt (`trusted` / `pending_review` / `rejected`).
- **A gyanús aktivitás látszik, de nem módosít birtokviszonyt.** A felhasználó
  futását nem tüntetjük el.
- **Minden hiba érthető magyar üzenetet adjon vissza** — nyers stack trace nem
  mehet a felületre.
- **Visszafelé kompatibilisen adj ki.** A backend külön települ, mint a web, az
  iOS és az Android kliens; a régi kliensek tovább hívják a régi szerződést.

## ⚠️ A külön typecheck

A gyökér `npx tsc --noEmit` **NEM ellenőrzi ezt a mappát**. Külön kell:

```
cd server && npx tsc --noEmit
```

Ez már fogott meg valódi típushibát, amit a gyökér-ellenőrzés zölden
átengedett. Kör végén mindkettőt futtasd.

## Firestore innen

`getFirestore(adminApp, 'grundo-db')` — a második paraméter kötelező. Részletek:
[`firebase-config.md`](firebase-config.md).

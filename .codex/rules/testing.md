---
description: Teszt-ritmus és a kimenet szűrése
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "vite.config.ts"
---

# Tesztek

**Ne futtass feleslegeset.** A harmadik teljes futás ugyanazt mondja, mint a
második — és a kimenete a kontextusba kerül. *Konkrét eset:* a 3. menetben
háromszor futott le a teljes készlet, pedig kettő elég lett volna.

1. **Fejlesztés közben célzott futás**: `npx vitest run <útvonal>`
2. javítás → újra célzott futás
3. **a kör végén EGYSZER** a teljes ellenőrzés

| Ellenőrzés | Parancs | Mikor |
|---|---|---|
| Teljes készlet | `npm run test` | commit előtt, egyszer |
| Typecheck | `npx tsc --noEmit` **és** `cd server && npx tsc --noEmit` | kör végén, mindkettő |
| Emulátoros készlet | `npm run test:emulator` | **csak** ha Firestore-viselkedés változott (tranzakció, lekérdezés, séma, szabály) |
| Production build | `npm run build` | ha a csomagméret a tét, vagy telepítés előtt |

⚠️ **Az emulátoros aktivitás-tesztek EGYÜTT futtatva bukhatnak, külön-külön
zöldek** — osztoznak egy emulátoron, a párhuzamos futtatás összeakasztja őket.
Ez ismert teszt-izolációs hiba, nem regresszió. Futtasd fájlonként:

```
firebase emulators:exec --only firestore --project demo-grundo "npx vitest run <egy fájl> --testTimeout=45000"
```

⚠️ **Git Bashben az emulátoros parancsok elé kell a Java PATH exportja.**

## Kimenet

PowerShellben szűrj: `| Select-Object -Last 25`, vagy a mentett logban `rg "FAIL|Error"`. Git Bashben használható a `tail -25`. Zöld futásból egyetlen sor elég
(„681 zöld"); csak a bukó teszt részletét idézd. Nagy kimenetet mentsd fájlba,
és abban keress.

## Amit teszt nem bizonyít

Natív viselkedést (háttér-GPS, hang, értesítés, engedély) teszt **nem** bizonyít
— lásd [`native.md`](native.md).

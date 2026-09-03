---
name: grundo-deploy
description: GRUNDO telepítési és kiadási eljárás — frontend, backend, Firestore szabályok és indexek, valamint az iOS/Android mérföldkő-buildek rendje. Használd, ha telepítésről, deployról, kiadásról, TestFlightről vagy APK-ról van szó.
---

# Telepítés és kiadás

## Hatáskör

- ⚠️ **A TELEPÍTÉST ÉN FUTTATOM, HA GERI SZÓL.** Az ő utasítása („telepítsd a
  frontendet", „mehet mindkettő") MAGA a jóváhagyás — ilyenkor ne kérdezz
  vissza, csak csináld meg, és jelentsd az eredményt.
- Ha **ÉN javaslom** a telepítést (ő nem kérte), **kérdezz előtte**: az élesbe
  küldés nem visszafordítható úgy, mint egy push.
- ⚠️ **ÁLLJ MEG ÉS SZÓLJ**, ha telepítés közben bármi eltér a várttól: piszkos
  munkamásolat, hiányzó környezeti változó, sikertelen build, nem várt `git`
  állapot. A félbehagyott telepítés helyrehozható, a rossz tartalommal kiadott
  nem — 2026-08-29-en pontosan ez döntötte le az oldalt.

## Honnan megy

⚠️ **2026-08-29-től a fejlesztői gépről, nem Cloud Shellből** (Geri döntése,
elfogyott a heti kvótája). A `scripts/deploy.sh` **Git Bashből** futtatható a
repo gyökeréből; minden eszköz telepítve és bejelentkezve. A backend build
ettől még a felhőben fut.

## Telepítés előtt — kötelező

1. **Környezeti változók ellenőrzése.** ⚠️ Az első gépes build Firebase-konfig
   NÉLKÜL ment élesbe (az értékek addig csak a Cloud Shell gitignore-olt
   `.env.local` fájljában éltek) — az oldal bejelentkezés nélkül, hibaüzenettel
   fogadta a felhasználókat. A nyilvános konfiguráció azóta a repóban van
   (`.env.production`), de a szokás maradjon: **`grep`-pel nézd meg a
   `dist/assets/`-ben, hogy a kulcsértékek tényleg beépültek-e.** Egy
   build-kimenet átfutása NEM bizonyíték — a Vite üres változóra is hibátlanul
   lefordít.
2. **Mindkét typecheck**: `npx tsc --noEmit` és `cd server && npx tsc --noEmit`.
3. Teljes tesztkészlet egyszer.

## A négy egység

| Szó | Mit telepít |
|---|---|
| **frontend** | a webapp (Firebase Hosting) |
| **backend** | a `server/` (Cloud Run) |
| **szabalyok** | `firestore.rules` + `storage.rules` — `npm run rules:deploy` |
| **indexek** | `firestore.indexes.json` — `npm run indexes:deploy` ⚠️ **KÜLÖN**, a „szabalyok" nem tartalmazza |

A záró üzenetben **csak a szavakat** írd ki, a parancsokat ne.

## Mobil kiadási rend

- A **webapp a gyors fejlesztői és funkcionális tesztcsatorna** — a kis,
  iteratív frontend-változásokat itt ellenőrizd először.
- A **TestFlight (iOS) és a Codemagic Android Release mérföldkő-csatorna**: ne
  készüljön minden apró commitból IPA vagy APK. Érdemi funkciócsomag után,
  valamint **minden platform-specifikus** változásnál (auth, GPS, engedély,
  értesítés, térkép, safe area, háttér) kötelező a készülékes ellenőrzés.
- Egy iOS és egy Android build is a `main` egy konkrét commitjából készül. A
  Beállítások → Alkalmazás részen a `vX · csatorna/build · rövid commit` jelből
  ellenőrizhető, hol pontosan mi fut.
- A backend külön települ — **visszafelé kompatibilisen** kell kiadni a már
  telepített webes, iOS és Android kliensekhez.
- Részletes pipeline: `docs/07-ios-testflight-codemagic.md`,
  `docs/08-android-codemagic.md`.

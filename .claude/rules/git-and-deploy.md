# Git, átadás és telepítés

## A záró chat-üzenet

A részletes átadó a `docs/ai/CURRENT_STATE.md`-ben él, **nem** a chatben — ez a
token-spórolás lényege: a következő beszélgetés egyetlen olvasással betölti. A
záró üzenetben csak ennyi marad:

1. **fájl-összefoglaló táblázat** — fájlonként ÚJ vagy MÓDOSÍTOTT, a
   hozzáadott/törölt sorok száma **`git diff`-ből** (soha ne emlékezetből), egy
   mondat arról, mi változott;
2. **teendők sorrendje**: push → adatbázis-lépés → melyik telepítés;
3. egy mondat: „a részletek a `docs/ai/CURRENT_STATE.md`-ben".

**A telepítő parancsokat ne írd ki**: elég a szó — **frontend**, **backend**,
**szabalyok**, **indexek**. ⚠️ Az „indexek" KÜLÖN van, a „szabalyok" nem
tartalmazza.

**Git-parancsot ne adj Gerinek.**

## Commit és push

- **A commit az enyém** (2026-08-19-től) és **a push is** (2026-08-29-től) —
  Geri kifejezetten így kérte.
- ⚠️ **EGYETLEN FELTÉTELLEL: minden push után SZÓLNI KELL, hogy megvolt.** Ne
  csendben történjen — Geri a GitHub Desktopban követi a repót, és tudnia kell,
  mikor mozdult alatta.
- A `docs/ai/CURRENT_STATE.md` frissítése **ugyanabba a commitba** kerül, mint
  a menet többi változása.
- Commit-üzenet: első sor tömör Summary (max ~50 karakter), üres sor, majd
  felsorolásos Description. **Magyarul.**
- Hosszú üzenetet fájlba írj és `git commit -F <fájl>`-lel adj át — a
  PowerShell here-string alak a Bash eszközben nem működik.
- **Mindig a friss `HEAD`-ből indulj**, ne a saját korábbi állapotodból: a
  repóban más forrás is dolgozik.

## Telepítés

⚠️ **2026-08-29-től a telepítés a fejlesztői gépről megy, nem Cloud
Shellből** (Geri döntése — elfogyott a heti kvótája). A `scripts/deploy.sh` Git
Bashből futtatható, minden eszköz telepítve és bejelentkezve. A backend build
ettől még a felhőben fut.

- ⚠️ **A TELEPÍTÉST ÉN FUTTATOM, HA GERI SZÓL.** Az ő utasítása („telepítsd a
  frontendet", „mehet mindkettő") MAGA a jóváhagyás — ilyenkor ne kérdezz
  vissza, csak csináld meg, és jelentsd az eredményt. Ha viszont ÉN javaslom a
  telepítést (ő nem kérte), akkor kérdezz előtte: az élesbe küldés nem
  visszafordítható úgy, mint egy push.
- ⚠️ **ÁLLJ MEG ÉS SZÓLJ**, ha telepítés közben bármi eltér a várttól: piszkos
  munkamásolat, hiányzó környezeti változó, sikertelen build, nem várt `git`
  állapot. A félbehagyott telepítés helyrehozható, a rossz tartalommal kiadott
  nem — 2026-08-29-en pontosan ez döntötte le az oldalt.
- ⚠️ **BUILD ELŐTT ELLENŐRIZD A KÖRNYEZETI VÁLTOZÓKAT.** Az első gépes build
  Firebase-konfig NÉLKÜL ment élesbe, mert az értékek addig csak a Cloud Shell
  gitignore-olt `.env.local` fájljában éltek — az oldal bejelentkezés nélkül,
  hibaüzenettel fogadta a felhasználókat. A nyilvános konfiguráció azóta a
  repóban van (`.env.production`), de a szokás maradjon: telepítés előtt
  `grep`-pel nézd meg a `dist/assets/`-ben, hogy a kulcsértékek tényleg
  beépültek-e. **Egy build-kimenet átfutása nem bizonyíték** — a Vite üres
  változóra is hibátlanul lefordít.
- ⚠️ Telepítés előtt fusson le a `server/` **külön** típusellenőrzése is (lásd
  [`testing.md`](testing.md)).

## Adatbázis-lépések

Külön telepítési egységek, ne mosd össze őket:

| Szó | Mit telepít |
|---|---|
| **szabalyok** | `firestore.rules` + `storage.rules` (`npm run rules:deploy`) |
| **indexek** | `firestore.indexes.json` (`npm run indexes:deploy`) — **külön!** |

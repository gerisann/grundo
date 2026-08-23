# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #10.** A Rivális funkció adatrétege LEZÁRULT
(emulátoros teszt + dokumentáció megvan), és a felület egy RÉSZLEGES
böngészős ellenőrzésen is átment — lásd lent, pontosan mi maradt ki.

## ⚠️ RIVÁLIS ADAT NÉLKÜL LETT NÉZVE A FELÜLET — NE TELEPÍTS BELŐLE ELLENŐRZÉS NÉLKÜL

A kód **típusellenőrzött** (gyökér ÉS `server/` is hibamentes) és **a teljes
117 emulátoros + típusellenőrzési teszt zöld**, benne az ÚJ
[rivals.emulator.test.ts](server/src/lib/rivals.emulator.test.ts) (5 teszt):
bizonyítja a tükör-írás (`recordRivalry`) helyességét és az
`existingRivals` sorrend-függő viselkedését. A `docs/02-funkcionalis-spec.md`
és a `docs/05-adatmodell.md` most már tartalmazza a Rivális funkciót.

**Amit ez a menet MÉG megnézett élőben**: helyi emulátoros környezet
(`firebase emulators:start --only auth,firestore`, `seed:emulator`,
`dev:emulator` gyökérben és `server/`-ben), bejelentkezve
(`__grundoDevSignIn()`) a Profil fül betöltött, konzolhiba nélkül — és a
**`RivalsCard` eltűnés-logikája helyesen működik**: a seed-adatban nincs
rivalitás, a szekció nem jelenik meg. Ez a szerverek/emulátor leállítva
maradtak a menet végén, nincs futó folyamat.

**Amit EZ SEM nézett meg**, mert a seed-adatban nincs rivalitás, azt
külön elő kellene idézni (két teszt-fiók, egyik elveszi a másik területét):
- a profil-szekció TÉNYLEGES megjelenése TOP 3 riválissal,
- a „RIVÁLIS" címke kinézete mindkét témában,
- a teljes, kereshető lista (`RivalsSheet`).

Ehhez a következő menetben érdemes a `server/src/scripts/seedEmulator.ts`-t
bővíteni egy lopás-eseménnyel, vagy kézzel egy aktivitást menteni két
seed-fiók között.

## MI KÉSZÜLT EL

Geri kérése (2026-08-22): ha valaki elvesz területet valakitől, a kettejük
kapcsolata „rivális" lesz. A profilon egy szekció mutatja a TOP 3-at, gomb
mögött a teljes, kereshető lista. A rangsor a KICSERÉLT MEZŐK száma (szerzett
+ vesztett — „ha valaki 1×10 cellát lopott, az ugyanannyit ér, mint 10×1").
Mindenhol a név mellett egy „RIVÁLIS" címke (`#FC5F71` háttér, fekete szöveg).
Ha egy rivális támad, az értesítés külön hangot kap.

### Adatmodell — `users/{uid}/rivals/{otherUid}`

Új [server/src/lib/rivals.ts](server/src/lib/rivals.ts). Két tükör-dokumentum
keletkezik lopásonként, mint a `blocks`/`blockedBy`-nál: `gainedCells` az
egyiknél pontosan az, ami a másiknál `lostCells`. `exchangedCells` a kettő
összege — ez a rangsor alapja, kiszámolt mező (nem hisszük el a tároltat,
lásd `toRivalRecord`).

⚠️ **NINCS `firstAt` mező, szándékosan** — a `rivals.ts` fejlécében részletes
indoklás van, miért nem (a `merge: true` az utolsót írná „első" néven).

A `recordRivalry()` a `server/src/routes/activities.ts` aktivitás-mentésébe
van bekötve, közvetlenül a `stolenFrom` feldolgozásánál. **Az áttörés
(`breakthroughFrom`) NEM csinál riválist** — az egy megvédett támadás, egy
mező sem cserélt gazdát.

### Végpontok — `server/src/routes/rivals.ts`

- `GET /api/rivals` — a teljes lista, rangsorolva, kiegészítve névvel/képpel.
  ⚠️ **Nincs `/:username/rivals`** — ez szándékos: más rivális-listája nem
  publikus, megmutatná, kitől szokott veszíteni.
- `GET /api/rivals/ids` — csak azonosítók, a címkékhez.
- Mindkettő kiszűri a tiltottakat (mindkét irányban), a `blocks`/`blockedBy`
  mintájára.

Regisztrálva a `server.ts`-ben: `app.use('/api/rivals', authenticate,
rivalsRouter)`.

### Firestore-szabály

`firestore.rules` → `match /rivals/{otherUid}`: csak a tulajdonos olvashatja,
írás sehonnan (a szerver Admin SDK-val ír, a szabály nem vonatkozik rá).
⚠️ **Nem kell hozzá index** — a `rivals` lekérdezés egyetlen mezőn
(`exchangedCells`) rendez, azt az automatikus egymezős index fedi.

### Értesítés

`notifyTerritoryStolen()` bővült egy `isRival` paraméterrel — ha igaz, a cím
„Egy riválisod megtámadta a grundod!", a szöveg km²-ben és mezőben is
mutatja a veszteséget (`Geri elvett tőled 0,072 km² területet (234 cellát).`).

⚠️ **A sorrend a hívóban KÖTÖTT**: előbb `existingRivals()` (ki volt MÁR
EDDIG IS rivális), utána `recordRivalry()`. Fordítva a kérdés értelmét
vesztené — rögzítés után minden áldozat rivális, tehát mindenki a
rivális-hangnemet kapná, még az első összecsapásnál is.

⚠️ **Mértékegység-javítás menet közben**: a régi `notifyTerritoryStolen` m²-t
írt ki, ami sérti az AGENTS.md 9. szabályát (mindig km²). Most `formatArea()`
megy, ehhez a `server/tsconfig.json` `include`-ja bővült
`../src/lib/format.ts`-szel — az a modul függetlenül áll (nincs importja),
ezért biztonságos volt bevonni a szerver fordításába.

### Felület

- [RivalProvider.tsx](src/hooks/RivalProvider.tsx) — EGY lekérdezés
  (`/api/rivals/ids`) a teljes alkalmazásnak, `App.tsx`-be kötve a
  `RecorderProvider` fölé. `useRivals().isRival(uid)` bárhonnan hívható,
  **nem dob**, ha nincs adat (a címke mellékes dísz, nem szabad miatta
  elszállnia egy képernyőnek).
- [RivalBadge.tsx](src/components/RivalBadge.tsx) — a címke maga, `uid`-et
  vár, ő dönti el, kell-e megjelennie.
- [RivalScore.tsx](src/components/RivalScore.tsx) — a mérleg
  (`128  +90 −38`), zöld/piros, screen-reader szöveggel is (a szín önmagában
  nem elég).
- [RivalsCard.tsx](src/components/RivalsCard.tsx) — profil-szekció, TOP 3,
  eltűnik, ha nincs rivális.
- [RivalsSheet.tsx](src/components/RivalsSheet.tsx) — teljes lista,
  kliensoldali kereséssel a betöltött (max 200) elemen.

**A címke bekerült minden helyre, ahol felhasználónév látszik:**
feed-kártya, hozzászólások (+ optimista komment), aktivitás-részletek,
keresés, követő/követett-lista, terület-tulajdonos kártya, ranglista-sorok,
nyilvános profil fejléce.

⚠️ **Ehhez a szerver `Author`-objektumai kaptak egy `uid` mezőt** — korábban
csak név és kép ment ki, névre illeszteni törékeny lett volna (átnevezés után
némán rossz eredményt adna). Négy hely érintett a `server/src/routes/
activities.ts`-ben: a feed (`withAuthors`), az aktivitás-részletek
(`loadAuthor`), a hozzászólás-lista és a válasz-célpont. Kliensoldalon egy
közös `ActivityAuthor` típus lett belőle (`src/lib/api.ts`), a korábbi három
egyedi inline típus helyett.

## MIT KELL MÉG CSINÁLNI — EBBEN A SORRENDBEN

1. ~~Emulátoros teszt~~ — KÉSZ (#9 vége): `rivals.emulator.test.ts`, 5 zöld teszt.
2. ~~Élő próba emulátorban~~ — LEFEDVE az 1. ponttal (adatréteg szinten
   bizonyítva), böngészős kipróbálás nem történt.
3. **A profil-szekció TOP 3-mal és a teljes lista éles felülete** — az
   ELTŰNÉS-eset (nincs rivális → nincs szekció) MÁR ELLENŐRIZVE (#9 vége,
   seed-adaton). A megjelenő állapot (van rivális) még nincs nézve, mert a
   seed-adatban nincs rivalitás — ehhez elő kell idézni, pl. a
   `seedEmulator.ts` bővítésével egy lopás-eseménnyel.
4. **A „RIVÁLIS" címke ÁTNÉZNI mindkét témában élőben** — a token
   (`--rival-badge-bg` / `--rival-badge-text`) csak `tokens.css`-be van beírva,
   böngészőben nem látott.
5. **Eldönteni, kell-e külön push a rivalitáshoz** — a jelenlegi
   `notifyTerritoryStolen` a meglévő `createNotification`-on megy, az már
   push-t is küld, valószínűleg elég, de nincs élőben nézve.
6. ~~`docs/`-ba felvenni~~ — KÉSZ (#9 vége): `docs/02-funkcionalis-spec.md`
   (Riválisok szakasz) és `docs/05-adatmodell.md` (`rivals` alkollekció).

## ÖSSZEFOGLALÓ TÁBLÁZAT (a mostani állapotig)

| Fájl | | Mit tartalmaz |
|---|---|---|
| [rivals.ts](server/src/lib/rivals.ts) | ÚJ | adatmodell: `recordRivalry`, `existingRivals`, `rivalIds`, `toRivalRecord` |
| [rivals.ts](server/src/routes/rivals.ts) | ÚJ | `GET /api/rivals`, `GET /api/rivals/ids` |
| [RivalProvider.tsx](src/hooks/RivalProvider.tsx) | ÚJ | globális rivális-halmaz, `useRivals()` |
| [RivalBadge.tsx](src/components/RivalBadge.tsx) | ÚJ | a „RIVÁLIS" címke |
| [RivalScore.tsx](src/components/RivalScore.tsx) | ÚJ | a mérleg-kijelző |
| [RivalsCard.tsx](src/components/RivalsCard.tsx) | ÚJ | profil TOP 3 szekció |
| [RivalsSheet.tsx](src/components/RivalsSheet.tsx) | ÚJ | teljes, kereshető lista |
| `rivalBadge.css` / `rivalScore.css` / `rivalsCard.css` / `rivalsSheet.css` | ÚJ | stílusok |
| [notifications.ts](server/src/lib/notifications.ts) | MÓD | `notifyTerritoryStolen` rivális-hangnem + km²-javítás |
| [activities.ts](server/src/routes/activities.ts) | MÓD | rivalitás rögzítése, `Author.uid`, hívássorrend |
| [server.ts](server/server.ts) | MÓD | `rivalsRouter` regisztrálása |
| [tsconfig.json](server/tsconfig.json) | MÓD | `src/lib/format.ts` bevonása |
| [firestore.rules](firestore.rules) | MÓD | `rivals` alkollekció szabálya |
| [tokens.css](src/styles/tokens.css) | MÓD | `--rival-badge-bg` / `--rival-badge-text` |
| [api.ts](src/lib/api.ts) | MÓD | `Rival`, `RivalList`, `ActivityAuthor` típusok, `api.rivals()`, `api.rivalIds()` |
| [App.tsx](src/App.tsx) | MÓD | `RivalProvider` a fába |
| ActivityCard / CommentSheet / ConnectionsSheet / ActivityScreen / SearchScreen / TerritoryScreen / PublicProfileScreen / ProfileScreen | MÓD | a címke elhelyezése + `uid` átvezetés |

Típusellenőrzés: **hibamentes**, gyökér és `server/` is. Tesztek: **381
zöld** (a régi készlet, változatlan) — **új teszt nincs még**.

## TELEPÍTÉS

**NE TELEPÍTS MOST.** A fenti 1–4. pont híján ez éles kockázat: a tükör-írás
hibája csendben rossz rivális-adatot generálna, amit utólag nehéz javítani
(minden aktivitásból újraszámolható, de az egy külön szkript, ami még
nincs megírva — ha idáig eljutnánk, ez is felkerül a listára).

## AZ ELŐZŐ MENET (GRUNDO #8) ÖSSZEFOGLALÓJA — VÁLTOZATLANUL ÉRVÉNYES

A #8 menet (küldetés-tervező mérése, hosszkalibráció, napi kártya)
**telepítésre kész és változatlan** — az itt leírtak nem érintik. A
`b607dfe` commit tartalmazza, frontend ÉS backend telepítést igényel, a
Mapbox-tokennel a `--substitutions`-ben. Ha a Rivális funkció még nem kész
mire legközelebb telepítünk, a #8 önmagában is telepíthető — csak azt a
kommitot kell nézni, nem a mostanit.

### Amit a #8-ból még mindig érdemes tudni

- A bringás küldetés lehet, hogy magától megjavult a detour-kalibrációtól —
  érdemes egyszerűen kipróbálni élesben, mielőtt bárki hibát keres.
- A `docs/`-ban a F. pont (rivális szín a térképen, fate-adat átvezetése) még
  nyitva van — ez MÁS „rivális", mint a mostani funkció: az a `--territory-
  rival` térképszínről szól, nem a névsorbeli címkéről. Ne keveredjen össze.

## Infrastruktúra: éles, csak olvasó Firestore-hozzáférés

Változatlan. `grundo-reader@grundo.iam.gserviceaccount.com`
(`roles/datastore.viewer`), Geri (`gergely.marthon@gmail.com`) személyesíti
meg. Nincs kulcsfájl. PowerShellben `gcloud.cmd`, nem `gcloud`.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Sonnet, normál mélységgel** elég a folytatáshoz — a fenti 1–4. pont
emulátoros tesztírás és élő próba, meglévő minták (`notifications.emulator.
test.ts`, a `ConnectionsSheet` felülete) alapján. Nincs benne adatmodell-
döntés, ami Opust indokolna — az már megtörtént ebben a menetben.

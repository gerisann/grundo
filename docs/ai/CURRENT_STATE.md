# Jelenlegi állapot

> Frissítve: **2026-09-03** · GRUNDO **#28**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**

## Jelenlegi cél

A Közösség menü életre keltése (docs/02-funkcionalis-spec.md → Közösség).
A menü eddig egy 10 soros Placeholder volt. A teljes spec négy alrészt ír le
(Felfedezés, Klubok, Kihívások, Útlevél) — ez a menet a navigációs vázat és a
Felfedezés alrészt szállította; Klubok/Kihívások/Útlevél külön menetekre
maradt, mert mindegyik saját Firestore séma- és security rules-döntést
igényel.

## Elkészült

1. **Navigációs héj**: a `ScrollableTabs.tsx` generikus, vízszintesen
   görgethető fülsor komponens a Profil fülsorból kiemelve (a
   drag-scroll/középre-igazítás logika most egy helyen él). A Közösség 4
   fülre (Felfedezés · Klubok · Kihívások · Útlevél) épül, saját route-tal
   mindegyik (`/kozosseg`, `/kozosseg/klubok`, `/kozosseg/kihivasok`,
   `/kozosseg/utlevel`).
2. **Felfedezés** (a `/kozosseg` alapértelmezett fülje) valós adattal
   működik:
   - **Kereső** — felhasználónév-keresés inline Követés/Kérés küldése
     gombbal, ami a keresési találat fiók-láthatóságából (publikus/privát) és
     a már meglévő követési állapotból indul ki. A klub-szűrő UI megvan, de
     "hamarosan érkezik" üzenetet mutat — klub-adatmodell még nincs.
   - **Aktivitás-feed nem követett felhasználóktól** — a meglévő
     világ/helyi (`world`/`local`) lekérdezésre épül, a már követett
     szerzőket kliensoldalon szűri ki a saját követési lista alapján.
     ⚠️ A követési lista max 100 elemig töltődik be — 100 fölötti követésszám
     esetén a szűrés a lista végén pontatlan lehet.
3. **Szerver**: a `GET /api/users/search` végpont bővült `account` és
   `followStatus` mezővel (egy batch `where(documentId, in, …)` lekérdezéssel
   a viewer `following` alkollekcióján — nem N darab olvasás találatonként).
   Ez visszafelé kompatibilis, a régi `SearchScreen.tsx` is ugyanazt a
   végpontot hívja, változatlanul.
4. **Klubok / Kihívások / Útlevél** fülek egyelőre "hamarosan érkezik" kártyát
   mutatnak (`CommunitySectionScreens.tsx`) — ezek a következő menetek
   tárgyai, lásd lent.

## Nyitott ügyek

- **Klubok** (legnagyobb backend munka): teljes CRUD — létrehozás [Pro],
  meghívókódos csatlakozás, klub-részletek (tagok, feed, ranglista, admin,
  csatlakozási kérések), szerepek (tulajdonos/admin/tag). Új
  `server/src/lib/clubs.ts` + route + Firestore séma + security rules +
  index.
- **Kihívások**: 5 típus (távolság/terület/lopás/sorozat/felfedezés),
  admin által létrehozva — ehhez kézi seed vagy minimál admin-felület is
  kell a teszteléshez.
- **Útlevél**: 0/242 ország zászlórács, fordított geokódolás az aktivitás
  nyomvonal első pontjára. ⚠️ Nincs még bekötve reverse-geocoding
  szolgáltatás a projektbe — ez külön beszerzési/konfigurációs döntés is
  lehet, nem csak kódmunka.

## Érintett fájlok

`src/components/ScrollableTabs.tsx` (új) ·
`src/components/tabStrip.css` (új) ·
`src/components/CommunityTabs.tsx` (új) ·
`src/components/CommunityHeader.tsx` (új) ·
`src/components/communityHeader.css` (új) ·
`src/components/ProfileTabs.tsx` (refaktor: `ScrollableTabs`-ra épül) ·
`src/components/profileTabs.css` (a fül-stílus kikerült `tabStrip.css`-be) ·
`src/screens/DiscoverScreen.tsx` (új) ·
`src/screens/discover.css` (új) ·
`src/screens/CommunitySectionScreens.tsx` (új) ·
`src/screens/CommunityScreen.tsx` (törölve — a `/kozosseg` route mostantól
közvetlenül `DiscoverScreen`-t tölt) ·
`src/App.tsx` (route-ok) ·
`src/lib/api.ts` (`DiscoverUser` típus, `api.discoverSearch`) ·
`server/src/routes/users.ts` (`/api/users/search` bővítve) ·
`docs/ai/CURRENT_STATE.md`

## Ellenőrzés

- Kliens `typecheck` ✅, szerver `typecheck` ✅, production `build` ✅.
- Kliens `npm test` (716 teszt) ✅, szerver `npm test` (210 teszt) ✅.
- Szerver `users.emulator.test.ts` (20 teszt, Firebase emulátorral) ✅ — a
  `/api/users/search` bővítés nem tört el semmit.
- Élő böngészős ellenőrzés helyi emulátorral (seedelt adaton, bejelentkezve):
  mind a 4 Közösség-fül renderel, a fülváltás/aktív-fül-kiemelés működik, a
  keresés valós találatot ad RIVÁLIS címkével és helyes Követve/Követés
  gombbal, a gomb kattintásra ténylegesen követ/leiratkozik (ellenőrizve
  Firestore felé), a klub-szűrő "hamarosan" üzenetet mutat. A Profil fülsor
  (a refaktor után) ugyanúgy működik, mint korábban — nincs regresszió.

## Telepítés

Telepítés nem történt ebben a munkamenetben.

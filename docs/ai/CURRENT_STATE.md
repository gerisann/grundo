# Jelenlegi állapot

> Frissítve: **2026-09-03** · GRUNDO **#29**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**

## Jelenlegi cél

A Közösség menü „Klubok" alrésze — Geri kérésére átnevezve **„Bandák"**-ra,
és a spec jóval bővebbre írva: több bandatagság egyszerre, publikus banda
azonnali csatlakozással, privát banda meghívókóddal/share linkkel/appon
belüli meghívással, terület+GP összesítés nap/hét/hónap/mindenkori
bontásban, két váltható feed (hírfolyam + chat fal), alapító/moderátor/tag
szerepkörök. Ez egy menetbe nem fér bele — ez a menet a **Phase 1**-et
szállította: adatmodell, Firestore-szabályok, rollup job, és a mag-CRUD.

## Elkészült (Phase 1)

1. **Adatmodell**: `bandas/{bandaId}` (a korábbi, kódban sosem implementált
   `clubs` séma átnevezve és kibővítve) + `bandas/{id}/members/{uid}` +
   `users/{uid}/bandas/{bandaId}` tükör-alkollekció (a „saját bandáim" lista
   ebből megy, collectionGroup-lekérdezés nélkül) + `inviteCodes/{code}`.
   Nincs `joinRequests`: publikus bandánál azonnali csatlakozás, privátnál
   kizárólag meghívókóddal.
2. **Rollup job**: `server/src/jobs/bandaRollover.ts` — a `bandas/{id}.totals`
   mezőt (terület+GP, nap/hét/hónap/mindenkori) előszámítja a tagok jelenlegi
   mezőiből, a `dailyRollover` mintájára. Trigger: `POST
   /api/jobs/banda-rollover`, ugyanazzal az `authorizeJob()`-bal, mint a napi
   forduló. **Cloud Scheduler-bejegyzés még nincs** — csak az endpoint kész.
3. **API**: `server/src/lib/bandas.ts` (tiszta segédfüggvények) +
   `server/src/routes/bandas.ts` — létrehozás, `/mine`, `/search`, publikus
   `/:id/join`, `/join-by-code`, `/:id`, `/:id/members`. Kliens:
   `src/lib/api.ts` → `api.bandas.*`.
4. **UI**: `src/screens/CommunityBandasScreen.tsx` (saját bandáim, kóddal
   csatlakozás, létrehozás, publikus keresés) a `/kozosseg/bandak` route-on
   (a `CommunityTabs` „Klubok" füle „Bandák"-ra nevezve), és
   `src/screens/BandaScreen.tsx` a `/bandak/:id` route-on (fejléc, terület+GP
   bontás, tag-lista szerepkör-jelvénnyel). A hírfolyam/chat fal/beállítások
   helyén "hamarosan érkezik" kártya.
5. **Firestore-szabályok**: a `clubs` blokk átnevezve `bandas`-ra,
   kibővítve a `users/{uid}/bandas` tükör olvasási szabályával.

## Nincs Phase 1-ben (nyitva Phase 2/3-ra)

- **Appon belüli meghívás** a követett-felhasználó listából (kereséssel
  szűrve) + **értesítés alapú elfogadás/elutasítás** — a kódbázisban eddig
  nincs accept/reject notification-minta, ezt itt kell megalapozni
  (`server/src/lib/notifications.ts` `NotificationType` unionja +
  `bandas/{id}/invites/{uid}` séma).
- **Hírfolyam** (`bandas/{id}/feed/{postId}`, posztolási jog a
  `settings.postPermission` szerint) és **chat fal**
  (`bandas/{id}/wall/{msgId}`).
- **Beállítások képernyő** az alapítónak: moderátor-kinevezés, kirúgás,
  tulajdonos-átruházás, ki hívhat meg / kinek látszik a meghívókód.
- **Share link** — jelenleg csak a nyers 8 karakteres kód másolható ki, a
  mélylink-parsolás (`?code=...` az útvonalon) még nincs bekötve.

## Döntések ebben a menetben

- **Nem Pro-funkció** a banda-létrehozás (a régi Klub-spec Pro-gate-je
  törölve).
- **A `totals` rollup jobból jön**, nem élő olvasáskori szumma.
- Részletek: `docs/ai/DECISIONS.md` → „Bandák (`#29` menet)".

## Módosított/új fájlok

`server/src/lib/bandas.ts` (új, 171 sor) · `server/src/lib/bandas.test.ts`
(új, 106 sor) · `server/src/routes/bandas.ts` (új, 409 sor) ·
`server/src/routes/bandas.emulator.test.ts` (új, 195 sor) ·
`server/src/jobs/bandaRollover.ts` (új, 72 sor) ·
`server/src/lib/firebase.ts` (+2: `COLLECTIONS.bandas`/`inviteCodes`) ·
`server/server.ts` (+2: router mountolás) ·
`server/src/routes/jobs.ts` (+28: `/banda-rollover` végpont) ·
`src/screens/CommunityBandasScreen.tsx` (új, 334 sor) ·
`src/screens/BandaScreen.tsx` (új, 154 sor) ·
`src/screens/CommunitySectionScreens.tsx` (−11: `CommunityClubsScreen`
törölve) · `src/components/CommunityTabs.tsx` (átnevezés) ·
`src/App.tsx` (route-ok) · `src/lib/api.ts` (+84: `Banda*` típusok,
`api.bandas`) · `src/screens/DiscoverScreen.tsx` (címke-átnevezés) ·
`firestore.rules` (`clubs`→`bandas`, tükör-szabály) ·
`firestore.indexes.json` (`clubs`→`bandas` index) ·
`docs/05-adatmodell.md`, `docs/02-funkcionalis-spec.md`,
`docs/01-kepernyoterkep.md`, `docs/ai/DECISIONS.md` (spec-átírás).

## Ellenőrzés

- Kliens `typecheck` ✅, szerver `typecheck` ✅, production `build` ✅.
- Kliens `npm test` (727 teszt) ✅, szerver `npm test` (221 teszt, ebből 11
  új a `bandas.test.ts`-ben) ✅.
- **Emulátoros teszt** (`npm run test:emulator`, mind a 142 teszt ✅) —
  `bandas.emulator.test.ts` (5 teszt): publikus/privát létrehozás, egyedi
  meghívókód, publikus csatlakozás + duplikáció-védelem, kóddal
  csatlakozás érvényes/érvénytelen kóddal, privát banda láthatósága
  tag/idegen szemszögből.
- **Élő böngészős ellenőrzés** helyi emulátorral, bejelentkezve
  (`demo-geri`): banda létrehozása (publikus és privát, meghívókóddal),
  a „Saját bandáim" lista mindkettőt mutatja szerepkör-jelvénnyel, publikus
  banda megtalálható a keresésben, a `BandaScreen` megjeleníti a fejlécet,
  a nulla terület+GP összesítést (rollup még nem futott) és a tag-listát.
  **Menet közben talált és javított hiba**: a publikus keresés
  csatlakozás-hibája (pl. „már tag vagy") némán eltűnt, mert a hibaüzenet
  csak üres találati listánál jelent meg — külön `joinError` állapotra
  bontva, most mindig látszik.
- **Amit NEM ellenőriztem**: a rollup job tényleges Cloud Scheduler
  triggerelése (nincs bekötve), a meghívókód-megosztás mobil share-sheeten,
  natív (Android/iOS) nézet.

## Telepítés

Telepítés nem történt ebben a munkamenetben. A `firestore.rules` és a
`firestore.indexes.json` módosult — telepítéskor **szabalyok** és
**indexek** is kellenek (külön-külön), a szokásos frontend+backend mellett.

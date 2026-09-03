# Jelenlegi állapot

> Frissítve: **2026-09-03** · GRUNDO **#30**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**

## Jelenlegi cél

A #29 menet Bandák Phase 1-je (mag-CRUD) után a felsorolt Phase 2/3 tételek
sorban haladása, mindegyik után külön commit+push. Az 1–3. pont elkészült;
a következő feladat a share-link mélylink-parsolása (`?code=...`).

## Elkészült

1. **Appon belüli meghívás + elfogadás/elutasítás** (commit `27f29c9`):
   `bandas/{id}/invites/{uid}` + tükör `users/{uid}/bandaInvites/{bandaId}`,
   `POST /:id/invite` (jogosultság a `settings.whoCanInvite` szerint,
   `canInvite`/`meetsRolePermission`), `GET /invites/mine`,
   `POST /:id/invite/accept` · `/decline`, új `banda_invited`
   értesítéstípus+push, `BandaInviteSheet` (követett-lista, kereshető) a
   `BandaScreen`-en, „Meghívóim” szekció a `CommunityBandasScreen`-en.
   Apró UX-javítás is bekerült: a publikus banda-keresésben már-tag
   találatnál „Megnyitás” látszik „Csatlakozás” helyett.
2. **Hírfolyam és chat fal** (commit `1ca2d3a`): `bandas/{id}/feed/{postId}`
   + `bandas/{id}/wall/{msgId}` (`GET`/`POST` mindkettőre), a hírfolyamra a
   `settings.postPermission` szerint posztolhat, a falra bárki tag —
   `BandaFeedWall` (`SegmentedControl` váltó) a `BandaScreen`-en, csak
   tagoknak. Nincs szerkesztés/törlés/lájk/válasz, nincs lapozás — az
   utolsó 50 (feed) / 100 (wall) elem egy kérésben.
3. **Alapítói beállítások és tagkezelés**: külön
   `/bandak/:id/beallitasok` képernyő fogaskerék-belépővel; szerkeszthető
   `whoCanInvite`/`inviteCodeVisibleTo`/`postPermission`; moderátor kinevezés
   és visszaminősítés; tag/moderátor kirúgása; tulajdonjog-átruházás.
   A régi alapító moderátor marad. Minden szerep- és tagságváltás
   tranzakcióban frissíti a banda- és felhasználóoldali tükört. A
   `inviteCodeVisibleTo` most már a részlet-válaszban is érvényesül.

## Módosított fájlok

`server/src/lib/bandas.ts` (+26: `canInvite`/`meetsRolePermission`,
`RolePermission` típus) · `server/src/lib/notifications.ts` (+15:
`banda_invited`) · `server/src/routes/bandas.ts` (+296: 8 új végpont) ·
`server/src/lib/bandas.test.ts` (+24) ·
`server/src/routes/bandas.emulator.test.ts` (+209: 8 új teszt) ·
`firestore.rules` (+25: `invites`/`feed`/`wall` alkollekciók) ·
`src/components/BandaInviteSheet.tsx` (új, 168 sor) ·
`src/components/BandaFeedWall.tsx` (új, 165 sor) ·
`src/lib/api.ts` (+87: típusok, `api.bandas.*`) ·
`src/lib/notificationTypes.ts` (+7) · `src/lib/push.ts` (+2) ·
`src/lib/push.test.ts` (+1) · `src/components/NotificationPanel.tsx` (+2) ·
`src/screens/BandaScreen.tsx` (+58) ·
`src/screens/CommunityBandasScreen.tsx` (+162: „Meghívóim”,
már-tag-jelzés keresésben) · `src/screens/BandaSettingsScreen.tsx` +
`bandaSettings.css` (Phase 3 UI) · `src/App.tsx`, `src/lib/api.ts`,
`server/src/routes/bandas.ts`, `server/src/routes/bandas.emulator.test.ts`
(Phase 3 route/API/tesztek) · `docs/05-adatmodell.md`,
`docs/02-funkcionalis-spec.md`, `docs/ai/DECISIONS.md` (spec+döntés).

## Ellenőrzések

- Kliens `typecheck` ✅, szerver `typecheck` ✅, production `build` ✅.
- Kliens `npm test` (731 teszt) ✅, szerver `npm test` (225 teszt, +4
  `canInvite`/`meetsRolePermission`) ✅.
- **Emulátoros teszt** (`bandas.emulator.test.ts`, mind a 16 teszt ✅):
  meghívás → elfogadás/elutasítás, dupla meghívás, `whoCanInvite`
  jogosultság, hírfolyam sorrend+jogosultság+validáció, chat fal,
  beállításmentés+kódláthatóság, szerepkörtükrözés, moderátori
  kirúgás és tulajdonjog-átruházás.
- `firebase deploy --only firestore:rules --dry-run` ✅ (szabályok
  szintaktikailag helyesek, nem történt tényleges telepítés).
- A Phase 3 képernyőt böngészőben, mobil app-szélességen, világos és
  sötét témában is ellenőriztem ideiglenes helyi előnézeti adatokkal; az
  előnézeti ág nincs benne a végleges kódban. Teljes bejelentkezéses UI E2E
  nem futott; a szerverviselkedést a 16 valódi Firestore-emulátoros HTTP-
  teszt fedi.

## Nyitott ügyek

Sorban, a felsorolás szerint folytatva:

4. **Share link mélylink-parsolása** (`?code=...` az útvonalon) — jelenleg
   csak a nyers kód másolható.
5. **Cloud Scheduler bekötése** a `bandaRollover` jobhoz (az endpoint kész,
   az ütemezés nincs).

Geri által ezen a meneten felírt, még NEM implementált backlog-tételek
(„írjuk fel” — csak rögzítve, sorrendben a fentiek után jönnek):

- Banda profilkép + borítókép feltöltés.
- Banda-belüli TOP3 dobogó-megjelenítéssel (ranglista a tagok között).
- A terület+GP megjelenítés átalakítása: vízszintesen váltható
  Ma/Heti/Havi/Mindig nézet, mindkettőnél TOP3 + kinyitható teljes
  toplista.

## Modelljavaslat

**Sonnet, alap mélység** — a hátralévő pontok is a meglévő minták
(jogosultság-ellenőrzés, tükör-alkollekció, sheet/board UI) folytatásai.

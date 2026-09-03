# Jelenlegi állapot

> Frissítve: **2026-09-03** · GRUNDO **#30**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**

## Jelenlegi cél

A Banda részlet négylapos, sportágankénti TOP10 ranglistája és a működő
megosztási link elkészült. A következő nyitott termékfeladat a banda profil-
és borítókép feltöltése.

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
4. **Hírfolyam/chat finomítások**: fix méretű szerkesztő külön görgethető
   üzenetlistával; hírfolyamban biztonságosan renderelt félkövér, dőlt,
   aláhúzott, felsorolás, számozás, idézet és link; egy, legfeljebb 2 MB-os,
   kliensoldalon JPEG-re tömörített kép; védett backend-kiszolgálás; relatív,
   egy hét után teljes dátum a posztokon és chatüzeneteken.
5. **Kilépési szabály**: tag és moderátor kiléphet, az alapító viszont csak
   a rang átadása után; a tagság kétoldali tükre és a taglétszám egyetlen
   tranzakcióban frissül.
6. **Ikonfrissítés**: külön új web favicon-forrás, valamint egységes új PWA,
   iOS és Android appikon; az Android splash is az új appikont használja.
7. **Publikus bandák böngészése + területszín-paletta**: a kereső alatt
   `Népszerű Bandák` / `Új Bandák` fülek, fülenként legfeljebb 10 elem,
   szerveroldali rendezéssel és Firestore-indexekkel. A színpaletták egy
   nagy méretű, végtelenített, nyilakkal és swipe-pal vezérelhető sort
   használnak; kiválasztáskor középre gördülnek, majd összefüggő háttércellák
   legfeljebb 5 másodperc alatt elhalványulnak.
8. **Banda statisztika és megosztás**: Mai/Heti/Havi/Mindenkori fülek,
   mindegyikben Futás/Séta/Bringa bontás, terület- és GP-összegző, TOP3
   dobogó, majd a 4–10. helyezett. Az aktivitásmentés sportáganként vezeti az
   időablakos értékeket. A meghívókód külön másolható, a share link
   `?code=` paraméterrel előtölti a csatlakozási mezőt.

## A legutóbbi menet fő módosításai

`src/components/BandaFeedWall.tsx` + `bandaFeedWall.css` ·
`src/lib/bandaContent.tsx` + teszt · `src/lib/photos.ts` · `src/lib/api.ts` ·
`src/screens/BandaScreen.tsx` · `src/screens/BandaSettingsScreen.tsx` ·
`server/src/routes/bandas.ts` + emulátoros tesztek · `storage.rules` ·
`assets/app-icon-source.png` + `assets/favicon-source.png` ·
`scripts/generate-icons.mjs` · web/PWA/iOS/Android generált ikonfájlok ·
funkcionális specifikáció, adatmodell és döntésnapló.

## Ellenőrzések

- Kliens és szerver `typecheck` ✅, production `build` ✅.
- Szerver `npm test` (225 teszt) ✅. Kliens `vitest` 15 másodperces
  tesztlimittel (734 teszt) ✅; az alap 5 másodperces futásban egy régi
  nagy-hurok teljesítményteszt egyszer kifutott a limitből.
- Új formázó/dátum egységtesztek (3/3) ✅.
- **Emulátoros teszt** (`bandas.emulator.test.ts`, mind a 18 teszt ✅):
  meghívás → elfogadás/elutasítás, dupla meghívás, `whoCanInvite`
  jogosultság, hírfolyam sorrend+jogosultság+validáció, chat fal,
  beállításmentés+kódláthatóság, szerepkörtükrözés, moderátori
  kirúgás és tulajdonjog-átruházás.
- A teljes emulátoros csomag 14 fájlban 158/158 teszttel zárt; ebben a
  publikus felfedező rendezése, tízes korlátja, privát-szűrése és hibás
  rendezési paramétere is valódi Firestore ellen ellenőrzött.
- Hírfolyam, chat, kilépés és Storage szabályok közös emulátoros futása:
  21/21 teszt ✅; `firebase deploy --only storage --dry-run` ✅.
- Az új banda-tag statisztika API 19/19, a normál aktivitásmentés 25/25,
  a darabolt aktivitásmentés 9/9 emulátoros teszttel ✅. Mindkét mentési út
  bizonyítottan növeli a sportágankénti terület- és GP-értékeket.
- A Phase 3 képernyőt böngészőben, mobil app-szélességen, világos és
  sötét témában is ellenőriztem ideiglenes helyi előnézeti adatokkal; az
  előnézeti ág nincs benne a végleges kódban. Teljes bejelentkezéses UI E2E
  nem futott; a szerverviselkedést a 16 valódi Firestore-emulátoros HTTP-
  teszt fedi. A frissített hírfolyam/chat sötét és világos témában is
  ellenőrizve lett ideiglenes helyi előnézettel.
- `npx cap sync` Androidon teljes; iOS-en a webmásolás teljes, a Windows alól
  nem létrehozható SPM symlink miatt a pluginfrissítés figyelmeztetést adott.

## Nyitott ügyek

Sorban, a felsorolás szerint folytatva:

1. **Banda profilkép + borítókép feltöltés.**
2. **Cloud Scheduler bekötése** a `bandaRollover` jobhoz (az endpoint kész,
   az ütemezés nincs).

Geri által ezen a meneten felírt, még NEM implementált backlog-tételek
(„írjuk fel” — csak rögzítve, sorrendben a fentiek után jönnek):

- Jelenleg nincs további, csak felírt banda-backlog tétel.

## Modelljavaslat

**Sonnet, alap mélység** — a hátralévő pontok is a meglévő minták
(jogosultság-ellenőrzés, tükör-alkollekció, sheet/board UI) folytatásai.

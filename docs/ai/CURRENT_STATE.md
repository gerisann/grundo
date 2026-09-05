# Jelenlegi állapot

> Frissítve: **2026-09-05** · GRUNDO **#40**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**
> Állapot: a négy kért módosítás kész; handoff, commit és push ebben a körben.
> Utoljára dolgozott: **Codex (GPT-6, Erős)** · Átadva: **Codex**

## Jelenlegi cél

Mentési idő szerinti aktivitás-feed, tízes lapozás, oldalváltást túlélő helyi
cache és nyolc óránál hosszabb aktivitások napnév szerinti automatikus címe.
A fejlesztés és az ellenőrzések elkészültek; **telepítés nem történt**.

## Elkészült

1. A feed `createdAt` (szerveroldali mentés) szerint rendez és szűr dátumra;
   a kártya is ezt mutatja. A tényleges `startedAt`/`endedAt` megmarad a
   részletek és a statisztika számára. A meglévő mentési utak már tárolják
   a `createdAt` mezőt, nem kell felülírni a kezdési időt.
2. Home (globális, helyi, követett), saját/nyilvános profil és Felfedezés:
   kezdetben 10 aktivitás, „Továbbiak betöltése” gombbal újabb 10.
   Időpont + dokumentumazonosító kurzor; azonos időpontok nem vesznek el.
   A szerver legfeljebb 300 jelöltet vizsgál kérésenként; sok rejtett/távoli
   sor után üres lap is lehet, de a folytatókurzor és a gomb megmarad.
   A Banda már meglévő tízes bővítésének gombfelirata is egységes.
3. TanStack Query memóriacache fiók és szűrők szerint, a betöltött lapokkal:
   5 perc frissesség, 30 perc inaktív megőrzés. Sikeres API-módosítás
   érvénytelenít, auth-állapotváltás ürít. Új appindításkor új lekérés;
   aktivitásadatot nem mentünk localStorage-ba.
4. A saját profil heti összesítője külön, útvonal/fotó nélküli végpontról
   jön, így a lapozás nem csonkolja a heti statisztikát.
5. Automatikus cím: **teljes időtartam > 8 óra** esetén a mentési nap neve,
   például „Szombati bringázás”. Pontosan 8 óráig a kezdési napszak marad;
   az egyedi cím elsőbbséget élvez. Kártya, részletező és értesítések követik.
   A kliens helyi naptárat, a szerverértesítés Europe/Budapest időzónát használ.

## Módosított fájlok

- Backend: `server/src/routes/activities.ts`, `feedScopes.emulator.test.ts`.
- Indexek: `firestore.indexes.json` — három új `createdAt DESC` index;
  a korábbi `startedAt` indexek megmaradnak.
- Cache/API: `src/lib/queryClient.ts`, `activityQueries.ts`, `api.ts`,
  `src/hooks/useActivities.ts`, `AuthProvider.tsx`, `src/main.tsx`.
- UI: `Feed.tsx`, `ActivityCard.tsx`, `BandaFeedWall.tsx`, `ProfileScreen.tsx`,
  `PublicProfileScreen.tsx`, `DiscoverScreen.tsx`, `ActivityScreen.tsx`.
- Formázás/teszt: `src/lib/format.ts`, `format.test.ts`, `week.ts`,
  `activityQueries.test.ts`.
- Specifikáció: `docs/02-funkcionalis-spec.md`, `docs/05-adatmodell.md`,
  `docs/ai/DECISIONS.md`, ez az átadó.

## Élesben fut / telepítetlen

- Élesben továbbra is a #39; a #40 nincs telepítve.
- Sorrend: **push → indexek → backend → frontend**.
- Várd meg mindhárom új index elkészültét a backend telepítése előtt.
- Adatbázis-migráció és **szabalyok** telepítése nem szükséges.
- A backend kompatibilis a régi klienssel; az új frontendhez új backend kell
  a kurzor és a heti összesítő miatt. Natív store-kiadás külön feladat.

## Ellenőrzések

- Kliens teljes készlet: **803 zöld**, 180 emulátoros teszt kihagyva.
- Szerver teljes készlet: **229 zöld**, 180 emulátoros teszt kihagyva.
- Célzott új cím/cache tesztek: **11/11 zöld**.
- Firestore-emulátor, feed: **13/13 zöld**. Az első futás a 10 másodperces
  inicializálási határ miatt leállt; 60 másodperces hook-limittel zöld.
- Kliens és szerver külön típusellenőrzése zöld; frontend production build
  zöld (a meglévő nagy csomagokra továbbra is figyelmeztet).
- Közös lista és gomb: 390 px-es helyi komponens-előnézet világos/sötét
  témában; 10 → 20 kártya, végén a gomb eltűnik. Nem teljes, bejelentkezett
  képernyőteszt; éles fiókon és Android/iOS készüléken nem ellenőrizve.
- `git diff --check` tiszta. Tesztlogok és UI-próba a nem verziókövetett `tmp/` alatt.

## Nyitott ügyek

1. A fenti sorrendben telepíteni, majd bejelentkezett fiókkal ellenőrizni:
   hosszú aktivitás mentése, feed-sorrend, lapozás és visszalépési cache.
2. Android/iOS készülékes smoke teszt és szükség esetén natív kiadás.

## Modelljavaslat

**Codex Sol, Közepes** a telepítéshez és smoke teszthez.

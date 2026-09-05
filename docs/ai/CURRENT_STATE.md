# Jelenlegi állapot

> Frissítve: **2026-09-05** · GRUNDO **#39**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**
> Állapot: a #39 commitolva, pusholva és élesben telepítve; a kör lezárva.
> Utoljára dolgozott: **Codex (Sol, Erős)** · Átadva: **Codex**

## Jelenlegi cél

A Banda-felület és a tagsági életciklus lezárása: moderáció, célzott
értesítések, jóváhagyásos belépés, stabil kirúgási tartalomrejtés és mobilos
szélességjavítás. **Kész, ellenőrzött és telepített.**

## Elkészült

1. **Banda UI.** A fejléc címe egységesen „Banda beállítások”; a Banda-fejléc
   háttere eltűnt, a borítókép háttere a képernyő tetejétől indul. A meghívókód
   középre igazított, a jobb szélen másolás ikon van, siker után pipa és zöld
   kód/doboz jelenik meg. Kapott halk „Meghívókód” címkét, a leírás alsó
   elválasztót. Az iOS-es vízszintes túlcsordulást szélességkorlátok fogják meg.
   A hírfolyam-író nem sticky, az üzenőfali mező egysoros, a scrollbarok rejtettek.

2. **Publikus csatlakozás.** Bandánként `instant` vagy `approval` mód
   választható. A beállítóoldal visszafelé kompatibilis `instant` alapértéket,
   látható aktív állapotot és külön „még nincs mentve” jelzést ad.
   Jóváhagyásos módban alapító és moderátor kezelheti a kérelmeket.

3. **Tagsági értesítések.** Új belépőről csak az alapító és a moderátorok
   kapnak értesítést; a kirúgott felhasználó külön jelzést kap. A banda-meghívó
   a Közösség / Bandák fülre visz. A `banda_membership` típus ikont is kapott.

4. **Moderáció és tagsági tartalom.** Alapító és moderátor más tag posztját és
   kommentjét is soft-hide-olhatja. Kirúgáskor a posztok biztosan eltűnnek a
   feedből: a művelet már nem függ collection-group kommentindextől, és a
   rejtett darabszámokat visszaadja. A komment helyőrzője „kilépett, vagy
   kirúgott felhasználó”, a válaszszál megmarad. Kilépéskor a user dönthet a
   saját tartalom elrejtéséről.

5. **Appbannolás.** Az admin API auditálhatóan soft-hide-olja a banda- és
   aktivitástartalmat; az adatbázisban megmarad, fizikai törlést csak a végleges
   fióktörlés végezhet.

6. **Dokumentáció és tesztek.** A specifikáció és adatmodell követi az új
   értesítési és helyőrző-viselkedést. Emulátoros regresszióteszt ellenőrzi a
   moderátori törlést, a célzott értesítéseket és a kirúgáskor ténylegesen
   elrejtett poszt/komment darabszámát.

## Módosított fájlok

- Banda backend: `server/src/routes/bandas.ts`,
  `server/src/lib/contentModeration.ts`, `server/src/lib/notifications.ts`.
- Banda kliens: `src/screens/BandaScreen.tsx`,
  `src/screens/BandaSettingsScreen.tsx`, `src/components/BandaFeedWall.tsx`
  és a hozzájuk tartozó CSS.
- Közös kliens: `src/lib/api.ts`, `src/lib/push.test.ts`,
  `src/components/NotificationPanel.tsx`, `src/styles/tokens.css`.
- Teszt/dokumentáció: `server/src/routes/bandas.emulator.test.ts`,
  `docs/02-funkcionalis-spec.md`, `docs/05-adatmodell.md`.

## Élesben fut / telepítetlen

- A felhasználó visszajelzése alapján a #39 push, production build, valamint
  a **frontend- és backendtelepítés elkészült**.
- Szabály-, index- és adatbázis-migrációs lépés ehhez a körhöz nem tartozott.
- Külön Android/iOS store-kiadás és készülékes smoke teszt nem lett jelezve.

## Ellenőrzések

- Kliens: **792/792** nem emulátoros teszt zöld; production build zöld.
- Szerver: **229/229** nem emulátoros teszt zöld; production build zöld.
- Célzott kliens: push + banda-tartalom **7/7** zöld.
- Banda Firestore-emulátor: **27/27** zöld, **1** storage-környezeti teszt
  kihagyva. A kirúgási teszt külön ellenőrzi a rejtett poszt/komment számát.
- Böngészőben sötét témában ellenőrizve a meghívókód alap- és zöld/pipa
  állapota, középre igazítása, címkéje és a leírás elválasztója.
- `git diff --check` tiszta. A telepítés elkészültét a felhasználó megerősítette;
  **készülékes ellenőrzésről nem érkezett külön visszajelzés.**

## Nyitott ügyek

1. Ebben a körben nincs nyitott fejlesztési tétel.
2. Következő opcionális lépésként Android/iOS készüléken smoke tesztelhető a
   vízszintes scroll, a fejléc/borítókép, a kirúgási tartalom és az értesítés.
3. Az appbannolási backend végponthoz külön feladatban admin UI készíthető.

## Modelljavaslat

**Codex Sol, Közepes** a telepítéshez és a készülékes ellenőrzéshez. Erős
fokozat csak új moderációs szabályok vagy adminfelület tervezéséhez indokolt.

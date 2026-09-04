# Jelenlegi állapot

> Frissítve: **2026-09-04** · GRUNDO **#39**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**
> Állapot: a #39 commitolva és pusholva; élesben még nincs telepítve.
> Utoljára dolgozott: **Codex (Sol, Erős)** · Átadva: **Codex**

## Jelenlegi cél

A Banda-felület és a tagsági életciklus lezárása: moderáció, célzott
értesítések, jóváhagyásos belépés, stabil kirúgási tartalomrejtés és mobilos
szélességjavítás. **Kódszinten és lokálisan kész; telepítetlen.**

## Elkészült

1. **Banda UI.** A fejléc címe egységesen „Banda beállítások”; a Banda-fejléc
   háttere eltűnt, a borítókép háttere a képernyő tetejétől indul. A meghívókód
   középre igazított, a jobb szélen másolás ikon van, siker után pipa és zöld
   kód/doboz jelenik meg. Kapott halk „Meghívókód” címkét, a leírás pedig alsó
   elválasztót. Az iOS-es vízszintes túlcsordulást szélességkorlátok fogják meg.
   A hírfolyam-író nem sticky, az üzenőfali mező egysoros, a scrollbarok rejtettek.

2. **Publikus csatlakozás.** Bandánként `instant` vagy `approval` mód
   választható. A beállítóoldal visszafelé kompatibilis `instant` alapértéket,
   jól látható aktív állapotot és külön „még nincs mentve” jelzést ad.
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

5. **Appbannolás.** Új, moderátori jogosultságú admin API letiltja az Auth-
   fiókot, visszavonja a frissítési tokeneket, auditál, és soft-hide-olja a
   banda-posztokat, falüzeneteket, banda- és aktivitáskommenteket, valamint az
   aktivitásokat. A korábban törlésre ütemezett aktivitás `purgeAt` mezője is
   törlődik: fizikai törlést csak a végleges fióktörlés végezhet.

6. **Dokumentáció és tesztek.** A specifikáció és adatmodell követi az új
   értesítési és helyőrző-viselkedést. Emulátoros regresszióteszt ellenőrzi a
   moderátori törlést, a célzott értesítéseket és a kirúgáskor ténylegesen
   elrejtett poszt/komment darabszámát.

## Módosított fájlok

- Banda backend: `server/src/routes/bandas.ts`, `server/src/lib/bandas.ts`,
  `server/src/lib/notifications.ts`, `server/src/lib/contentModeration.ts`.
- Admin és aktivitások: `server/src/routes/admin.ts`,
  `server/src/routes/activities.ts`.
- Banda kliens: `src/screens/BandaScreen.tsx`,
  `src/screens/BandaSettingsScreen.tsx`, `src/components/BandaFeedWall.tsx`
  és a hozzájuk tartozó CSS.
- Közös kliens: `src/lib/api.ts`, `src/lib/notificationTypes.ts`,
  `src/components/NotificationPanel.tsx`, `src/components/CommentSheet.tsx`,
  `src/components/ui/ScreenHeader.tsx`.
- Teszt/dokumentáció: `server/src/routes/bandas.emulator.test.ts`,
  `server/src/lib/contentModeration.emulator.test.ts`, `docs/02-*`, `docs/05-*`,
  `docs/ai/DECISIONS.md`.

## Élesben fut / telepítetlen

- A #39-hez **frontend- és backendtelepítés kell**. Szabály- és indexváltozás
  nincs, adatbázis-migráció nem kell.
- Az új felület a mobilappba csak új Android/iOS builddel kerül be.
- A #36–#37 korábbi telepítési tartozása továbbra is él: worker, részletes
  teljesítménymérés, hangjavítás és a korábbi Bandák-kör.
- A `backfill:banda-stats --apply --allow-production` még nem futott, a
  `grundo-banda-daily` Scheduler-job még nincs bejegyezve.

## Ellenőrzések

- Kliens: **792/792** teszt zöld 15 s tesztlimittel; production build zöld.
- Szerver: **229/229** nem emulátoros teszt és production build zöld.
- Célzott kliens: push + banda-tartalom **7/7** zöld.
- Banda emulátor: **27/27** zöld, **1** storage-környezeti teszt kihagyva.
- Böngészőben ellenőrizve a sötét témájú meghívókód alap- és zöld/pipa
  állapota, középre igazítása, címkéje és a leírás elválasztója.
- `git diff --check` tiszta. **Készüléken és éles Firebase-adatokon nem volt
  ellenőrzés**, telepítés nem történt.

## Nyitott ügyek

1. Telepítés után Androidon és iOS-en ellenőrizni a fejléc/borítókép réteget,
   a hosszú kommentlistákat, a kilépési kétlépcsős kérdést és az értesítéseket.
2. Az appbannolási backend végpont kész, de a jelenlegi adminfelületnek nincs
   felhasználókezelő képernyője; ha UI-ból kell indítani, külön adminfeladat.
3. Lefuttatni a korábbról nyitott banda-statisztika backfillt és felvenni a
   napi Scheduler-jobot.

## Modelljavaslat

**Codex Sol, Közepes** a telepítéshez és a készülékes ellenőrzéshez. Erős
fokozat csak az admin felhasználókezelő felület vagy új moderációs szabályok
tervezéséhez indokolt.

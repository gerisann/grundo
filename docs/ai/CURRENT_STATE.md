# Jelenlegi állapot

> Frissítve: **2026-09-04** · GRUNDO **#38**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**
> Állapot: a #38 commitolva és pusholva; élesben még nincs telepítve.
> Utoljára dolgozott: **Codex (Sol, Erős)** · Átadva: **Codex**

## Jelenlegi cél

A Banda-felület egységesítése és a teljes tagsági életciklus befejezése:
jóváhagyásos publikus belépés, értesítések, kilépési/kirúgási tartalomkezelés,
kommentválaszok, valamint az appbannolt felhasználók tartalmának auditálható,
fizikai törlés nélküli elrejtése. **Kódszinten és lokálisan kész; telepítetlen.**

## Elkészült

1. **Banda UI.** A fejléc címe egységesen „Banda beállítások”. A Banda-oldal
   fejlécének nincs saját háttere, a borítókép elmosott háttere a képernyő
   tetejétől indul. A teljes meghívókód-doboz másol, siker után zöld állapotot
   kap. A hírfolyam-komponens nem tapad, az üzenőfali beviteli mező egysoros,
   a releváns szövegdobozok és kommentlisták scrollbarja rejtett.

2. **Publikus csatlakozás.** Bandánként `instant` vagy `approval` mód
   választható, visszafelé kompatibilis `instant` alapértékkel. Jóváhagyásos
   módban a kérés megmarad a `joinRequests` alkollekcióban; alapító és
   moderátor elfogadhatja vagy elutasíthatja. Elfogadáskor a két tagsági tükör
   és a taglétszám tranzakcióban frissül.

3. **Tagsági értesítések.** A banda tagjai értesítést kapnak belépésről és
   kilépésről; a kirúgott felhasználó külön értesítést kap. Az új
   `banda_membership` típus globálisan és bandánként is némítható.

4. **Kilépés, kirúgás és kommentválasz.** Kilépéskor külön választás dönti el,
   hogy a saját banda-tartalom látható maradjon-e. Kirúgáskor automatikus a
   soft-hide. A posztok/falüzenetek eltűnnek, a kommentek helyén „törölt
   komment vagy tag” marad; a dokumentumazonosító és a válaszszál megmarad.
   A banda hírfolyam-kommentjeire most közvetlenül válaszolni is lehet.

5. **Appbannolás.** Új, moderátori jogosultságú admin API letiltja az Auth-
   fiókot, visszavonja a frissítési tokeneket, auditál, és soft-hide-olja a
   banda-posztokat, falüzeneteket, banda- és aktivitáskommenteket, valamint az
   aktivitásokat. A korábban törlésre ütemezett aktivitás `purgeAt` mezője is
   törlődik: fizikai törlést csak a végleges fióktörlés végezhet.

6. **Dokumentáció és tesztek.** A funkcionális specifikáció, adatmodell és
   tartós döntések követik az új viselkedést. Emulátoros regresszióteszt fedi
   a jóváhagyást, a kilépési választást, a kirúgásos soft-hide-ot, a válaszszál
   helyőrzőjét és a bannolás adatmegőrzését.

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

- A #38-hoz **frontend- és backendtelepítés kell**. Szabály- és indexváltozás
  nincs, adatbázis-migráció nem kell.
- Az új felület a mobilappba csak új Android/iOS builddel kerül be.
- A #36–#37 korábbi telepítési tartozása továbbra is él: worker, részletes
  teljesítménymérés, hangjavítás és a korábbi Bandák-kör.
- A `backfill:banda-stats --apply --allow-production` még nem futott, a
  `grundo-banda-daily` Scheduler-job még nincs bejegyezve.

## Ellenőrzések

- Kliens: **792/792** teszt zöld 15 s tesztlimittel; production build zöld.
- Szerver: **229/229** nem emulátoros teszt és production build zöld.
- Emulátor: Banda + tartalommoderáció + aktivitás együtt **51/51** zöld,
  **1** környezeti teszt kihagyva.
- Világos és sötét témában böngészőben ellenőrizve a Banda-oldal és a
  „Banda beállítások” oldal; az eredeti sötét téma visszaállítva.
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

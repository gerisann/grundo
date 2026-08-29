# GRUNDO handoff

> Frissítve: **2026-08-29** · átadás a **GRUNDO #20** menetből a **#21**-re
>
> Repo: `C:\Users\Geri\Documents\ChatGPT\GRUNDO` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · HEAD: **`Android zárolt képernyős élő mérés`**
> (a jelen `HANDOFF.md`-t tartalmazó commit)

## ÁLLAPOT

Elkészült az iOS Live Activity Android megfelelője a már működő location
foreground service-re építve.

- Az Android foreground notification kompakt nézete folyamatosan mutatja a
  távot, időt és sebességet.
- A kibontott/zárolt képernyős nézet mutatja a mozgásformát, a `Élő` / `Szünet`
  állapotot, valamint külön oszlopban a távot, időt és sebességet.
- Az időt natív Android `Chronometer` rajzolja, ezért lezárt képernyőn és
  felfüggesztett WebView mellett is tovább jár; szünetnél megáll.
- A háttér-GPS a WebView nélkül is frissíti a notification táv- és
  sebességértékét. Előtérben a közös TypeScript recorder minden elfogadott
  mintánál visszaszinkronizálja a pontos, szűrt állapotot.
- A notification állapota (`startedAt`, táv, összes szünet, nyitott szünet,
  sebesség) `SharedPreferences`-ben is megmarad, ezért a foreground service
  rendszer általi újraindítása után helyreáll.
- A notification nyilvános lock-screen tartalmat kér és koppintásra megnyitja
  a GRUNDO-t. A felhasználó Android rendszerbeállítása és az OEM felülete
  mindig elsőbbséget élvez.
- Android 13+-on az első, élő mérésre engedélyezett rögzítés indításakor a
  plugin kéri a `POST_NOTIFICATIONS` engedélyt. Megtagadáskor a GPS-rögzítés
  nem áll le, de az Android a foreground service-t csak az Active apps /
  feladatkezelő felületen mutatja.
- A Beállítások → Értesítések → „Élő mérés a zárolt képernyőn” kapcsoló már
  Androidon is megjelenik. Kikapcsolva a következő rögzítés csak a kötelező,
  egyszerű foreground service értesítést használja.
- Új notification channel készült: `grundo_tracking_live_v2`. A régi
  `grundo_tracking` channel megmaradhat a készülék rendszerbeállításaiban, de
  az új build már nem használja.

## ANDROID RENDSZERKORLÁT

Android 12+ alatt teljesen egyedi notification nem készíthető: a rendszer a
saját app-fejlécét, ikonját és kibontó vezérlőjét kötelezően hozzáadja. Emiatt
a csatolt iOS-kártya információs hierarchiája és adatai átvihetők, de a
pixelpontos külső nem. A megvalósítás a hivatalos
`DecoratedCustomViewStyle` + `RemoteViews` mintát használja; a kompakt nézet
48 dp-es, a kibontott nézet a nagyobb tartalmi területet használja.

## ÉLESBEN FUT / TELEPÍTETLEN

- A mostani Android zárolt képernyős nézet **még nincs pusholva és nincs
  készülékre telepítve**.
- Backend-, Firestore-szabály-, index- és adatbázis-változás nincs.
- A webes felületen a kapcsoló továbbra sem jelenik meg; a TypeScript-változás
  csak a natív iOS/Android appban aktív.
- A korábbi GraphHopper-kód továbbra is a `main` ágon van, de élesben a
  `GRAPHHOPPER_URL` üres, ezért a Mapbox-ág fut. A #19-ben eldöntött
  küldetés-ajánló route/terület számítás szétválasztása e menet miatt
  szándékosan nem kezdődött el.

## ELLENŐRZÉSEK

- `npm run typecheck`: sikeres.
- `npm test`: **556 sikeres**, 122 emulátoros teszt kihagyva.
- `npm run build`: sikeres production build; a meglévő nagy chunk figyelmeztetés
  változatlan.
- `npx cap sync android`: sikeres, 4 Capacitor plugin felismerve.
- Android célzott JUnit: **3 sikeres**
  (`TrackingNotificationFormatterTest`: szünetidő és iOS-sel azonos formázás).
- Android `lintDebug`: sikeres.
- Android `lintRelease`, `assembleRelease`, `bundleRelease`: **BUILD SUCCESSFUL**.
- Firestore-emulátoros teszt nem futott, mert sem tranzakció, sem lekérdezés,
  sem séma, sem biztonsági szabály nem változott.
- Csatlakoztatott Android készülék nem volt, ezért a tényleges lock-screen
  layout és OEM-viselkedés még nincs vizuálisan ellenőrizve.

Windows alatt a release build első két próbája nem kódhibán, hanem a generált
Capacitor `build` könyvtárak `ReadOnly` attribútumán állt meg. Az attribútum
feloldása után ugyanaz a release parancs teljesen sikeres lett; forrásfájl vagy
verziókövetett fájl emiatt nem változott.

## KÖVETKEZŐ MENET — #21

1. Geri pusholja a commitot.
2. Codemagicben készüljön **GRUNDO Android Release** build; adatbázis-lépés,
   backend-, frontend-, szabály- vagy indextelepítés nem kell.
3. Az új APK kerüljön valódi Android készülékre.
4. Beállítások → Értesítések alatt legyen bekapcsolva az élő mérés. Android
   13+-on az első rögzítés indításakor engedélyezni kell a rendszerértesítést.
5. Legalább 3 perces és 100 méteres futás/séta közben:
   - kijelző lezárása;
   - kompakt és kibontott notification ellenőrzése;
   - táv, idő, sebesség és mozgásforma ellenőrzése;
   - szünet legalább 30 másodpercig, majd folytatás;
   - ellenőrizni, hogy az idő megáll, a sebesség 0, és folytatáskor nem kerül
     bele a szünet alatt megtett távolság;
   - notificationre koppintva a GRUNDO nyíljon meg;
   - feloldás után a nyomvonal legyen hézagmentes.
6. A kapcsolót kikapcsolva új rögzítésnél csak az egyszerű, kötelező Android
   foreground notification maradjon.
7. Külön érdemes megtagadott notification permissionnel ellenőrizni, hogy a
   GPS-rögzítés nem vész el, miközben a kártya a notification drawerből a
   rendszer Active apps felületére kerül.
8. Ha a készülékes ellenőrzés zöld, a következő fejlesztési feladat visszatérhet
   a #19-ben megtervezett küldetés-ajánló gyors/lassú fázis szétválasztására.

## NYITOTT KISEBB ÜGYEK

- A notification tényleges mérete, alapértelmezett kibontottsága és tipográfiája
  Android-verzió- és OEM-függő; készülékes képernyőkép alapján lehet még
  finomhangolni.
- Samsung/Xiaomi/Huawei akkumulátorkezelésnél továbbra is kell lezárt
  képernyős terepi teszt.
- A notification permission közös az FCM push engedéllyel. Ha a felhasználó a
  tracking indításakor engedélyezi, a Beállítások push-kapcsolója a képernyő
  következő megnyitásakor olvassa vissza a friss rendszerállapotot; FCM-token
  ettől még csak a push-kapcsoló bekapcsolásakor készül.
- A korábbról nyitott Android GPS-esetek: csak hozzávetőleges hely,
  helymegtagadás, appváltás, offline pontsor, force stop és Active apps → Stop.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

- Készülékes megjelenés-ellenőrzéshez és kisebb layout-finomításhoz:
  **Sonnet, normál mélység**.
- Ha a notification nem frissül lezárt képernyőn, a service újraindulásakor
  elcsúszik az idő/táv, vagy OEM-specifikus háttérleállás jelentkezik:
  **Opus, emelt mélység**.
- A küldetés-ajánló API-szerződésének és háttérszámításának szétválasztásához:
  **Opus, emelt mélység**.

## FORRÁSOK SORRENDJE

1. `AGENTS.md`
2. `HANDOFF.md` (ez a fájl)
3. `android/app/src/main/java/app/grundo/android/TrackingLocationService.java`
4. `android/app/src/main/java/app/grundo/android/BackgroundLocationPlugin.java`
5. `android/app/src/main/res/layout/notification_tracking_compact.xml`
6. `android/app/src/main/res/layout/notification_tracking_expanded.xml`
7. `docs/08-android-codemagic.md` → GPS és háttérmérés / készülékes ellenőrzés
8. `docs/02-funkcionalis-spec.md` → Rögzítés / élő rendszerértesítés

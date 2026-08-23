# GRUNDO — átadás

Ez a fájl az aktuális állapotot mutatja; a részletes történet a Git logban van.

## ÁLLAPOT

- Repo: `C:\Users\Geri\Documents\GitHub\grundo`
- Ág: `main`.
- GitHubon jelenleg `c6de619 Natív iOS push bekötése` van.
- A lokális ág két commit-tal jár a GitHub előtt: `56f3c16` izolálja a
  Codemagic push-tesztet, ezt követi a zárolt képernyős Live Activity.
  A push a felhasználó következő lépése.
- Teljes unit teszt: **403 zöld**, 112 célzott emulátoros teszt kihagyva.
- A frontend production build és a backend TypeScript build sikeres
  2026-08-23-án. Natív Xcode-fordítás Windows alatt nem futtatható; ezt a
  Codemagic következő buildje ellenőrzi.

## ELKÉSZÜLT

### Küldetés, webes rögzítés és háttér-GPS

- A küldetésgeneráló már nem ad nulla találatot csak azért, mert minden
  Mapbox-jelöltben talált kisebb visszafordulást: ilyenkor a három legkevésbé
  hibás kört adja vissza. A tényleges útvonalminőség külön optimalizálandó.
- A webes rögzítés életciklus-diagnosztikája megkülönbözteti az újratöltést,
  bezárást és háttérbe kerülést.
- iOS-en natív Core Location bridge gyűjti és sorban tárolja a lezárt
  képernyő alatt kapott pontokat. A valós, 100+ méteres TestFlight-teszt még
  hátravan.

### Webes push

- A webes FCM út kész: felhasználói engedélykérés, service worker, VAPID token
  Firestore-ba, szerveroldali FCM-küldés és érvénytelen token törlése.
- A production VAPID public key a verziókövetett `.env.production` része, így
  a Cloud Shell frontend buildben is elérhető.

### Natív iOS push

- Az Apple Developerben az `app.grundo.ios` App ID Push Notifications
  capabilityje aktív.
- Az APNs kulcs neve `IPNForSendPush`, Key ID-je `9BGTAPANR8`, Team ID-je
  `HFS68TZMCH`; Sandbox & Production jogosultságú. A `.p8` csak az Apple és a
  Firebase felületén él, **nem kerül a repóba**.
- A Firebase iOS app regisztrált (`app.grundo.ios`, App Store ID `6804285861`),
  és a production APNs auth key fel van töltve a Cloud Messaginghez.
- A letöltött `GoogleService-Info.plist` az iOS App target erőforrása. Ez
  klienskonfiguráció, ezért verziókövetett; a Firebase SDK ebből inicializál.
- A `@capacitor-firebase/messaging` plugin FCM tokent kér, a
  `devices/{uid}/tokens/{token}` dokumentumba `platform: ios` értékkel menti,
  tokenfrissítéskor cseréli, leiratkozáskor törli. A rendszerengedély és az
  appon belüli kapcsoló külön állapot.
- Értesítésre koppintás belső GRUNDO képernyőre navigál. Előtérben az alert,
  badge és hang is engedélyezett; a szerver APNs payloadja alapértelmezett
  hangot kér.
- Az Xcode projekt tartalmazza a push entitlementet és a background remote
  notification módot. A Codemagic a Capacitor sync után külön ellenőrzi a
  plistet, a messaging plugint és az entitlementet, mielőtt IPA-t készít.
- Windows alatt a Capacitor SPM symlink létrehozása jogosultsági hibával
  megállt; a Package.swift kézzel is tartalmazza a plugint. A macOS Codemagic
  syncnek ezt újra kell generálnia, a natív fordítás a döntő ellenőrzés.

### Codemagic unit teszt javítása

- A `c6de619` Codemagic buildben a push unit teszt valódi Firestore-írást
  próbált, mert ott a Firebase environment teljes volt; helyben konfiguráció
  nélkül ezért nem jelentkezett. A `56f3c16` teljesen mockolja a Firestore
  határt, így a teszt semmilyen környezetben nem megy hálózatra.

### Zárolt képernyős Live Activity

- Külön `GrundoLiveActivity` WidgetKit extension target készült iOS 16.1+
  rendszerre. A zárolt képernyőn és Dynamic Islanden mutatja a mozgásformát,
  időt, távot, aktuális sebességet és szünetállapotot.
- A Core Location bridge akkor is frissíti az ActivityKit állapotát, amikor a
  WebView alszik. Előtérbe visszatérve a szűrt recorder-állapot korrigálja a
  natív becslést; befejezéskor a Live Activity azonnal eltűnik.
- A Beállítások → Értesítések alatt eszközönként kikapcsolható, alapból aktív.
  A változtatás a következő rögzítéstől érvényes.
- A `.pbxproj` külön parserrel érvényesnek bizonyult, mind az App, mind az
  extension target felismerhető. A Swift/ActivityKit fordítást csak a
  következő macOS Codemagic archive tudja véglegesen igazolni.

## TELEPÍTÉSI SORREND

1. A felhasználó pusholja a két lokális commitot.
2. Adatbázis-, szabály- és indextelepítés nem kell.
3. **Backend telepítés szükséges** az egységes push-adatmezők és iOS hang miatt.
4. **Frontend telepítés szükséges** a production VAPID és a push UI frissítése
   miatt.
5. Apple Developerben előbb létre kell hozni a `GRUNDO Live Activity`
   Identifier/App ID-t `app.grundo.ios.liveactivity` bundle ID-val.
6. Ezután Codemagic TestFlight build ugyanebből a `main` commitból; a workflow
   mind az apphoz, mind az extensionhöz provisioning profile-t kér.

## KÖVETKEZŐ ELLENŐRZÉS

1. Codemagicben a natív push/Live Activity preflight, SPM feloldás és Xcode archive legyen
   zöld. Ha az Apple provisioning profile nem tartalmazza az
   `aps-environment` entitlementet, az automatikus signingot kell újragenerálni.
2. TestFlighton a Beállítások → Értesítések kapcsoló kérje az iOS
   rendszerengedélyt. Firestore-ban jelenjen meg egy `platform: ios` FCM token.
3. Valódi értesítést kell kiváltani lezárt képernyő mellett: jelenjen meg
   hanggal, koppintásra nyissa meg a megfelelő GRUNDO képernyőt.
4. Kikapcsolás után a token tűnjön el a Firestore-ból és ne érkezzen több push
   az adott eszközre.
5. Egy közös terepi tesztben ellenőrizendő a lezárt képernyős háttér-GPS és a
   Live Activity: 3+ perc, 100+ méter, szünet/folytatás, majd befejezés.
6. Az éles weben újra kell reprodukálni a rögzítő megszakadását. Az új
   lifecycle-adatból derül ki, hogy reload, pagehide, háttérbe kerülés vagy
   saját állapotkezelési hiba előzte meg; utána készül a célzott javítás.

## NYITOTT KISEBB ÜGYEK

- A küldetések Mapbox útvonalgeometriájának zsákutcáit mérésalapú optimalizálás
  szükséges, a jelenlegi fallback csak a használhatatlan nulla találatot oldja.
  A felhasználó ezt a jelenlegi sorrendben a harmadik feladatnak kérte.
- Az npm production audit két közepes React Router figyelmeztetést jelez; a
  javítás major verzióváltást igényel, ezért nem része a push implementációnak.

## MODELLJAVASLAT

**Sol, erős** a Codemagic/Xcode signing vagy valós iOS push hibakereséséhez.
**Terra, közepes** elég, ha a build zöld és csak a készülékes ellenőrzés
eredménye alapján kell kisebb kliensjavítás.

# GRUNDO — átadás

Ez a fájl az aktuális állapotot mutatja; a részletes történet a Git logban van.

## ÁLLAPOT

- Repo: `C:\Users\Geri\Documents\GitHub\grundo`
- Ág: `main`.
- GitHubon jelenleg `7c45ad9 Webes push production konfiguráció` van.
- A lokális ág egy commit-tal jár a GitHub előtt: a natív iOS push
  implementációja. A push a felhasználó következő lépése.
- Teljes unit teszt: **402 zöld**, 112 célzott emulátoros teszt kihagyva.
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

## TELEPÍTÉSI SORREND

1. A felhasználó pusholja a lokális commitot.
2. Adatbázis-, szabály- és indextelepítés nem kell.
3. **Backend telepítés szükséges** az egységes push-adatmezők és iOS hang miatt.
4. **Frontend telepítés szükséges** a production VAPID és a push UI frissítése
   miatt.
5. Ezután Codemagic TestFlight build ugyanebből a `main` commitból.

## KÖVETKEZŐ ELLENŐRZÉS

1. Codemagicben a natív push preflight, SPM feloldás és Xcode archive legyen
   zöld. Ha az Apple provisioning profile nem tartalmazza az
   `aps-environment` entitlementet, az automatikus signingot kell újragenerálni.
2. TestFlighton a Beállítások → Értesítések kapcsoló kérje az iOS
   rendszerengedélyt. Firestore-ban jelenjen meg egy `platform: ios` FCM token.
3. Valódi értesítést kell kiváltani lezárt képernyő mellett: jelenjen meg
   hanggal, koppintásra nyissa meg a megfelelő GRUNDO képernyőt.
4. Kikapcsolás után a token tűnjön el a Firestore-ból és ne érkezzen több push
   az adott eszközre.
5. Külön terepi körben ellenőrizendő a lezárt képernyős háttér-GPS és a webes
   rögzítő lifecycle-diagnosztikája.

## NYITOTT KISEBB ÜGYEK

- A zárolt képernyős Live Activity nincs elkészítve; külön ActivityKit
  bővítmény.
- A küldetések Mapbox útvonalgeometriájának zsákutcáit mérésalapú optimalizálás
  szükséges, a jelenlegi fallback csak a használhatatlan nulla találatot oldja.
- Az npm production audit két közepes React Router figyelmeztetést jelez; a
  javítás major verzióváltást igényel, ezért nem része a push implementációnak.

## MODELLJAVASLAT

**Sol, erős** a Codemagic/Xcode signing vagy valós iOS push hibakereséséhez.
**Terra, közepes** elég, ha a build zöld és csak a készülékes ellenőrzés
eredménye alapján kell kisebb kliensjavítás.

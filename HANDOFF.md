# GRUNDO — átadás

Ez a fájl az aktuális állapotot mutatja; a részletes történet a Git logban van.

## ÁLLAPOT

- Repo: `C:\Users\Geri\Documents\GitHub\grundo`
- Ág: `main`.
- GitHubon jelenleg `de4ad25 Capacitor 8 Live Activity fordítás javítása` van.
- A lokális ág egy küldetés-geometriai committal fog a GitHub előtt járni; a
  push a felhasználó következő lépése.
- Teljes unit teszt: **409 zöld**, 112 célzott emulátoros teszt kihagyva.
- A frontend production build és a backend TypeScript build sikeres
  2026-08-23-án. Natív Xcode-fordítás Windows alatt nem futtatható; ezt a
  Codemagic következő buildje ellenőrzi.

## ELKÉSZÜLT

### Küldetés, webes rögzítés és háttér-GPS

- A Mapbox Directions minden mértani köztes pontot kötelezően, sorrendben
  látogat meg; a zsákutcára pattant pont okozta a random oda-vissza lábakat.
  A generátor már irányhelyesen illeszti a köztes pontokat (`bearings` és
  `continue_straight`), alternatív útvonalakat kér, a visszatérő kitérőt okozó
  pontot pedig az úthálózati bejárathoz igazítva újratervezi. Nem rajzol
  légvonalas rövidítést, ezért a javított geometria továbbra is járható.
- A valódi U-fordulás és az enyhébb helyi kerülő külön pontszám. Élő mérésen
  (3 budapesti kiindulás × 8 irány, 7,5 km) a nyers U-fordulás 61-ről 14-re,
  a ténylegesen felajánlott útvonalaké 16-ról **0-ra** csökkent; az átlagos
  helyi kerülő 4,0-ről 3,17-re javult. A Map Matching próba 7/8 irányban
  széteső részutakat adott az 50 méteres illesztési korlát miatt, ezért nem
  került productionbe.
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
  extension target felismerhető. Az első Codemagic archive-ban maga a Live
  Activity extension lefordult és belinkelődött; a fő targetet a Capacitor 8
  megváltozott `call.options` típusa állította meg. A `syncActivity` már a
  típusos `CAPPluginCall` gettereket használja; az új archive ellenőrzése vár.

## TELEPÍTÉSI SORREND

1. A felhasználó pusholja a lokális küldetés-geometriai commitot.
2. Adatbázis-, szabály- és indextelepítés nem kell.
3. **Backend telepítés szükséges** az új Mapbox kéréshez és újratervezéshez.
4. Ehhez a commithoz frontend telepítés nem szükséges.
5. Az Apple Developerben a `GRUNDO Live Activity` Identifier/App ID már
   létrejött `app.grundo.ios.liveactivity` bundle ID-val.
6. Codemagic TestFlight build ugyanebből a `main` commitból; a workflow
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
7. Backend deploy után ugyanarról a valós kiindulópontról több küldetést kell
   generálni; a szaggatott útvonalon ne legyen oda-vissza zsákutcai láb. Ritka
   úthálózatban a helyi legjobb fallback továbbra is adhat kényszerű kerülőt.

## NYITOTT KISEBB ÜGYEK

- Az npm production audit két közepes React Router figyelmeztetést jelez; a
  javítás major verzióváltást igényel, ezért nem része a push implementációnak.

## MODELLJAVASLAT

**Sol, erős** a Codemagic/Xcode signing vagy valós iOS push hibakereséséhez.
**Terra, közepes** elég, ha a build zöld és csak a készülékes ellenőrzés
eredménye alapján kell kisebb kliensjavítás.

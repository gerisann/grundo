# GRUNDO Android · Capacitor · Codemagic

**Állapot:** natív Android projekt és release workflow elkészült · 2026-08-26

**App:** GRUNDO · **Application ID:** `app.grundo.android`

Az Android külön, Geri által jóváhagyott azonosítót használ; az iOS bundle ID
változatlanul `app.grundo.ios`. A közös Capacitor-konfiguráció `appId` mezője
az iOS-értéken marad, az Android Gradle `namespace` és `applicationId` viszont
`app.grundo.android`. A Google Playben az Android application ID később nem
módosítható.

## Buildkonfiguráció

| Beállítás | Érték |
|---|---|
| Capacitor | 8.5.0 |
| `minSdk` | 24 (Android 7.0) |
| `compileSdk` | 36 |
| `targetSdk` | 36 |
| Android Gradle Plugin | 8.13.0 |
| Gradle wrapper | 8.14.3 |
| Java | 21 |
| Kotlin plugin | 2.2.20 (a Geolocation plugin hozza) |
| `versionName` | a gyökér `package.json` verziója |
| `versionCode` | Codemagic `BUILD_NUMBER`, helyben alapból 1 |
| R8/minify | az első stabil release-ben kikapcsolva; nincs szükséges egyedi keep rule |

Az Android projekt a webappal azonos Vite bundle-t használja:

```text
npm ci → tesztek → npm run build → npx cap sync android
→ lintRelease → assembleRelease + bundleRelease → signing → artifactek
```

Az iOS workflow külön maradt, a meglévő Xcode/SPM/TestFlight lépései nem
változtak.

## Firebase Android

Az Auth, Firestore és Storage továbbra is a Firebase web SDK-n keresztül éri
el ugyanazt a `grundo` projektet és a dedikált `grundo-db` adatbázist. A natív
Android FCM-hez ezen felül kell a Firebase Android app konfigurációja.

1. Firebase Console → `grundo` → Project settings → General → Your apps →
   **Add app → Android**.
2. Android package name: `app.grundo.android`; app nickname: `GRUNDO Android`.
3. Töltsd le a `google-services.json` fájlt. Ne tedd Gitbe; az
   `android/.gitignore` kizárja.
4. PowerShellben, a fájl saját mappájában másold a base64 értéket a vágólapra:
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path '.\google-services.json'))) | Set-Clipboard`
5. A kapott érték a Codemagic `grundo_android` csoport
   `GOOGLE_SERVICES_JSON_BASE64` nevű, **Secret** változója legyen.

Az Android workflow visszafejtés után ellenőrzi, hogy a JSON valóban az
`app.grundo.android` csomaghoz tartozik. Hamis vagy más apphoz tartozó fájllal a
build még Gradle előtt leáll. E-mail/jelszó authhoz és FCM-hez nem kell SHA-1;
natív Google-belépés bevezetésekor majd szükséges lesz.

## GPS és háttérmérés

Az Android implementáció nem a felfüggeszthető WebView hely-API-jára épít.
A felhasználó a látható appból indítja el a `location` típusú
`TrackingLocationService` foreground service-t. A szolgáltatás:

- Fused Location Providerrel, nagy pontossággal és 5 méteres minimum
  elmozdulással kér pontokat;
- futás közben folyamatos, nem elnémítható alkalmazáslogikájú foreground
  notificationt tart fenn;
- szünetnél leállítja a GPS-frissítést, folytatásnál újraindítja;
- minden pontot a WebView-tól független SQLite-sorba ír, időrendben;
- legfeljebb 25 000 natív pontot őriz, majd a legöregebbeket dobja;
- WebView-ébresztés vagy process-visszaállítás után `drain()`-nel adja át a
  sor tartalmát a közös TypeScript recordernek;
- `START_STICKY` módban rendszer általi process-kilövés után a megőrzött
  állapotból vissza tud állni. Felhasználói force stop után Android-szabály
  szerint semmilyen app nem indulhat újra magától.

### Jogosultságok

| Permission | Miért kell |
|---|---|
| `ACCESS_COARSE_LOCATION` | az Android közös helyengedély-dialógusának része |
| `ACCESS_FINE_LOCATION` | a H3 res 12 játékhoz szükséges pontos GPS; csak hozzávetőleges engedélynél az indítás érthető hibával leáll |
| `FOREGROUND_SERVICE` | hosszú idejű foreground service |
| `FOREGROUND_SERVICE_LOCATION` | Android 14+ kötelező location service-típus |
| `POST_NOTIFICATIONS` | Android 13+ FCM és notification runtime engedély; az FCM kapcsoló felhasználói gesztusra kéri |

Szándékosan nincs `ACCESS_BACKGROUND_LOCATION`: a mérés a látható appban,
felhasználói gombnyomásra induló location foreground service, ezért a
while-in-use pontos helyengedéllyel a háttérben is folytatható. A service-t
háttérből nem próbáljuk elindítani. Nincs `ACTIVITY_RECOGNITION` sem, mert a
jelenlegi kód nem olvas mozgásszenzort.

Doze alatt a foreground location service jogosult tovább futni, de egyes OEM
akkumulátorkezelők agresszívebben korlátozhatják. Nem kérünk indokolatlan
„ignore battery optimization” engedélyt; Samsung/Xiaomi/Huawei készüléken a
valós terepi teszt része legyen az app akkumulátor-beállításának ellenőrzése.

## Android upload key

A Google Play App Signing mellett Codemagic upload key-jel ír alá. A kulcsot
PowerShellben vagy Cloud Shellben, **nem a repository mappájában** hozd létre:

`keytool -genkeypair -v -keystore grundo-upload.jks -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias grundo-upload -dname "CN=GRUNDO Upload, OU=Mobile, O=GRUNDO, L=Budapest, ST=Budapest, C=HU"`

A parancs bekéri a keystore- és kulcsjelszót. A `.jks` fájlról és a
jelszavakról legyen külön, biztonságos mentés; a Codemagicből a feltöltött
keystore később nem tölthető vissza.

## Codemagic UI

### 1. Android environment group

Codemagic app → Environment variables → Add group: `grundo_android`.
Vedd fel ugyanazokat a kliensváltozókat, mint az iOS `grundo_ios` csoportban:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID=grundo`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIRESTORE_DATABASE_ID=grundo-db`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID` (a közös web SDK app ID-ja)
- `VITE_FIREBASE_VAPID_KEY`
- `VITE_MAPBOX_TOKEN`
- `VITE_MAPBOX_STYLE_LIGHT`
- `VITE_MAPBOX_STYLE_DARK`
- `VITE_API_BASE_URL`
- `VITE_USE_EMULATORS=0`
- `GOOGLE_SERVICES_JSON_BASE64` (**Secret**, az előző fejezet szerint)

A `VITE_*` értékek kliensoldaliak és beépülnek az APK/AAB web bundle-jébe;
szerveroldali privát kulcs soha ne kerüljön közéjük.

A Mapbox publikus token URL-korlátozásánál az Android Capacitor origint,
`https://localhost`-ot is engedélyezni kell (vagy külön, minimális scope-ú,
natív klienshez szánt publikus tokent kell használni), különben a térkép az
APK-ban üres marad.

### 2. Keystore identity

1. Codemagic Team settings → `codemagic.yaml settings` → Code signing
   identities → Android keystores → Add keystore.
2. Töltsd fel a `grundo-upload.jks` fájlt, add meg a keystore password, key
   alias (`grundo-upload`) és key password mezőket.
3. Keystore reference: pontosan `grundo_android_upload`.

A workflow ebből automatikusan kapja a `CM_KEYSTORE_PATH`,
`CM_KEYSTORE_PASSWORD`, `CM_KEY_ALIAS`, `CM_KEY_PASSWORD` változókat. Ezek
egyike sem kerül Gitbe vagy YAML-ba.

### 3. Backend CORS

Az Android Capacitor originje `https://localhost`. Ez bekerült a Cloud Run
`ALLOWED_ORIGINS` listájába, ezért a commit pusholása után a **backendet** is
újra kell telepíteni. Firestore-szabály és index nem változott.

## Első build

1. Pushold a commitot a GitHub `main` ágra.
2. Codemagic → GRUNDO → Start new build.
3. Workflow: **GRUNDO Android Release**, branch: `main`, majd Start.
4. A build az `android/app/build/outputs/apk/release/app-release.apk` és az
   `android/app/build/outputs/bundle/release/app-release.aab` fájl meglétét és
   aláírását is ellenőrzi.
5. Mindkettő külön letölthető a build **Artifacts** szakaszában. Automatikus
   Google Play publikálás szándékosan nincs.

## Első valódi készülékes ellenőrzés

- Friss telepítésen engedélyezd a **pontos** helyet, indíts legalább 3 perces
  rögzítést, haladj legalább 100 métert, közben zárd le a kijelzőt.
- Ellenőrizd a folyamatos foreground notificationt, majd feloldás után a
  hézagmentes nyomvonalat.
- Ismételd meg appváltással, 5 perces szünettel/folytatással és hálózat nélkül.
- Próbáld ki a csak hozzávetőleges helyet és a megtagadást: az aktivitás nem
  maradhat látszólag futó állapotban.
- Android 13+ alatt külön próbáld a notification permission megtagadását;
  ilyenkor az aktív foreground service legalább a rendszer Active apps
  felületén látszik, a mérés nem veszhet el.
- A force stop és az Active apps → Stop felhasználói leállítás; ezek után az
  operációs rendszer szándékosan nem enged automatikus folytatást.

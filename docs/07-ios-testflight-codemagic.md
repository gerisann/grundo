# GRUNDO iOS · Capacitor · Codemagic · TestFlight

**Állapot:** első belső TestFlight buildre előkészítve · 2026-08-23

**App:** GRUNDO · **Bundle ID:** `app.grundo.ios` · **Team ID:** `HFS68TZMCH`

**Verzió:** `1.0.0` · az első Codemagic build száma `1`

## Felépítés

Az iOS alkalmazás nem külön fork. A Vite ugyanazt a React alkalmazást építi a
`dist/` mappába, amelyet a Capacitor a commitált `ios/` Xcode projektbe másol.
Az iOS projekt Swift Package Managert használ; CocoaPods nem szükséges.

```text
npm ci → tesztek → npm run build → npx cap sync ios
→ Xcode archive → App Store-aláírt IPA → App Store Connect → Internal TestFlight
```

A `codemagic.yaml` workflow neve **GRUNDO iOS TestFlight**. Xcode 26.4-et és
Node 22.14-et használ. A `BUILD_NUMBER` minden Codemagic futásnál az Xcode
`CURRENT_PROJECT_VERSION` értéke lesz; a marketingverzió változatlanul 1.0.0.

## WKWebView audit és döntések

| Terület | Első build állapota |
|---|---|
| Firebase Auth e-mail/jelszó | Támogatott; a web SDK IndexedDB/localStorage perzisztenciája marad. |
| Google popup OAuth | WKWebView-ben nem megbízható, ezért natív appban őszinte hibaüzenet jelenik meg. A későbbi natív Google flow iOS OAuth client ID-t és URL scheme-et igényel. Weben változatlanul működik. |
| Firestore / Storage | A meglévő web SDK marad. A fotófeldolgozás `createImageBitmap` hiányakor WebKit-kompatibilis `<img>` fallbacket használ, miközben a vászonra újrakódolás továbbra is törli az EXIF-et. |
| Cloud Run API | A backend CORS allowlist része a `capacitor://localhost`; a backend újratelepítése szükséges az iOS API-hívások előtt. |
| Mapbox GL | A webes WebGL implementáció marad. A Codemagicben olyan nyilvános Mapbox tokent kell használni, amelyet nem kizárólag HTTPS web-originre korlátoztak. |
| Geolocation | Előtérben a WKWebView `navigator.geolocation` működik; az Info.plist helyhasználati indoklást tartalmaz. Háttér-GPS nincs bekapcsolva az első buildben. |
| Érintés/gesztus | A meglévő pointer/touch kezelés WKWebView-kompatibilis; natív gesztusplugin nem szükséges. |
| SPA routing | A Capacitor `capacitor://localhost` originjén a meglévő BrowserRouter marad; nincs Associated Domains vagy universal link capability. |
| Külső URL-ek | A jelenlegi kódban nincs külön `window.open`/külső link flow, ezért Browser plugin sem került be. |
| Web push | A jelenlegi FCM service worker csak weben támogatott. Natív appban „nem támogatott”; APNs és Push Notifications capability nincs bekapcsolva. |
| Státuszsáv / safe area | Edge-to-edge WKWebView, `viewport-fit=cover`, meglévő `safe-area-inset-*` CSS és a témát követő natív státuszsáv. |
| Fájl/fotó választás | WKWebView file input támogatott; kamera- és fotótár-indoklások szerepelnek az Info.plistben. |

Az első build szándékosan nem kér Push Notifications, Sign in with Apple,
Associated Domains vagy Background Modes capabilityt. Ezeket csak a hozzájuk
tartozó funkció tényleges implementálásakor szabad bekapcsolni.

## Codemagic environment variable-ök

A Codemagic alkalmazásban hozz létre egy `grundo_ios` és egy
`grundo_ios_signing` nevű csoportot. Az Apple API-kulcs nem ezekbe kerül: azt
a `grundo_app_store_connect` integration őrzi. Az automatikus aláíráshoz
szükséges külön RSA certificate private key a signing csoport titkos értéke;
ez nem az App Store Connect `.p8` kulcsa.

| Név | Secret? | Érték forrása |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | nem | `.env.example` / Firebase Web app config |
| `VITE_FIREBASE_AUTH_DOMAIN` | nem | `.env.example` / Firebase Web app config |
| `VITE_FIREBASE_PROJECT_ID` | nem | `grundo` |
| `VITE_FIREBASE_STORAGE_BUCKET` | nem | `.env.example` / Firebase Web app config |
| `VITE_FIRESTORE_DATABASE_ID` | nem | `grundo-db` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | nem | `.env.example` / Firebase Web app config |
| `VITE_FIREBASE_APP_ID` | nem | `.env.example` / Firebase Web app config |
| `VITE_FIREBASE_VAPID_KEY` | nem | `.env.example`; iOS-ben még nem használjuk, a közös buildkonfiguráció miatt marad |
| `VITE_MAPBOX_TOKEN` | nem, `pk.` token | Mapbox → Tokens; natív originről is használható, minimális scope-ú publikus token |
| `VITE_MAPBOX_STYLE_LIGHT` | nem | `mapbox://styles/mapbox/light-v11` |
| `VITE_MAPBOX_STYLE_DARK` | nem | `mapbox://styles/mapbox/dark-v11` |
| `VITE_API_BASE_URL` | nem | az éles `grundo-api` Cloud Run HTTPS URL-je |
| `VITE_USE_EMULATORS` | nem | `0` |
| `CERTIFICATE_PRIVATE_KEY` | **igen** | új, 2048 bites RSA PEM kulcs; kizárólag a `grundo_ios_signing` Codemagic csoportban |

Ezek kliensoldali Vite-értékek, tehát beépülnek az IPA web bundle-jébe. Valódi
privát kulcs vagy szerveroldali secret nem lehet `VITE_*` változóban.

## MANUAL STEPS

### 1. Apple azonosító és App Store Connect app

1. Az **Apple Developer → Certificates, Identifiers & Profiles → Identifiers**
   oldalon ellenőrizd, hogy létezik az explicit `app.grundo.ios` App ID a
   `HFS68TZMCH` team alatt. Ha nincs, hozd létre `GRUNDO` néven. Külön
   capabilityt az első buildhez ne kapcsolj be.
2. Az **App Store Connect → My Apps → + → New App** alatt hozz létre iOS appot:
   név `GRUNDO`, Bundle ID `app.grundo.ios`, tetszőleges egyedi SKU (például
   `grundo-ios-1`). Az app-rekordnak az első feltöltés előtt léteznie kell.

### 2. GitHub összekötése Codemagicgel

1. A módosítások GitHubra pusholása után nyisd meg a Codemagicet.
2. **Applications → Add application → GitHub**, engedélyezd a hozzáférést a
   GRUNDO repositoryhoz, válaszd ki a repót.
3. A konfigurációnál válaszd a repository gyökerében lévő
   `codemagic.yaml`-t. A listában a **GRUNDO iOS TestFlight** workflow jelenik meg.

### 3. App Store Connect integration

1. Codemagic **Team settings → Integrations → Developer Portal → Manage keys
   → Add key**.
2. Integration/API key name: `grundo_app_store_connect`.
3. Issuer ID: `3c03dcec-a963-4099-a1d6-ecc39d5e21a9`.
4. Key ID: `H73HYZ34UC`.
5. Az **API key / Choose a .p8 file** mezőben töltsd fel a helyben őrzött
   `.p8` fájlt, majd mentsd. A kulcs tartalma se GitHubra, se környezeti
   változóba nem kerül.
6. Nem kell `.p12`-t vagy provisioning profile-t kézzel létrehozni/feltölteni.
   A workflow az integration és a következő pontban megadott certificate
   private key alapján az Apple-től automatikusan létrehozza vagy lekéri az
   `IOS_APP_STORE` aláírófájlokat.

### 4. Environment variable-ök

1. Codemagic app → **Environment variables → Add group**, név: `grundo_ios`.
2. Vedd fel ebbe a fenti 13 `VITE_*` változót. Ezek egyike sem signing secret.
3. **Google Cloud Shellben**, bármely nem-repository mappában generáld az
   automatikus Apple certificate kulcsát egyetlen sorral:
   `ssh-keygen -t rsa -b 2048 -m PEM -f ~/ios_distribution_private_key -q -N ""`.
4. A Cloud Shell Editorban nyisd meg a `~/ios_distribution_private_key`
   fájlt. Codemagicben hozz létre egy `grundo_ios_signing` groupot, benne
   `CERTIFICATE_PRIVATE_KEY` néven másold be a teljes PEM tartalmat (a BEGIN
   és END sorokkal együtt), és jelöld **Secret** értéknek. A fájl és a
   `.pub` párja soha ne kerüljön a GRUNDO repositoryba.
5. A Mapbox tokennél ellenőrizd, hogy a weboldal-origin korlátozás nem tiltja
   a `capacitor://localhost` kéréseket; szükség esetén használj külön,
   minimális scope-ú natív publikus tokent.

### 5. Backend és workflow indítása

1. A commit pusholása után telepítsd a **backendet**, mert az új
   `capacitor://localhost` CORS origin nélkül az iOS kliens API-hívásai
   elutasításra kerülnek. Firestore-szabály vagy index nem változott.
2. Codemagic → GRUNDO alkalmazás → **Start new build** → workflow:
   **GRUNDO iOS TestFlight** → branch `main` → Start.
3. A futó build oldalán minden scriptlépés lenyitható; az Xcode hibák az
   **App Store IPA készítése** lépésben és az artifacts között mentett
   `/tmp/xcodebuild_logs/*.log` fájlokban találhatók.
4. Sikeres upload után az App Store Connectben nyisd meg:
   **My Apps → GRUNDO → TestFlight → iOS Builds**. Az Apple feldolgozása
   néhány percet igényelhet. A build mellett `Internal` jelölés várható.
5. A **TestFlight → Internal Testing** alatt add a buildet a belső tesztelői
   csoporthoz, ha azt az App Store Connect nem rendelte hozzá automatikusan.

## Első Codemagic buildben ellenőrizendő

- Az Xcode/SPM dependency resolution ténylegesen csak macOS-on validálható.
- Az Apple signing identity és provisioning profile csak a Codemagic fiók
  konfigurálása után ellenőrizhető.
- Valódi készüléken ellenőrizni kell az e-mailes authot, Mapbox WebGL-t,
  előtéri helyengedélyt, útvonalrögzítést, fotóválasztást, safe area-t és a
  világos/sötét státuszsávot.
- A háttérbe küldött app jelenleg nem ígér folyamatos GPS-rögzítést. Ez külön
  natív háttér-GPS fejlesztési és terepi tesztfeladat.

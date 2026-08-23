# GRUNDO iOS · Capacitor · Codemagic · TestFlight

**Állapot:** Codemagic → TestFlight pipeline működik · 2026-08-23

**App:** GRUNDO · **Bundle ID:** `app.grundo.ios` · **Team ID:** `HFS68TZMCH`

**Verzió:** `1.0.0` · a Codemagic buildszám minden feltöltésnél nő

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
A Vite buildbe bekerül az `iOS build <szám>` és a rövid Git commit is.

## WKWebView audit és döntések

| Terület | Első build állapota |
|---|---|
| Firebase Auth e-mail/jelszó | Támogatott; iOS-en kényszerített `localStorage` perzisztencia van, mert a WKWebView IndexedDB-je kezdeti auth-beragadást okozhat. |
| Google popup OAuth | WKWebView-ben nem megbízható, ezért natív appban őszinte hibaüzenet jelenik meg. A későbbi natív Google flow iOS OAuth client ID-t és URL scheme-et igényel. Weben változatlanul működik. |
| Firestore / Storage | A meglévő web SDK marad. A fotófeldolgozás `createImageBitmap` hiányakor WebKit-kompatibilis `<img>` fallbacket használ, miközben a vászonra újrakódolás továbbra is törli az EXIF-et. |
| Cloud Run API | A backend CORS allowlist része a `capacitor://localhost`; a backend újratelepítése szükséges az iOS API-hívások előtt. |
| Mapbox GL | A webes WebGL implementáció marad. A Codemagicben olyan nyilvános Mapbox tokent kell használni, amelyet nem kizárólag HTTPS web-originre korlátoztak. |
| Geolocation | iOS-en a saját Core Location Capacitor bridge kéri a GRUNDO helyengedélyét, így nincs `localhost` böngészős prompt. Aktív mérés alatt `UIBackgroundModes: location`, 5 m-es mintavétel és tartós natív pontsor fut; az ébredő WebView a sorba tett pontokat átveszi. A rendszer helyengedélyénél a „Mindig” opció kell a specifikáció szerinti lezárt képernyős rögzítéshez. Weben marad a `navigator.geolocation`, ott nincs háttérkövetés. |
| Érintés/gesztus | A meglévő pointer/touch kezelés WKWebView-kompatibilis; natív gesztusplugin nem szükséges. |
| SPA routing | A Capacitor `capacitor://localhost` originjén a meglévő BrowserRouter marad; nincs Associated Domains vagy universal link capability. |
| Külső URL-ek | A jelenlegi kódban nincs külön `window.open`/külső link flow, ezért Browser plugin sem került be. |
| Push | Weben FCM service worker + VAPID; natív iOS-en `@capacitor-firebase/messaging` ad FCM tokent, a Firebase Production APNs-kulccsal kézbesít. A Push Notifications capability, `aps-environment` entitlement és `remote-notification` háttérmód bekötve. |
| Live Activity | iOS 16.1+-on külön WidgetKit extension jeleníti meg a lezárt képernyőn és a Dynamic Islanden az aktív mérés idejét, távját, sebességét és szünetállapotát. A Core Location réteg háttérből frissíti. |
| Státuszsáv / safe area | Edge-to-edge WKWebView, `viewport-fit=cover`, meglévő `safe-area-inset-*` CSS és a témát követő natív státuszsáv. |
| Fájl/fotó választás | WKWebView file input támogatott; kamera- és fotótár-indoklások szerepelnek az Info.plistben. |

A Push Notifications capability és a Background Modes → Location Updates +
Remote notifications már a tényleges natív implementációval együtt szerepel.
Sign in with Apple és Associated Domains továbbra sincs bekapcsolva. A
készülékes, lezárt kijelzős GPS- és push-teszt kötelező.

## Kiadási rend: web és TestFlight

- A webapp a gyors fejlesztési és funkcionális tesztcsatorna.
- TestFlight build csak érdemi funkciócsomag után készül, illetve azonnal,
  ha iOS-specifikus kód (auth, GPS, engedélyek, térkép, safe area, háttér)
  változik.
- Mindkét felületen a **Beállítások → Alkalmazás → Verzió** sor mutatja az
  `vX · csatorna/build · rövid commit` azonosítót. Csak azonos commit tekinthető
  szinkron webes és iOS kiadásnak.
- A Cloud Run backend külön települ, ezért az új backendnek a már kint lévő
  mobil és webes kliensekkel is kompatibilisnek kell maradnia.

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
| `VITE_FIREBASE_VAPID_KEY` | nem | weben a verziókövetett `.env.production` garantálja; iOS-ben még nem használjuk, a közös buildkonfiguráció miatt marad |
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
   A **Push Notifications** capability legyen bekapcsolva.
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
5. A Background Modes → Location updates megfelelője már commitolva van az
   Info.plist `UIBackgroundModes: location` bejegyzésében; Codemagic ebből
   épít, nincs külön portál- vagy kézi Xcode-lépés.
6. A Mapbox tokennél ellenőrizd, hogy a weboldal-origin korlátozás nem tiltja
   a `capacitor://localhost` kéréseket; szükség esetén használj külön,
   minimális scope-ú natív publikus tokent.

### 5. Natív iOS push

1. Apple Developer → **Keys** alatt a meglévő, Team Scoped
   `IPNForSendPush` kulcs (`9BGTAPANR8`) Sandbox & Production APNs-hozzáférést
   ad. A `.p8` privát fájl nem kerülhet a repóba vagy Codemagic változóba.
2. Firebase → Project settings → Cloud Messaging → **GRUNDO iOS** alatt a
   Production APNs auth key fel van töltve a `HFS68TZMCH` teamhez.
3. A Firebase iOS app bundle ID-ja `app.grundo.ios`; a hozzá tartozó
   `GoogleService-Info.plist` az Xcode App target verziókövetett erőforrása.
   Ez klienskonfiguráció, nem az APNs privát kulcs.
4. A Capacitor plugin csak felhasználói kapcsolóra kér értesítési engedélyt,
   FCM tokent ment `platform: ios` jelöléssel, tokenfrissítéskor cserél, és
   leiratkozáskor a helyi valamint Firestore tokent is törli.
5. Az `aps-environment` buildfüggő: Debugban `development`, App Store/TestFlight
   Release-ben kötelezően `production`. A Codemagic ezt az archive előtt
   ellenőrzi; a szerver minden sikertelen iOS FCM-kézbesítés platformját és
   Firebase/APNs hibakódját naplózza.

### 6. Zárolt képernyős Live Activity

1. Apple Developer → Certificates, Identifiers & Profiles → Identifiers alatt
   az app App ID-ja mellett külön App ID kell a WidgetKit extensionnek:
   `app.grundo.ios.liveactivity`. A név legyen `GRUNDO Live Activity`.
2. Az app `Info.plist` fájljában a `NSSupportsLiveActivities` aktív. A külön
   `GrundoLiveActivity` extension target minimum iOS 16.1-et kér, és az App
   targetbe ágyazódik.
3. A natív helyforrás indításkor létrehozza, szünet/folytatáskor frissíti,
   befejezéskor azonnal lezárja a Live Activityt. Háttérben a szűrt Core
   Location pontokból folytatja a táv és sebesség frissítését.
4. A Beállítások → Értesítések → „Élő mérés a zárolt képernyőn” kapcsoló
   helyi eszközbeállítás; alapból aktív, a következő rögzítéstől érvényes.
5. Codemagic külön App Store provisioning profile-t kér az apphoz és az
   `app.grundo.ios.liveactivity` extensionhöz, majd az `App` scheme mindkettőt
   egy IPA-ba archiválja.

### 7. Backend és workflow indítása

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
- Készüléken indíts rögzítést, majd zárd le a képernyőt legalább 3 percre,
  haladj közben legalább 100 métert, nyisd fel az appot és ellenőrizd a
  folyamatos pontsort. A rendszer bármikor leállíthatja a kilőtt appot; az
  aktív, háttérben hagyott rögzítés támogatott, nem a force-quit utáni
  automatikus újraindítás.
- Ugyanezen teszt alatt a Live Activity jelenjen meg a zárolt képernyőn;
  az idő másodpercenként fusson, a táv és sebesség mozgáskor frissüljön, a
  szünet gomb után „Szünet” állapotot mutasson, befejezéskor pedig tűnjön el.

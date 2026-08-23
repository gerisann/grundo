# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja. A történet a git logban van.

**Következő menet neve: GRUNDO #12.** A #11 menet a webes GRUNDO-ból
commitálható Capacitor iOS projektet és automatikus Codemagic → Internal
TestFlight pipeline-t készített. Valódi Xcode archive vagy TestFlight feltöltés
Windowsról nem futott; a következő menet a Codemagic első build eredményéből
induljon.

## ÁLLAPOT

- Repo: `C:\Users\Geri\Documents\GitHub\grundo`
- Ág: `main`; a menet eleji HEAD `bd951b0`, a mostani változások külön magyar
  commitban kerülnek rá.
- Unit tesztek: **394 zöld**, 112 emulátoros teszt a normál futásban kihagyva.
  Az emulátoros suite nem futott, mert Firestore-séma, -szabály vagy
  -tranzakció nem változott.
- Frontend TypeScript + production Vite build: zöld. Az ismert Mapbox chunk
  továbbra is 521,57 kB gzip figyelmeztetést ad.
- Backend TypeScript + production build: zöld.
- Clean `npm ci`: zöld; a root `package-lock.json` reprodukálható Codemagic
  telepítést ad.
- Capacitor `sync ios` és pluginlista: zöld. A doctor egyetlen hibája az
  elvárt „Xcode is not installed” Windows alatt.
- `codemagic.yaml`: YAML lint zöld. Xcode/archive/signing csak Codemagic macOS
  gépen validálható.
- App Store asset audit: 1024×1024 RGB app icon, 2732×2732 RGB splash; nincs
  tiltott alpha csatorna.
- `git diff --check`: tiszta.

## MI KÉSZÜLT EL

### Capacitor iOS

- Capacitor 8.5, iOS 15 minimum, Xcode 26.4, Swift Package Manager.
- App: `GRUNDO`; Bundle ID: `app.grundo.ios`; Team ID: `HFS68TZMCH`.
- Vite web output: `dist`; ugyanaz a web és iOS kódbázis.
- Xcode marketingverzió `1.0.0`, kezdő build `1`, Apple generic versioning.
- Commitálható `ios/` projekt, a generált web bundle és buildtermékek
  gitignore-ban maradnak.
- GRUNDO maskable ikonból RGB 1024-es iOS app icon; márkázott sötét splash.
- Info.plist: GRUNDO-specifikus Location When In Use, Camera és Photo Library
  szöveg; export compliance `false`. Nincs fölösleges capability.

### WKWebView kompatibilitás

- A safe-area CSS és `viewport-fit=cover` megmaradt; a Capacitor edge-to-edge
  webview státuszsávja követi a világos/sötét témát.
- A fotókód `createImageBitmap` nélkül WebKit `<img>` fallbacket használ,
  továbbra is vászonra újrakódolva és EXIF nélkül.
- A natív app nem próbál webes FCM service workert indítani; natív push nincs
  az első buildben, Push Notifications capability sincs.
- A Firebase Google popup natív WKWebView-ben nem fut: érthető magyar üzenet
  irányít e-mail/jelszó belépésre. Weben változatlan. Natív Google auth külön
  iOS OAuth client ID-t igénylő következő funkció.
- Firestore/Auth/Storage marad a Firebase web SDK-val; Mapbox marad WebGL.
- Háttér-GPS nincs bekapcsolva; az első build előtéri `navigator.geolocation`
  rögzítést tesztel. Background Modes capability nincs.
- A Cloud Run CORS allowlist megkapta a `capacitor://localhost` origint; ehhez
  backend telepítés szükséges.

### Codemagic és aláírás

- Root `codemagic.yaml`, workflow: **GRUNDO iOS TestFlight**.
- Lépések: npm ci → 394 unit teszt → Vite build → Capacitor sync → ideiglenes
  keychain → automatikus Apple Distribution certificate/App Store profile →
  Codemagic build number → aláírt IPA → App Store Connect → TestFlight.
- A `grundo_app_store_connect` integration kezeli a `.p8`-at; sem tartalom,
  sem Apple credential nincs a repóban.
- A Codemagicben Secret `CERTIFICATE_PRIVATE_KEY` alapján a CLI `--create`
  módban kezeli az aláíró certificate-et és profile-t; nincs kézi `.p12` flow.
- A build internal-only export optiont kap; nem alkalmas external testingre
  vagy App Store release-re.
- A Codemagic `$BUILD_NUMBER` lesz az Xcode build number, ezért minden új
  feltöltés egyedi.

### Dokumentáció és repo-higiénia

- Új `docs/07-ios-testflight-codemagic.md`: teljes architektúra-audit,
  environment variable táblázat és önálló MANUAL STEPS.
- A docs index frissült.
- A `.gitignore` tiltja a `.p8`, `.p12`, provisioning, certificate, PEM/key,
  signing private key, érzékeny `.env` és natív buildtermék fájlokat.

## TELEPÍTETLEN / MANUÁLISAN HÁTRA VAN

1. Geri pusholja a commitot GitHubra.
2. Apple Developerben ellenőrizni/létrehozni az explicit App ID-t és App Store
   Connectben a GRUNDO app-rekordot.
3. Codemagicben GitHub app, `grundo_app_store_connect` integration, a két env
   group és a certificate private key beállítása a docs/07 pontos lépéseivel.
4. **Backend** telepítés a Capacitor CORS origin miatt. Szabály- és
   indextelepítés nincs.
5. Codemagic **GRUNDO iOS TestFlight** első futás, majd az Internal TestFlight
   build készülékes ellenőrzése.

## ELSŐ CODEMAGIC BUILD / KÉSZÜLÉKTESZT ELLENŐRZŐLISTA

- SPM dependency resolution és Xcode archive.
- Apple certificate/profile automatikus létrehozása és internal-only export.
- App Store Connect app-rekord és Bundle ID egyezése.
- E-mail/jelszó Firebase auth, Cloud Run API és Firestore/Storage.
- Mapbox WebGL és a Codemagicben használt publikus token native-origin
  korlátozása.
- Előtéri location engedély, tracking, térképgesztusok és folytatható lokális
  checkpoint.
- Fotótár/kamera, EXIF nélküli feltöltés.
- notch/Dynamic Island/home indicator, világos/sötét státuszsáv.

## ISMERT KORLÁTOK / NYITOTT ÜGYEK

- Google-belépés és Google-fiók linkelés natív appban még nincs; iOS OAuth
  client ID + natív flow kell.
- Web push nem jelent natív APNs push-t; külön funkció és capability kell.
- A háttér-GPS a projekt legnagyobb nyitott natív kockázata; az első build
  nem ígér háttérben folyamatos rögzítést.
- `npm audit --omit=dev`: 2 moderate React Router advisory; csak v7 majorban
  van javítás. A fejlesztői Vite/Vitest audit további high/critical dev-server
  advisorykat jelez; CI-ben csak build és `vitest run` fut, szerver/UI nem.
- A Mapbox token native-origin kompatibilitása csak valós buildben mérhető.
- A korábbi rivális badge neve és jutalom-GP-je továbbra is döntésre vár.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Sonnet/Sol, normál mélység** elég az első Codemagic log célzott javításához.
Valós készülékes háttér-GPS vagy Mapbox/WebGL anomália esetén **Opus/Sol emelt
mélység** indokolt, mert mért platformhibát kell diagnosztizálni.

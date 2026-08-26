# GRUNDO handoff

> Frissítve: **2026-08-26** · Android natív build és Codemagic release pipeline
>
> Repo: `C:\Users\Geri\Documents\ChatGPT\GRUNDO` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · HEAD: az Android build commitje (lásd `git log -1`)

## Mi készült el

- Létrejött a Capacitor 8.5 Android projekt a Geri által jóváhagyott
  `app.grundo.android` application ID-val. Az iOS bundle ID változatlanul
  `app.grundo.ios`. `minSdk 24`, `compileSdk/targetSdk 36`, AGP 8.13.0,
  Gradle 8.14.3, Java 21.
- A saját `BackgroundLocation` Capacitor plugin Androidon egy felhasználói
  gesztusból induló `location` foreground service-t vezérel. Fused Location
  Provider, 1 másodperces kérés, 5 méteres minimum elmozdulás, tartós
  notification és legfeljebb 25 000 pontos SQLite-sor készült. A WebView
  felfüggesztése vagy process-visszaállítás után a TypeScript recorder
  időrendben átveszi a pontokat.
- Csak a szükséges Android engedélyek vannak a manifestben. Nincs
  `ACCESS_BACKGROUND_LOCATION` és nincs `ACTIVITY_RECOGNITION`; pontos hely
  nélkül az indítás érthető hibával leáll és nem marad ál-rögzítés.
- A natív FCM iOS mellett Androidon is működik, a Firestore tokenrekord
  `platform: android` jelölést kap. A Firebase Android konfiguráció nem került
  Gitbe.
- A backend CORS allowlist megkapta az Android Capacitor `https://localhost`
  originjét. Firestore rules/index/adatmodell nem változott.
- A `codemagic.yaml` új, az iOS workflow-tól különálló **GRUNDO Android
  Release** workflow-ja tesztel, buildel, lintel, Codemagic upload key-jel
  aláír, majd az APK és az AAB aláírását is ellenőrzi. Automatikus Play Store
  publikálás nincs.
- Teljes üzemeltetési és első készülékes leírás: `docs/08-android-codemagic.md`.

## Ellenőrzött állapot

- `npm run test`: **532 sikeres**, 122 emulátoros teszt kihagyva.
- `npm run build`: sikeres TypeScript + Vite production build.
- `server/npm run build`: sikeres.
- `npx cap sync android`: sikeres, 3 Android Capacitor plugin felismerve.
- Gradle `lintRelease`, `assembleRelease`, `bundleRelease`: **BUILD SUCCESSFUL**.
  Lint: **0 hiba**, 16 nem blokkoló, nagyrészt a Capacitor alapsablon nem
  használt launcher/splash erőforrásaira vonatkozó figyelmeztetés.
- Helyben aláíratlan `app-release-unsigned.apk` és `app-release.aab` készült.
  Valódi aláírt artifactet csak a Codemagicben tárolt upload key-jel lehet
  előállítani; teszt/fiktív release kulcs nem készült.
- Production dependency audit: kliens 0 critical/high (2 moderate), szerver
  0 critical/high (8 moderate). Automatikus breaking audit-fix nem futott.
- `codemagic.yaml`: YAML lint sikeres. `git diff --check`: tiszta.

## Geri következő kézi lépései

1. Firebase Console-ban hozz létre Android appot `app.grundo.android` package
   névvel, és a letöltött `google-services.json` base64 értékét tedd a
   Codemagic `grundo_android` csoport `GOOGLE_SERVICES_JSON_BASE64` secretjébe.
2. Hozd létre és biztonságosan mentsd a Play upload key-t, töltsd fel
   Codemagicbe `grundo_android_upload` reference néven. A pontos parancs és UI
   mezők a `docs/08-android-codemagic.md` fájlban vannak.
3. A workflow a meglévő `grundo_ios` csoport közös `VITE_*` értékeit
   újrahasználja; a Mapbox token engedje a `https://localhost` origint.
4. A commit pusholása után telepítsd újra a backendet a CORS-változás miatt,
   majd indítsd a **GRUNDO Android Release** workflow-t a `main` ágon.
5. Az artifactek a Codemagic build Artifacts részében lesznek:
   `android/app/build/outputs/apk/release/app-release.apk` és
   `android/app/build/outputs/bundle/release/app-release.aab`.

## Nyitott, készüléket igénylő ellenőrzés

- Valódi Android 13+ készüléken pontos/helymegtagadott engedélyág, lezárt
  kijelzős 3+ perces út, appváltás, szünet/folytatás, offline pontsor és FCM.
- Samsung/Xiaomi/Huawei OEM akkumulátorkezelés terepi ellenőrzése. Az app
  szándékosan nem kér battery-optimization kivételt.
- Google Play Console app és Play App Signing csak akkor szükséges, amikor az
  első belső teszt AAB feltöltése következik.

## Következő session modellje

- A kézi Firebase/Codemagic beállítás és az első build naplóelemzése:
  **GPT-5.6 Terra, high** elég.
- Natív GPS lifecycle/OEM hiba vagy aláírási probléma esetén:
  **GPT-5.6 Sol, high/xhigh** ajánlott.

## Források sorrendje

1. `AGENTS.md`
2. `HANDOFF.md`
3. `docs/08-android-codemagic.md`
4. `docs/README.md` és a kapcsolódó funkcionális/architektúra dokumentumok

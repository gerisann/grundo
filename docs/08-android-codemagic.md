# GRUNDO Android · Capacitor · Codemagic

**Állapot:** natív Android projekt, release workflow, Google-belépés és zárolt képernyős élő mérés elkészült · 2026-08-29

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
| Codemagic instance | `mac_mini_m2` (az Individual free csomagban elérhető) |
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

Az Android Gradle build macOS-on is fut; a pipeline nem indít Android-emulátort.
A Firebase-konfiguráció dekódolása és az `apksigner` kiválasztása
platformfüggetlen Node-szkripttel történik. Ezért ugyanaz a workflow a
Codemagic Individual csomag ingyenes `mac_mini_m2` gépén is használható.

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
`app.grundo.android` csomaghoz tartozik, valamint tartalmaz Android- és webes
OAuth-klienst. Hamis, hiányos vagy más apphoz tartozó fájllal a build még
Gradle előtt leáll.

### Natív Google-belépés

A Firebase Android appban az upload certificate SHA-1 ujjlenyomata rögzítve
van. Ezután új `google-services.json` készült, és annak base64 értéke került a
Codemagic `GOOGLE_SERVICES_JSON_BASE64` változójába. A jelenlegi upload SHA-1:

`2A:75:93:84:FA:1F:DB:21:7A:39:EB:78:F7:10:66:3A:D8:7F:EF:5F`

Androidon a `@capacitor-firebase/authentication` natív Credential Manager
fiókválasztója szerzi meg a Google ID tokent. A tartós munkamenetet továbbra is
a közös Firebase JS SDK kezeli: a natív tokenből `GoogleAuthProvider`
credential készül, majd ugyanaz a kliensoldali belépési vagy fiók-összekapcsolási
folyamat fut, mint weben. Az iOS Google-belépés ettől nem változik.

Google Play App Signing bekapcsolásakor a Play más tanúsítvánnyal írja alá a
felhasználóknak kiosztott APK-kat. A Play Console-ban megjelenő **app signing
certificate SHA-1** ujjlenyomatot ezért külön hozzá kell adni ugyanahhoz a
Firebase Android apphoz, majd ismét frissíteni kell a Codemagicben tárolt
`google-services.json` értéket. Enélkül a Codemagicből közvetlenül telepített
APK-ban működhet a Google-belépés, a Play Áruházból telepített verzióban viszont
nem.

## GPS és háttérmérés

Az Android implementáció nem a felfüggeszthető WebView hely-API-jára épít.
A felhasználó a látható appból indítja el a `location` típusú
`TrackingLocationService` foreground service-t. A szolgáltatás:

- Fused Location Providerrel, nagy pontossággal és mozgásforma szerinti
  minimum elmozdulással kér pontokat: futás 5 m, séta 8 m, bringa 12 m;
- futás közben folyamatos, nem elnémítható alkalmazáslogikájú foreground
  notificationt tart fenn; engedélyezett élő mérésnél ennek kompakt és
  kibontott nézete mutatja a távot, a natív chronometerrel tovább járó időt,
  az aktuális sebességet, a mozgásformát és a szünet állapotát;
- szünetnél leállítja a GPS-frissítést, folytatásnál újraindítja;
- minden pontot a WebView-tól független SQLite-sorba ír, időrendben; a sor
  méretét folyamaton belüli, a drainnel közös zár alatt kezelt számláló
  követi, ezért nem fut 25 000 soros ellenőrző lekérdezés minden GPS-pontnál;
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
| `POST_NOTIFICATIONS` | Android 13+ FCM és notification runtime engedély; az FCM kapcsoló vagy az alapból engedélyezett zárolt képernyős élő mérés indítása felhasználói gesztusra kéri |

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

Az Android workflow a meglévő `grundo_ios` csoport platformfüggetlen
`VITE_*` kliensváltozóit is importálja. Az Apple signing ettől elkülönített
`grundo_ios_signing` csoportban van, azt az Android workflow nem kapja meg.
Így a közös értékeket nem kell duplikálni, és később sem tudnak eltérni.

A `grundo_android` csoportban csak ez az Android-specifikus változó szükséges:

- `GOOGLE_SERVICES_JSON_BASE64` (**Secret**, az előző fejezet szerint)

A `grundo_ios` csoportból újrahasznált közös változók:

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

- Jelentkezz ki, válaszd a Google-belépést, válassz fiókot, majd ellenőrizd,
  hogy a profil betöltődik. E-mail/jelszavas fiókkal külön próbáld ki a
  Google-fiók összekapcsolását is.
- Friss telepítésen engedélyezd a **pontos** helyet, indíts legalább 3 perces
  rögzítést, haladj legalább 100 métert, közben zárd le a kijelzőt.
- Ellenőrizd a folyamatos foreground notificationt, majd feloldás után a
  hézagmentes nyomvonalat.
- Zárolt képernyőn ellenőrizd a kompakt, majd kibontott GRUNDO-kártyán a
  mozgásformát, távot, tovább járó időt és sebességet. Szünetnél az idő és a
  GPS-adatok álljanak meg, folytatásnál ne ugorjon bele a szünet alatt megtett
  távolság. A kártyára koppintva a GRUNDO nyíljon meg.
- Kapcsold ki a Beállítások → Értesítések → Élő mérés a zárolt képernyőn
  opciót, indíts új rögzítést, és ellenőrizd, hogy csak az Android által
  kötelező egyszerű foreground service értesítés marad; a kapcsoló a már futó
  rögzítést szándékosan nem alakítja át.
- Ismételd meg appváltással, 5 perces szünettel/folytatással és hálózat nélkül.
- Hosszú regresszióként rögzíts legalább 90 percet és 20 km-t bringával,
  a kijelzőt az idő nagy részében lezárva tartva. A feloldás utáni
  nyomvonal nem tartalmazhat hosszú kezdő–végpont egyenest, és a
  referenciaeszközhöz viszonyított táveltérést rögzíteni kell.
- Próbáld ki a csak hozzávetőleges helyet és a megtagadást: az aktivitás nem
  maradhat látszólag futó állapotban.
- Android 13+ alatt külön próbáld a notification permission megtagadását;
  ilyenkor az aktív foreground service legalább a rendszer Active apps
  felületén látszik, a mérés nem veszhet el.

## Reprodukálható terepteszt hamis GPS-szel

A fenti hosszú regresszió (90 perc, 20 km, lezárt kijelzővel) valódi mozgást
igényel, és a hiba pont a legritkábban látott, több órás/tízkilométeres
szakaszon jelentkezett korábban (lásd `docs/ai/DECISIONS.md`). Ehelyett a
**LAB GPX-export** ugyanazt a valódi natív utat futtatja meg (valódi app,
valódi foreground service, valódi zárolt képernyő), de a GPS-jel forrása
reprodukálható:

1. `/admin/lab/scenario` → állíts össze egy útvonalat (vagy tölts be egy
   mentett scenariót) → **„GPX exportálása"** gomb a térkép felett. Ez a
   `generateGpsActivity` ugyanazon mérési modelljét (zaj, pontosság, drift,
   jelkimaradás) exportálja GPX-be, amit a LAB böngészős szimulációja is
   használ.
2. A telefonon: **Beállítások → Fejlesztői beállítások → Hamis helyadat app**
   — válassz egy GPX-lejátszásra képes appot (pl. „Fake GPS Location", „GPX
   Player"), és importáld a letöltött fájlt. **A GRUNDO-t itt NEM kell
   kiválasztani** — a mock provider az Android helyszolgáltatásán keresztül
   minden appnak (így a GRUNDO valódi `FusedLocationProviderClient`
   hívásának is) átlátszóan szállítja a fixeket.
3. Nyisd meg a **valódi** GRUNDO appot, indíts valódi rögzítést a megfelelő
   mozgásformával.
4. Indítsd el a lejátszást a mock appban, majd **fizikailag zárd le** a
   telefont a route egy tetszőleges pontján; hosszabb szakaszra hagyd
   lezárva, mint amennyit korábban élőben sikerült tesztelni.
5. Feloldás után ellenőrizd a nyomvonalat, a távot és az értesítést — pont
   úgy, mint a fenti checklistában.

**Korlát:** ez a natív rögzítőt és az OS-szintű helyszolgáltatást valódi
körülmények között teszteli, tehát erősebb bizonyíték, mint bármilyen
böngészős szimuláció — de a GPS-jel maga szintetikus. A kiadás előtti
regressziót ez **kiegészíti**, nem helyettesíti: legalább egy valódi,
kültéri GPS-es hosszú menetet a fentiek szerint el kell végezni.
- A force stop és az Active apps → Stop felhasználói leállítás; ezek után az
  operációs rendszer szándékosan nem enged automatikus folytatást.

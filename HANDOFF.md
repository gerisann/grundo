# GRUNDO — átadás

Ez a fájl az aktuális állapotot mutatja; a részletes történet a Git logban van.

## ÁLLAPOT

- Repo: `C:\Users\Geri\Documents\GitHub\grundo`
- Ág: `main`.
- Az utolsó már GitHubra feltolt auth-javítás: `740eba7 Stabilize Firebase auth in iOS WebView`.
- A webes és TestFlight build legutóbbi éles verziója: `1.0.0`; Codemagicben a
  buildszám automatikusan nő.
- Unit tesztek: 394 zöld, 112 emulátoros teszt a normál futásban kihagyva.
  Emulátoros suite nem kell, mert sem Firestore-séma, sem szabály, sem
  tranzakció nem változott.

## MI MŰKÖDIK ÉLESBEN

- Codemagic → App Store Connect → TestFlight pipeline működik. A külső review
  külön Apple-folyamat; belső teszteléshez a feltöltött build review nélkül is
  használható.
- A Cloud Run API helyes címe:
  `https://grundo-api-65689674957.europe-west1.run.app`.
  A rövid `a.run.app` alias erre a projektre 404-et ad, ne használd Vite
  `VITE_API_BASE_URL` értéknek.
- iOS-en az auth inicializálás Firebase `localStorage` perzisztenciát használ,
  mert a WKWebView IndexedDB-je beragadhatott. A 4 másodperces indulási és a
  15 másodperces belépési őrszem konkrét hibát mutat végtelen splash helyett.
- A felhasználó a legutóbbi iOS buildben már eljutott a loginig és sikeresen
  belépett.

## JELEN MENET VÁLTOZÁSAI — MÉG TESTFLIGHT-RA KERÜLNEK

- `@capacitor/geolocation` 8.2.2: iOS rögzítésnél a Capacitor natív
  helymeghatározási plugin fut. A rendszer engedélykérése ezért **GRUNDO**
  néven jelenik meg, nem `localhost` weboldalként.
- A webes `navigator.geolocation` csak böngészőben marad. Háttér-GPS továbbra
  sincs: nincs Background Modes capability, a `supportsBackground` ezért
  helyesen `false`.
- Beállítások → Alkalmazás alatt minden build kiírja a
  `v1.0.0 · csatorna/build · rövid commit` azonosítót.
  Web buildnél `web`, Codemagicnél `iOS build <BUILD_NUMBER>` a csatorna.
- A `package.json` verziója is `1.0.0`, így egyezik az Xcode
  `MARKETING_VERSION` értékével.
- A kiadási rend AGENTS.md-ben és docs/07-ben rögzítve:
  web = gyors funkcionális teszt; TestFlight = nagyobb funkciócsomag és minden
  iOS-specifikus változás; mindig konkrét commitot kell promotálni.

## KÖVETKEZŐ LÉPÉSEK

1. Futtasd a teljes unit tesztet és a production buildet, majd commitold a
   jelen menet fájljait.
2. A felhasználó pusholja a commitot, majd indítson belőle Codemagic buildet.
3. TestFlighton ellenőrizd: első rögzítéskor a natív **GRUNDO** location prompt,
   Allow után GPS-fix, útvonal és stop/mentés. A háttérbe tett appot ne tekintsd
   támogatottnak.
4. Web deploy csak akkor szükséges, ha a webes kiadást is erre a commitra akarjuk
   frissíteni. Szabály-, index- és backend telepítés ehhez a menethez nem kell.

## NYITOTT KOCKÁZATOK

- Háttér-GPS, natív Google/Apple belépés és APNs push még nincs implementálva.
- A Mapbox WebGL és a natív GPS valós készülékes mérését minden nagyobb iOS
  build után külön ellenőrizni kell.
- A TestFlight külső review-ra egyszerre egy build lehet azonos verzió-trainben;
  emiatt a Codemagic post-processing ilyenkor hibázhat, miközben az IPA és a
  belső tesztelhető build sikeresen feltöltődött.

## MODELLJAVASLAT

**Terra/Sol, közepes mélység** elég a kiadási azonosító, Capacitor plugin és
felületi integráció munkához. Valós készülékes GPS- vagy Mapbox-anomália
diagnózisánál **Sol, erős** indokolt.

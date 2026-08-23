# GRUNDO — átadás

Ez a fájl az aktuális állapotot mutatja; a részletes történet a Git logban van.

## ÁLLAPOT

- Repo: `C:\Users\Geri\Documents\GitHub\grundo`
- Ág: `main`.
- GitHubon jelenleg `85802da Küldetés és iOS háttér-GPS javítása` van.
- A lokális HEAD egy commit-tal a GitHub előtt jár: **Webes push production
  konfiguráció**. A push a felhasználó következő lépése.
- Teljes unit teszt: **399 zöld**, 112 célzott emulátoros teszt kihagyva.
  Production Vite build sikeres 2026-08-23 17:05-kor; a generált bundle-ben
  a production VAPID public key jelenléte külön ellenőrizve.

## MI VÁLTOZOTT EBBEN A MENETBEN

### Küldetésgenerálás

- Az `a858c52` abszolút útvonalhibaszűrője akkor is eldobta az összes jelöltet,
  ha minden körön csak egy kisebb visszafordulás volt. Ez okozta a
  „Találtunk köröket, de mindegyikben…” zsákutcát.
- Most a 0 hibás útvonalak elsőbbséget kapnak, de ha nincs ilyen, a három
  legkevésbé hibás kör visszakerül a találati listába. A küldetéskérés tehát
  nem válik használhatatlanná. A tényleges Mapbox-geometriai kitérők további
  javítása ettől független, következő optimalizálási feladat.

### Webes félbehagyott rögzítés

- Mérés: a „Folytatom” felajánlás csak akkor jelenhet meg, ha a
  `RecorderProvider`/oldal újraindul és az IndexedDB-ből újraolvassa az aktív
  állapotot; a böngészős GPS-hiba önmagában nem állítja félbe a rögzítőt.
- Új, helyi életciklus-diagnosztika rögzíti a `hidden` és `pagehide` eseményt,
  és visszaállításkor konkrétan kiírja: újratöltés, bezárás vagy háttérbe
  kerülés előzte-e meg. A következő webes reprodukcióból így bizonyítható a
  valódi kiváltó ok; jelenleg nem állítunk megalapozatlan automatikus javítást.

### iOS háttér-GPS

- A korábbi előtéri `@capacitor/geolocation` helyett helyi Swift Core Location
  Capacitor bridge van. Aktív rögzítéskor 5 m-es szűrővel dolgozik,
  `UIBackgroundModes: location` értékkel, és a lezárt képernyő alatt kapott
  pontokat natív `UserDefaults` sorban megőrzi. A felébredő WebView átveszi
  őket, így a háttérben megtett út nem függ a felfüggesztett JavaScripttől.
- A rendszer „Mindig” engedélyét kéri a specifikáció szerint; enélkül a UI
  továbbra is képernyő-ébrentartást kér. A force-quittel kilőtt alkalmazás
  automatikus folytatása nem támogatott iOS-en.
- **Kötelező valós TestFlight-teszt:** indíts rögzítést, adj „Mindig” engedélyt,
  zárd le 3 percre, haladj 100+ métert, majd ellenőrizd a folytonos nyomvonalat.
  A Windowsos fejlesztői környezetből Xcode-fordítás nem ellenőrizhető.
- A zárolt képernyős Live Activity nincs elkészítve. Ez külön ActivityKit
  bővítmény (és Androidon foreground service), a háttér-GPS-hez nem szükséges.

### Push

- A webes FCM út már kódban kész: engedélykérés csak felhasználói kapcsolóra,
  service worker, VAPID token Firestore-ba, szerveroldali FCM-küldés és
  érvénytelen token törlése. A VAPID public key most már a verziókövetett
  `.env.production` része, ezért a Cloud Shellből készített webbuild sem veszti
  el akkor, ha ott nincs helyi `.env.local`.
- Natív iOS push még nincs: az Apple APNs-kulcs vagy Firebase iOS Messaging
  konfiguráció külső hitelesítőanyagot kíván. Ne generálj vagy helyettesíts
  ilyet; előbb Apple Developer/Firebase oldali döntés és kulcs kell.

## TELEPÍTÉSI SORREND

1. A felhasználó pusholja a következő commitot.
2. **Backend telepítés szükséges** a küldetés-generálás szerveroldali fallbackje
   miatt.
3. **Frontend telepítés szükséges** a webes rögzítő-diagnosztikához és a webes
   FCM ellenőrzéséhez.
4. Ezután Codemagicből TestFlight build ugyanebből a commitból; iOS háttér-GPS
   csak valódi készüléken tekinthető ellenőrzöttnek. Szabály- és indextelepítés
   ehhez a menethez nem kell.

## KÖVETKEZŐ MENET

1. Éles weben reprodukáld a rögzítő-megszakítást, és az új visszaállítási
   üzenet alapján döntsd el, reload/pagehide/background volt-e a kiváltó ok.
2. TestFlighton végezd el a lezárt képernyős GPS-tesztet. Sikertelen pontsor
   esetén a Codemagic Xcode log és a készülék helyengedély-állapota az első
   bizonyíték, ne módosítsunk vakon.
3. Natív pushhoz kérj döntést: Firebase iOS Messaging (Firebase Console iOS
   app + APNs-kulcs) vagy közvetlen APNs-szállítás. Ezután készülhet a kliens-
   és szerveroldali tokenkezelés.
4. A küldetések tényleges útvonalminőségét külön, Mapbox-válaszokra épített
   mérőcsomaggal optimalizáld; a mostani fallback csak a nulla találatot oldja.

## MODELLJAVASLAT

**Sol, erős** a valódi GPS-életciklus és háttérbeli anomáliák méréséhez.
**Terra, közepes** elég az ezt követő, konkrét webes lifecycle-javításhoz és a
natív push meglévő mintára épülő klienskódjához.

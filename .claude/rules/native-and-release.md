# Natív kód és kiadási rend

## A natív appok EGY repóban élnek

⚠️ Ez NEM csak webes projekt. Ha valaha felmerül, hogy az Android vagy az iOS
külön repóba kerüljön: **nem**. A `src/game/` motor közös a klienssel, a
szerverrel és mindkét platformmal — külön repóban vagy duplikálódna, vagy
submodule kellene, és mindkettő pont azt a garanciát törné meg, hogy az
előnézet és a végleges eredmény bitre azonos.

```
android/app/src/main/java/app/grundo/android/
  BackgroundLocationPlugin.java       Capacitor plugin, engedélykérés
  TrackingLocationService.java        foreground service, élő notification
  TrackingLocationStore.java          állapot SharedPreferences-ben
  TrackingNotificationFormatter.java  táv/idő/sebesség formázás
  MainActivity.java
ios/App/
  App/BackgroundLocationPlugin.swift       a fenti Android plugin párja
  App/GrundoLiveActivityController.swift   Live Activity vezérlés
  GrundoLiveActivity/                      widget extension (zárolt képernyő)
  Shared/GrundoTrackingAttributes.swift    a widget és az app közös típusa
```

## Mielőtt natív kódhoz nyúlsz

- **A háttér-GPS a projekt legkockázatosabb része.** A natív plugin és a
  `src/tracking/` közösen működik: háttérben a natív oldal viszi a távot és az
  időt, előtérben a TypeScript recorder szinkronizál vissza.
- **A natív felület nem tesztelhető emulátor nélkül, sőt gyakran készülék
  nélkül sem.** Ha natív kódot írsz, a kör végén **mondd ki tételesen, mit NEM
  tudtál ellenőrizni** — ne állítsd késznek.
- ⚠️ **Egy kapcsoló elolvasása NEM mérés.** Platform-viselkedésre csak
  készüléken mért bizonyíték számít; forrásból legfeljebb hipotézis lesz.
  Részletek és a konkrét eset: [`lessons.md`](lessons.md).
- Android 12+ alatt teljesen egyedi notification nem készíthető: a rendszer a
  saját app-fejlécét és kibontó vezérlőjét kötelezően hozzáadja. Az iOS Live
  Activity adatai és hierarchiája átvihető, a pixelpontos külső nem.
- A natív oldal változásához `npx cap sync` kell, a build a Codemagicben fut
  (`docs/07-ios-testflight-codemagic.md`, `docs/08-android-codemagic.md`).

## Kiadási csatornák

- A **webapp a gyors fejlesztői és funkcionális tesztcsatorna.** A kis,
  iteratív frontend-változásokat itt ellenőrizd először.
- A **TestFlight (iOS) és a Codemagic Android Release mérföldkő-csatorna**: ne
  készüljön minden apró commitból IPA vagy APK. Érdemi funkciócsomag után,
  valamint minden **platform-specifikus** változásnál (auth, GPS, engedély,
  értesítés, térkép, safe area, háttér) kötelező a készülékes ellenőrzés.
- Egy iOS és egy Android build is a `main` egy konkrét commitjából készül. A
  Beállítások → Alkalmazás részen a `vX · csatorna/build · rövid commit` jelből
  ellenőrizhető, hol pontosan mi fut.
- A backend külön települ, ezért a változásait a már telepített webes, iOS és
  Android kliensekkel **visszafelé kompatibilisen** kell kiadni.

## Amit a két platformon KÜLÖN kell ellenőrizni

Mert a megvalósítás is külön:

- háttér-GPS;
- értesítés / zárolt képernyős élő mérés (iOS Live Activity ↔ Android
  foreground notification);
- engedélykérés (iOS: helyhasználat; Android 13+: `POST_NOTIFICATIONS` is);
- a gyártói akkumulátorkezelés (Samsung/Xiaomi/Huawei) hatása hosszú
  rögzítésre.

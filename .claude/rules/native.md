---
description: Natív Android/iOS és a háttér-GPS szabályai
paths:
  - "android/**"
  - "ios/**"
  - "src/tracking/**"
  - "capacitor.config.*"
---

# Natív kód (Android/iOS) és háttér-GPS

⚠️ **A natív appok EGY repóban élnek.** Ha valaha felmerül, hogy az Android
vagy az iOS külön repóba kerüljön: **nem.** A `src/game/` motor közös a
klienssel, a szerverrel és mindkét platformmal — külön repóban duplikálódna
vagy submodule kellene, és mindkettő megtörné a „bitre azonos eredmény"
garanciát.

- **A háttér-GPS a projekt legkockázatosabb része.** A natív plugin és a
  `src/tracking/` közösen működik: háttérben a natív oldal viszi a távot és az
  időt, előtérben a TypeScript recorder szinkronizál vissza.
- ⚠️ **Egy kapcsoló elolvasása NEM mérés.** Platform-viselkedésre csak
  készüléken mért bizonyíték számít; forrásból legfeljebb hipotézis lesz. Ha
  nincs mód mérésre, mondd ki, hogy a javítás feltételezésen áll — és azt a
  változatot válaszd, ami **hibás feltevés mellett is működik**. (A hangnémulás
  esete egy teljes build-ciklusba került; részletek: `/grundo-lessons`.)
- **A natív felület nem tesztelhető emulátor nélkül, gyakran készülék nélkül
  sem.** Ha natív kódot írsz, a kör végén **sorold fel tételesen, mit NEM
  tudtál ellenőrizni** — ne állítsd késznek.
- Android 12+ alatt teljesen egyedi notification nem készíthető: a rendszer a
  saját app-fejlécét és kibontó vezérlőjét kötelezően hozzáadja. Az iOS Live
  Activity adatai és hierarchiája átvihető, a pixelpontos külső nem.
- A natív oldal változásához **`npx cap sync`** kell, a build a Codemagicben fut
  (`docs/07-ios-testflight-codemagic.md`, `docs/08-android-codemagic.md`).

## Fájlok

```
android/app/src/main/java/app/grundo/android/
  BackgroundLocationPlugin.java  TrackingLocationService.java
  TrackingLocationStore.java     TrackingNotificationFormatter.java
ios/App/
  App/BackgroundLocationPlugin.swift       App/GrundoLiveActivityController.swift
  GrundoLiveActivity/ (widget extension)   Shared/GrundoTrackingAttributes.swift
```

## A két platformon KÜLÖN ellenőrizendő

Mert a megvalósítás is külön: háttér-GPS · értesítés / zárolt képernyős élő
mérés (iOS Live Activity ↔ Android foreground notification) · engedélykérés
(iOS: helyhasználat; Android 13+: `POST_NOTIFICATIONS` is) · a gyártói
akkumulátorkezelés (Samsung/Xiaomi/Huawei) hatása hosszú rögzítésre.

A kiadási rend (mikor készül IPA/APK) a `/grundo-deploy` skillben van.

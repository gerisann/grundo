# Jelenlegi állapot

> Frissítve: **2026-09-05** · Menetszám: **#42 javaslat**, nem megerősített
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **main** · HEAD: **8d12869**
> Utoljára dolgozott: **Codex (GPT-6; pontos modellváltozat/erősség nem igazolt)**
> Átadva: **Claude**

## Jelenlegi cél

**Kész:** helyi Windows debug APK → külön telepített app → Game Loop scenario 2
sikeres futtatása a fizikai Samsungon. A következő feladatot Geri adja meg;
az elkészült folyamatot ne indítsd újra automatikusan.

## Elkészült

- SDK: `C:\Users\Geri\AppData\Local\Android\Sdk`; Java: Temurin 21.0.12,
  `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot`.
- Készülék: **RF8R11T8KXE**, Samsung **SM-G780F**, Android 13.
- A debug package **app.grundo.android.debug**, versionCode **1**,
  versionName **1.0.0-debug**; az APK-ból `aapt`-tal ellenőrizve.
- Az éles **app.grundo.android** változatlanul telepítve: versionCode **28**,
  lastUpdateTime **2026-09-05 14:09:27**. Nem töröltük vagy írtuk felül.
- Scenario **2 / scenario-25km-fast / 100×** eredmény: **236206 ms**,
  **26544 m**, **17 hurok**, **14799 cella**, **496 GP**, `error: null`,
  `host: native`. A JS eredményt írt a logcatba, majd az Activity bezárult.

## Windows buildhiba: mért tények és korlátok

- A hibás `android/app/build/intermediates/incremental/packageDebug/tmp`
  alatt a `debug` és `debug/zip-cache` könyvtár **ReadOnly** attribútumú volt.
- A Microsoft Sysinternals Handle a célútvonalra nem talált nyitott fogantyút.
  Egy szélesebb handle-keresés elakadt; csak ezt a saját segédfolyamatot állítottuk le.
- A Gradle daemon (PID **26232**) szabályosan leállt a `--stop` paranccsal.
  Ezután az üres `zip-cache` Win32 törlési próbája **5 / Access denied** hibát adott.
- Csak az érintett `tmp` könyvtárfán vettük le a ReadOnly attribútumot.
  A következő Gradle build maga kitakarította a cache-t: **BUILD SUCCESSFUL, 37 s**.
  Forráskódot, globális Gradle cache-t, teljes buildfát nem töröltünk.
- A ReadOnly attribútum a build után visszatért. A Gradle naplóban `desktop.ini`
  létrehozások látszanak. A Google Drive naplója igazolja a repo és `.git/objects`
  szinkronizálását, de **az attribútumot beállító folyamat nincs bizonyítva**.
  Ne nevezd bizonyított Java-fájlzárnak vagy Google Drive-hibának.

## Build, telepítés, indítás (PowerShell, repo gyökér)

A korábbi `npm run build:gameloop` és `npx cap sync android` kimenetét használtuk;
ezeket ebben a körben nem futtattuk újra. A csomagolt webes revision **6091d5d**,
a natív package-beállítás már **8d12869**. A riport `channel: web` mezője
nem jelenti, hogy böngészőben futott: `platform: android`, `native: true`.

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot'
$adb='C:\Users\Geri\AppData\Local\Android\Sdk\platform-tools\adb.exe'
.\android\gradlew.bat -p android --stop
.\android\gradlew.bat -p android :app:assembleDebug --no-daemon --no-watch-fs
& $adb -s RF8R11T8KXE install -r android/app/build/outputs/apk/debug/app-debug.apk
& $adb -s RF8R11T8KXE shell pm list packages --user 0 app.grundo.android
& $adb -s RF8R11T8KXE shell am start --user 0 -W -n app.grundo.android.debug/app.grundo.android.GameLoopActivity -a com.google.intent.action.TEST_LOOP -t application/javascript --ei scenario 2
& $adb -s RF8R11T8KXE logcat -d -s GrundoGameLoop
```

## Módosított fájlok és helyi bizonyítékok

- Az alkalmazás forráskódja nem változott; csak ez az átadó, a döntések és a
  Codex tanulságfájl frissült. **Nincs commit vagy push**, ezekre nem volt kérés.
- APK: `android/app/build/outputs/apk/debug/app-debug.apk` (13236832 bájt).
- SHA256: `B6694583CB911168390182D247BC96E9453A59436CDAC41D147D634E991C8E5C`.
- **Csak helyben, gitignore alatt:** `tmp/android-debug-diagnostics/`:
  `scenario-2-result.json`, `scenario-2-logcat.txt`, `scenario-2-runtime.log`,
  `assemble-debug.log`, `release-manifest.log`, diagnosztikai segédeszközök.
  A runtime napló korai pillanatfelvétel; a befejezést a külön Game Loop napló őrzi.

## Élesben fut / telepítetlen, ellenőrzések

- Ebben a körben kizárólag a helyi debug app települt; felhős telepítés nem volt.
- A korábbi #41 átadó szerint a feed javítása éles, a délutáni UI-kör nem települt;
  ezt most nem ellenőriztük újra. A történet az előző CURRENT_STATE git-változatában.
- A `:app:processReleaseMainManifest` sikeres. Az összeállított release manifestben
  nincs `GameLoopActivity`, `TEST_LOOP` vagy `com.google.test.loops`; a Java osztály
  kizárólag `src/debug` alatt van. Release APK-t ebben a körben nem építettünk.
- Nem futott felhős Firebase Test Lab teszt, logFile URI-s eredményírás, scenario 1/3,
  release build/telepítés vagy új teljes tesztkészlet. A helyi scenario 2 bizonyított.

## Nyitott ügyek / tanulság

- Hiányzik a natív Firebase alapkonfiguráció: App Check és Authentication plugin
  betöltési hibák vannak. A sikeres sandbox Game Loopot nem akadályozták; nem javítottuk.
- A ReadOnly attribútum visszaállításának forrása további mérést igényel, ha ismét előjön.
- A `pm list packages` Samsung-profilhibát adott user 150-re; a `--user 0` működött.
- A DOM-ban kiolvasott „SZÜNET” szöveget tévesen megállásnak értelmeztem. Ez nem
  igazolt szüneteltetés; a futás önállóan befejeződött. Ne induljon erre hibajavítás.

## Modelljavaslat

Astra / high az ismeretlen Windows-attribútumhiba további méréséhez;
a már sikeres scenario 2 ismétléséhez Terra / medium elegendő a projektajánlás szerint.

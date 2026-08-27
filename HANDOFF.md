# GRUNDO handoff

> Frissítve: **2026-08-27** · átadás Claude-nak az Android Google-belépés után
>
> Repo: `C:\Users\Geri\Documents\ChatGPT\GRUNDO` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · implementációs HEAD: **`5b81a83`**
> (`Natív Android Google-belépés`) · Geri a push-t visszaigazolta

## ÁLLAPOT

- Elkészült a Capacitor 8.5 natív Android app `app.grundo.android`
  application ID-val és külön Codemagic **GRUNDO Android Release** workflow-val.
- A workflow a Codemagic Individual csomag `mac_mini_m2` gépén készít upload
  key-jel aláírt APK-t és AAB-t. A Gradle wrapper végrehajtható joga javítva.
- A Firebase Android app, a Codemagic keystore (`grundo_android_upload`) és a
  `grundo_android` environment group be van állítva. A
  `GOOGLE_SERVICES_JSON_BASE64` Secret az SHA-1 felvétele után letöltött, friss
  Firebase-konfigurációt tartalmazza.
- Elkészült az Android natív Google-belépés és Google-fiók-összekapcsolás.
  A `@capacitor-firebase/authentication` Credential Manager fiókválasztója ID
  tokent ad, amelyből a meglévő Firebase JS auth-réteg credentialt készít.
  A webes popup változatlan; iOS-en a Google-belépés továbbra sincs engedélyezve.
- A Codemagic build a Gradle előtt ellenőrzi, hogy a Firebase JSON az
  `app.grundo.android` apphoz tartozik, és Android- valamint webes OAuth-klienst
  is tartalmaz.
- A Firebase JSON és a JKS nincs Gitben. A részletes üzemeltetési leírás:
  `docs/08-android-codemagic.md`.

## ÉLESBEN FUT / TELEPÍTVE

- A backend `grundo-api-00090-6wg` revisionje engedi az Android Capacitor
  `https://localhost` originjét. Az e-mail/jelszavas belépés és a profil
  betöltése az Android appban működik.
- A `5b81a83` commit a GitHub `main` ágra pusholva van.
- Geri visszajelzése alapján az új Codemagic buildből származó APK-t már
  telepítette a telefonjára a korábbi verzió fölé.
- Az Androidhoz szükséges backend telepítése korábban megtörtént; ehhez a
  Google-auth commithez nem kell új backend-, Firestore-szabály- vagy
  indextelepítés.

## TELEPÍTETLEN / MÉG NEM ELLENŐRZÖTT

- A natív Google-belépés készülékes eredményéről még nincs visszaigazolás.
- A már létező e-mail/jelszavas fiók Google-fiókkal való összekapcsolása sincs
  még készüléken visszaigazolva.
- A Google Play Console és Play App Signing beállítása szándékosan későbbre
  maradt; az AAB még nincs Play Áruházba feltöltve.
- Windows alatt az iOS Swift Package Manager auth-plugin symlink létrehozása
  `EPERM` hibával kimaradt. A macOS Codemagic `npx cap sync ios` lépésének kell
  létrehoznia; a következő iOS mérföldkő-buildben ezt ellenőrizni kell.

## ELLENŐRZÉSEK

- `npm run typecheck`: sikeres.
- `npm run build`: sikeres TypeScript + Vite production build.
- `npm run test`: **532 sikeres**, 122 emulátoros teszt kihagyva.
- `npx cap sync android`: sikeres, 4 Android Capacitor plugin felismerve.
- Gradle `lintRelease`, `assembleRelease`, `bundleRelease`: **BUILD SUCCESSFUL**
  az új Firebase Authentication modullal.
- `codemagic.yaml`: YAML lint sikeres.
- Production dependency audit: 0 high/critical, 2 moderate React Router
  jelzés. A felkínált javítás törő 7-es főverzióra váltana, ezért `--force`
  javítás nem futott.

## KÖVETKEZŐ MENET — CLAUDE ELSŐ FELADATA

1. Valódi Android készüléken kijelentkezés után indítsa el a **Belépés
   Google-fiókkal** folyamatot, válasszon fiókot, és ellenőrizze a profil
   betöltését.
2. Külön ellenőrizze egy meglévő e-mail/jelszavas felhasználó Google-fiókkal
   való összekapcsolását.
3. Ha hiba van, kérje el a pontos magyar felületi üzenetet és a Codemagic build
   commitját/buildszámát; ne találgasson. Auth/signing hibánál Android logcat
   szükséges.
4. Ha mindkettő működik, rögzítse az eredményt ebben a fájlban. Ezután lehet
   visszatérni a félretett Google Play Console/App Signing folyamathoz.

## GOOGLE PLAY KÉSŐBBI KÖTELEZŐ LÉPÉSE

Play App Signing bekapcsolása után a Play által adott **app signing
certificate SHA-1** ujjlenyomatot is hozzá kell adni a Firebase Android apphoz,
majd újra le kell tölteni és a Codemagic Secretben frissíteni kell a
`google-services.json` fájlt. Enélkül a Codemagic APK működhet, miközben a
Playből telepített app Google-belépése elbukik.

## NYITOTT KISEBB ÜGYEK

- Android 13+ készüléken pontos/helymegtagadott engedélyág, lezárt kijelzős
  3+ perces út, appváltás, szünet/folytatás, offline pontsor és FCM.
- Samsung/Xiaomi/Huawei OEM akkumulátorkezelés terepi ellenőrzése.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

- Egyszerű készülékes Google-auth ellenőrzéshez: **Sonnet, normál mélység**.
- Natív auth-, Gradle-, signing- vagy iOS SPM-hibához: **Opus, emelt mélység**.

## FORRÁSOK SORRENDJE

1. `AGENTS.md`
2. `HANDOFF.md`
3. `docs/08-android-codemagic.md`
4. `docs/README.md` és a kapcsolódó funkcionális/architektúra dokumentumok

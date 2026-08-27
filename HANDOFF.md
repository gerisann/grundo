# GRUNDO handoff

> Frissítve: **2026-08-27** · Android natív Google-belépés
>
> Repo: `C:\Users\Geri\Documents\ChatGPT\GRUNDO` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · kiinduló HEAD: `2a97641` · az új commitot lásd: `git log -1`

## Állapot

- A natív Android projekt és a Codemagic **GRUNDO Android Release** workflow
  működik az Individual csomag `mac_mini_m2` gépén. A `2a97641` commitból
  aláírt APK és AAB készült; az APK telepítve lett valódi készülékre.
- Az Android Capacitor `https://localhost` originjét engedő backend élesben fut
  a `grundo-api-00090-6wg` revisionön. Az e-mail/jelszavas belépés és a profil
  betöltése az APK-ban működik.
- A Firebase Android appban szerepel a Codemagic upload certificate SHA-1
  ujjlenyomata. Az új `google-services.json` Android és web OAuth-klienst is
  tartalmaz; base64 értéke a Codemagic `grundo_android` csoport
  `GOOGLE_SERVICES_JSON_BASE64` Secret változójában van.
- Elkészült az Android natív Google-belépés és Google-fiók-összekapcsolás.
  A Credential Manager natív fiókválasztója ID tokent ad, amelyből a közös
  Firebase JS auth-réteg credentialt készít. A webes popup és az iOS jelenlegi
  viselkedése változatlan.
- A Codemagic a Gradle előtt ellenőrzi, hogy a Firebase JSON a
  `app.grundo.android` apphoz tartozik, és tartalmazza mindkét szükséges OAuth
  klienst.
- A Firebase-konfiguráció és a keystore továbbra sincs Gitben.

## Ellenőrzött állapot

- `npm run typecheck`: sikeres.
- `npm run build`: sikeres TypeScript + Vite production build.
- `npm run test`: **532 sikeres**, 122 emulátoros teszt kihagyva.
- `npx cap sync android`: sikeres; 4 Android Capacitor plugin felismerve.
- Gradle `lintRelease`, `assembleRelease`, `bundleRelease`: **BUILD SUCCESSFUL**
  az új Firebase Authentication modullal. A Windows által zárolt régi
  build-mappát külön ideiglenes Gradle-kimenettel kerültük meg; ez nem
  forráskód- vagy Codemagic-hiba.
- `codemagic.yaml`: YAML lint sikeres.
- Production dependency audit: 0 high/critical, 2 moderate React Router
  jelzés. A felkínált javítás törő 7-es főverzióra váltana, ezért automatikus
  `--force` javítás nem futott.
- A Windows nem tudta létrehozni az iOS Swift Package Manager plugin-symlinket
  (`EPERM`). A macOS Codemagic `npx cap sync ios` lépése hozza majd létre; a
  következő iOS mérföldkő-buildben ezt külön ellenőrizni kell.

## Következő kézi lépések

1. Push a GitHub `main` ágra.
2. Codemagicben új **GRUNDO Android Release** build a friss `main` commitból.
3. Az új APK letöltése és telepítése a meglévő verzió fölé.
4. Kijelentkezés után Google-belépés: fiókválasztás, majd profilbetöltés.
5. E-mail/jelszavas fiókkal a Google-fiók összekapcsolásának ellenőrzése is.

Ehhez a változáshoz nem kell backend-, szabály- vagy indextelepítés.

## Google Play későbbi kötelező lépése

Play App Signing bekapcsolása után a Play által adott **app signing
certificate SHA-1** ujjlenyomatot is hozzá kell adni a Firebase Android apphoz,
majd újra le kell tölteni és a Codemagic Secretben frissíteni kell a
`google-services.json` fájlt. A Playből telepített app különben nem tud majd
Google-fiókkal belépni.

## Nyitott készülékes ellenőrzések

- Natív Google-belépés és már létező fiók összekapcsolása az új APK-ban.
- Valódi Android 13+ készüléken pontos/helymegtagadott engedélyág, lezárt
  kijelzős 3+ perces út, appváltás, szünet/folytatás, offline pontsor és FCM.
- Samsung/Xiaomi/Huawei OEM akkumulátorkezelés terepi ellenőrzése.

## Következő session modellje

- Codemagic build és egyszerű készülékes ellenőrzés: **GPT-5.6 Terra, high**.
- Natív auth-, Gradle-, signing- vagy iOS SPM-hiba esetén:
  **GPT-5.6 Sol, high/xhigh**.

## Források sorrendje

1. `AGENTS.md`
2. `HANDOFF.md`
3. `docs/08-android-codemagic.md`
4. `docs/README.md` és a kapcsolódó funkcionális/architektúra dokumentumok

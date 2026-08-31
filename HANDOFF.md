# GRUNDO handoff

> Frissítve: **2026-08-31** · a **#25** beszélgetés vége, átadás **#26**-ra
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`**. A menet induló HEAD-je **`61153e6`**; az új biztonsági
> csomag ezt a `HANDOFF.md`-t tartalmazó következő commit.

## ÁLLAPOT

Az audit következő biztonsági csomagja elkészült: függőségfrissítés,
Firebase App Check, szerveroldali rate limit és az OTP-versenyhelyzetek
lezárása. A rollout szándékosan **observe-first**; az enforcementet a web,
Android és iOS valós tokenmérése előtt nem szabad bekapcsolni.

### Függőségek és audit

- Frontend/runtime: Firebase **12.18.0**, React Router **7.18.3**; build/test:
  Vite **8.2.2**, Vitest **4.1.11**.
- Natív Firebase pluginek: Authentication és Messaging **8.5.0**, új App
  Check **8.5.0**.
- Backend: Firebase Admin **14.3.0**, Nodemailer **9.1.0**, Vitest **4.1.11**.
- A root production audit **2 közepesről 0-ra** csökkent. A teljes root audit
  **3 közepes** fejlesztői jelzést hagyott az `@capacitor/cli → xcode → uuid`
  ágban; a felajánlott `--force` visszalépés lenne, ezért nem alkalmaztuk.
- A server audit korábbi kritikus/magas jelzései megszűntek. **6 közepes**
  production jelzés maradt a legfrissebb `firebase-admin →
  @google-cloud/storage → uuid` tranzitív ágán; nincs biztonságos npm-fix,
  a `--force` Firebase Admin 10.3-ra léptetne vissza.

### App Check

- Weben reCAPTCHA Enterprise, Androidon Play Integrity, iOS 14+-on App
  Attest (iOS 13-on a plugin DeviceCheck fallbackot ad).
- A natív token `CustomProvider` hídon a Firebase JS SDK-hoz is eljut, így a
  Cloud Run fejléc és később a közvetlen Firestore/Storage kérés is ugyanazt
  az attesztációt használhatja.
- A backend `off | observe | enforce` módban működik. A Cloud Scheduler
  `/api/jobs` ág továbbra is a saját `X-Job-Token` hitelesítését használja.
- A Cloud Build alapértéke `observe`; a CORS engedi az
  `X-Firebase-AppCheck` fejlécet. A Codemagic iOS ellenőrzés a szinkronizált
  App Check SPM-csomagot és az App Attest entitlementet is megköveteli.
- Az iOS helyi `cap sync` Windows alatt a szükséges SPM-symlink létrehozásán
  `EPERM` hibával megállt. A Codemagic macOS-en teljes `cap sync ios`-t futtat,
  majd explicit ellenőrzi az eredményt; az első új TestFlight build ezt még
  igazolja.

### Rate limit és OTP

- A limit közös, Firestore-tranzakciós számláló, ezért Cloud Run példányok
  között sem kerülhető meg. A dokumentumkulcs HMAC, nyers e-mail,
  felhasználónév vagy UID nem kerül a `rateLimits` kollekcióba.
- Külön keret van a belépésre, belépési mód lekérdezésére, OTP küldésre és
  ellenőrzésre, aktivitásfeltöltésre, küldetéstervezésre, időjárásra,
  területcsempére és az egyéb írásokra. Az olcsó normál GET-ek nem kapnak
  külön Firestore-tranzakciót.
- `observe` módban csak mér és ritkított strukturált naplót ír; `enforce`
  módban 429 + `Retry-After`, tárolóhiba vagy hiányzó HMAC-kulcs esetén 503.
- Az OTP küldés és ellenőrzés most tranzakciós, ezért párhuzamos kéréssel nem
  kerülhető meg sem az újraküldési idő, sem a próbálkozásszám.

### Ellenőrzések

- mindkét `npm ci`: sikeres;
- teljes normál teszt: **592 sikeres, 129 emulátoros kihagyva**;
- App Check/rate limit célzott teszt: **12/12 zöld**;
- teljes emulátoros készlet: **129/129 zöld**;
- kliens typecheck + Vite production build: zöld, **304 modul**;
- szerver typecheck + production build: zöld;
- `npx cap sync android`: sikeres, mind a négy plugin felismerve;
- Android release unit teszt + `lintRelease`: sikeres, új lint-hiba nincs;
- Cloud Build és Codemagic YAML: parser/lint szerint érvényes;
- entitlement XML és mindkét package JSON/lock: parser szerint érvényes;
- `git diff --check`: tiszta.

## ÉLESBEN FUT / TELEPÍTETLEN

- Az előző adatvédelmi kiadás változatlanul éles: backend/frontend kód
  `605736f`, Cloud Run `grundo-api-00110-94c`, szabályok és fotómigráció kész.
- Az iOS háttér-GPS javítás a **TestFlight #27** buildben van, forrása
  `6da0288`; a hosszú készülékes regresszió még hátravan.
- Az Android háttér-GPS javítás a Google Play belső tesztsáv **#14** buildjében
  van, forrása `57f4d5a`; a hosszú készülékes regresszió még hátravan.
- A mostani App Check/rate limit/dependency csomag **nincs telepítve**.
- Nincs kötelező adatmigráció és nincs új index. A `rateLimits.expiresAt`
  Firestore TTL később opcionálisan bekapcsolható.

## KÖVETKEZŐ MENET

1. **Cloud Shell:** létre kell hozni a `RATE_LIMIT_HMAC_KEY` titkot, hozzáadni
   a Cloud Run service account Secret Manager hozzáférését és a
   `roles/firebaseappcheck.tokenVerifier` szerepet. A pontos, egysoros
   parancsok a `docs/06-architektura-es-admin.md` App Check rollout részében
   vannak.
2. **Firebase/Google Cloud Console:** regisztrálni kell a webes reCAPTCHA
   Enterprise, Android Play Integrity és iOS App Attest providereket. A webes
   publikus Key ID-t ezután kell beírni a `VITE_RECAPTCHA_SITE_KEY` értékébe;
   jelenleg szándékosan üres, mert külső kulcsot nem találunk ki.
3. Ezután sorrendben: push → **szabályok** → **backend** (`observe`) →
   **frontend** → Android belső build → iOS TestFlight build. **Indexek** és
   adatbázis-migráció nem kellenek.
4. Mindhárom kliensen ellenőrizni kell a Cloud Run/Firebase App Check
   metrikákat, a 401/429/503 arányt, a normál belépést, OTP-t, aktivitásmentést,
   csempét és időjárást. A natív `CustomProvider` híd csak valódi készülékes
   tokennel tekinthető igazoltnak.
5. Csak igazolt lefedettség után válthat `_APP_CHECK_MODE=enforce` és
   `_RATE_LIMIT_MODE=enforce` értékre; a Firestore/Storage konzolos
   enforcement ennél is későbbi, külön lépés.
6. A korábban előírt 90 perces / 20 km-es iOS és Android háttér-GPS terepteszt
   továbbra is nyitott, és az új natív buildben egyben App Check smoke teszt is.

## NYITOTT KISEBB ÜGYEK

- A frontend production Mapbox chunk **1,824 MB**, a Firebase chunk **630 kB**;
  ez meglévő teljesítmény-karbantartási feladat.
- A hat megmaradt backend auditjelzés tranzitív `firebase-admin` függőség;
  upstream frissítést kell figyelni, `--force` downgrade nem elfogadható.
- A Codemagic Google Play ellenőrző parancsában a régi
  `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` név később megszűnik; külön
  üzemeltetési menetben kell átnevezni.
- `emulator-5562 offline` továbbra is látszott Geri gépén; ez a Gradle
  unit/lint ellenőrzést nem akadályozta, de UI-életciklustesztet nem adott.

## 0. MODELLJAVASLAT a folytatáshoz

Az App Check éles konzolkonfigurációjához és a háromplatformos observe →
enforce kiértékeléshez **GPT-5.6 Sol, erős gondolkodási mélység** indokolt,
mert hibás sorrenddel a régi kliensek vagy a közvetlen Firestore/Storage
kérések kizárhatók.

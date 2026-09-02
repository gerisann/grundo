# GRUNDO handoff

> Frissítve: **2026-09-02** · a **#23** beszélgetés vége, átadás **#24**-re
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · HEAD **`4aedbff`** · pusholva, munkamásolat tiszta
>
> Tesztek: **626 zöld**, gyökér és `server/` typecheck tiszta (mérve `fb72645`-nél;
> a `4aedbff` csak ezt a fájlt érintette)

---

## ⚠️ A #24 ELSŐ DOLGA: natív Google-belépés

Geri a #23 legvégén jelezte: **a Google-fiókkal belépés egyik natív appon sem
működik, a webappban tökéletesen megy.** A vizsgálat elindult, de NEM fejeződött
be. Két külön dologról van szó:

### iOS — ez NEM hiba, szándékos

A [`src/hooks/AuthProvider.tsx`](src/hooks/AuthProvider.tsx) `signInWithGoogle()`
és `linkGoogle()` metódusa iOS-en kifejezetten dob:

> „A Google-belépés az iOS alkalmazás első verziójában még nem érhető el.
> Lépj be e-mail-címmel és jelszóval."

Ez a #26-os audit óta nyitott döntés maradványa: az Apple App Store **4.8-as
szabálya** miatt Google-belépés mellé kell Sign in with Apple (vagy egyenértékű),
és ezt még nem építettük meg. **Két út van, dönteni kell:**
(a) Sign in with Apple bevezetése, és a Google-belépés kinyitása iOS-en,
(b) a Google-belépés végleges elhagyása iOS-en, tisztább üzenettel.

### Android — VALÓS hiba, a gyanú nincs igazolva

A kód az Android **Credential Manager** API-t használja
(`nativeGoogleCredential()`, `useCredentialManager: true`). Ez a natív folyamat
az app **aláíró tanúsítványát** ellenőrzi a Firebase-projektben regisztrált
ujjlenyomatok ellen — a webes OAuth-popup viszont nem, ezért működik a webapp
érintetlenül.

⚠️ **HIPOTÉZIS, NEM MÉRÉS**: a Firebase-projektben valószínűleg csak a helyi
fejlesztői / feltöltő kulcs SHA-1-e van felvéve, a Play-ről telepített build
viszont a **Play alkalmazás-aláíró kulccsal** van újraaláírva. A két kulcs
különbözik.

**Amit ellenőrizni kell (ebben a sorrendben):**

1. Firebase Console → ⚙️ Project Settings → General → „Your apps" → GRUNDO
   Android → milyen **SHA-1** ujjlenyomatok vannak felvéve
2. Play Console → az aláírókulcs **SHA-1**-e (a megtalálásához lásd lent az
   „Üzemeltetési jegyzetek" szakaszt — ez nem triviális)
3. Ha hiányzik: felvenni a Firebase-projektbe
4. ⚠️ **ÉS EZ A LÉPÉS KÖNNYEN KIMARAD:** az SHA felvétele megváltoztatja a
   `google-services.json` tartalmát, a Codemagic build viszont egy **statikus,
   base64-kódolt titokból** írja ki (`GOOGLE_SERVICES_JSON_BASE64`, a
   `grundo_android` változócsoportban). A Firebase-es hozzáadás önmagában
   **nem lép érvénybe** — le kell tölteni a friss `google-services.json`-t,
   base64-be kódolni, és frissíteni a Codemagicban.

A tényleges hibaüzenetet (Android logcat / a felületen látott szöveg) **nem
láttuk** — ez a leggyorsabb út a megerősítéshez vagy a hipotézis elvetéséhez.

---

## ÁLLAPOT — mi készült el a #23-ban

Két nagy blokk: a délutáni terepteszt audio-vizuális felkészítése, és a
rögzítés-modell átnézéséből származó javítások. Minden élőben ellenőrizve a
helyi emulátoros környezetben (`localhost:5173` + Firestore/Auth emulátor +
backend) és a LAB E2E-ben 1×, 10×, 100×, MAX sebességen.

### Hangeffektek (ÚJ)

Hét MP3 a `public/sounds/` alatt, lejátszó a `lib/sound.ts`-ben (`<audio>`-elem
poolok, hangonkénti alaperősítés, felhasználói gesztusból feloldott hangzár).

| Esemény | Hang |
|---|---|
| Visszaszámlálás — a 3, a 2 és az 1 megjelenésekor | `count-down-beep` |
| „RAJT!" felirattal egyszerre | `count-down-start` |
| Új mezőre lépés — szabad | `cell-captured` |
| Új mezőre lépés — saját, védelem még emelhető | `cell-defend` |
| Új mezőre lépés — saját, MÁR 5-ös szinten | `cell-max` |
| Új mezőre lépés — riválisé | `cell-stolen` |
| Hurokbezárás | `loop-closed` |

⚠️ **A cellahangok VALÓS IDEJŰEK, nem a bezáráshoz tartoznak.** Ezt Geri
kétszer is pontosította: a hang akkor szól, amikor a futó ténylegesen rálép egy
új mezőre, és azt mondja meg, MIRE lépett rá — nem azt, hogy a bezárás végül mit
írt jóvá. A tanulság általánosabb: visszajelzésnél azt kell kérdezni, mikor
VESZI ÉSZRE a felhasználó a dolgot, nem azt, mikor történik meg az adatmodellben.

Mérve, 1×-es LAB-futáson: 15 koppanás 35 másodperc alatt, átlag 2,5
másodpercenként. A `CELL_STEP_BURST_CAP = 5` csak a natív ébredés /
visszaállítás okozta kötegeket fogja meg.

A `cell-max` szabályát Geri utólag megerősítette: **saját mező, ami MÁR 5-ös
védettségen áll**, tehát nem emelhető tovább.

Beállítás: **Beállítások → Hangok** (ÚJ oldal) — fő kapcsoló, hangerő-csúszka,
három csatorna külön kapcsolóval, hangonként meghallgatás-gomb (ez oldja fel a
böngésző hangzárját is). `localStorage`-ban, eszközhöz kötve.

### Területszerzés-üzenet konfettivel (ÚJ)

Hurokbezáráskor felugró kártya: **„Grund megszerezve!"** / **„Grund
elfoglalva!"** (ha bármit elvettél valakitől — a lopás az erősebb hír) /
**„Grund megerősítve!"** (a kérésben nem szerepelt, de a játék előállítja).
Alatta terület + cellaszám a `formatArea()`-n át. Öt másodperc, ✕-szel
bezárható. Mögötte konfetti + két tűzijáték-robbanás, tiszta CSS-ből.

Kapcsoló: **Beállítások → Megjelenés → Rögzítés közben**.

⚠️ **A hamis riasztás elleni védelem a lényeg** (`lib/captureEvents.ts`): az élő
előnézet minden `/api/tiles` válaszra is újrafut, és olyankor egy cella sorsa
visszamenőleg megváltozhat. Ezért az esemény kapuja a **bezárások száma**, nem
az állapotkülönbség — enélkül egy hálózati válasz hangot és konfettit szórna a
semmiért. Tesztekkel rögzítve.

### Saját cellaszínek a rögzítés képernyőn

Az élő előnézet mezői viszik az `owner`-t, és az `ownerColors` táblába bekerül a
saját profil színe is (a `/api/tiles` csak azokat adja vissza, akiknek a látott
szakaszon már VAN cellájuk). A nyomvonal cellái vastagabb körvonalat és sűrűbb
kitöltést kaptak, a nyomvonal vonala alá kontrasztos szegély került — enélkül
azonos színű saját területen a vonal beleolvadt a birtokba.

### `/admin` teljes szélesség · LAB E2E paritás · toplista

- Az `app-shell` 480 px-es mobil oszlopa `/admin` alatt megszűnik. A rögzítés
  képernyője KIVÉTEL marad, tehát a LAB E2E telefonos elrendezésben mutat.
- A LAB sandbox `/api/tiles` válasza ad `ownerColors`-t; a tile-bridge
  mostantól a `territoryBlobs`-ot is átveszi (előtte az ÉLES világ
  birtokviszonya rajzolódott a sandbox cellái alá, valódi felhasználók
  adatával).
- Terület-toplista: a dobogó együtt görög a listával, fixen csak a fejléc és a
  napi/heti/havi/mindenkori fülsor marad.

### Mért hibák és javítások

A hangsúly a MÉRÉSEN van — kétszer is megdőlt az első hipotézisem.

1. ⚠️ **A hatszögek lemaradtak a valós helyzethez képest** — a menet legnagyobb
   találata. A szabad hatszögrács ugyanabban a GeoJSON-forrásban ült, mint a
   nyomvonal: **13 733 poligon**, ebből 13 700 a rács és 13–33 a nyomvonal, és
   minden ÚJ nyomvonal-cellánál az egész újracsempéződött. A nyomvonal VONALA
   (külön, egyelemű forrás) ezért volt mindig naprakész.
   **Előtte:** panel 33 / forrás 33 / **kirajzolt 12**. **Utána:** 34 / 34 /
   **33**, a cella-forrás 13 733-ról **276**-ra fogyott.
   *(Az első hipotézisem — „a fő szál túlterhelt" — MEGDŐLT: 12 másodperc alatt
   nulla hosszú task.)*
   ⚠️ Ha legközelebb „lemarad a kirajzolás": HÁROM réteget kell szétválasztani —
   az app állapotát, a térképnek ÁTADOTT adatot (`source._data`), és a
   ténylegesen KIRAJZOLTAT (`map.queryRenderedFeatures`).
2. ⚠️ **A LAB tile-bridge bent ragadt a LAB elhagyása után.** A React
   `StrictMode` kétszer hívja meg a `useState` inicializálóját: két híd
   regisztrálódott, de a komponens csak az EGYIK feloldóját tartotta meg. Mérve:
   a LAB-ból a `/grund`-ra navigálva a Grund képernyő a SANDBOX világot mutatta,
   és egyetlen `/api/tiles` kérés sem ment ki. Verem helyett egy-slotos,
   idempotens híd.
3. **Dokk-gombok egyforma szélessége.** Mérve: 177,5 vs 153,5 px. A `flex: 1`
   `flex-basis: 0%`-ot jelent, ami `border-box` mellett a keretdobozt nullázza,
   és a böngésző a bélésre + keretre kerekíti fel — a különbség pontosan a 24 px
   béléskülönbség. Grid `1fr auto 1fr`, kifejtett `justify-items: stretch` (a
   `normal` alapérték `<button>`-nél `start`). Utána: 165,5 = 165,5 px.
4. **`browserSource.ts` — őrkutya a néma `watchPosition`-re.** iOS Safariban a
   figyelés előtérbe visszatérés után némán halott maradhat: se minta, se hiba.
   45 másodperc teljes csend után újraindul (a hiba is életjel). Rejtett lapon
   sosem. Tiszta függvény + hat teszt.
5. **`wakeLock.ts` + `useRecorder.ts` — a képernyőzár állapota élővé vált.**
   Eddig egyszer, a megszerzéskor íródott be, holott a böngésző háttérbe
   kerüléskor elengedi: a felület a futás végéig az első másodperc állapotát
   mutatta.
6. **`nativeSource.ts`** — korlátos, kétgenerációs duplikátumszűrő (eddig sosem
   ürülő halmaz gyűjtötte az aktivitás minden időbélyegét).
7. **`TrackingScreen.tsx`** — 20 bejegyzéses LRU a csempe-gyorsítótáron, és
   hálózati hiba után újra lehet próbálni (a `requestedBox` jelző bent ragadt).
8. **`useRecorder.ts`** — a natív `syncActivity` híd­hívás legfeljebb
   másodpercenként (eddig MINDEN GPS-mintára), de a státuszváltás azonnal megy.
9. **`.gitattributes`** — `*.mp3|m4a|wav|ogg binary`, hogy egy LF-csere ne
   tegye lejátszhatatlanná a hangfájlokat.

---

## ÉLESBEN FUT / TELEPÍTETLEN

### Web — ÉLES

**`fb72645`**, https://grundo.web.app. Telepítés utáni ellenőrzés megtörtént: a
belépő chunk neve megegyezik a helyi buildével, mind a hét hang kiszolgálva
(`audio/mpeg`, a böngésző dekódolta is), az új `grundo-grid` térképforrás benne
van az éles `MapView` chunkban.

### Backend — VÁLTOZATLAN

Nem változott ebben a menetben, nem is települt. Az előző kiadás fut: kód
`605736f`, Cloud Run `grundo-api-00110-94c`. Nincs adatmigráció, nincs új index.

### iOS — build indítva, EREDMÉNY NEM VISSZAIGAZOLT

A TestFlight build először **elhasalt** (`xcode-project build-ipa`, exit 65).

⚠️ **Ok, és ez fontos tanulság:** a `d8de34f` (App Check) hozzáadta a
`com.apple.developer.devicecheck.appattest-environment` entitlementet az
`App.entitlements`-hez, de az App ID-n a Developer Portalon **nem volt
bekapcsolva az App Attest capability**. Az archiválás ezért az entitlements és a
provisioning profil eltérésén bukott el, még mielőtt bármi fordítási hiba lett
volna. Ez volt az ELSŐ iOS archiválás, ami egyáltalán megpróbálta ezt az
entitlementet használni (a legutóbbi sikeres build, `6da0288`, még nem
tartalmazta).

**Amit megcsináltunk:** App Attest capability bekapcsolva az `app.grundo.ios`
App ID-n; a Developer Portalon **Invalid** státuszúvá vált „GRUNDO ios_app_store
1787484102" profil törölve, hogy a Codemagic `fetch-signing-files --create`
frisset generáljon. A „GRUNDO Live Activity" profil érintetlen maradt (érvényes,
2027/08/23).

⚠️ **Apple provisioning profilok NEM frissülnek maguktól, ha egy App ID
capability-je utólag változik** — a régit törölni kell.

**A build újraindult, de az eredményét NEM láttuk.** A #24 első teendői közt
ezt ellenőrizni kell.

### Android — build NEM indult el

A `main` friss HEAD-jét fogja húzni, tehát minden webes újítás benne lesz (a
`npm run build` + `npx cap sync android` viszi a `dist/`-et). A menet **nem
érintett natív Android fájlt**.

---

## App Check — hol tart

| Lépés | Állapot |
|---|---|
| Play Integrity API engedélyezve (Cloud Console) | ✅ már korábban megvolt |
| Android: Play Integrity provider + SHA-256 a Firebase App Checkben | ✅ **a #23-ban megcsinálva** |
| iOS: App Attest provider | ✅ Registered |
| Web: reCAPTCHA Enterprise provider | ✅ Registered |
| `VITE_RECAPTCHA_SITE_KEY` a `.env.production`-ben | ❌ **ÜRES** — a webes Key ID még nincs bekötve |
| Cloud Shell: `RATE_LIMIT_HMAC_KEY` titok + IAM (`firebaseappcheck.tokenVerifier`) | ❓ nem ellenőriztük |
| Backend `observe` telepítés | ❌ nem történt meg |
| `enforce` átkapcsolás | ❌ csak igazolt lefedettség után |

Az Androidhoz a **Play alkalmazás-aláíró kulcs („Klasszikus kulcs") SHA-256**-át
regisztráltuk — nem a feltöltési kulcsét, és nem a posztkvantum kulcsét.

**Metrika még nincs**: a Firebase App Check Metrics csak akkor mutat adatot, ha
egy telepített build ténylegesen küldött App Check tokent. Ez a natív buildek
eszközre telepítése után ellenőrizhető.

---

## KÖVETKEZŐ MENET

**A) A natív Google-belépés** — lásd a fájl elején. Ez a legfrissebb, konkrét,
felhasználót érintő hiba.

**B) Az iOS build eredményének ellenőrzése**, és ha lefutott, a TestFlight
telepítés utáni készülékes próba. Ott két dolog vár igazolásra a #23-ból, amit
csak eszközön lehet:
1. a némító kapcsoló / csengőhang-mód hatása a hangeffektekre iOS-en,
2. hogy a hangzár feloldása (`unlockSounds`) a WKWebView-ban is megtörténik az
   indítógomb koppintására.

**C) A terepteszt visszajelzései.** A hangok üteme, hangereje és a felugró
üzenet hossza csak valódi futás közben ítélhető meg. Hangolópontok:
`lib/cellStepSound.ts` (`CELL_STEP_GAP_MS`, `CELL_STEP_BURST_CAP`),
`lib/sound.ts` (`SOUND_GAIN`), `hooks/useCaptureFeedback.ts`
(`TERRITORY_TOAST_MS`), `components/territoryToast.css`.

**D) App Check éles bevezetése** — a fenti táblázat hiányzó sorai. Sorrend:
szabályok → backend (`observe`) → frontend → Android → iOS, és csak igazolt
lefedettség után `enforce`. Részletek:
`docs/06-architektura-es-admin.md` App Check rollout szakasz.

**E) Kód-jelöltek, változatlanul nyitva a #22 óta:**
1. A gameplay-config runtime snapshot bekötése a tényleges
   aktivitás-feldolgozásba (`activityCommit.ts`, `activityChunked.ts`,
   `trust/score.ts`, 16 hívási hely). Ez élesíti a Trust Score observe-only
   kikapcsolhatóságát és az admin GP-modifiereket egyszerre.
2. `mailer.ts:122-129` fail-closed tétele hiányzó `SMTP_HOST`-ra production
   módban.

---

## NYITOTT KISEBB ÜGYEK

- A rögzítés `applySample`-je minden mintánál ÚJ pontok-tömböt másol
  (`[...state.points, point]`). Egy 3000 pontos aktivitáson ez négyzetes
  jellegű munka és GC-nyomás. **Feltérképezve, nem javítva** — a tiszta
  reducer-szerződés és a React változásfelismerés is ezen áll, tehát mérés
  nélkül nem szabad hozzányúlni. Önálló menetet érdemel, mért előtte-utána
  számokkal.
- A frontend production Mapbox chunk **1,824 MB**, a Firebase chunk **630 kB**.
- A hat backend auditjelzés tranzitív `firebase-admin` függőség.
- A Codemagic Google Play ellenőrző parancsában a régi
  `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` név később megszűnik.
- A 90 perces / 20 km-es iOS és Android háttér-GPS terepteszt továbbra is
  nyitott.

---

## Üzemeltetési jegyzetek

### Hol van a Play Store aláírókulcs SHA-1 / SHA-256?

⚠️ Ezzel a #23-ban sok kört futottunk feleslegesen. A régi „App integrity"
oldal **átköltözött**, és az `Alkalmazásintegritás` menüpont csak egy
átirányítást mutat — körbe. A közvetlen URL (`.../app-signing`) sem működik,
visszadob az applistára. A tényleges útvonal:

**Play Console → GRUNDO app → „A Google Play védi" → a „Google Play
Áruház-védelem" kártya kinyitása a sorvégi ∨ nyíllal → „Alkalmazás-aláíró kulcs
védelme" sor → „A Play alkalmazás-aláírás kezelése" gomb**

Ott az „Alkalmazás-aláíró kulcs" dobozban a **Klasszikus kulcs** SHA-1 és
SHA-256 ujjlenyomata. Amit NE használj: a „Posztkvantum titkosítási kulcs"
értékeit, és a lap alján lévő „Feltöltési kulcs tanúsítványa" ujjlenyomatokat
(az a te feltöltő kulcsod, a Google ettől eltérő kulccsal írja alá újra).

### Helyi teszt-környezet

`localhost:5173` + Firestore/Auth emulátor + backend. Belépés:
`geri@grundo.local` / `grundo-emulator`, vagy a konzolban
`await __grundoDevSignIn()`. A seed-fiók a #23-ban **owner** szerepkört kapott
(`server/src/scripts/setUserRole.ts`), tehát az `/admin` és a Simulation LAB
elérhető — a szerepkör a tokenben ül, szerepkör-változás után ki/be kell
jelentkezni.

**LAB E2E gyorsítás:** a session közvetlenül létrehozható `sessionStorage`-ban
(`grundo.lab.e2e.<id>`), nem kell kézzel útvonalat rajzolni a Scenario LAB-ban.
A hangok ellenőrzéséhez a `HTMLMediaElement.prototype.play` kipatchelhető egy
naplótömbbe — így hang nélkül is látszik, MELYIK hang, MIKOR és milyen
hangerővel szólt.

---

## 0. MODELLJAVASLAT a #24-hez

**Opus, emelt mélység** — ha a natív Google-belépéssel kezdünk (A). Ez mért
anomália hibakeresése, ahol a hipotézisem még nincs igazolva, és két platform
konfigurációja fut össze (Firebase SHA-regisztráció, Play App Signing, Codemagic
statikus titok). A #23 kétszer is megmutatta, hogy a kézenfekvő magyarázat
megdőlhet.

**Sonnet, normál mélység** — ha a terepteszt visszajelzéseinek átvezetése (C)
lesz a téma: ott számhangolások és apró UI-igazítások vannak ismert helyeken.

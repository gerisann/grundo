# GRUNDO handoff

> Frissítve: **2026-09-02** · a **#24** beszélgetés vége, átadás **#25**-re
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · HEAD **`06cf4e5`** · pusholva, munkamásolat tiszta
>
> Élesben: web `06cf4e5` · backend `grundo-api-00111-ldw` · indexek naprakészek
>
> Tesztek: **640 zöld** + **129 emulátoros zöld**, gyökér és `server/` typecheck
> tiszta

---

## TELEPÍTVE — 2026-09-02, mind a három

A #24 munkája **élesben fut**. Adatmigráció nem kellett.

| Lépés | Állapot | Ellenőrzés |
|---|---|---|
| **indexek** | ✅ | `activityCells`, `activityCellParents`, `private/points` mentesítve (üres indexlistával, `gcloud firestore indexes fields describe`); a `modifiers` összetett index `CREATING` állapotban indult |
| **backend** | ✅ | revízió **`grundo-api-00111-ldw`**, `timeoutSeconds=900`, `startup-cpu-boost=true`, `/api/health` → `grundo-db` |
| **frontend** | ✅ | belépő chunk **`index-Cmvc9hgG.js`**, az élesen kiszolgált név megegyezik a helyi buildével; mind a négy `VITE_*` érték benne a bundle-ben; az oldal konzolhiba nélkül tölt |

⚠️ A frontend azért NEM volt elhagyható, mert a `src/game` motor KÖZÖS a
klienssel: a `windingCounts` javítása megváltoztatja a védelmi szintek
számítását. Csak backend-frissítéssel a rögzítés közbeni élő előnézet mást
mutatott volna, mint amit a mentés jóváír.

**Ami még hátravan ehhez a menethez:** a natív buildek (Codemagic, iOS +
Android) a `06cf4e5`-ből. A menet natív fájlt nem érintett, de a `dist/`
igen — a `npx cap sync` viszi be a motorjavítást és a #23 összes webes
újítását, amit az Android még sosem kapott meg.

---

## ÁLLAPOT — mi készült el a #24-ben

A menet TELJES EGÉSZÉBEN a mentés és a betöltés hibáiról szólt (Geri
döntése a lista átnézése után). A hangok, a dokk Play gombja és a profil
rivális-sávjai szándékosan átcsúsztak — a diagnózisuk viszont lent megvan.

### 1. A 12 órás mentés bukása — MEGTALÁLVA, JAVÍTVA

Az éles kérésnapló szerint 2026-09-01 este **négy próbálkozás, mind 504-es
hiba, mind pontosan 300,00 másodperc után** (`POST /api/activities`, 1,1 MB
törzs). A kliens ebből csak annyit látott, hogy „nincs kapcsolat a
szerverrel" — az `api.ts` a fetch elhalását hálózati hibának fordítja.

Két, egymástól független ok:

**a) Firestore index-plafon.** A `stderr` naplóban:
`INVALID_ARGUMENT: too many index entries for entity /activities/777bbde5-…`,
`reason: INDEX_ENTRIES_COUNT_LIMIT_EXCEEDED`. Az `activityCells` a kör
TELJES elfoglalt területe — Jamal napján **36 012 elem** —, a Firestore
pedig minden tömbelemre KÉT indexbejegyzést készít, dokumentumonként
40 000-es plafonnal. Vagyis **~20 000 cella fölött a mentés soha nem tudott
sikerülni.** Javítás: `fieldOverrides` az `activities.activityCells`, az
`activityCellParents` és a `private/track.points` mezőkre. Ugyanez a
plafon a `blockIndex.blocks`-nál már ki volt védve — ott valaki gondolt rá,
itt nem.

**b) Cloud Run időkorlát.** Az alapértelmezett 300 s. A szerver a 300 s
után is dolgozott (a Firestore-hiba a naplóban a kérés kezdete után ~22
perccel jelent meg), de a kliens addigra elveszítette a kapcsolatot.
Javítás: `--timeout=900` a `cloudbuild.yaml`-ban.

### 2. A mentés lassúsága — MÉRVE, 8,9× GYORSABB

⚠️ **A 22 perc nem a Firestore volt, hanem a CPU.** Fázismérés egy 126 km-es
városi rács-menetre (10 571 pont, 22 hurok, 23 927 cella):

| Fázis | Idő |
|---|---|
| `buildActivityGeometry` (hurokdetektor) | **425 191 ms** |
| `loopCells` összesítés | 31 ms |
| `windingCounts` | 247 ms |
| `resolveLoopClaims` | 388 ms |
| `mergeClaims` | 18 ms |
| `expandCellScope` + `blocksFor` | 434 ms |

Azon belül: a `buildLoopInterior` **430-szor** futott, összesen 87 s-ot
(hívásonként 202 ms). Vagyis nem a hívások SZÁMA volt sok, hanem egy hívás
ára — és a 430 jelölt nagyjából ugyanazon a néhány tízezer cellás területen
dolgozik, újra és újra kiszámolva ugyanazokat a H3-műveleteket.

Három lépés, mindegyik mérve, mindegyik VÁLTOZATLAN eredménnyel:

| Lépés | 126 km-es menet `planActivity` |
|---|---|
| kiinduló állapot | **453 643 ms** |
| `neighbours.ts` — `gridDisk(cell,1)` memoizálva | ~200 000 ms |
| a kitöltés választása arány-alapú (`ADAPTIVE_AREA_PER_WALL_CELL`) | 83 161 ms |
| `parentOf` / `childrenOf` memoizálva | **51 000 ms** |

A Cloud Run 1 vCPU-ja ennél ~3,1-szer lassabb (ezt az élesben mért 1 320 s
és a helyi 425 s aránya adja), tehát a legrosszabb mért eset most ~160 s —
bőven a 900 s-os korlát alatt.

⚠️ **A gyorsulás a RÖGZÍTÉS KÉPERNYŐN is érvényes**, mert az inkrementális
detektor ugyanezt a kitöltést hívja. Ez Jamal „az app újranyitása
nehézkes" panaszának egy részét is enyhíti (a többiről lent).

### 3. ⚠️ Motorhiba, amit a gyorsítás fedett fel — JAVÍTVA

A `windingCounts` egy régió körüljárási számát az **elsőként megtalált**
cellájánál mérte. Elvben mindegy (a régió minden cellája ugyanannyit lát),
a gyakorlatban nem: az `encirclementsAround` racsnija tűréssel dolgozik, és
a régió peremén két szomszédos cella a küszöb két oldalára eshet.

**Mérve:** pusztán a kitöltés belső halmazának BEJÁRÁSI SORRENDJÉT
megváltoztatva a kifelé tartó spirál magja 3× helyett 2× védelmen maradt.
Vagyis a felhasználó területének védettsége egy `Set` beszúrási sorrendjén
múlt — pontosan az a fajta rejtett függés, amitől a kliens és a szerver
eredménye szétcsúszhat, holott a modul fejléce bitre azonos eredményt ígér.

Mostantól a régió **lexikografikusan legkisebb** celláján mérünk. Két új
teszt rögzíti: `winding.order.test.ts` (sorrendfüggetlenség) és
`loops.fill.test.ts` (a két kitöltési út ugyanazt adja).

### 4. Területfoltok csonkolása — JAVÍTVA (latens volt)

A `recomputeTerritoryBlobs` a felhasználó **első 400 blokkjából** számolta a
foltokat, majd **törölt mindent, amit nem hozott vissza**. 400 blokk fölött
tehát a birodalom maradéka egyszerűen eltűnt a térképről — lyukak és üres
foltok a régen elfoglalt területen. A `loadUserBlockIds` visszaadta a
`truncated` jelzést, csak épp senki nem nézte meg.

A plafon 4 000 blokk, és **csonkolt listával már nem törlünk**, hanem
naplózunk. A blokkolvasás kötegelt lett (400-asával), hogy a nagyobb plafon
ne vigye el a memóriát.

⚠️ **Ez NEM magyarázza Jamal tegnapi lyukait** — lásd lent, „Ami nyitva
maradt".

### 5. Hidegindítás — RÉSZBEN

`--cpu-boost` a `cloudbuild.yaml`-ban. Mérve az éles naplóban: hidegen az
első kérés 2,58 s, melegen ugyanaz 0,1–0,7 s. Geri 2026-09-02-án a
díjmentes felet választotta, tehát **`--min-instances=0` marad** — a
hidegindítás rövidebb lesz, de nem tűnik el. Ha a feed lassúsága továbbra is
zavaró, a `--min-instances=1` az egyetlen, ami megszünteti (~12–18 USD/hó).

### 6. Hiányzó index — JAVÍTVA

`modifiers` (scope, from, to). Az óránként futó forduló akció-indulás
értesítése e nélkül **minden órában** `FAILED_PRECONDITION`-nel hasalt el.
Ez nem szerepelt a hibalistán — a naplóból derült ki.

---

## MÉRT DIAGNÓZIS a még NEM javított pontokra

Ezek a #25 kész munkacsomagjai. Mindegyik mögött konkrét kód áll, nem
feltételezés.

### A) iOS: a zárolt képernyőn más táv, mint az appban

Jamal képernyőképein azonos percben **86,07 km** a zárolt képernyőn és
**92,69 km** az appban — 7,1% hiány.

**Ok: két, KÜLÖN algoritmusú távolságszámláló.** Előtérben a JS küldi a
hiteles értéket (`syncActivity`), háttérben viszont a natív
`GrundoLiveActivityController.record()` maga összegez — más szabályokkal:

| | JS (`tracking/filter.ts` + `recorder.ts`) | natív (`record()`) |
|---|---|---|
| pontosság-kapu | 30 m | **50 m** |
| elvetett mintánál a referenciapont | **marad a régi** | **előrelép** |
| távösszegzés | horgony-alapú, 12 m sugár | egyszerű láncösszeg |

A második sor a lényeg: a `defer { lastLocation = location }` a kapuk ELŐTT
fut le, tehát egy elvetett fix is új referenciaponttá válik — **az azon
átívelő szakasz távja végleg elveszik**. Bringánál (`distanceFilter = 12`)
ez fixenként 12–24 m. A hiba iránya mindig veszteség, ami egybevág a mért
7,1%-kal.

**Javítás iránya:** a natív ág vegye át a JS szabályát — 30 m-es kapu,
elvetett fixnél NE lépjen a referencia, és horgony-alapú összegzés 12 m-rel
(`GAMEPLAY.GPS_STATIONARY_RADIUS_M`). Fájl:
`ios/App/App/GrundoLiveActivityController.swift`.

### B) iOS: a hangok beragadnak, majd tömegesen leszólalnak

**Ok, és ez platformkorlát, nem hiba a kódban:** az
`ios/App/App/Info.plist` `UIBackgroundModes` tömbje `location` és
`remote-notification` — **`audio` NINCS BENNE**, és sehol nincs
`AVAudioSession` beállítás. Vagyis amíg az app háttérben van (zárolt
képernyő), a WebView `<audio>` eleme nem szólalhat meg. A `play()` hívás
nem hibázik, csak vár — és amikor az app előtérbe kerül, a felgyűlt
lejátszások egyszerre indulnak el. Pontosan ezt írta le Geri.

Ez magyarázza a többi tünetet is: a 3-2-1 és a RAJT azért ment, mert azok
ELŐTÉRBEN szólnak (épp megnyomta az indítást); a cellahangok és a
hurokbezárás azért nem, mert azok menet közben, háttérben keletkeznek.

**Két külön teendő:**
1. **Azonnali, olcsó:** a `lib/sound.ts` `playSound()`-ja ne indítson
   lejátszást, ha `document.visibilityState === 'hidden'`, és a
   `playSoundSequence` függő időzítői is szakadjanak meg elrejtéskor. Egy
   hang, amit MOST nem hallani, később már nem információ, hanem zaj.
2. **Termékdöntés:** ha a zárolt képernyős menet közben is szólni kell,
   ahhoz natív hangút kell (iOS: `UIBackgroundModes: audio` +
   `AVAudioSession` `.playback` + `AVAudioPlayer`; Android: `SoundPool` az
   előtér-szolgáltatásban). Ez önálló funkció, nem javítás — és iOS-en
   figyelni kell, hogy a háttérhang-jogosultság App Store-felülvizsgálati
   kérdés is.

### C) A dokk Play gombja két lépés

Kérés: bárhol nyomjuk meg a dokk Play gombját, egyből a mozgásforma-választó
jöjjön. Ma a rögzítés oldalra visz, és ott újra kell nyomni. Érintett:
`components/Dock.tsx` (`primaryAction`) és a `TrackingScreen` indító
állapota. ⚠️ A Dock indítógombja oldja fel a böngésző hangzárját is
(`unlockSounds`) — az átalakításnál ez nem eshet ki.

### D) A profil rivális-blokkja kapja meg az új Rival Bars megjelenítést

Minden felhasználó sávja a saját színével. A #23-ban a Home feed
aktivitás-kártyáin készült el (`RivalRow.tsx` + `connectionsSheet.css`); a
profil `RivalsCard`-ja még a régit használja.

---

## AMI NYITVA MARADT — és amihez INFORMÁCIÓ kell

### Jamal „lyukak a térképen" bejelentése

⚠️ **Ez nem a 4. pontban javított hiba.** Éles adaton lemérve
(2026-09-02): **Jamalnak NULLA blokkja és NULLA területfoltja van** — a 12
órás menet sosem íródott ki, tehát nem volt mit lyukasnak látni. A
legnagyobb birodalom jelenleg 84 blokk (geri), vagyis a 400-as csonkolás
sem sújtott még senkit.

A 23:34-es képernyőképen látható lila terület tehát a **mentetlen aktivitás
kliensoldali előnézete**, nem a tárolt birtokviszony. Ahhoz, hogy ezt
érdemben meg lehessen nézni, kérdezzük meg Jamaltól: melyik képernyőn látta
(Grund térkép / rögzítés / aktivitás részletező), és a lyukak az ő
területén belül voltak-e, vagy másén. A javított mentéssel érdemes újra
próbálni, és ha újra előjön, akkor már lesz tárolt adat összehasonlítani.

### „Az app újranyitása sokáig tart hosszú rögzítés után"

A geometria 8,9-szeres gyorsulása ebbe is beleszámít, de **marad egy
mért, ismert négyzetes költség**, ami a #23 óta nyitva van: a
`tracking/recorder.ts` `applySample`-je MINDEN mintánál új pontok-tömböt
másol (`[...state.points, point]`). Ébredéskor a natív sor egyszerre több
ezer pontot szállít, és mindegyik egy teljes tömbmásolást indít — egy
8 000 pontos menetnél ez ~32 millió elemmásolás egyetlen kötegben.

⚠️ A #23 kifejezetten azt írta, hogy ehhez **mérés nélkül nem szabad
hozzányúlni**, mert a tiszta reducer-szerződés és a React
változásfelismerés is ezen áll. Ez így is van — a helyes irány egy KÖTEGES
`applySamples(state, samples)`, ami egyszer másol, és amit előtte-utána
mérni kell (a natív drain kötegméretével).

### Változatlanul nyitva a korábbi menetekből

- **Natív Google-belépés** (a #23 fő témája volt): iOS-en szándékosan
  tiltva (App Store 4.8 → Sign in with Apple kell hozzá), Androidon valódi
  hiba, a SHA-1 hipotézis IGAZOLATLAN. Részletek a #23 handoffjában, a
  git logban.
- **iOS TestFlight build eredménye** a #23-ból nem lett visszaigazolva.
- **App Check**: a webes `VITE_RECAPTCHA_SITE_KEY` üres, a backend `observe`
  telepítése nem történt meg, `enforce` csak igazolt lefedettség után.
- A gameplay-config runtime snapshot bekötése (`activityCommit.ts`,
  `activityChunked.ts`, `trust/score.ts`, 16 hívási hely).
- `mailer.ts:122-129` fail-closed tétele hiányzó `SMTP_HOST`-ra.
- A frontend production Mapbox chunk 1,824 MB, a Firebase chunk 630 kB.
- 90 perces / 20 km-es iOS és Android háttér-GPS terepteszt.

---

## Üzemeltetési jegyzetek

### Éles naplók olvasása — ez a menet ezen állt vagy bukott

A gépen bejelentkezett `gcloud` (`gergely.marthon@gmail.com`) lát Cloud
Logginget. Git Bashből, a repo bármely mappájából:

```
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="grundo-api" AND httpRequest.requestMethod="POST"' --project grundo --freshness=2d --limit 40 --format="value(timestamp,httpRequest.status,httpRequest.latency,httpRequest.requestSize,httpRequest.requestUrl)"
```

⚠️ A KÉRÉSNAPLÓ CSAK A STÁTUSZT ADJA. A konténer saját üzenetei — köztük a
Firestore-hibák teljes szövege — a `stderr` naplóban vannak: a szűrőbe
`logName:"stderr"` kell. Ez a menet enélkül nem találta volna meg az
index-plafont, csak a 300 s-os időkorlátot, és félig javított volna.

⚠️ **PowerShellben a szűrő idézőjelei elvesznek** a natív parancsnak
átadva („Unparseable filter"). Git Bashből kell futtatni, ott a `gcloud`
elérhető a `/c/Program Files (x86)/Google/Cloud SDK/…` alól.

### Éles Firestore-olvasás szkriptből

A `server/` mappában, a moduláris firebase-admin API-val (az
`admin.firestore()` alak a v13-ban már nem létezik):

```
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: 'grundo' }), 'grundo-db');
```

PowerShellből: `$env:GOOGLE_CLOUD_PROJECT="grundo"` és `node` a `server/`
mappából — a szkript a `server/node_modules`-t használja.

### Helyi teszt-környezet

`localhost:5173` + Firestore/Auth emulátor + backend. Belépés:
`geri@grundo.local` / `grundo-emulator`, vagy a konzolban
`await __grundoDevSignIn()`. A seed-fiók **owner** szerepkörű, tehát az
`/admin` és a Simulation LAB elérhető.

Emulátoros tesztek Git Bashből, a Java PATH exportja után:
`export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"`

### Hol van a Play Store aláírókulcs SHA-1 / SHA-256?

Play Console → GRUNDO app → „A Google Play védi" → a „Google Play
Áruház-védelem" kártya kinyitása a sorvégi ∨ nyíllal → „Alkalmazás-aláíró
kulcs védelme" sor → „A Play alkalmazás-aláírás kezelése" gomb. Ott az
„Alkalmazás-aláíró kulcs" dobozban a **Klasszikus kulcs** ujjlenyomatai
kellenek — nem a posztkvantum kulcs és nem a feltöltési kulcs.

---

## 0. MODELLJAVASLAT a #25-höz

**Sonnet, normál mélység** — ha a #24 diagnózisait vezetjük át (A, B/1, C,
D). Ott már mind a négyhez megvan a hely és a szabály; ez felület- és
platform-kódírás, nem nyomozás.

**Opus, emelt mélység** — ha a rögzítő `applySample` négyzetes költsége vagy
a natív Google-belépés lesz a téma. Az egyik mért teljesítmény-átalakítás
egy tiszta reducer szerződésével a tét, a másik igazolatlan hipotézis két
platform konfigurációjának metszetében.

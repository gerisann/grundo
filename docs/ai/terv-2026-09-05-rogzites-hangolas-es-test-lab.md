# Terv — rögzítés-hangolás munkafolyamat és Firebase Test Lab bekötés

> Készült: **2026-09-05** · GRUNDO **#42 előkészítés** · Claude Opus 5
> Állapot: **javaslat.** Egy fixture bekerült (`bench/tracks/scenario-25km.json`),
> a többi nincs megvalósítva.
>
> ⚠️ **2026-09-05 korrekció.** A terv első változata alábecsülte, mi van már
> kész: a GRUNDO-ban **létezik teljes GPS-szimulációs forrás és LAB E2E
> futtató**. Az érintett pontok (2.4, 3.3) javítva. A korrekció iránya
> kedvező: a 3. lépés lényegesen olcsóbb, mint hittem.

Két kérdésre válaszol: (1) milyen ismételhető munkafolyamattal hangolható
tovább a rögzítés / GPS / hurokszámolás hosszú, sok hurkos menetnél, és
(2) hogyan használható ki a Firebase Test Lab ingyenes napi kerete valódi
telefonos futásmérésre.

---

## 0. Honnan indulunk (mért tények, nem feltételezés)

A `docs/ai/archive/2026-09-04-terepi-fosszal-meres.md` szerint:

- az **átlagos** főszál-terhelés 0,1% — nem ez az akadozás oka;
- a fájdalom **egyetlen 859 ms-os blokk**, háttérből visszatéréskor, a
  felgyűlt GPS-minták kötegelt feldolgozásából;
- ennek 99,5%-a a hurokkeresés, azon belül 491 jelölt **valódi hurok, de már
  bekerített** belsővel — a szabály dolgozik rendesen, nincs olcsó szűrő;
- a `coarseContextOf` memoizálás −55%-ot hozott böngészőben;
- a per-hívás költség **×5,6-ra nőtt 8,6 km alatt** — 25 km-nél ez a
  többszöröse lesz **a workerrel együtt is**.

Tehát az algoritmus mikro-optimalizálása nagyrészt ki van bányászva. Ami
hiányzik, az **nem egy ötlet, hanem egy mérőpad**:

| hiány | ma | miért baj |
|---|---|---|
| pályakorpusz | `tmp/preview-probe-track.json`, egy darab | 25 km / 40 hurok esetre nincs adat |
| mérőszkriptek | ~20 db `tmp/measure-*.ts`, **verziózatlan**, `tmp/` alatt | egy takarítás elviszi; nem összehasonlítható |
| regressziós korlát | nincs | egy lassító változtatás csendben átmegy a CI-n |
| valódi készülék | kézi terepmérés, ~40 perc séta | nem ismételhető, nem rendszeres |
| mentési út | nincs mérve | a #42 kérdése épp a mentés akadása |

---

## 1. Skillek — mit talált a `find-skills`

Négy releváns találat, telepítési számmal és forrással:

| skill | telepítés | mire jó itt |
|---|---|---|
| `addyosmani/web-quality-skills@performance` | **33,1K** | Fő javaslat. Addy Osmani / Chrome-csapat. Long task, INP, main-thread jank, worker-leválasztás módszertana — pontosan a 859 ms-os blokk nyelvén. |
| `mapbox/mapbox-agent-skills@mapbox-web-performance-patterns` | **2K** | Hivatalos Mapbox. A GRUNDO `mapbox-gl`-t használ; a sok ezer cellás hurok-poligon újrarajzolása a második gyanúsított a rögzítés közbeni akadásra. |
| `tovimx/maestro-mobile-testing-skill@maestro-mobile-testing` | 970 | Maestro folyamatok Capacitor-appra. Ez a **híd a 2. feladathoz**: a Maestro-folyam az, amit a Test Lab valódi telefonon lefuttat. |
| `firebase/agent-skills@firebase-basics` | **145,9K** | Hivatalos Firebase. Általános, de a Test Lab / gcloud oldalt megbízhatóan fedi. |

**Amit NEM találtam:** nincs a nyilvános ökoszisztémában GPS-nyomvonal
rögzítésre, hurokdetektálásra vagy geo-játék teljesítményre való skill. A
`geolocation` keresés OSINT- és IP-geolokációs skilleket ad. Ez a rész
**házon belül építendő** — lásd a 2. pontot.

Telepítés (Git Bash, bárhonnan):

```bash
npx skills add addyosmani/web-quality-skills@performance -g -y
```

```bash
npx skills add mapbox/mapbox-agent-skills@mapbox-web-performance-patterns -g -y
```

```bash
npx skills add tovimx/maestro-mobile-testing-skill@maestro-mobile-testing -g -y
```

---

## 2. A saját munkafolyamat: „rögzítés-mérőpad"

Ez a lényegi javaslat. Négy lépcső, mindegyik önmagában is értékes.

### 2.0 ⚠️ Ami MÁR KÉSZ (és amit az első változat kihagyott)

| modul | mit tud |
|---|---|
| `src/tracking/simulationSource.ts` | Teljes szimulált GPS-forrás: sebesség, mintavételi jitter, zaj, drift, kimaradás, kiugró fix, **seed** — determinisztikus. |
| `src/admin/LabE2eLauncherScreen.tsx` + `labE2eSandbox.ts` | LAB E2E: **valódi eszközön futtatja** a szimulált menetet, kármentesen. |
| `src/admin/labPerfScenario.ts` | Kódban élő perf-útvonal (GRUNDO #32) — épp azért, mert a `localStorage` eszközhöz kötött. |
| `src/admin/labScenarioEngine.ts` | Több játékos, több fázis, `tieBreakSeed`. |
| `grundo.lab.lastRun.v1` | Már ma ír futásösszegzést: `routeDistanceM`, `recordedDistanceM`, `rawSamples`, `acceptedSamples`, `rejected`, `seed`. |

Vagyis a „replay mód", amit a 3.3/1. pont építendőként írt le, **létezik**. A
`labPerfScenario.ts` fejlécében ott a pontos indoklás is:

> „a LAB E2E a mentett scenariókat a böngésző `localStorage`-ából olvassa, ami
> eszközhöz kötött — az asztali gépen megrajzolt útvonal SOSEM jut át a
> telefonra."

Ez **szó szerint a 2.1 pont indoklása**: a korpusz repóba emelése nem új
ötlet, hanem egy már leírt hiány betömése.

### 2.1 Pályakorpusz (`bench/tracks/`, verziózva)

Fixált, valódi és szintetikus nyomvonalak JSON-ban, `TracePoint[]` alakban:

| pálya | forrás | mit feszít |
|---|---|---|
| ✅ `scenario-25km.json` | **Geri rajzolta, 2026-09-05, beemelve** | 262 pont, 25,02 km, `ride` 22 km/h, 1 s mintavétel, 2,5 m zaj, `seed 738291` |
| `field-8km-samsung.json` | a 2026-09-04-i terepmérés | a referencia, amihez minden szám köthető |
| `scenario-111km.json` | Geri LAB-scenariója | felső határ; a ×5,6 növekedés extrapolációja |
| `synth-stadium-repeat.json` | generált, ugyanaz a kör 20×-szor | „körbe-körbe futás" — a jelöltrobbanás esete |
| `synth-jitter-urban.json` | generált, 15 m szórású zaj | GPS-pontatlanság hatása a jelöltszámra |
| `field-background-gap.json` | valódi, háttérbe tett készülék | a **859 ms-os köteg** reprodukálása |

A `tmp/export-field-track.ts` már tudja az exportot — ez a lépés főleg
**áthelyezés és rögzítés**, nem új kód.

### 2.2 Node-os mérőpad (`bench/`, a `tmp/measure-*` konszolidálva)

Egy belépési pont, ami minden pályára lefuttatja a teljes láncot
(`previewEngine` → `loopDetection` → `incrementalClaims`) és **gépi olvasható
JSON-t** ír: teljes idő, p50/p95/max blokk, kilométerenkénti bontás,
jelöltszám, elutasítási okok, `coarseContextOf` találati arány.

Kimenet `bench/results/<dátum>-<git sha>.json`, **commitolva** — így a
javulás és a romlás is visszakereshető.

### 2.3 Regressziós korlát a CI-ben

A `bench` egy rövid változata (a 8 km-es pálya) fusson a teszt mellett, és
**bukjon**, ha a max blokk vagy az összidő a rögzített alapvonal fölé megy
egy tűrésen túl. Ez a lépés fordítja meg a mai helyzetet: ma egy lassítás
csendben átmegy.

⚠️ **Csapda:** a Node-os idő nem a telefon ideje. A CI-korlát csak
**relatív** romlást fogjon (pl. +20% az előző alapvonalhoz), abszolút
ms-küszöböt ne — a futtató gép terhelése ingadozik.

### 2.4 A hiányzó két mérés (amiről ma nincs adatunk)

1. **A mentés útja.** A terepmérés a *rögzítés közbeni* előnézetet mérte. A
   „mentéskor se akadjon" kérés a `activityCommit` / `compactBlockClaim`
   szerveroldali és a kliens feltöltési oldalát érinti — ott ma **nincs
   mérés**. Ez önálló kör.
2. **A Mapbox rajzolás.** A `perfMeter` a preview-számítást méri, a
   `setData` / réteg-újrarajzolás költségét nem. 40 hurok poligonjánál ez
   önálló gyanúsított — a `mapbox-web-performance-patterns` skill ide szól.

### 2.5 Vizuális oldal („legyen szép is")

A worker miatt az előnézet **később** érkezik, mint a GPS-pont. Ez nem
akadás, de látszik. Amit mérni és hangolni kell: az előnézeti cella
megjelenésének késleltetése a mintához képest (p95), és hogy a
megjelenés animált-e vagy ugrik. Ehhez a `perfMeter` egy új mezője kell:
minta-időbélyeg → kirajzolás-időbélyeg.

---

## 3. Firebase Test Lab — mit ad, és mennyiért

### 3.1 A keret (2026-09-05-i árazás)

A GRUNDO **Blaze**-en van (Cloud Run, Firestore), tehát a Blaze-keret él:

| | ingyenes napi keret | felette |
|---|---|---|
| **virtuális** eszköz | **60 perc/nap** | 1 USD/óra |
| **valódi** eszköz | **30 perc/nap** | 5 USD/óra |
| Device Streaming | 30 perc/**hónap** | 0,15 USD/perc |

Percre kerekítve számolják, **a telepítés és az eredmény-begyűjtés ideje nem
számít bele**. Az eredmények 90 napig maradnak meg a GCS-ben, ennél tovább
`--results-bucket` saját tárolóval.

Ez napi kb. **6 db 5 perces valódi készülékes futás** ingyen. Egy 25 km-es
menet valós időben nem fér bele — **ezért kell a gyorsított visszajátszás**
(lásd 3.3).

### 3.2 Melyik teszttípus

| típus | verdikt GRUNDO-ra |
|---|---|
| **Robo** | ⚠️ Gyenge. A Robo a natív nézetfát járja; a GRUNDO Capacitor-**WebView**, amiben a Robo alig lát elemeket. Füstteszt-szintre jó, mérésre nem. |
| **Espresso / instrumentation** | Működik, de natív teszteket kell írni egy webes apphoz — nagy ráfordítás. |
| **Game Loop** | ✅ **Ez a nyerő.** Az app maga futtatja a forgatókönyvet. |

**Game Loop mechanika:** a `MainActivity` manifestjébe kerül egy
`com.google.intent.action.TEST_LOOP` intent-filter; indításkor az app
kiolvassa a `scenario` számot, lefuttatja a hozzá tartozó menetet, JSON-t ír
a `launchIntent.getData()` fájlba, majd `finish()`-sel jelez. A Test Lab a
fájlt feltölti a GCS-be, a Firebase konzol pedig — megadott JSON-séma
esetén — mutatja a mérőszámokat.

**Valódi készüléken ráadásul kapunk beépített teljesítmény-mérőszámokat is**
(CPU, memória, hálózat, grafika: lassú és fagyott képkockák) — pont az, amit
ma kézzel következtetünk ki, plusz videót a futásról.

### 3.3 A bekötés terve

1. ⚠️ **JAVÍTVA: a replay mód KÉSZ.** A `simulationSource.ts` és a LAB E2E
   futtató már ma valódi eszközön játszik vissza szimulált menetet, seeddel.
   Ami hiányzik, az mindössze a **gépi indítás**: a `scenario` szám kössön egy
   `bench/tracks/` pályát, és a futás emberi kattintás nélkül induljon el.
   Ez lényegesen kisebb munka, mint amit az első változat feltételezett.
   ⚠️ A LAB ma is admin-mögötti; a Game Loop intent-filter **debug** buildre
   korlátozandó, hogy éles APK-n ne legyen indítható.
2. **A `perfMeter` mentse a JSON-t a Game Loop logFile-ba.** A mérő már ma
   tud percenkénti bontást és legdrágább-futás-listát; ez pont a kimenete.
   (Ez oldja meg azt is, amit a memória „mérési adatot menteni kell"-ként
   rögzít: az élő kijelzés önmagában kevés.)
3. **APK build + futtatás** (PowerShell, `C:\Users\Geri\Documents\GitHub\grundo`):

```bash
gcloud firebase test android run --type game-loop --app android/app/build/outputs/apk/debug/app-debug.apk --device model=redfin,version=30,locale=hu,orientation=portrait --scenario-numbers=1,2 --timeout 5m --results-bucket grundo-testlab
```

4. **Eredmény lehúzása és a `bench/results/` alá mentése** — ugyanabba a
   formátumba, mint a Node-os mérés, hogy a kettő egymás mellé tehető.
5. **Ritmus:** ne minden commitnál. Kiadás előtt és nagyobb
   rögzítés-változtatás után, 2–3 készüléken. Így a napi 30 perc bőven elég,
   és **nulla forintba kerül**.

### 3.4 Amit a Test Lab NEM tud

- **Nincs GPS-injektálás.** Nincs olyan kapcsoló, amivel a Test Lab mozgatná
  a készüléket. Ezért kell a 3.3/1. pont — a hamis pozíció az **appon
  belülről** jön. Ez nem kerülőút, hanem az egyetlen út.
- **Nincs valódi rádió/akkumulátor-viselkedés** olyan értelemben, mint séta
  közben: a készülék az állványon áll. A grafikai és CPU-számok valósak, az
  akkumulátor-fogyasztás nem reprezentatív.
- **iOS**: a Game Loop és a natív mérőszámok Android-oldalon a legerősebbek.

---

## 4. Javasolt sorrend

| # | lépés | ráfordítás | mit ad |
|---|---|---|---|
| 1 | `bench/tracks/` korpusz + `bench/` konszolidáció | közepes | ismételhetőség; a `tmp/` már meglévő munkája megmenekül |
| 2 | CI-regresszió a 8 km-es pályára | kicsi | a lassulás nem megy át csendben |
| 3 | Game Loop bekötése a MEGLÉVŐ LAB E2E-re | **kicsi-közepes** (javítva) | **valódi telefonos szám, ingyen, ismételhetően** |
| 4 | Mentési út mérése | közepes | a ma teljesen mérés nélküli fele |
| 5 | Mapbox rajzolás mérése | kicsi | a második gyanúsított kizárása vagy megfogása |

---

## Apró észrevétel menet közben

A `src/lib/previewEngine.ts` és `src/lib/perfMeter.ts` kommentjei a
`docs/ai/meres-2026-09-04-terepi-fosszal.md` útvonalra hivatkoznak, a fájl
viszont a `docs/ai/archive/2026-09-04-terepi-fosszal-meres.md` alatt van.

## Források

- <https://firebase.google.com/docs/test-lab/usage-quotas-pricing>
- <https://firebase.google.com/docs/test-lab/android/game-loop>
- <https://firebase.google.com/docs/test-lab/android/command-line>
- <https://firebase.google.com/docs/test-lab/android/analyzing-results>

---

# Futtatókönyv (2026-09-05, megvalósítva)

## Helyi próba böngészőben

Git Bash, `C:\Users\Geri\Documents\GitHub\grundo`:

```bash
npm run dev:gameloop
```

Aztán `http://localhost:5173/gameloop?scenario=2`. A futás magától indul,
lezár, ment, és az eredmény a konzolba + a `window.__grundoGameLoopResult`-ba
kerül.

| scenario | pálya | lejátszás | mire jó |
|---|---|---|---|
| 1 | városi kör (#32) | 1× | a 23 ms-os asztali alapérték párja |
| 2 | Scenario 25km | 100× | belefér a napi ingyenes keretbe |
| 3 | Scenario 25km | 1× | ⚠️ ~68 perc, TÚLLÉPI az ingyenes keretet |

## Debug APK és Test Lab

```bash
npm run build:gameloop
```

```bash
npx cap sync android
```

Az APK-t a szokásos módon kell legyártani (Codemagic vagy Android Studio),
**debug** variánsban — a `TEST_LOOP` belépő csak ott létezik. Majd:

```bash
gcloud firebase test android run --type game-loop --app android/app/build/outputs/apk/debug/app-debug.apk --device model=redfin,version=30,locale=hu,orientation=portrait --scenario-numbers=2 --timeout 10m --results-bucket grundo-testlab
```

Az eredmény-JSON a futás Cloud Storage mappájában lesz, a videó és a
készülékes teljesítménymérőszámok mellett.

## Mit ad vissza egy futás

Mérve a 2-es scenarióval, böngészőben (2026-09-05):

```
schema        grundo.gameloop.v1
wallClock     128 s
summary       26,54 km · 17 hurok · 14 799 cella · 496 GP
perf.total    2 102 minta · átlag 4,3 ms · p95 6,7 ms · max 72 ms
perf.buckets  15 percenkénti bontás
perf.events   40 legdrágább futás teljes körülménnyel
```

## ⚠️ Amit NEM ellenőriztem

Az `android/app/src/debug/` alatti Java és manifest **nincs lefordítva**: ezen
a gépen nincs Android SDK (`ANDROID_HOME` üres, `local.properties` sincs), a
buildek a Codemagicen futnak. A manifest-összefésülés és a
`@JavascriptInterface` tehát az első debug buildnél derül ki. A JS oldal
viszont végig van mérve.

# GRUNDO handoff

> Frissítve: **2026-09-02** · Claude Code kvótája elfogyott, átadás **Codexnek**
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · HEAD **`4a2f017`** · pusholva, munkamásolat tiszta
>
> Élesben: web `06cf4e5` (mentés+betöltés javítások) · backend
> `grundo-api-00112-6b2` · ⚠️ **három friss commit MÉG NEM TELEPÍTVE**
> (`2ab519f`, `4a2f017`) — lásd „ELSŐ DOLOG" lent
>
> Tesztek: **646 zöld** + **129 emulátoros zöld**, gyökér és `server/`
> typecheck tiszta

---

## ⚠️ ELSŐ DOLOG: telepítés

Két kód-commit van a `06cf4e5` (élesben lévő) óta, egyik sem ment ki:

- **`2ab519f`** — a dokk beragadt választója (csak frontend) + a natív
  hangkötegek időzítés-őre (`src/lib/sound.ts`, csak frontend, DE a Swift/
  Java oldala natívban vár Codemagic buildre — lásd lent)
- **`4a2f017`** — gzip-tömörítés a feltöltésnél. ⚠️ **EZ BACKEND ÉS
  FRONTEND EGYÜTT KELL.** A `server/server.ts` CORS `Access-Control-Allow-
  Headers` listája bővült `Content-Encoding`-gal — enélkül a tömörített
  kérés a böngészőben ELŐKÉRÉS-hibával elhasal, és a felhasználó pontosan
  azt a „nincs kapcsolat a szerverrel" hibát kapja, amit épp javítottunk.
  **Ha csak a frontendet telepíted, ROSSZABB állapotba kerül az élesnél.**

Sorrend: **backend, majd frontend**, egy menetben, ne csak az egyik.

```
./scripts/deploy.sh backend
./scripts/deploy.sh frontend
```

Telepítés után ellenőrizd (ez a szokásos protokoll, lásd AGENTS.md): a
belépő chunk neve egyezzen (`grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
dist/index.html` vs. `curl -s https://grundo.web.app/`), és a Cloud Run
revízió frissüljön (`gcloud run services describe grundo-api --region
europe-west1 --project grundo --format='value(status.latestReadyRevisionName)'`).

Adatmigráció nincs.

---

## MI KÉSZÜLT EL EBBEN A MENETBEN

Geri visszajelzése alapján, terepteszt után.

### 1. Dokk Play gomb — beragadt választó (JAVÍTVA, mérve)

**Tünet:** Play gombra kattintva átvált `/rogzites`-re és nyílik a
mozgásforma-választó (sárga felfelé nyíl). Ha innen a dokk MÁSIK
menüpontjára navigáltál, a gomb véglegesen beragadt a sárga nyílon,
`disabled` állapotban — többé nem lehetett rákattintani.

**Ok:** a `picking` állapot (`idle && pickerOpen && !pendingType`,
`src/components/Dock.tsx`) igaz maradt, mert semmi nem zárta be a
`pickerOpen`-t elnavigáláskor.

⚠️ **Az első javításom ELBUKOTT, ezt méréssel fogtam meg** (helyi
emulátoron, böngésző konzolból közvetlen `click()` hívásokkal): egy
állapot-alapú effekt („nyitva a választó ÉS nem a rögzítésen vagyunk")
BEZÁRTA a választót MÉG A NAVIGÁCIÓ KÖZBEN, mert a `primaryAction`
ugyanabban a koppintásban nyitja a választót ÉS hívja a `navigate()`-et — a
React Router útvonala csak a KÖVETKEZŐ renderben áll át, és abban a köztes
renderben a feltétel már igaz volt.

**A végleges megoldás egy `wasOnTrackingScreen` ref-fel az ÁTMENETET
figyeli** (`false → true` nem zár, csak `true → false`), `Dock.tsx` kb.
123-158. sor. Mérve: Home → Play → `/rogzites` + nyitott választó →
elnavigálás → gomb visszaáll, kattintható → újra Play → ismét nyílik →
Futás → 3-2-1 → elindul.

### 2. Natív hangkötegek — „egyszerre szól az összes" (JAVÍTVA, DE ESZKÖZÖN NEM IGAZOLVA)

**Tünet (Geri pontosítása, döntő nyom):** asztali böngészőben a hangok
rendben, natív iOS/Androidon nem — a rögzítés közben néma cellahangok és
hurokbezárás az app előtérbe térésekor tömegesen, egyszerre szólaltak meg.

**Mechanizmus:** a `playSoundSequence` (`src/lib/sound.ts`) szándékosan
190–220 ms-onként lépteti a koppanásokat `window.setTimeout`-tal. Amikor a
telefon lezáródik, a WKWebView/Android WebView MEGÁLLÍTJA a JavaScriptet —
a már beütemezett időzítők nem futnak le a saját idejükben. Előtérbe
visszatéréskor a böngésző az ÖSSZES lejárt időzítőt egymás után, szinte
azonnal elsüti.

A #24-ben bekerült `visibilitychange`-alapú megszakítás ehhez NEM elég:
feltételezi, hogy az esemény a felfüggesztés ELŐTT lefut — natív WebView-
ban zárolt képernyőnél ez nem garantált.

**A javítás:** minden késleltetett hang MAGA ellenőrzi, hogy időben
szólal-e meg (`isSequenceStepStale`, 600 ms tűréssel, `sound.ts`). Ami
elkésett, eldobja magát ahelyett, hogy lejátszaná. Tiszta függvény, négy
teszt rögzíti (`feedbackSettings.test.ts`).

⚠️ **EZT NEM LEHETETT ESZKÖZÖN ELLENŐRIZNI** — a fejlesztői gépen nincs
Xcode és nincs Android SDK. A mechanizmus azonosítva, a javítás logikusan
rá válaszol, de a bizonyíték a Codemagic build utáni KÉSZÜLÉKES próba.

### 3. Rivális-sávok, zárolt képernyős táv, hangok némítása, dokk-átirányítás — a #24-ből, ÉLESBEN VAN

Ezekhez lásd a git logot (`9fa6e4f`, `2ab519f` előtti rész) — mind
élesben, mind kód-, mind webes szinten. Röviden:
- profil rivális-sávok saját színnel (kliens + `/api/rivals` mindkettő
  javítva),
- zárolt képernyős táv szinkronizálva a JS és a natív (Swift+Java) számláló
  között — **ez is Codemagic buildre vár**, csak a natívban van,
- hangok nem szólnak háttérben (`document.visibilityState === 'hidden'`
  őr),
- a dokk Play gombja egy koppintással a választóig visz.

### 4. Gzip-tömörítés a feltöltésnél (JAVÍTVA, mérve, DE MÉG NEM ÉLESBEN)

Lásd fent az „ELSŐ DOLOG" szakaszt — ez a `4a2f017` commit, backend+frontend
együtt kell hozzá.

**Mérve** (helyi emulátoron, 200 pont → 5000-re bővítve): 249 052 bájt
nyers JSON → 37 049 bájt tömörítve (~6,7×). Jamal 12 órás, 1,1 MB-os
menete ezzel becsülve ~160 kB körül landolna.

`src/lib/api.ts` `compressedJsonBody()` — `CompressionStream('gzip')`,
feature-detection-nel (iOS Safari/WKWebView 16.4-től létezik, alatta sima
JSON megy tömörítés nélkül, ez NEM hibaágazat). A szerver nem igényelt
kódot az `express.json()` `inflate` miatt — **KIVÉVE a CORS-fejlécet**,
amit szintén ez a commit javított (`server/server.ts` `Access-Control-
Allow-Headers` + `Content-Encoding`).

Végponttól végpontig ellenőrizve a helyi emulátoron: a tömörített
feltöltés célba ér, a szerver dekódolja, a mentés sikerül.

---

## KÖVETKEZŐ MENET(EK) — Geri kérése, MÉG NINCS KÓD

Ezt a beszélgetést azért zártam le, mert a kvóta elfogyott — az alábbi
kettő tervezve van (a beszélgetésben megbeszélve Gerivel), de KÓD MÉG
NINCS hozzá.

### A) „Nyugodtan bezárhatod" kezelés hosszú mentésnél

**A probléma:** a Cloud Run 300 s-os időkorlátja (`--timeout=900` a #24
óta) alatt is a szerver TOVÁBB DOLGOZIK, ha a kliens megszakad — ezt a #24
mérése igazolta (504 után a konténer még ~22 percig futott). A kliens ma
ezt VÉGZETES hibaként kezeli: „A mentés nem sikerült" felirattal ijeszt,
holott a szerver valószínűleg befejezi.

**Amit a beszélgetés során feltártam, induló pontnak:**
- A mentés **idempotens** az `activityId`-ra: `POST /api/activities`
  elején egy előszűrés `duplicate: true`-val tér vissza, ha a dokumentum
  már létezik (`server/src/routes/activities.ts` kb. 163-169. sor). Az
  újrapróbálás/rákérdezés tehát biztonságos.
- **A push+in-app értesítés MÁR MEGVAN**: sikeres mentés után
  `notifyGpActivity()` fut (`server/src/lib/notifications.ts` kb. 384-400.
  sor), ami `data: { screen: 'activity', activityId }` célponttal küld
  FCM pusht ÉS in-app értesítést — pontosan az aktivitás részletezőre
  irányítva. Ehhez valószínűleg nem kell hozzányúlni.
- **A haladás Firestore-ból is követhető** HTTP-kapcsolat nélkül:
  `useClaimProgress` (`src/hooks/useClaimProgress.ts`) `onSnapshot`-tal
  figyeli az aktivitás dokumentum `claimProgress`/`claimStatus` mezőit —
  ez ma is működik nagy (darabolt) mentéseknél, csak a hétköznapi
  (egytranzakciós, `total === 1`) mentésnél nincs mit mutatnia.
- **GET `/api/activities/:id`** már létezik és visszaadja az aktivitást,
  ha elkészült (`server/src/routes/activities.ts` kb. 922. sortól) —
  státuszlekérdezésre felhasználható, bár ma nincs explicit „még dolgozom
  rajta" jelzés benne 202-es válasszal.

**Amit ki kell találni (nincs kész terv):**
1. Mikor és HOGYAN mondja a felület, hogy „nyugodtan bezárhatod"? Csak a
   feltöltés indulásakor, vagy csak nagy (darabolt) mentésnél?
2. Ha a kliens visszatér (app újranyitás) egy `sending` állapotú, de
   valójában már kész mentéssel — hogyan veszi ezt észre? (Rákérdezés az
   `activityId`-ra? A push értesítés maga elég jelzés?)
3. Kell-e a `POST /api/activities`-nek egy korai 202-es válasz, mielőtt a
   teljes feldolgozás lezárul? Ma a válasz csak a VÉGE után megy.

### B) Szerveroldali RÉSZSZÁMÍTÁS menet közben (Geri saját ötlete — FONTOS, ne keverd össze a darabonkénti commitolással!)

⚠️ **Geri kifejezetten NEM éles, darabonkénti commitolást kért.** A
javaslat: a GEOMETRIÁT (hurokdetektálás, cellalánc) számolja a szerver
FOLYAMATOSAN, menet közben, egy IDEIGLENES TÁROLÓBA — a birtokviszony
véglegesítése (a Firestore-commit) marad a mentés VÉGÉN, egyben. Így a
végső mentéskor már csak a felhalmozott geometriát kell ÖSSZEGEZNI a
mostani birtokviszonnyal, nem nulláról újraszámolni.

**Miért nem ütközik a „cellánként az első sikeres commit nyer" szabállyal
(amit tévesen felhoztam ellenérvként, Geri javított ki):** a birtokviszony
véglegesítése ELVÁLIK a geometria-számítástól. A geometria (mely cellák,
mely hurkok) NEM függ más játékosok aktuális állapotától — csak a saját
GPS-nyomvonaltól. Ez tehát biztonságosan előreszámolható, a döntés
(kié lesz a cella) marad a mentés pillanatára.

**Amit a beszélgetés során feltártam, induló pontnak:**
- **A kliens MÁR csinálja ezt, csak nem menti sehova.**
  `IncrementalActivityGeometry` / `IncrementalLoopDetector` /
  `IncrementalCellPath` (`src/game/`, `src/screens/TrackingScreen.tsx`)
  pontosan az inkrementális, csak-az-új-részt-számoló motor — ez adja az
  élő előnézetet. Mérve (a kódban dokumentálva): 20 km-en a teljes
  újraszámolás 337 ms, inkrementálisan frissítésenként átlag 29 ms.
- **A szerver ma NULLÁRÓL fut le** minden mentésnél
  (`server/src/lib/activityCommit.ts` `planActivity()` →
  `processActivity()` → `buildActivityGeometry()`, `src/game/index.ts`).
  Ez a #24-ben mért ~160 s (Cloud Runon, 126 km-es menetre) — az egész
  motor egyszer, a teljes nyomvonalra fut.
- **Az állapot mérete, amit meg kéne őrizni két kérés között:** a 126
  km-es próbamenetnél 7 759 lánccella + 23 927 belső cella, plusz a
  detektor belső könyvelése (`seenAt` térkép, elfogadott hurkok fala/
  belseje, `enclosed` halmaz) — összesen nagyságrendileg a végeredmény
  méretével egyező, néhány száz kB sorosítva. Firestore 1 MB-os
  dokumentumhatárba szűkösen fér, Cloud Storage-objektumba kényelmesen.
- ⚠️ **KRITIKUS CSAPDA, amit előre látni kell:** a nyomvonal NEM
  szigorúan növekvő. A natív GPS-forrás `ordered = false`
  (`src/tracking/nativeSource.ts`), és az `applySample`
  (`src/tracking/recorder.ts`) kifejezetten kezeli a sorrenden kívül
  érkező mintát (beszúrás a lánc közepébe, horgony-alapú távújraszámolás).
  A detektor ilyenkor TELJES ÚJRAÉPÍTÉST csinál — helyesen, de ez
  ÉRVÉNYTELENÍTI a felhalmozott szerveroldali részállapotot. A tervnek
  kell egy VISSZAESÉSI ÁG a mai, teljes újraszámolásra, arra az esetre, ha
  a beérkező köteg nem egyszerű folytatás.
- **Hol küldi a kliens a köteget ma?** Sehol — ma egyetlen `POST
  /api/activities` hívás megy a teljes nyomvonallal, a mentés VÉGÉN. Egy
  új, menet közbeni végpont kellene (pl. `POST
  /api/activities/:id/progress` vagy hasonló), amit a kliens percenként
  hívna a legutóbbi köteg új pontjaival.

**Ez NEM egy délutáni feladat.** Új végpont, állapot-tárolás (Cloud
Storage vagy Firestore, TTL-lel), visszaesési logika, és a meglévő
`planActivity`/`commitActivity` átalakítása, hogy tudjon „folytatásból"
indulni. **Opus, emelt mélység kell hozzá** — ez architektúra-döntés, nem
rutinkód.

---

## Üzemeltetési jegyzetek (a #24-ből, még mindig érvényes)

### Éles naplók olvasása

```
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="grundo-api" AND httpRequest.requestMethod="POST"' --project grundo --freshness=2d --limit 40 --format="value(timestamp,httpRequest.status,httpRequest.latency,httpRequest.requestSize,httpRequest.requestUrl)"
```

⚠️ A kérésnapló csak a státuszt adja — a konténer saját üzenetei (Firestore-
hibák teljes szövege) a `stderr` naplóban vannak: `logName:"stderr"` a
szűrőbe. ⚠️ PowerShellből a szűrő idézőjelei elvesznek — **Git Bashből
fusson**, ott a `gcloud` a `/c/Program Files (x86)/Google/Cloud SDK/
google-cloud-sdk/bin/` alól elérhető.

### Helyi teszt-környezet

`localhost:5173` + Firestore/Auth emulátor + backend. Belépés:
`geri@grundo.local` / `grundo-emulator`, vagy konzolból
`await __grundoDevSignIn()`. Emulátoros tesztek Git Bashből, Java PATH
export után:
```
export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"
```

**A Simulation LAB (`/admin/lab`) hasznos eszköz élő rögzítés
teszteléséhez** — a seed-fiók `owner` szerepkört kap, útvonal rajzolható a
térképen, „Scenario mentése" után az „E2E · Éles UI" (`/admin/lab/e2e`) a
VALÓDI `TrackingScreen`+`Dock`+`Recorder`-t futtatja szimulált GPS-sel. Ezt
használtam a dokk-hiba reprodukálásához.

### Natív build

Ezen a gépen NINCS Android SDK (`gradlew` „SDK location not found"-dal áll
meg) és NINCS Xcode. A Swift/Java módosítások (`2ab519f`-ből: a zárolt
képernyős táv szinkron, a #24-ben) és a mostani változtatások natív
oldala kizárólag Codemagic buildben fordul le és tesztelhető készüléken.

---

## 0. MODELLJAVASLAT a folytatáshoz

**Sonnet, normál mélység** — a „nyugodtan bezárhatod" kezelés (A pont): a
kellékek (idempotencia, push, `onSnapshot`) már megvannak, ez felület- és
állapotgép-munka ismert mintákra.

**Opus, emelt mélység** — a szerveroldali részszámítás (B pont): új
állapot-életciklus, visszaesési ág, és egy meglévő, kritikus motor
(`activityCommit.ts`/`activityChunked.ts`) átalakítása. Rossz döntés itt
csendben rossz területet adhat egy felhasználónak.

# GRUNDO handoff

> Frissítve: **2026-08-30** · a **#21** menet vége, átadás **#22**-re
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`**, **minden pusholva** (`9518aff`). `npx tsc --noEmit` tiszta
> mindkét oldalon, teljes `npx vitest run`: 577/700 (123 kihagyva), nincs
> regresszió a menet egyetlen commitjában sem.

## A #21 MENET TÉMÁJA: iOS/Android energia-/hőelemzés + mérés

Geri panasza: a GRUNDO iOS release buildje tétlenül is melegíti a telefont,
sokat fogyaszt rögzítés közben. A menet lépései: (1) statikus kódelemzés →
17 lelet + terv (Artifact-ban átadva, a chat elején, nincs fájlban), (2) 1–3.
hullám javítása, (3) egy Android WebView-debug mellékszál, (4) VALÓS mérés
Chrome DevTools Performance trace-ekkel egy Samsung S20 FE-n.

⚠️ **ÉLESBEN RÉSZLEGES**: a webes frontend (`https://grundo.web.app`)
TELEPÍTVE a menet végén (`9518aff`, beleértve mindhárom hullámot). A backend
NEM változott, nem is kellett telepíteni. Az Android/iOS natív buildek
Codemagic-on lefutottak — de csak `e203bef`-ig (B5-ig) lettek TELEPÍTVE a
teszt-telefonra és mérve; **az A5 és a D2 még nincs eszközön ellenőrizve**,
csak `tsc`/`vitest`/böngészős (dev szerver) próbával.

### 1. hullám (`b167a51`) — CSS-animációk, wakelock, memoizálás, csomagméret

A1 (Dock-lüktetés kompozitálhatóra + véges), A2 (láthatatlan
`backdrop-filter`-ek törölve), B1 (képernyőzár-tiltás natív appban ki), B3
(`MapView` props memoizálva), D1 (`sourcemap: false` natív buildhez — mérve:
13 MB → 3,6 MB), C4 (`@capacitor/geolocation` törölve).

### 2. hullám (`687fc1d`) — inkrementális cellalánc, natív sor, Live Activity

B2 (`IncrementalCellPath`, `src/game/cells.ts`, 6 új teszt), B4 (`MapPane`
`React.memo`-ba emelve), B7 (nyomvonal-`setData` 3 mp-re throttolva), C1
(natív pontsor memóriában, háttérben 10 mp-enkénti lemezírás), C2 (Live
Activity natív frissítése csak háttérben, 10 mp-re ritkítva), C3
(mozgásformafüggő `distanceFilter`).

⚠️ **A Swift-kód (C1/C2/C3) NINCS lefordítva ezen a gépen** (nincs Xcode/Mac)
— csak Codemagic-buildel ellenőrizve, ESZKÖZÖN/Instrumentsszel MÉG SOHA.

### 3. hullám (`e203bef`, `b24249d`, `9518aff`)

- **B5** (`e203bef`): az `App.tsx` `Router()`-je — a teljes útválasztó —
  korábban a teljes `useRecorderContext()`-et kérte le, pedig csak
  `upload.status`-t használ. Új, könnyű context
  (`useRecorderUploadStatus`, `RecorderProvider.tsx`) — a Router többé nem
  renderelődik újra minden GPS-mintánál. **ESZKÖZÖN MÉRVE** (lásd lent).
- **A5** (`b24249d`): `useNotifications()` mostantól `NotificationsProvider`-
  ben fut egyszer (`useNotifications.tsx`, átnevezve JSX miatt) — a Kezdőlap
  harangja és a `NotificationPanel` egy közös `onSnapshot`-ot oszt meg a
  korábbi kettő helyett. **ESZKÖZÖN MÉG NINCS MÉRVE.**
- **D2** (`9518aff`): a 21 játékos képernyő (Home kivételével) `lazy()`-ra
  váltott, közös `Suspense`-szel. Mérve buildben: belépő csomag
  557,88 kB → 425,69 kB (gzip 168,60 kB → 129,11 kB). Böngészős
  próba (helyi dev szerver): `/udvozles`, `/belepes` hibátlan, konzolhiba
  nincs. **ESZKÖZÖN MÉG NINCS MÉRVE.**
- **A4 — SZÁNDÉKOSAN NINCS MEGCSINÁLVA.** A #2-es trace két Mapbox
  worker-készlete valószínűleg NEM képernyőváltásból jött, hanem a
  `TrackingScreen` teljes statisztika-nézetéből: ott a kód SZÁNDÉKOSAN
  állítja le teljesen a Mapbox-példányt (Geri kérése, 2026-08-27,
  `TrackingScreen.tsx` a `statsView !== 'full'` ág felett kommentben).
  Megkérdeztem Gerit, hogy ezen a ponton váltsunk-e „csak elrejtés"-re
  (életben tartott példány, nincs újraépülés, de rejtve is fogyaszt
  valamennyit) — **Geri a mai leállítást választotta, marad a jelenlegi
  viselkedés.** A NAGYOBB, eredeti A4-ötlet (egyetlen, KÉPERNYŐK KÖZÖTT is
  túlélő Mapbox-példány, React Portal-lal) továbbra is nyitott, külön menetet
  igénylő tétel, ha valaha releváns lesz — ÁLLÁS: NEM KEZDTEM EL, mert a
  konkrét kiváltó ok másnak bizonyult, és a nagy verzió kockázata/mérete
  külön döntést igényel.

### WebView remote debugging (`41d9e4b` → javítva `fe004c0`)

Geri teljesítménytesztet futtatott Chrome DevTools-szal egy Play
Console-os RELEASE buildön. Az első próbálkozás
(`WebView.setWebContentsDebuggingEnabled(true)` a `MainActivity.java`-ban)
**hatástalan volt**: a Capacitor `Bridge` MINDIG saját maga hívja meg
ugyanezt, `BuildConfig.DEBUG`-ra alapozva, MINDIG KÉSŐBB, mint bármi, amit
előtte írnánk. A helyes megoldás **konfigurációs kapcsoló**:
`capacitor.config.ts` → `android.webContentsDebuggingEnabled: true`.

⚠️ **EZ IDEIGLENES, TÖRLENDŐ A MÉRÉS UTÁN** — jelölve a fájlban. Van
`ios.webContentsDebuggingEnabled` megfelelője is (nem bekapcsolva), ha
valaha Safari Web Inspectorral kellene iOS-t mérni.

⚠️ **Ha újra kell csinálni valahol**: NE Java/Swift kódból — mindig a
Capacitor konfigból. A `Bridge`/`WKWebView` mindig felülírja, amit előtte
beállítanál.

## MÉRVE, NEM TIPPELVE — négy Chrome DevTools Performance trace

Geri négy `.json.gz` trace-t vett fel Samsung S20 FE-n (USB,
`chrome://inspect`), Node-szkripttel elemezve (Trace Event Format,
`source-map-js` a `dist/assets/*.js.map`-ekhez).

| Trace | Forgatókönyv | Build | Tétlen % |
|---|---|---|---|
| #1 (20,65 mp) | Grund képernyő, semmi nem történik | 1–2. hullám | **96,0%** |
| #2 (66 mp) | Rögzítés + szünet/folytatás + nézetváltás + réteg ki/be | 1–2. hullám | 60,3% |
| #3 (61 mp) | **Aktív rögzítés, telefon mozdulatlanul** | 1–2. hullám | **95,5%** |

(Egy 4. trace-re — B5 hatásának mérésére — Geri döntése alapján ebben a
menetben már nem került sor: „most ne mérjünk, haladjunk a fázisokkal".)

**A legfontosabb eredmény (#3-ból)**: a `RunTask` 15 mp-es negyedekre bontva
**1314,6 → 476,9 → 462,8 → 446,0 ms** — lapos, nem növekvő. Ez konkrét
bizonyíték arra, hogy a B2 inkrementális cellalánc tartja magát folyamatos
rögzítés alatt (a régi hiba mellett ez a görbe emelkedne).

**#2-ből az A4-hez vezető nyom**: két külön Mapbox worker-készlet — később
kiderült, hogy ez valószínűleg a `statsView==='full'` váltásból jött, nem
képernyőváltásból (lásd A4 fent). A legdrágább azonosított tételek
(`mapbox-gl.js` `_render()`-je 13,4%, React saját Scheduler csomagja 6,5%)
Geri kattintgatásának ára voltak, nem háttérhiba — de a Scheduler-teher
közvetlen indoka volt a B5-nek.

⚠️ **Módszertan, ha meg kell ismételni**: `.json.gz` export a DevTools
Performance panelről. `gunzip` + `JSON.parse` Node-ból
(nagy trace-nél `--max-old-space-size=8192`). `thread_name`/`process_name`
→ `CrRendererMain` tid. CPU-minták: `Profile` + `ProfileChunk` UGYANAZZAL az
`id`-vel (⚠️ NEM `tid` köti össze — külön `v8:ProfEvntProc` szálon vannak).
Konkrét függvény: `FunctionCall`/`v8.callFunction`
`args.data.{url,lineNumber,columnNumber}` + a megfelelő `.js.map` +
`source-map-js` (már a repóban, `node_modules/source-map-js`). A saját
`index-*.js` hash-e csatornánként eltér, de UGYANABBÓL a commitból
újraépítve a sorok/oszlopok egyeznek. `chrome://inspect`-et a
böngésző-automatizálás biztonsági okból nem tudja megnyitni — Gerinek kell
kézzel csinálnia.

⚠️ **A `chrome://inspect` „Device information is stale" hibája**: az adb
szerver (`adb kill-server && adb start-server`) újraindítása nem segített
tartósan — a végleges megoldás a Chrome TELJES újraindítása volt (nem csak a
fül bezárása).

## KÖVETKEZŐ MENET

A tervezett energia-hullámok (1–3.) mind lezárva. Nyitva maradt:

1. **A5 és D2 eszközön nincs mérve.** Ha van rá mód, egy Codemagic build
   `9518aff`-ból + `chrome://inspect` trace megmutatná, csökkent-e tovább a
   React Scheduler-teher és a WebView-indulási idő.
2. **A nagy A4 (Portal-alapú, képernyők közötti közös Mapbox-példány)**
   nyitott, külön menetet igénylő tétel — csak akkor érdemes elkezdeni, ha
   valódi, gyakori képernyőváltás (nem a stats-toggle) okoz mérhető
   költséget. Nincs indokolva, amíg nincs erre külön mérés.
3. **iOS-oldal (C1/C2/C3) eszközön ellenőrizetlen** — nincs Mac. A
   `MetricKit` (naponta egyszeri, magától az eszköztől jövő
   energia-/teljesítmény-jelentés, Firestore-ba írva) az egyetlen Mac
   nélküli út valódi iOS-mérésre — FELVETVE, DE NINCS ELKEZDVE, mert ez saját
   fejlesztést igényel (Swift-kód, ami a `MXMetricManager` payloadot fogadja
   és felküldi), külön menetet érdemel.
4. **`capacitor.config.ts` `android.webContentsDebuggingEnabled: true`**
   MÉRÉS UTÁN törlendő — ne maradjon bent nyilvános kiadásban.

## NYITOTT KISEBB ÜGYEK

- `emulator-5562 offline` folyamatosan megjelenik Geri gépén `adb devices`
  kimenetében — ismeretlen eredetű, nem zavarja a tesztelést, tisztázatlan.

## 0. MODELLJAVASLAT a folytatáshoz

Ha az A5/D2 eszközös mérése jön: **Sonnet, alacsony-közepes mélység** — csak
mérés és értelmezés, nincs kódírás.

Ha a MetricKit-integráció indul: **Sonnet, közepes mélység** — új, jól
körülhatárolt Swift-kód (payload-fogadás + Firestore-írás), nincs
architektúra-döntés.

Ha a nagy A4 (Portal-alapú közös térkép) indul: **Opus, magas mélység** — ez
architektúra-döntés (hol éljen a DOM-elem, hogyan add át az imperatív
vezérlést 4 fogyasztónak), nem mechanikus átalakítás.

# GRUNDO handoff

> Frissítve: **2026-08-30** · a **#21** menet közepe, ugyanebben a
> beszélgetésben folytatódik a **3. hullám**
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`**, **minden pusholva** (`fe004c0`). ⚠️ **A #21 EDDIGI ANYAGA
> ÉLESBEN NINCS** — az energiafixek Codemagic-buildekben vannak (Android
> lefutott és telepítve Play belső tesztre, iOS lefutott, de a natív Swift
> rész eszközön nincs ellenőrizve), a `deploy.sh` (web/backend) nem futott
> ezen a #21 menetben, mert egyik commit sem érintette a `server/`-t vagy a
> webes buildet érdemben. `npx tsc --noEmit` tiszta mindkét oldalon, teljes
> `npx vitest run`: 577/700 (123 kihagyva), nincs regresszió.

## A #21 MENET EDDIGI TÉMÁJA: iOS energia-/hőelemzés + mérés

Geri panasza: a GRUNDO iOS release buildje tétlenül is melegíti a telefont, és
sokat fogyaszt rögzítés közben. A menet két részből állt: (1) statikus
kódelemzés → 17 lelet + terv (Artifact-ban átadva, lásd a beszélgetés elejét,
nincs fájlban), (2) az 1–2. hullám tényleges javítása, (3) egy Android
WebView-debug mellékszál, (4) VALÓS mérés Chrome DevTools Performance
trace-ekkel — ez utóbbi az, ami miatt ez a menet szokatlanul erős: nem csak
kódolvasásból, hanem élő adatból tudjuk, hogy a fixek működnek.

### 1. hullám (`b167a51`) — CSS-animációk, wakelock, memoizálás, csomagméret

- **A1**: a Dock Play-gombjának lüktetése `box-shadow`-ról (minden
  képkockán újrafestés) kompozitálható `transform`/`opacity`-re állt
  (`Dock.css` `::after` pszeudoelem), és véges (6 kör) az `--idle`
  állapotnál — a `--armed` (rövid életű, választás/visszaszámlálás alatt)
  marad végtelen.
- **A2**: `backdrop-filter` törölve minden helyen, ahol a háttér 92–100%-ban
  tömör volt (Dock, Grund kártyák/fejléc, Rögzítés jegyzetei) — láthatatlan
  hatás, valós GPU-költség.
- **B1**: `acquireWakeLock` natív appban (`isNativeApp()`) azonnal visszatér
  — a képernyőzár-tiltás kizárólag a webes rögzítés feltétele, natívan a
  `BackgroundLocationPlugin` méri zárolt képernyőnél is.
- **B3**: `MapView` `ownerColors`/`layers` propjai `useMemo`-ba kerültek
  mindkét térképes képernyőn (Rögzítés, Grund) — korábban inline objektum
  volt, ami minden rendernél (a másodperces stopper is!) kiütötte a
  hexagon-réteg memóját.
- **D1**: `sourcemap: false` natív buildhez (`vite.config.ts`,
  `VITE_BUILD_CHANNEL !== 'web'`). Mérve: az iOS-be másolt webes mappa
  13 MB → 3,6 MB.
- **C4**: a sehol nem használt `@capacitor/geolocation` függőség törölve.

### 2. hullám (`687fc1d`) — inkrementális cellalánc, natív sor, Live Activity

- **B2**: `IncrementalCellPath` (`src/game/cells.ts`) — a `traceToCellPath`
  korábban a TELJES nyomvonalra futott minden GPS-mintánál (négyzetesen nőtt
  a munka). Az új osztály csak az új pontokat dolgozza fel. 6 új teszt.
- **B4**: a térkép JSX külön `MapPane` `React.memo`-komponensbe emelve
  (`TrackingScreen.tsx`) — a másodperces stopper (`now`) többé nem futtatja
  újra a `MapView`-t.
- **B7**: a nyomvonal-rajzolás (`syncTrackData`) élő rögzítésnél legfeljebb
  3 mp-enként frissül (`MapView` új `live` prop), azonnali flush indításkor/
  reseten/befejezéskor.
- **C1**: a natív pontsor (`BackgroundLocationPlugin.swift`) memóriában
  gyűlik, csak háttérben, 10 mp-enként íródik `UserDefaults`-ba.
- **C2**: a Live Activity natív (GPS-alapú) frissítése kizárólag háttérben
  fut — előtérben a JS oldali `syncActivity` az egyetlen forrás; a háttéres
  ág is 10 mp-re ritkítva (`GrundoLiveActivityController.swift`).
- **C3**: `distanceFilter` mozgásformánként eltérő (séta 8 m, futás 5 m,
  bringa 12 m).

⚠️ **A Swift-kód (C1/C2/C3) NINCS ezen a gépen lefordítva** (nincs Xcode/Mac)
— csak Codemagic-buildel ellenőrizve, ESZKÖZÖN MÉG NEM. Ha iOS-es mérés
jönne egy következő körben, ez a nyitott kockázat.

### WebView remote debugging (`41d9e4b` → javítva `fe004c0`)

Geri teljesítménytesztet akart futtatni Chrome DevTools-szal egy Play
Console-os RELEASE buildön (Samsung S20 FE, USB, `chrome://inspect`). Az
első próbálkozás (`WebView.setWebContentsDebuggingEnabled(true)` a
`MainActivity.java`-ban) **hatástalan volt** — hosszas élő eszközös
diagnosztika után kiderült: a Capacitor `Bridge` MINDIG saját maga hívja meg
ugyanezt, `BuildConfig.DEBUG`-ra alapozva (tehát release buildben `false`),
és ez a hívás a MI `super.onCreate()`-ünkön belülről fut — mindig később,
mint bármi, amit előtte írnánk. A helyes megoldás **konfigurációs kapcsoló**,
nem kód: `capacitor.config.ts` → `android.webContentsDebuggingEnabled: true`.
Ez KÖZVETLENÜL azt az alapértéket írja felül, amit a `CapConfig` ad a
`Bridge`-nek.

⚠️ **EZ IDEIGLENES, TÖRLENDŐ A MÉRÉS UTÁN** — a `capacitor.config.ts`
tetején jelölve. Van egy `ios.webContentsDebuggingEnabled` megfelelője is,
ha valaha Safari Web Inspectorral kellene iOS-t mérni (nem bekapcsolva).

⚠️ **Ha valaha újra kell csinálni**: NE Java/Swift kódból — mindig a
Capacitor konfigból. A `Bridge`/`WKWebView` mindig felülírja, amit előtte
beállítanál.

## MÉRVE, NEM TIPPELVE — három Chrome DevTools Performance trace

Geri három `.json.gz` trace-t vett fel a fenti Samsung telefonon (USB,
`chrome://inspect`), amiket Node-szkripttel (nem a UI-n át) elemeztem —
Trace Event Format, CPU-mintavétel dekódolva forrástérképpel
(`source-map-js`, lásd lent a pontos módszertant).

| Trace | Forgatókönyv | Tétlen % |
|---|---|---|
| #1 (20,65 mp) | Grund képernyő, semmi nem történik | **96,0%** |
| #2 (66 mp) | Rögzítés + szünet/folytatás + nézetváltás + réteg ki/be | 60,3% |
| #3 (61 mp) | **Aktív rögzítés, telefon mozdulatlanul, semmi interakció** | **95,5%** |

**A legfontosabb eredmény (#3-ból)**: a `RunTask` (fő szál összes munkája)
15 másodperces negyedekre bontva: **1314,6 → 476,9 → 462,8 → 446,0 ms** — az
első negyed az indítási költség, utána LAPOS, sőt enyhén csökkenő. Ha a
B2 előtti `traceToCellPath`-hiba (minden mintánál a teljes nyomvonalra fut)
még bent lenne, ez a görbe EMELKEDNE minden negyedben. Ez konkrét,
folyamatos rögzítés alatti bizonyíték arra, hogy az inkrementális
cellalánc-javítás tartja magát.

**#2-ből egy konkrét, számszerű A4-bizonyíték**: a trace-ben KÉT külön
Mapbox worker-készlet jött létre (két `DedicatedWorker thread`-pár) — a
térkép ténylegesen újraépült valamikor (feltehetően a teljes
statisztika-nézetbe váltás és vissza). A leazonosított legdrágább tételek
(`mapbox-gl.js` saját `_render()`-je 8,83 mp/66 mp = 13,4%, React saját
Scheduler csomagja 4,3 mp/66 mp = 6,5%) mind a Geri-féle KATTINTGATÁS ára
(kameramozgás, réteg-ki/be), nem háttérben futó hiba — de a Scheduler-teher
közvetlen indok a B5-re (lásd lent).

⚠️ **Módszertan, ha meg kell ismételni**: a trace `.json.gz` a DevTools
Performance panel letöltés-ikonjával exportálható. Elemzés Node-ból
(`gunzip` + `JSON.parse`, nagy trace-nél `--max-old-space-size=8192`):
- `thread_name`/`process_name` eventekből azonosítsd a `CrRendererMain`
  tid-jét.
- CPU-mintavétel: `Profile` event (`id`) + `ProfileChunk` eventek
  UGYANAZZAL az `id`-vel (⚠️ NEM a `tid` köti össze őket — a `ProfileChunk`
  egy külön `v8:ProfEvntProc` szálon van). `cpuProfile.nodes` +
  `timeDeltas` + `samples` rekonstruálja a mintákat; `(idle)`/`(program)`/
  `(garbage collector)` a hívási fa gyökér-közeli kategóriái.
- Konkrét függvény azonosításához: `FunctionCall`/`v8.callFunction` events
  `args.data.{url,lineNumber,columnNumber}` + a megfelelő `dist/assets/*.js.map`
  + `source-map-js` (`node_modules/source-map-js`, már a repóban van).
  ⚠️ A saját `index-*.js` hash-e build-csatornánként eltér
  (`VITE_BUILD_CHANNEL` string), de UGYANABBÓL a commitból újraépítve a
  sorok/oszlopok egyeznek — a `mapbox-*.js`/`h3-*.js`/`firebase-*.js` hash-e
  változatlan commit mellett bitre egyezik.
- `chrome://inspect`-et a böngésző-automatizálás (Claude in Chrome
  extension) biztonsági okból nem tudja megnyitni — Gerinek kell kézzel
  ellenőriznie/exportálnia.

## KÖVETKEZŐ MENET — 3. hullám (ugyanebben a beszélgetésben folytatódik)

A tervezett négy tétel, nagyság szerint sorrendben:

1. **B5 — a rögzítő állapotának szétbontása.** A `RecorderProvider` az
   `App.tsx` gyökerén ül, minden GPS-minta a TELJES app-fát újrarenderelteti.
   A mai #2-es trace React Scheduler-terhelése (6,5%) közvetve ezt igazolja.
   Javaslat a korábbi tervből: a gyakran változó mezőket (pontok, táv)
   zustand-csatornába tenni, a Dock csak a státuszt olvassa.
2. **A4 — egyetlen Mapbox-példány útvonalváltás közben.** A #2-es trace
   MÉRVE mutatta: két worker-készlet = a térkép ténylegesen újraépült.
   Legnagyobb munkájú tétel — előbb érdemes megbecsülni, mennyi haszna
   lenne, mert egy útvonalváltást túlélő térkép-példány komoly
   átszervezés.
3. **A5 — értesítés-figyelő szolgáltatóba.** `useNotifications()` két külön
   `onSnapshot`-ot nyit (Kezdőlap harang + panel), amíg a panel nyitva van.
4. **D2 — útvonalszintű kódszétvágás.** A 22 játékos képernyő mind statikus
   import a belépő csomagban.

⚠️ **Kockázat-megjegyzés a saját korábbi tervemből**: mindhárom (B5, A4, A5)
nagyobb szerkezeti kockázatú, mint az 1–2. hullám bármelyik tétele — B5 és
A4 különösen, mert React-render-határokat/komponens-élettartamot
mozgatnak. Élő böngészős/eszközös ellenőrzés NÉLKÜL nem szabad elkezdeni —
most VAN hozzá eszköz (a `chrome://inspect` a Samsung telefonon működik),
tehát ki KELL használni: minden B5/A4 lépés után új Performance trace kell,
nem csak `tsc`/`vitest`.

## NYITOTT KISEBB ÜGYEK

- Az iOS Swift-kód (C1/C2/C3) eszközön ellenőrizetlen — Mac/Xcode hiányzik
  erről a gépről. Ha Geri hozzáfér Machez, `ios.webContentsDebuggingEnabled`
  ugyanígy bekapcsolható a Safari Web Inspectorhoz.
- A `capacitor.config.ts` `android.webContentsDebuggingEnabled: true` és a
  hozzá tartozó komment MÉRÉS UTÁN törlendő — ne maradjon bent egy tényleges
  nyilvános kiadásban.
- `emulator-5562 offline` folyamatosan megjelenik Geri gépén `adb devices`
  kimenetében — ismeretlen eredetű, valószínűleg egy másik telepített
  eszköz/emulátor próbál csatlakozni, nem zavarja a valódi tesztelést, de
  tisztázatlan.

## 0. MODELLJAVASLAT a folytatáshoz

**Sonnet, magas gondolkodási mélységgel** a B5/A4 tervezéséhez és
implementálásához — ez elsősorban React-architektúra-átalakítás, ismert
minta (zustand-csatorna, megosztott térkép-példány), nem algoritmikus döntés
vagy adatmodell-kérdés, ami Opust indokolná. Ha viszont a mérés valami
váratlant mutat (pl. a memoizáció után is nő a render-idő), érdemes lehet
Opusra váltani a hibakereséshez.

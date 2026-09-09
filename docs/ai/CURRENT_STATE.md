# Jelenlegi állapot

> Frissítve: **2026-09-09** · Menetszám: **#44, lezárva**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **main** · HEAD: **ca33a6d**
> Utoljára dolgozott: **Claude (Opus, High)**
> Átadva: **Claude vagy Codex** — a következő lépés a **készülékes ellenőrzés
> egy új iOS buildből**, utána a bugreport **F2** (képernyőkép)

## Jelenlegi cél

A bugreport rendszer **F1-e (nem natív rész) kész és élesben van**, és a
helyengedély-kérés sorrendje is javítva. Mindkettő **készülékes
visszaigazolásra vár** — ehhez új iOS build kell, mert a natív app a saját
buildjébe zárt web-csomagot futtatja.

## Elkészült

**1. Bugreport rendszer, F1.** Terv:
[`terv-2026-09-09-bugreport-rendszer.md`](terv-2026-09-09-bugreport-rendszer.md)
(négy fázis). Ebben a menetben az egész **nem natív** rész elkészült: `bugReports`
gyűjtemény szerver-only írással, melléklet-előtag mindkét oldalon ellenőrizve,
üzemmód-választó és lebegő gomb a tesztelői körnek, 200 elemű morzsanapló,
JS-alapú crash-felismerés, admin **Bugreportok** fül. A képernyőkép és a videó
menüpont a helyén van, letiltva (F2/F3).

**2. A helyengedély három rendszerablaka.** A magyarázó képernyő megjelent, de a
rendszer kérdése ráugrott: a `TrackingScreen` a **mountján** kért helyzetet, a
magyarázattól függetlenül. Az **angol, „localhost" nevű** ablak beazonosítva —
nem a rendszer és nem mi küldtük, hanem a **WebKit oldal-szintű
engedélykérése**, amit a `navigator.geolocation` váltott ki. A javítás után
natívban egyetlen `navigator.geolocation` hívás sincs.

⚠️ A tartós megkötések a **`DECISIONS.md`**-ben vannak („Bugreport rendszer —
F1", „Helyzetlekérdezés natívban") — azokat nem szabad visszacsinálni. Egy új
hibaminta a `grundo-lessons` skillben (17.).

## Módosított fájlok (`e9f7d39..ca33a6d`, 2 commit, 41 fájl, +3998/−126)

| Fájl | | +/− | Mit |
|---|---|---|---|
| `server/src/routes/bugreports.ts` + `.test.ts` | ÚJ | +402 | beküldő és triázs végpontok, `mediaPathBelongsTo()` |
| `server/src/lib/adminAudit.ts` · `routes/admin.ts` | ÚJ/M | +109 | a napló külön modulba, `/testers` végpont, alútvonal |
| `src/admin/BugReportsScreen.tsx` + `.css` | ÚJ | +652 | lista, adatlap, státusz, tesztelő-kezelés |
| `src/components/DebugFab.tsx` · `DebugLayer.tsx` · `ModeChooser.tsx` · `BugReportSheet.tsx` · `debug.css` | ÚJ | +909 | a teljes tesztelői felület |
| `src/lib/debugMode.ts` · `breadcrumbs.ts` · `bugReport.ts` (+ tesztek) | ÚJ | +731 | üzemmód, menet, morzsanapló, beküldés |
| `src/lib/currentPosition.ts` + `.test.ts` | ÚJ | +193 | **egyetlen** helyzetlekérdező belépési pont |
| `src/lib/api.ts` | M | +145 | bugreport típusok és végpontok, `Profile.tester` |
| `src/screens/TrackingScreen.tsx` · `LocationPrimer.tsx` | M | +114/−… | helyzetkérés a `primerSeen` mögé, valós lépések, elavult üzenet törölve |
| `ios/…/BackgroundLocationPlugin.swift` · `android/…/BackgroundLocationPlugin.java` | M | — | új `getCurrentPosition` (iOS-en külön `CLLocationManager`-en) |
| `firestore.rules` · `storage.rules` · `firestore.indexes.json` | M | +17 (storage) | szerver-only dokumentum, melléklet-előtag, 3 index + 2 index-tiltás |

## Élesben fut / telepítetlen

- **Mind a négy egység telepítve** a `ca33a6d` tartalmával: **indexek**,
  **szabalyok**, **backend**, **frontend**. A backend egészséges
  (`/healthz/` → `{"ok":true,"database":"grundo-db"}`), a `POST /api/bugreports`
  token nélkül **401**-et ad (tehát a végpont be van kötve), és a
  `grundo.web.app` a most buildelt csomagot szolgálja.
- ⚠️ **iOS/Android build NEM készült.** A natív app a saját buildjébe zárt
  web-csomagot futtatja, ezért a telefonokon **még a régi viselkedés fut** —
  a helyengedély-javítás és a tesztelői felület is csak új natív buildben él.
- ⚠️ **A tesztelői jog nincs kiosztva senkinek.** A lebegő gomb addig csak
  admin szerepkörrel jelenik meg. Kiosztás: admin → Bugreportok → Tesztelők.

## Ellenőrzések

- `npm run test`: **879 zöld**, 181 skip. `tsc --noEmit` kliens **és** szerver:
  zöld. `npm run build`: zöld.
- A `firestore.rules` és a `storage.rules` hibátlanul betöltődik a Firestore- és
  Storage-emulátorban, és a telepítés is hibátlanul fordította.
- **Mérve:** a debug réteg külön csomagdarab (`DebugLayer-*.js` ~10,7 kB +
  3,9 kB CSS), a belépő csomag egyetlen sorát sem tartalmazza.
- ⚠️ **NEM ellenőrzött:** a két natív `getCurrentPosition` (iOS + Android), az
  hogy az angol „localhost" ablak tényleg eltűnik, és a bugreport első valódi
  beküldése végponttól Storage-ig. Emulátoros tesztkészlet nem futott (a
  bugreport-végpontokra nincs emulátoros teszt).
- ℹ️ A `VITE_RECAPTCHA_SITE_KEY` üres a `.env.production`-ban (a bevezetése óta
  így van): az App Check emiatt el sem indul a kliensen. Nem regresszió, de
  eldöntendő, hogy így akarjuk-e.

## Nyitott ügyek

- **Készülékes visszaigazolás új iOS buildből** — ez a legrégebbi nyitott
  tétel, már a #43 óta. Ellenőrzendő: a tájékoztató alatt **nem** ugrik fel
  rendszerablak · az **angol „localhost" ablak eltűnt** · Play-nél egyetlen
  rövid koppanás · 3-2-1 a számokkal · **Bluetooth-fülhallgatón is szól** ·
  némító gomb · tulajdonos-kártya · popup nyila háromszög · új telepítésnél
  **csak két** engedélykérdés · a lebegő bogár-gomb működik és húzható.
- **Bugreport F2** — képernyőkép: saját Capacitor-plugin iOS-en
  (`WKWebView.takeSnapshot`) és Androidon (`PixelCopy`). Utána **F3** (videó,
  ReplayKit / MediaProjection) és **F4** (Crashlytics, jóváhagyva).
- A **funkció-lista** a #43-ból, sorrend nélkül: üres felületek (Közösség →
  kihívások, útlevél; Profil → statisztika) · sehova nem vezető menüpontok
  (Mértékegységek, Csatlakoztatott appok, Előfizetés) · adatkezelési
  tájékoztató és ÁSZF · aktivitás jelentése · banda törlése.
- A térképrajzolás (Mapbox `setData`/GPU) önálló mérőszáma hiányzik.
- Egy **teljes kód-audit** kérésben volt; félbeszakadt az állapotfelmérés után.

## Modelljavaslat

Az F2/F3 natív munkájához (WebView-pillanatkép, képernyőrögzítés, engedélyek)
**Opus, High** — natív hibát teszt nem bizonyít, mérni kell. A funkció-lista
képernyőihez, űrlapjaihoz és CRUD-jaihoz **Sonnet, Medium**.

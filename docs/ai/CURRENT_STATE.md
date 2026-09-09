# Jelenlegi állapot

> Frissítve: **2026-09-09** · Menetszám: **#45, lezárva**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **main** · HEAD: **6f5590e**
> Utoljára dolgozott: **Claude (Sonnet, Medium)**
> Átadva: **Claude vagy Codex** — a következő lépés a **készülékes
> ellenőrzés egy új iOS/Android buildből** (F2, képernyőkép)

## Jelenlegi cél

A **#44 lezárt** (bugreport F1 + helyengedély sorrendje) **készüléken
visszaigazolva**: minden ellenőrzőlista-tétel OK. Ebben a menetben elkészült
a bugreport **F2 (képernyőkép)** — teljes lánc, natív pluginnal mindkét
platformon —, ami szintén **készülékes visszaigazolásra vár**.

## Elkészült

**Bugreport F2, képernyőkép.** Terv:
[`terv-2026-09-09-bugreport-rendszer.md`](terv-2026-09-09-bugreport-rendszer.md)
(9. pont). Saját Capacitor-plugin, nem `html2canvas` (az a DOM-ot rajzolná
újra, a Mapbox GL vászon üresen maradna):
- **iOS**: `WKWebView.takeSnapshot`, PNG base64-ben.
- **Android**: `PixelCopy` a bridge WebView-ján.
- **JS belépési pont** (`src/lib/screenshot.ts`): natívon a pluginra megy,
  weben elutasít (nincs natív pillanatkép a böngészőben).
- A lebegő 🐞 gomb és a menü **eltűnik a capture pillanatában** (2 animációs
  keret vár rá), utána visszaáll — a plugin a TELJES webnézetet menti, a
  debug-felület is rajta lenne, ha nyitva marad.
- A melléklet a meglévő F1-es Storage-útvonalon megy fel
  (`bugreports/{uid}/{reportId}/`, `storage.rules` + `mediaPathBelongsTo()`),
  a `submitBugReport(draft, media?)` bővült ezzel.
- `DebugFab.tsx`-ben a „Képernyőkép" sor élesítve natívban.

## Módosított fájlok (`5dada26..6f5590e`, 1 commit, 10 fájl, +378/−24)

| Fájl | | +/− | Mit |
|---|---|---|---|
| `ios/App/App/BugReportPlugin.swift` | ÚJ | +46 | `takeSnapshot` → base64 PNG |
| `android/.../BugReportPlugin.java` | ÚJ | +75 | `PixelCopy` → base64 PNG |
| `GRUNDOBridgeViewController.swift` · `MainActivity.java` | M | +2 | plugin regisztrálva |
| `src/lib/screenshot.ts` + `.test.ts` | ÚJ | +106 | JS belépési pont, teszt |
| `src/lib/bugReport.ts` | M | +40 | `submitBugReport(draft, media?)`, Storage-feltöltés |
| `src/components/BugReportSheet.tsx` | M | +20 | opcionális `media` prop, kép-előnézet |
| `src/components/DebugFab.tsx` | M | +104 | capture-folyamat, gomb elrejtése |
| `src/components/debug.css` | M | +9 | `.dbg-shot-preview` |

## Élesben fut / telepítetlen

- A `ca33a6d` (F1 + helyengedély) **készüléken visszaigazolva**, minden
  ellenőrzőlista-tétel OK.
- ⚠️ **A `6f5590e` (F2) még NEM épült be natív buildbe.** Új Codemagic
  build kell (`ios-testflight` workflow) mindkét platformhoz.
- Az élesben futó frontend/backend/szabályok/indexek a `ca33a6d` tartalmát
  szolgálják — az F2 kliensoldali kódja (JS) még nem lett újratelepítve, de
  ez nem sürgős, mert natív plugin nélkül a gomb továbbra is a régi,
  letiltott állapotban marad weben és a régi natív buildben.

## Ellenőrzések

- `npm run test`: **882 zöld** (F1-hez képest +3, a `screenshot.test.ts`),
  181 skip. `tsc --noEmit` kliens **és** szerver: zöld. `npm run build`:
  zöld — `DebugLayer` chunk 10,7 kB → 12,68 kB, továbbra is a belépő
  csomagtól elkülönítve.
- ⚠️ **NEM ellenőrzött** (natív kód, Windowsról nem tesztelhető):
  - iOS: a `takeSnapshot` tényleg kihagyja-e a natív chrome-ot, és a
    Mapbox GL vászon **nem** üres-e a mentett képen.
  - Android: a `PixelCopy` `getActivity().getWindow()`-ja a bridge
    Activity-n a webView tényleges képernyő-koordinátáit adja-e
    (státuszsáv/nav-sáv eltolás).
  - A 🐞 gomb eltűnése/visszatérése villan-e a képen.
  - A feltöltött PNG az admin Bugreportok fülön aláírt URL-en megnyílik-e.

## Nyitott ügyek

- **Készülékes visszaigazolás új iOS/Android buildből** — F2 (képernyőkép):
  fenti négy NEM ellenőrzött tétel.
- **Bugreport F3** (videó, iOS `ReplayKit` / Android `MediaProjection` +
  `MediaRecorder`, 30 mp-es vágás, MP4) és **F4** (Crashlytics, jóváhagyva)
  — még nincs megírva.
- A **funkció-lista** a #43-ból, sorrend nélkül: üres felületek (Közösség →
  kihívások, útlevél; Profil → statisztika) · sehova nem vezető menüpontok
  (Mértékegységek, Csatlakoztatott appok, Előfizetés) · adatkezelési
  tájékoztató és ÁSZF · aktivitás jelentése · banda törlése.
- A térképrajzolás (Mapbox `setData`/GPU) önálló mérőszáma hiányzik.
- Egy **teljes kód-audit** kérésben volt; félbeszakadt az állapotfelmérés után.

## Modelljavaslat

Az F3-hoz (natív videórögzítés, engedélyek, tömörítés) **Opus, High** —
natív hibát teszt nem bizonyít, mérni kell. A funkció-lista képernyőihez,
űrlapjaihoz és CRUD-jaihoz **Sonnet, Medium**.

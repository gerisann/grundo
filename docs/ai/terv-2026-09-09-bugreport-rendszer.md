# Terv — Bugreport rendszer (GRUNDO #44)

> Készült: **2026-09-09** · Menet: **#44** · Modell: Opus, High
> Állapot: **F1 kész és készüléken ellenőrizve; F2 iOS-en készüléken
> ellenőrizve, Androidon ellenőrizendő; F3–F4 implementálva, új natív
> buildekben és készüléken ellenőrizendő.**

A tesztelők ma szóban jelentik a hibákat, és minden alkalommal ugyanaz a kör
megy le: melyik buildben? melyik képernyőn? mi volt előtte? A cél, hogy egy
koppintás elküldje azt, amit különben visszakérdezünk.

---

## 1. Amit a rendszer nyújt

| Beküldés | Mit tartalmaz | Fázis |
|---|---|---|
| **Report** | csak kontextus: build, eszköz, útvonal, engedélyek, morzsanapló | **F1** |
| **Képernyőkép** | a fenti + egy PNG, a debug gomb nélkül | F2 |
| **Videó** | a fenti + max. 30 mp MP4, tömörítve | F3 |
| **Crash report** | a fenti + az összeomlás nyoma, a **következő indításkor** felajánlva | F1 (JS) / F4 (natív) |

Mind a négy **ugyanaz a dokumentum** a `bugReports` gyűjteményben, csak a
`kind` és a csatolt média különbözik. Így az admin fülnek egyetlen listája és
egyetlen adatlapja van, nem négy.

---

## 2. Ki látja a debug módot

⚠️ **Az üzemmód-választó NEM jelenhet meg mindenkinek.** Két oka van: az App
Store és a Play felülvizsgálója is látná (indoklást kérnének rá), és a valódi
felhasználó fele véletlenül „Debug"-ot választana, majd egy lebegő bogár-gombbal
használná az appot.

**A kapu:** `users/{uid}.tester === true`, amit az admin állít be, **vagy**
bármilyen admin szerepkör (`owner`/`admin`/`moderator`/`support`/`readonly`).
Helyi fejlesztésben (`import.meta.env.DEV`) mindig elérhető.

- A választó **minden hidegindításkor** megjelenik a jogosultaknak — a tesztelő
  így tud váltani anélkül, hogy beállítást keresne.
- A választás a `localStorage`-ban marad, tehát a képernyő az **előző választást
  előre kiemelve** kínálja; „Mindig normál módban indulj" pipával kikapcsolható,
  és a Beállításokból visszakapcsolható.
- **Normál módban a bugreport kódja nem fut**, és a lebegő gomb nem létezik.

A `tester` mező **nem** játékadat, de a 4. sérthetetlen szabály szellemében
kizárólag szerverről írható (admin végpont, `adminAudit` naplóval).

---

## 3. Adatmodell — `bugReports`

Új gyűjtemény a **`grundo-db`** adatbázisban (9. szabály). Kizárólag a backend
írja és olvassa; a `firestore.rules` `read, write: if false`, mint a
`perfSnapshots` esetében.

```
bugReports/{reportId}
  kind        'report' | 'screenshot' | 'video' | 'crash'
  status      'new' | 'triaged' | 'in_progress' | 'fixed' | 'wontfix' | 'duplicate'
  severity    'low' | 'normal' | 'high'          (a beküldő állítja, az admin felülírja)
  createdAt   Timestamp                          (szerveridő, mindig)
  uid, username
  note        string, max 2000 karakter          (a beküldő megjegyzése)

  device      { platform, native, userAgent, appVersion, channel, revision }
              — a MEGLÉVŐ `captureDeviceInfo()` visszatérése, változtatás nélkül

  context     { route, sessionId, online, viewportW, viewportH, dpr,
                memoryMB?, startedAt, uptimeMs }
  state       { permissions { location, notifications }, recorder? }
  logs        [ { t, level, msg } ]              — max 200 morzsa, lásd 4.
  media       [ { path, contentType, bytes, durationMs? } ]  — Storage-útvonalak

  crash?      { previousSessionId, lastRoute, startedAt, seenAt }

  adminNote?, assignedTo?, resolvedAt?           — csak a szerver írja
```

**Miért szerveridő a `createdAt`:** a készülék órája állítható, és a beküldések
sorrendje a triázs egyetlen fogódzója. (Vö. a `8b29f3f0` Timestamp-ügye.)

### Média a Storage-ban

```
bugreports/{uid}/{reportId}/{fileName}
```

`storage.rules`, az aktivitás-fotók bevált mintájára: **a kliens tölt fel
közvetlenül**, a backend csak a hivatkozást kapja és az előtagot ellenőrzi — a
Cloud Run kérésmérete nem visel el egy 30 másodperces videót.

```
allow read:   if false;                 // az admin aláírt URL-en át kapja
allow create: if isSelf(uid)
              && (isImage() && underMB(10)
                  || request.resource.contentType == 'video/mp4' && underMB(50));
allow update, delete: if false;         // a beküldött bizonyíték nem írható át
```

⚠️ A Storage-szabályokat **külön kell deployolni**
(`firebase deploy --only storage:rules`) — a fájl fejléce is figyelmeztet rá.

---

## 4. Morzsanapló (breadcrumbs)

Egy **200 elemű gyűrűpuffer** a memóriában (`src/lib/breadcrumbs.ts`), ami
debug módban gyűlik:

- útvonalváltás (`route`), app előtér/háttér (`lifecycle`),
- `console.error` és `console.warn` (a natív konzol nem elérhető utólag),
- `window.onerror` és `unhandledrejection`,
- minden `ApiError` (státusz + kód + útvonal, **törzs nélkül**),
- a rögzítő állapotátmenetei.

**Adatvédelem:** a morzsa **nem tartalmazhat GPS-koordinátát**. A rögzítő
átmenetei állapotnevek, nem pontok. A privát zóna logikája ugyanaz, mint a
fotóknál: ami egyszer kikerül, azt nem lehet visszavenni.

A puffer **normál módban nem kap semmit** — a `console.error` átkötése is csak
debug módban történik meg.

---

## 5. Crash-elkapás — két rétegben

### F1, JS-oldalon (natív munka nélkül)

A trükk az, hogy nem az összeomlást kapjuk el, hanem azt vesszük észre, hogy az
**előző futás nem zárult rendesen**:

1. induláskor `localStorage['grundo.debug.session'] = { id, startedAt, mode,
   route, open: true, seenAt }`,
2. `pagehide` és `visibilitychange → hidden` esetén `open: false` (a
   `beforeunload` natív WebView-ban megbízhatatlan; új Capacitor-plugin nem
   kell — ugyanezt a két eseményt figyeli a rögzítő is),
3. a **következő** indításkor, ha az előző rekord `open: true` maradt **és
   debug módban futott** → felajánljuk a crash reportot, benne az utolsó
   morzsákkal és útvonallal. Normál módú menet után nincs felajánlás: ott nincs
   napló, amit el lehetne küldeni.

⚠️ **Ez becslés, nem bizonyíték.** A folyamat kilövése (app-váltóból kihúzás),
az OS általi memória-visszavétel és a valódi összeomlás mind ugyanígy néz ki.
Ezért a felajánló szöveg nem állítja, hogy összeomlott: *„Az app váratlanul
bezárult. Elküldöd, mi történt előtte?"*. A `crash.previousSessionId` köti majd
össze az F4-es natív nyommal, ahol biztosat lehet mondani.

### F4, natívan — Firebase Crashlytics

Jóváhagyva (#44). A `@capacitor-firebase/crashlytics` illeszkedik a már használt
`@capacitor-firebase/*` családhoz, tehát nem új szolgáltató.

- A **natív stack trace** a Firebase konzolba megy — nem a mi adminunkba, és
  nem is kell odavinni.
- Az összekötés egy **egyedi kulcs**: `Crashlytics.setCustomKey('grundo.sessionId')`
  és `setUserId(uid)`. Az admin adatlapján a `sessionId` látszik, azzal a
  Crashlytics konzolban egy keresés megtalálja a nyomot.
- Cserébe **új natív build kell mindkét platformra**, és a `GoogleService-Info.plist`
  / `google-services.json` már a helyén van.

---

## 6. Lebegő debug gomb

`src/components/DebugFab.tsx` — a mintát a meglévő **`PerfOverlay`** adja
(admin-only, összecsukott pötty, `position: fixed`).

- **Húzható**, a pozíció a `localStorage`-ban marad, és a képernyő szélére
  pattan (a bal/jobb élhez), hogy ne takarjon.
- ⚠️ **Nem takarhatja a rögzítés vezérlőit.** Az induló pozíció a jobb szél, a
  képernyő aljától 140 képpontra — a Dock és a rögzítés középen álló gombjai
  fölött. Elforgatásnál a gomb visszakerül a képernyőre.
- A menü: **Képernyőkép · Videó · Report · Napló megnyitása**. F1-ben a
  képernyőkép és a videó **letiltva, „F2/F3" felirattal** — a gomb szerkezete
  már végleges, hogy a natív rész csak a hívást cserélje.
- A gomb `pointer`-eseményekkel dolgozik, és **elengedéskor** dönt kattintás
  vs. húzás között — a `FinishGestureButtons` mutató-elfogásának tanulságával
  (#43): `pointercancel`-t kezelni kell, `pointerleave`-et nem.

---

## 7. Szerver — `server/src/routes/bugreports.ts`

| Metódus | Útvonal | Ki | Mit |
|---|---|---|---|
| `POST` | `/api/bugreports` | tesztelő/admin | létrehoz, visszaad `reportId`-t |
| `POST` | `/api/bugreports/:id/media` | a beküldő | a feltöltött fájl útvonalát rögzíti (előtag-ellenőrzéssel) |
| `GET` | `/api/admin/bugreports` | READ_ROLES | lista, szűrőkkel |
| `GET` | `/api/admin/bugreports/:id` | READ_ROLES | adatlap + **aláírt média-URL** |
| `PATCH` | `/api/admin/bugreports/:id` | owner/admin/moderator/support | státusz, súlyosság, admin-jegyzet — **`audit()`-tal** |

- A beküldő végpontok az `authenticate` + `authenticatedRateLimit` mögött ülnek,
  és **külön napi korlátot** kapnak (`bugReports`, 30/nap/felhasználó) a meglévő
  `rateLimit.ts` `evaluateRateLimit()`-jével. Egy beragadt retry-hurok különben
  ezer dokumentumot ír.
- A `note` és a morzsák **hossza vágva** a szerveren is, nem csak a kliensen.
- Az admin végpontok az `adminRouter` mintáját követik: szerepkör a claimből,
  minden írás naplózva.

**Miért nem írhat a kliens közvetlenül Firestore-ba:** a `status`, a `createdAt`
és a `uid` hitelessége a triázs alapja. A médiát azért töltheti fel mégis
közvetlenül, mert ott a Storage-szabály elvégzi ugyanezt (saját uid-előtag,
méret, típus), és a bájtoknak nincs mit hazudniuk.

---

## 8. Admin fül

Új NAV-elem: **„Bugreportok"** (`/admin/bugreportok`, ikon `🐞`).

- **Lista**: státusz-szűrő (alapból `new` + `triaged`), típus, platform,
  app-verzió, felhasználó. Egy sor: idő, típus-ikon, beküldő, build, a jegyzet
  első sora, státusz-jelvény.
- **Adatlap**: a jegyzet, a média (kép/videó aláírt URL-en), az eszközadat, a
  kontextus, és a **morzsanapló idővonalként** — ez a leghasznosabb része.
- **Műveletek**: státusz, súlyosság, admin-jegyzet. Törlés nincs: a beküldés
  bizonyíték.
- A `readonly` szerepkör csak néz.

---

## 9. Fázisok

| | Tartalom | Natív? |
|---|---|---|
| **F1** | üzemmód-választó · lebegő gomb · report · JS-crashfelismerés · adatmodell · szabályok · szerver-végpontok · admin fül | **nem** |
| **F2** | képernyőkép: saját Capacitor-plugin iOS-en (`WKWebView.takeSnapshot`) és Androidon (`PixelCopy`) | igen |
| **F3** | videó: iOS `ReplayKit` (`RPScreenRecorder`), Android `MediaProjection` + `MediaRecorder`, 30 mp-es vágás, MP4 | igen |
| **F4** | Crashlytics mindkét platformon, `sessionId` kulccsal összekötve | igen |

**Miért saját plugin a képernyőképhez, és nem `html2canvas`:** a `html2canvas`
a DOM-ot rajzolja újra, tehát a **Mapbox GL vászna üresen marad** — pont a
térkép hiányozna a bugreportból. A natív pillanatkép azt menti, ami a képernyőn
van. Kb. 60 sor platformonként.

**A videó a legdrágább tétel.** Az Android `MediaProjection` minden indításkor
rendszer-engedélykérdést ad (ez nem kerülhető meg), és előtérszolgáltatást
igényel. Az iOS `ReplayKit` mikrofonját a megvalósítás kikapcsolja: a
hibabejelentéshez nincs szükség beszéd rögzítésére. Ezért van a sor végén.

### F3–F4 — megvalósítás (2026-09-09)

- A videó natív cache-fájlba készül, nem base64-en megy át a Capacitor
  bridge-en. A WebView csak a kész MP4-et olvassa Blobbá, majd törli a natív
  ideiglenes fájlt.
- Mindkét natív oldal 30 másodpercnél önállóan leáll. Androidon H.264/MP4,
  legfeljebb 1280 px hosszú él és 4 Mbps bitráta tartja 50 MB alatt a fájlt.
- Androidon minden indítás rendszerengedélyes `MediaProjection`, és a teljes
  munkamenet `mediaProjection` típusú foreground service-ben él. iOS-en
  `RPScreenRecorder`, kikapcsolt mikrofonnal rögzít.
- A kész videó beküldés előtt lejátszható; csak a kézi Küldés tölti fel. A
  Storage-hivatkozás `video/mp4`, `.mp4` fájlnév és `durationMs` metaadat.
- F4 a `@capacitor-firebase/crashlytics` Capacitor 8 plugin. A natív eseményhez
  `grundo.sessionId` custom key és Firebase UID kerül; az adminban látható
  előző session ID-val így a Firebase konzolban kereshető a stack trace.
- iOS-en az App target utolsó build phase-e feltölti a dSYM-et a Crashlytics
  SPM scriptjével; Androidon a Crashlytics Gradle plugin készíti a mappinget.

### F2 — iOS készülékes ellenőrzés (2026-09-09)

- [x] Elkészül a képernyőkép.
- [x] A Mapbox térkép látszik a képen.
- [x] A debug gomb és a nyitott debug menü nem kerül rá a képre.
- [x] A feltöltött kép megnyílik az adminfelületen.

Az Android `PixelCopy` ág készülékes ellenőrzése továbbra is nyitott.

---

## 10. Amit ez a terv **nem** tartalmaz

- Automatikus hibabejelentés felhasználói szándék nélkül. Minden beküldés
  kézi — a képernyőkép is megmutatkozik, mielőtt elmegy.
- Hálózati kérés-törzsek naplózása (tokent és személyes adatot vinne).
- Bármi, ami normál módban fut. A tesztelői eszköz nem lehet a többi felhasználó
  akkumulátorterhe.

---

## 11. F1 — mi készült el (2026-09-09)

| Fájl | | Mit |
|---|---|---|
| `server/src/routes/bugreports.ts` | ÚJ | beküldő és triázs végpontok, `mediaPathBelongsTo()` |
| `server/src/routes/bugreports.test.ts` | ÚJ | az útvonal-ellenőrzés hét esete |
| `server/src/lib/adminAudit.ts` | ÚJ | a napló kiemelve az `admin.ts`-ből, hogy a triázs is ide írjon |
| `server/src/routes/admin.ts` | M | `/testers` végpont, a bugreport-alútvonal bekötése |
| `server/src/lib/rateLimit.ts` | M | `bugReport` házirend, 30/nap |
| `server/src/lib/firebase.ts` · `server/server.ts` | M | gyűjtemény és útvonal bekötése |
| `firestore.rules` · `storage.rules` · `firestore.indexes.json` | M | szerver-only dokumentum, melléklet-előtag, három index + két index-tiltás |
| `src/lib/debugMode.ts` + `.test.ts` | ÚJ | üzemmód, menet, a nem tiszta leállás felismerése |
| `src/lib/breadcrumbs.ts` + `.test.ts` | ÚJ | 200 elemű gyűrűpuffer, konzol- és hibakötés |
| `src/lib/bugReport.ts` | ÚJ | kontextus összeállítása és beküldés |
| `src/components/DebugLayer.tsx` · `DebugFab.tsx` · `ModeChooser.tsx` · `BugReportSheet.tsx` · `debug.css` | ÚJ | a tesztelői felület |
| `src/admin/BugReportsScreen.tsx` + `bug-reports.css` | ÚJ | triázs és tesztelő-kezelés |
| `src/App.tsx` · `src/admin/index.tsx` · `AdminLayout.tsx` · `SettingsScreen.tsx` · `src/lib/api.ts` | M | bekötés |

**Mérve, nem feltételezve:** a kiadási build a debug réteget külön darabba
teszi (`DebugLayer-*.js`, 11,7 kB + 3,9 kB CSS), és a belépő csomag egyetlen
sorát sem tartalmazza — a normál felhasználó nem tölti le.

**Ellenőrizve:** `npm run test` 874 zöld / 181 skip · `tsc --noEmit` kliens és
szerver zöld · `npm run build` zöld · a `firestore.rules` és a `storage.rules`
hibátlanul betöltődik a Firestore- és Storage-emulátorban.

**NEM ellenőrzött:** valódi végpont-hívás (emulátoros bugreport-teszt nem
készült), és semmi készüléken. A beküldés első éles próbája telepítés után jön.

# Tartós döntések

Amit **nem szabad visszacsinálni**, és amiért. Ez a fájl lassan nő: csak olyan
kerül bele, ami hónapok múlva is korlátozza a megoldásteret. A napi állapot a
[`CURRENT_STATE.md`](CURRENT_STATE.md)-ben van, a történet a git logban.

> A játékszabályok és a spec forrása a `docs/` — ez a fájl azokat nem
> ismétli, csak azokat a **megvalósítási** döntéseket rögzíti, amiket egy
> friss munkamenet nem tudna kitalálni a kódból.

## Geometria és területszámítás

- **H3 hexrács, res 12, poligon-algebra nélkül.** Nincs PostGIS, nincs turf.js
  boolean. (`docs/README.md` 1. döntés)
- **Compact / hierarchikus nagy-hurok logika — nem szabad visszaegyszerűsíteni
  teljes res12 materializációra.** Balaton-méretű területnél ez milliós
  cellalistát jelentene. Forrás: `#12` menet (LAB → production).
- **A frontier cleanup snapshot-alapú, NO CASCADE.** Ne váljon általános world
  cleanup algoritmussá.
- **A kliens activity/claim számítása előnézet.** Normál aktivitásmentésnél a
  **backend az authoritative**, nyers trace-ből újraszámol mindent.

## Megerősítés (védelem) — a `#13` menet döntése

- **A védelem NEM a bezárások számából jön**, hanem abból, hogy a nyomvonal
  hányszor **kerülte meg** a cellát (körüljárási szám,
  `src/game/winding.ts`). A hurokdetektor dönti el, MELY cellák jönnek szóba; a
  körüljárás azt, HÁNYSZOR.
- A körüljárás **nyitott nyomvonalon, záró húr nélkül** számolódik — záró
  húrral egy hosszú hazasétálás hamis körüljárást vinne be (mérve: két cella
  esett ki emiatt egy bezárt területből).
- **Racsni, nem szögösszeg**: valahányszor az elfordulás egy teljes kört
  összegyűjt — bármelyik irányban —, az egy bekerítés. Így az ellentétes irányú
  körök nem oltják ki egymást, a félkör nem lép, és a kör utáni elsétálás nem
  teker vissza.
- **Régiónként számolunk, nem cellánként** (836 cellás nyom + 3544 claim-cella:
  66 ms → 26 ms). A falcellák a szomszédos régióktól öröklik az értéket.
- ⚠️ **Ne told vissza az index-alapú heurisztikákat** (`creditedAt`,
  `actorAcquiredAt`, `lastReinforcement`, `sameTraversalReinforcement`,
  `closureBlock` 75%-os ablak). Mind a **bejárás irányától** függött; ez volt a
  hiba forrása. Törölve, és a „first wins" probléma velük együtt megszűnt.
- ⚠️ **Ne írj tesztet kézzel gyártott `DetectedLoop`-ból nyomvonal nélkül.** A
  megerősítés geometriából jön — nyomvonal nélkül nincs mit mérni.
- **Valódi új traversal ugyanazt a saját területet ismét erősítheti 2×–5×-re.**
  Ne tegyél olyan dedupe/cooldown-t, ami ezt megszünteti.

## Adattárolás

- **Dedikált Firestore adatbázis: `grundo-db`** — nem a `(default)`. Három
  helyen kell egyeznie (`firebase.json`, `src/lib/firebase.ts`,
  `server/server.ts`). Egy hiányzó második paraméter csendben a `(default)`-ra
  ír. Részletek: `CLAUDE.md`.
- **A kliens soha nem ír játékadatot**, a Firestore-szabályok ezt
  kikényszerítik.

## Profilpreferenciák

- **Egyetlen mező mentése nem töltheti újra a teljes profilt.** A területszín
  Firestore-írása után a `ProfileProvider` csak a helyi `cellColor` mezőt
  módosítja. A `reload()` itt tiltott, mert `loading` állapotba teszi a teljes
  profilfüggő felületet, és látható oldalfrissülést okoz.

## Térképi teljesítmény

- **Az elszámolási adat és a render-munkakészlet külön életű.** Hosszú
  rögzítésnél a teljes nyomvonal és cellageometria megmarad a közös
  játékmotornak, de Mapbox GeoJSON-ba csak a kamera FOV-ja + előtöltési
  ráhagyás, legfeljebb a pozíció körüli beállított sugár kerül. Ezt nem szabad
  a teljes nyomvonal visszarajzolására egyszerűsíteni: Android WebViewben a
  `GeoJSONSource.setData()` teljes tesszellálást és GPU-feltöltést indít, így
  a költség korábban a megtett távval folyamatosan nőtt.
- **A render-sugár és a 3D látótávolság két külön beállítás.** A render-sugár
  a GeoJSON munkakészletet korlátozza; a 250–5000 m-es Viewing Distance a
  döntött kamera zoomját adja meg. A Mapbox ködtartománya perspektívarelativ,
  ezért a méteres értéket a kamera zoomjára képezzük, a távoli peremen pedig
  témaszínű szürke köd ad fokozatos átmenetet. 2D-re váltva mindig az
  alaptérkép eredeti ködbeállítása áll vissza.
- **A rögzítési zoomgomb nem szakítja meg a pozíciókövetést.** A `+ / −`
  programozott kameramozgás, ezért nem állítja `followPaused` állapotba a
  térképet; csak a DOM `originalEvent`-tel érkező valódi felhasználói gesztus
  teszi ezt. A következő GPS-frissítés középen tartja a pozíciót, de megőrzi a
  gombbal választott zoomot.
- **A `traceToCellPath` SOSEM futhat a teljes nyomvonalon élő rögzítés közben.**
  A GRUNDO #21 energiaelemzés ezt már egyszer kijavította a `TrackingScreen`
  saját cellalánc-cache-ében (`IncrementalCellPath`), de a `game/index.ts`-beli
  `IncrementalActivityGeometry` (GP/claim preview) egy szinttel feljebb
  megismételte — mérve (#31→#32): 10 km-es városi Android-rögzítésnél a teljes
  app lassulását okozta. Mindkét osztály mostantól ugyanazt az O(1),
  pontreferencia-alapú folytatás-felismerést használja (lásd `grundo-lessons`
  #9). **Ha új élő-preview kód `traceToCellPath`-ot vagy `buildActivityGeometry`-t
  hívna GPS-mintánként, az hiba — a `IncrementalCellPath`/`IncrementalActivityGeometry`
  meglévő cache-einek kell futnia helyette.**
- **A `visibleTrackSegments()` NEM szűk keresztmetszet — ne írd át
  inkrementálisra.** A #31 átadója gyanúsítottként jelölte meg (O(n) scan
  minden throttolt `setData`-nál). Mérve (#32, 12 km / 2397 minta, követő
  nézet): 200 pontnál 40 µs, 2397 pontnál 32 µs — LAPOS, mert a kimenet
  sugár-vágott, és a `trackSyncIntervalMs` throttling amúgy is ritkítja. A
  jelenlegi forma elég; az inkrementálissá tétel csak kockázatot adna.
- **A rögzítő per-minta tömbmásolása és az IndexedDB-írás sem szűk
  keresztmetszet.** Az `applySample()` teljes `points` másolása 200→2000
  pontnál 3 µs → 6 µs. A „minden mintánál ír az IndexedDB-be" állítás pedig
  téves volt: a `createRunPersister` 2000 ms-os `minIntervalMs`-szel
  összevonja az írásokat (`tracking/storage.ts`).
- **A `processActivityGeometry()` költségét a HUROKZÁRÁS hajtja, nem a
  pontszám.** Mérve (#32, ugyanaz az útvonal): hurok nélkül 0,95 ms, az első
  hurok után 5,34 ms, 6 huroknál (2536 fal- + 6979 belső cella) 23,16 ms
  hívásonként — nagyjából 3,3 µs / belső cella, és minden újraszámolásnál a
  TELJES hurokkészletre lefut, pedig a korábban bezárt hurkok már nem
  változnak. A `TrackingScreen` preview-ja NEM minden GPS-mintánál fut, hanem
  új H3 cellánál vagy 25 méterenként (`cellRevision` / `distanceBucket`
  függőségek) — a terhelés a per-hívás költség ÉS a gyakoriság szorzata.
- **A főszál-terhelést valódi eszközön a beépített mérő adja, nem érzés.**
  `lib/perfMeter.ts` + `components/PerfOverlay.tsx` (admin-only, alapból
  kikapcsolt), a hozzá tartozó, kódban élő teszt-útvonallal
  (`admin/labPerfScenario.ts`, LAB E2E indító). A LAB-scenariók
  `localStorage`-ban élnek, tehát eszközhöz kötöttek — telefonon mérni csak
  beépített útvonallal lehet. **A mérő-útvonal paraméterein ne változtass:**
  azonos a `tmp/measure-preview-cost.test.ts` mérőpadjával, ettől
  összehasonlítható az asztali és a telefonos szám.

- **A nagy (10 000+ cellás) `layers` réteg viewport-szűrése MINDIG a durva
  vödrözésen (`mapRender.ts`, `filterCellsToBounds`/`coarseBucketsOf`) menjen
  át, sose a nyers `cells.filter(cellInBounds)`-on.** Gyökérok (2026-09-05,
  jamal 148 717 cellás aktivitása): a hexagon-réteg (`AREA_SOURCE`/
  `CELL_SOURCE`) minden jelentős zoom/pan után (`moveend`) a TELJES
  cellalistán futtatta a pontos, natív H3 `cellToLatLng`-et — a
  `CELL_CENTER_CACHE` 50 000-es korlátja emiatt ennél a méretnél folyamatosan
  kiürült. Ez a szinkron főszál-blokkolás az aktivitás-térkép mélyzoomos
  ÖSSZEOMLÁSÁT okozta (Android megölte és újraindította a WebView-t). A durva
  vödrözés a `territoryBlobStore.ts` szintjeivel azonos elvet visz át
  kliensoldalra: előbb egy sokkal ritkább (res8) rácson dől el, mely
  vödrökbe érdemes belenézni. Készülékes teszttel megerősítve (Samsung
  SM-G780F): ugyanaz a reprodukció (hexagon mód + mélyzoom + gyors pásztázás
  jamal aktivitásán) többé nem omlik össze, a folyamat PID-je végig azonos
  maradt.

## Munkamódszer

- **Egy klón, egy mappa:** `C:\Users\Geri\Documents\GitHub\grundo`. 2026-08-29:
  egy második klón (`Documents\ChatGPT\GRUNDO`) kézzel feloldandó
  merge-konfliktust okozott; törölve.
- **Telepítés a fejlesztői gépről**, nem Cloud Shellből (2026-08-29, kvóta).
- **A commit és a push az ügynöké**, de minden push után szólni kell.
- **A natív app nem kerül külön repóba** — a `src/game/` motor közössége miatt.

## Ügynök-konfiguráció betöltése (2026-09-03, mérve a 2.1.255 binárison)

- **A `.claude/rules/` MINDEN fájlja Project-memóriaként töltődik be**, és
  `paths:` frontmatter nélkül `session_start` okkal, azaz minden menetben. ⚠️
  **Ne tegyél scope nélküli fájlt a `.claude/rules/`-ba.** Egyszer már
  megtörtént: 536 sornyi szabály ült minden menet kontextusában.
  `paths:` esetén a betöltés oka `path_glob_match`, tehát csak akkor jön be,
  amikor Claude az illeszkedő fájlhoz nyúl.
- **A Claude Code NEM tölti be az `AGENTS.md`-t.** A memóriabetöltő csak a
  `CLAUDE.md`-t, a `.claude/CLAUDE.md`-t, a `CLAUDE.local.md`-t és a
  `.claude/rules/`-t ismeri; az `AGENTS.md` a binárisban csak a
  Codex-migrációban és az `/init`-ben szerepel. Az `AGENTS.md` ezért **a
  Codexnek és más ügynököknek** szól, és csak átirányítás — ne kerüljön bele
  önálló tartalom, mert az azonnal duplikáció lesz.
- **Eljárás- és referenciaanyag skillbe megy**, nem szabályfájlba: telepítés,
  menetindítás, menetzárás, mért tanulságok. A skill neve és leírása kerül csak
  a rendszerpromptba, a törzse hívásra.
- Cél: a **mindig betöltött** instrukció a projekt `CLAUDE.md`-jére (≈100 sor)
  és a globális `~/.claude/CLAUDE.md`-re (≈50 sor) szorítkozzon.

## Hangok (`#36` menet)

- **A hangzár feloldásához VALÓDI, végigfutó lejátszás kell** — a `play()`
  puszta meghívása nem elég, és a szinkron `pause()` egyenesen tönkreteszi:
  iOS-en a megszakított lejátszás nem aktiválja az AVAudioSessiont, és az app
  teljesen elnémul. Ez már KÉTSZER okozott éles némulást (2026-09-03: a
  feloldás natív kihagyása; 2026-09-04: a szinkron `pause()`). A hallható
  zavart nem a lejátszás megszakításával kell kerülni, hanem azzal, hogy a
  hang **legvégére ugrunk** (`UNLOCK_TAIL_S`) — a lecsengés csendes része.
  ⚠️ A `volume = 0` iOS-en hatástalan; a `muted = true` pedig vélhetően nem
  „szenteli fel" az elemet, tehát nem alternatíva.

## Bandák (`#29` menet)

- **Nem Pro-funkció.** A korábbi Klub-spec Pro-gate-jét (`+ Létrehozás [Pro]`)
  elvetettük — bárki hozhat létre bandát. Geri jóváhagyta 2026-09-03.
- **A sportágankénti `bandaStats` VISSZASZÁMOLHATÓ az aktivitás-
  előtörténetből** (mérve, #36). A bevezetéskor az ellenkezőjét feltételeztük,
  és a backfill csak nullákkal hozta létre a mezőt — a ranglista emiatt élesben
  minden tagnál 0 km²-t és 0 GP-t mutatott, miközben a felhasználóknak több
  km²-ük volt. A feltevés a rossz szinten nézte az adatot: a felhasználón
  tárolt terület `foot`/`bike` réteg szerint áll (abból futás/séta valóban nem
  bontható), az AKTIVITÁS-dokumentum viszont megőrzi a `type`-ot, az
  `areaGainedM2`-t és a `gp`-t. ⚠️ Az összesítésbe a **törölt aktivitás is
  beleszámít**: a törlés csak az aktivitás- és a távolságszámlálót csökkenti.
  Csak a mindenkori mezőket szabad visszaírni — a napi/heti/havi ablakokat a
  napi forduló nullázza, ott a visszamenőleges pontosságnak nincs értelme.
- **A `totals` előszámított, rollup jobból jön, nem élő olvasáskori
  szumma.** A `BandaScreen` megnyitása ne fizessen egy N-tagos `getAll`-t
  minden alkalommal. Lásd `server/src/jobs/bandaRollover.ts`.
- **`users/{uid}/bandas/{bandaId}` tükör-alkollekció** a `bandas/{id}/members`
  felől, a `following`/`followers` mintájára — a „saját bandáim" lista így
  egyetlen, saját-magam-alatti olvasás, NEM collectionGroup-lekérdezés (ami
  külön engedélyezett indexet igényelne). Ne told vissza collectionGroup-ra:
  az app egyetlen más helyen sem szűr collectionGroup-lekérdezéssel, csak
  szűretlenül olvas ki mindent (`blocks`, `blockIndex` backfill-szkriptek).
- **Publikus belépés bandánként választható.** Az alapértelmezés visszafelé
  kompatibilisen `instant`, az alapító azonban `approval` módot választhat;
  ekkor `joinRequests` alkollekció készül, és alapító vagy moderátor fogadja
  el. A privát banda belépése továbbra is csak kóddal/meghívással történik.
- **Tulajdonjog-átruházáskor a korábbi alapító moderátor marad.**
  Az új alapító egy meglévő tag; az `ownerId` és mindkét felhasználó
  két tagsági tükördokumentuma egyetlen tranzakcióban vált. Így mindig
  pontosan egy `owner` van, miközben az átadó nem veszíti el hirtelen az
  adminisztrációs kapcsolatát a bandával.
- **Alapító nem hagyhat gazdátlan bandát.** Kilépés előtt kötelező
  egy meglévő tagnak átadnia az alapítói rangot; ezt a szerver tiltja, nem
  csak a felület magyarázza. Az átadás után moderátorként a normál kilépési
  útvonalon távozhat.
- **A banda-feed képe nem kap tartós Firebase download tokent.** A Storage-
  objektum közvetlenül nem olvasható; a backend ellenőrzi a tagságot, majd
  hitelesített bináris válaszként szolgálja ki. Ez megőrzi a privát banda
  tartalmának határát akkor is, ha valaki megszerzi az objektum útvonalát.
- **A publikus banda-böngészés szerveroldalon rendezett és tízes korlátú.**
  A `GET /api/bandas/discover` csak `popular` vagy `new` rendezést fogad,
  kizárja a privát bandákat és legfeljebb 10 dokumentumot olvas. A két
  rendezéshez külön `visibility + memberCount`, illetve `visibility +
  createdAt` kompozit index tartozik; a kliens fülváltáskor gyorsítótárazza
  az egyszer már betöltött listát.
- **Tagsági/moderációs tartalomeltávolítás soft-hide.** Kirúgás, a kilépő
  kifejezett tartalomtörlési választása és appbannolás esetén az eredeti poszt,
  komment, falüzenet és aktivitás adatbázisban marad admin-visszakereséshez.
  A listák a posztokat elrejtik, a kommentazonosítót megőrző helyőrzőt adnak,
  ezért a válaszszál nem szakad el. Fizikai törlést csak a végleges
  fióktörlési folyamat végezhet.

## Területszín-paletta (`#28` menet)

- **A végtelen sor ismételt ciklusokkal működik.** A paletta azonos
  színciklusokat fűz egymás mögé, és a görgetési pozíciót láthatatlanul a
  középső tartományba helyezi vissza; ezért swipe és nyilas léptetés közben
  sincs végpont vagy scrollbar. Csak a középső ciklus fókuszálható, így a
  vizuális ismétlés nem sokszorozza meg a billentyűzetes bejárást.
- **A kiválasztási háttéreffekt összefüggő axiális hexrácson nő.** Minden
  új cella már meglévő cellához kapcsolódik, az egyedi késleltetés és
  halványulás összege pedig soha nem haladhatja meg az 5 másodpercet. A
  csökkentett mozgást kérő rendszerbeállítás az effektet kikapcsolja.

## Az élő előnézet a főszálon kívül (`#37` menet)

- **A preview-számítás WORKERBEN fut** (`src/workers/previewWorker.ts`), a
  `usePreviewEngine` hookon át. Terepi mérés (2026-09-04, Samsung SM-G780F): a
  főszálon egyetlen **859 ms**-os blokk keletkezett a háttérből visszatéréskor,
  miközben az ÖSSZKÖLTSÉG elhanyagolható volt (0,1% kitöltés). Nem az átlagot
  kellett javítani, hanem az eloszlást.
- ⚠️ **A worker felé KÜLÖNBSÉGET küldünk, sosem a teljes pontsort.** A
  `structuredClone` minden pontot új objektummá másol; az inkrementális
  gyorsítótár viszont az OBJEKTUM-AZONOSSÁGBÓL ismeri fel a folytatást. Teljes
  listával minden frissítés a nulláról épülne: mérve **2,6 ms → 1 248 ms**.
  Őrzi: `previewEngine.test.ts` „nem épül újra" és „ugyanazokat az
  objektumokat".
- **A cellalánc (`IncrementalCellPath`) a FŐSZÁLON marad.** Olcsó (a teljes
  körre 6 ms), és a kirajzolt nyom meg a lépéshang nem várhat egy
  körbefordulásra. Ne told be a workerbe „a teljesség kedvéért".
- **Ha a `Worker` nem indul, a hook némán a szinkron ágra vált** — ugyanazzal a
  kóddal (`lib/previewEngine.ts`). Ez a `PreviewSession` létjogosultsága; ne
  olvadjon bele a workerbe.

## A hurokkeresés gyorsítótára (`#37` menet)

- **A durva kitöltés-előkészület memoizálva** (`loops.ts` `coarseContextOf`):
  befoglaló polyfill, durva kitöltés, sáv és sávperem. Mérve: 499 jelöltre
  mindössze **29 különböző durva fal** jut, mert a jelöltek res12 fala
  cellánként eltér, két felbontással feljebb viszont a különbség eltűnik.
  Nyereség: böngészőben **−55%**, bitre azonos eredménnyel.
- ⚠️ **A gyorsítótárazott kültér-halmaz `ReadonlySet`, és a hívó MÁSOLJA.** A
  visszaterjesztés (3. lépés) a finom fal alapján tovább nyitja; ha a
  bejegyzést mutálná, a következő azonos durva falú jelölt kinyitott kültérrel
  indulna — kisebb belsőt, azaz **kevesebb területet** adna a felhasználónak,
  csendben. A típus kényszeríti ki; **teszt ezt nem fogja meg** (a
  visszaterjesztés csak ritka alakzatra fut le).
- ⚠️ **NINCS biztonságos jelöltszűrő a feltöltés előtt** — végigmérve.
  Területküszöb: az elutasított jelöltek területe NAGY (medián 50 000 m²).
  Egyetlen korábbi hurokba tartalmazás: 499-ből 2. Az olcsó ellenőrzések
  előrehozása: a `sameLoopGeometry` első ága a belsőt nézi. A bekerített cellák
  UNIÓJÁRA szűrni **nem biztonságos**: több hurok gyűrűt formálhat, aminek a
  lyuka valódi új terület. A maradék költség a jelöltek SZÁMA — az pedig
  játékszabály-kérdés, nem optimalizálás.

## Archívum

A `#12`–`#13` menetek részletes átadói a
[`archive/`](archive/) mappában vannak. **Alapból ne olvasd be őket** — csak
akkor, ha a compact backend, a LAB E2E vagy a körüljárás részleteire van
szükség, és akkor is célzottan (`grep`-pel a fejezetcímre).

| Fájl | Miről szól |
|---|---|
| `archive/2026-08-25-lab-e2e.md` | compact claim primitívek, chunked route, LAB → production tracking UI, gameplay regressziós mátrix |
| `archive/2026-08-25-reinforcement.md` | a körüljárás bevezetése, a mérések, a nyitott szálszabály és nyomvonal-vékonyítás |
| `archive/2026-09-04-terepi-fosszal-meres.md` | a két készülékes terepi főszál-mérés teljes kiértékelése, a hurokkeresés fázisbontása, és a NEM működő optimalizálási irányok |

## Aktivitás-feed — #40

- **A feed a BEFEJEZÉS ideje (`endedAt`) szerint rendez és dátumoz**, nem a
  `startedAt`, és nem is a szerveroldali mentés idejét jelző `createdAt`
  szerint. A `startedAt` a tényleges kezdés marad, nem írható át a
  megjelenítési sorrend kedvéért.
  ⚠️ A #40 először `createdAt`-tal ment ki; offline vagy késve feltöltött
  körnél az érdemben eltér a valóságtól. Az `endedAt` mezőt a 2026-08-17-i
  legelső mentési implementáció óta minden aktivitás-dokumentum tartalmazza,
  ezért a váltás migráció nélkül visszamenőleg is helyes.
- **Új feedmezőre váltás előtt az indexeknek KINT KELL LENNIÜK.** A #40
  backendje `createdAt`-os indexek nélkül települt élesbe (2026-09-05 07:53
  UTC), ettől a `/api/activities` mindenkinek 500-at adott
  (`FAILED_PRECONDITION`). A helyreállítás forgalom-visszaterelés volt az
  előző revízióra; a sorrend nem opcionális: **index → backend → frontend.**
- A tízes lapozás kurzora időpont + dokumentumazonosító: azonos időpontnál
  sem hagyhat ki aktivitást. Rejtett/távoli sorok esetén üres lap is adhat
  folytatókurzort, a kliens ilyenkor is mutatja a betöltőgombot.
- A heti statisztika nem függhet a feedben megnyitott lapok számától.
- A feed memóriacache fiók- és szűrésfüggő, módosításkor érvénytelenítendő,
  auth-váltáskor ürítendő. Privát aktivitásadat nem kerül localStorage-ba.

## Külön Android debug app és Game Loop (2026-09-05)

- A release applicationId `app.grundo.android`, a debugé
  `app.grundo.android.debug`. A debug telepítése nem törölheti és nem írhatja
  felül az éles appot; a két csomag együttélését Samsungon ellenőriztük.
- A Java namespace továbbra is `app.grundo.android`. A Game Loop component
  `app.grundo.android.debug/app.grundo.android.GameLoopActivity`.
- A `GameLoopActivity`, a Test Lab intent-filter és a loops metaadat kizárólag
  `android/app/src/debug` alatt létezhet; release-be nem kerülhet. A Game Loop
  webcsomag sem kiadási csomag: az éles webbuildhez a rendes build szükséges.

## iOS hangzár: a feloldás HALLHATÓ, és soha nem némítható (2026-09-09)

Négy éles némulás után mérve (GRUNDO #43, Geri iPhone-ján, iOS build 48–50).
**Ezt soha ne csináld vissza.**

- iOS-en a `HTMLMediaElement.volume` írása **csak addig hatástalan, amíg az
  elem nincs betöltve**. Betöltött elemen a `volume = 0` ÉRVÉNYRE JUT — és egy
  néma lejátszás **nem aktiválja az AVAudioSessiont**, tehát utána az app
  MINDEN hangja néma marad.
- A hangzár feloldásához **valódi, hallható, végigfutó** lejátszás kell. Nem az
  elemek SZÁMA számít: **egyetlen** elem elég, és azon keresztül a fel NEM
  oldott elemek is megszólalnak.
- Ezért natív iOS-en a feloldás: **egy saját elem** (`cell-captured`), a hang
  **elejétől**, `volume` állítása és `currentTime`-ugratás **nélkül**. A
  `UNLOCK_TAIL_S` (a hang végére ugrás) iOS-en tilos — csak azért „működött"
  évekig, mert a `duration` mindig `NaN` volt, és csendben kimaradt.
- ⚠️ A `primeSounds()` **nem futhat a `Dock` mountjában**. Ott előtölti az
  elemeket, amitől a `volume = 0` hatni kezd — pontosan ez némította el a 49-es
  és 50-es iOS buildet.
- **Weben és Androidon nem szabad szűkíteni**: ott nincs Capacitor, a WebKit
  gesztus-kapuja ÉL és elemenként érvényes, tehát minden elem kap (néma)
  feloldást. iPhone Safari a WEBES ághoz tartozik, nem a natívhoz.
- Az `AVAudioSession` `.playback` + `.mixWithOthers` (`AppDelegate.swift`): a
  hang a némító kapcsolótól függetlenül szól és Bluetooth-ra is kimegy, a zene
  pedig megy tovább. Mivel így a készülék néma kapcsolója nem állít meg minket,
  a rögzítés felületén **kötelező** a némító gomb (`.track__mute`).

## iOS helyzet-engedély: az „Always" életünkben egyszer (2026-09-09)

- Az `requestAlwaysAuthorization()` **két külön helyen**, korlátlanul futott
  (`start()` és `locationManagerDidChangeAuthorization`), egyik sem emlékezett
  a felhasználó döntésére — egy tesztelőnek háromszor kellett engedélyt adnia.
- Mostantól `requestAlwaysOnce()` megy mindkét helyen, `UserDefaults` jelzővel.
  Aki nemet mondott, azt nem zaklatjuk többé; az „Always" a rendszer
  Beállításaiban bármikor megadható.
- A rendszerpárbeszéd elé **magyarázó képernyő** kell (`LocationPrimer`): egy
  elutasított engedélyt az appból többé nem lehet újra kérni.

## Szerver-szkriptek futtatása (2026-09-09)

- A `server/src/scripts/` szkriptjei **csak a `server` mappából** futnak —
  kívülről nem látják a `firebase-admin`-t.
- **Kell melléjük `GOOGLE_CLOUD_PROJECT=grundo`**: a fejlesztői gépen nincs
  beállítva, és a hiányából adódó hiba félrevezető („Unable to detect a Project
  Id in the current environment"), mert nem a hitelesítésre panaszkodik.
- A `FIRESTORE_DATABASE_ID` alapértelmezése helyesen `grundo-db`
  (`server/src/lib/firebase.ts`), azt nem kell megadni.
- Az egy dokumentumra szóló, egyszeri javítószkriptek **nem verziókövetettek**;
  a helyük a `tmp/`. Írjanak száraz futást alapértelmezésben, és legyenek
  idempotensek, hogy utólag ellenőrizhető legyen, lefutottak-e már.

## Bugreport rendszer — F1 (2026-09-09)

Terv: [`terv-2026-09-09-bugreport-rendszer.md`](terv-2026-09-09-bugreport-rendszer.md).

- **A debug mód NEM jelenhet meg mindenkinek.** A kapu a `users/{uid}.tester`
  mező (kizárólag adminból, `POST /api/admin/testers`) vagy egy admin
  szerepkör; helyi fejlesztésben mindig nyitva. Ha az üzemmód-választó minden
  felhasználónál felugrana, az App Store és a Play felülvizsgálója is látná, és
  a felhasználók egy része véletlenül debug módban használná az appot.
- **A bugreport dokumentumot MINDIG a szerver írja** (`bugReports`,
  `firestore.rules`: `read, write: if false`). A `status`, a `createdAt` és a
  `uid` hitelessége a triázs egyetlen fogódzója; kliensről érkező időbélyeg a
  készülék állítható órájáról jönne. A **melléklet** viszont közvetlenül a
  Storage-ba megy — egy 30 mp-es videó nem fér át a Cloud Run kérésméretén —,
  és az útvonal-előtagot MINDKÉT oldal ellenőrzi (`storage.rules` és
  `mediaPathBelongsTo()`). Egyiket sem szabad elhagyni.
- **A crash-felismerés becslés, nem bizonyíték.** Az app nem kapja el a saját
  összeomlását; csak azt látja a következő indításkor, hogy az előző menet
  nyitva maradt. Ugyanígy néz ki a valódi összeomlás, az app-váltóból kihúzás
  és az OS memória-visszavétele is — a felajánló szöveg ezért **nem
  állíthatja**, hogy összeomlott. Natív bizonyíték csak az F4-es Crashlytics
  lesz.
- **A morzsanapló csak debug módban gyűjt**, és **helyadatot nem tartalmazhat**
  — se koordinátát, se pontosságot, se cellaazonosítót. Ugyanaz az elv, mint az
  aktivitás-fotók EXIF-törlésénél: ami egyszer kikerül, azt nem lehet
  visszavenni.
- **A képernyőképhez saját natív plugin kell, nem `html2canvas`** (F2). A
  `html2canvas` a DOM-ot rajzolja újra, tehát a Mapbox GL vászna üresen
  maradna — pont a térkép hiányozna a bugreportból.

## Helyzetlekérdezés natívban: a `navigator.geolocation` tilos (2026-09-09)

- **Natív appban SOHA nem hívunk `navigator.geolocation`-t.** Mérve (iPhone,
  2026-09-09): a WebView geolocation API-ja KÉT rendszerablakot hoz fel
  egymás után. Az első a CoreLocation kérdése, a rendszer folyamatából, a
  készülék nyelvén. A második a **WebKit saját, oldal-szintű engedélykérése**,
  amit a WebKit a mi processzünkben rajzol — ezért **angolul** (az app
  bundle-ben nincs magyar lokalizáció, `CFBundleDevelopmentRegion: en`), és
  ezért hivatkozik a **`localhost`** névre (`capacitor.config.ts` →
  `server.hostname`). A felhasználónak ez érthetetlen és gyanús: pont abban a
  pillanatban, amikor igent mondana.
- Az egyetlen belépési pont a **`src/lib/currentPosition.ts`**: natívon a
  `BackgroundLocation.getCurrentPosition()` plugin-metódus, weben a böngésző
  API-ja. Aki új helyzetlekérdezést ír, ezt hívja — **egyetlen** közvetlen
  `navigator.geolocation` hívás visszahozza az angol ablakot az egész appban.
  Regressziós teszt: `src/lib/currentPosition.test.ts`.
- iOS-en az egyszeri fix **külön `CLLocationManager`-en** megy
  (`oneShotManager`). A rögzítés managerének `didUpdateLocations` visszahívása
  minden pontot a nyomvonal sorába tesz — egy térkép-középre igazításhoz kért
  fix nem kerülhet bele a felhasználó megtett útjába.
- **Engedélyt magyarázat nélkül nem kérünk.** A magyarázó képernyő
  (`LocationPrimer`) csak akkor ér valamit, ha a helyzetkérés IS a nyugtázás
  mögött van: korábban a `TrackingScreen` a mountján kért helyzetet, és a
  rendszerablak ráugrott az el nem olvasott magyarázatra. A `primerSeen` ezért
  nem csak azt dönti el, mi LÁTSZIK, hanem azt is, mi FUT.
- A „Mindig" szintű engedélyről **egy helyen** beszélünk: a magyarázó
  képernyőn. A rögzítés alatti figyelmeztető sáv natív ága törölve — három
  helyen ugyanaz az üzenet elveszi a hitelét mindháromnak.

## Route Intelligence: preferenciák és forráshatárok (2026-09-11)

- Az útvonalválasztás három külön fogalmat kezel: **pontosan egy elsődleges
  stratégia**, **pontosan egy terepprofil**, valamint több kombinálható
  útjellemző. Az egymással versengő célokat nem független kapcsolókként
  mutatjuk; a `Felfedező` és a `Kedvelt szakaszaim` kölcsönösen kizárja egymást.
- A jelenlegi idő-/távcélos körútvonalaknál nincs külön `Legrövidebb` vagy
  `Gyors` stratégia: a kívánt hossz már bemenet. Ezek csak későbbi A→B
  tervezésnél kapnak külön jelentést.
- **Biztonságot nem ígérünk.** A UI `Védettebb` útvonalat és külön mérhető
  közlekedési dimenziókat mutathat; minden minősítéshez lefedettség,
  bizonytalanság és magyarázat tartozik.
- A hálózati pontozás elsődleges forrása OSM + saját GRUNDO-előzmény; a
  domborzat külön DEM-ből érkezik. A Google Maps tartalmából nem építünk saját
  pontozó adatbázist, és nem keverjük a Mapbox-térképpel.
- A készülékirány natív szenzorból jön (`CLHeading` / rotation vector), webes
  geolokációs fallback nélkül. Mozgáskor a GPS-nyomvonal iránya vezetheti a
  kamerát; álló helyzetben a pozíciójel iránynyila a készülék tájolását mutatja.

## Útvonal-könyvtár (2026-09-12)

Terv: [`../routing/route-library.md`](../routing/route-library.md) · mérés:
[`../routing/benchmark.md`](../routing/benchmark.md) → „Hol megy el az idő”.

- ⚠️ **A küldetés-ajánló lassúsága NEM a GraphHopperben van.** Mérve: a
  tervezőmotor mindkét menete együtt 0,3–1,8 s minden hosszon, a bezárt
  cellahalmaz kiszámítása viszont 20–25 km-en 8 s, 60 km-en 35 s. Ne kezdj a
  tervezőmotor hangolásába a mérés újrafuttatása nélkül.
- **A megoldás iránya nem gyorsítás, hanem felhalmozás:** minden kiszámolt
  útvonal paraméterezve eltárolódik, és új keresésnél azonnal felajánlható,
  amíg a friss generálás a háttérben fut. A könyvtár használat közben javul.
- **A könyvtár útvonalat tárol, nem eredményt.** Terület, GP, áldozat és
  birtokviszony sosem onnan jön — ezek minden kérésnél élőben számolódnak,
  különben sérülne a „küldetés nem becslés” szabály.
- **A cellahalmaz viszont TÁROLÓDIK** (Cloud Storage, a `territoryBlobStore`
  mintájára), mert épp az a drága. Ettől lesz a hasonló találat teljes értékű
  kártya, nem helyőrző.
- **A rekordban nincs felhasználói azonosító.** Az útvonal az úthálózat terméke,
  nem valakinek a nyomvonala; így a megosztása senkiről nem árul el semmit.
- **A hasonló találat nem fogyasztja a heti generálási keretet**, mert nem
  történt generálás. A Pro ettől sem kap játékbeli előnyt: ugyanaz a könyvtár,
  ugyanaz a terület és GP.

## A→B útvonaltervezés a rögzítés előtt (2026-09-12)

Spec: [`../02-funkcionalis-spec.md`](../02-funkcionalis-spec.md) → *Útvonaltervezés
a rögzítés előtt* · terv és mérés:
[`../routing/point-to-point.md`](../routing/point-to-point.md).

- **Tervezési réteg a meglévő rögzítés előtt, nem külön aktivitásrendszer.** A
  kimenet ugyanaz a vezetett rögzítési csomag, amit a küldetés `Indítás most`
  gombja állít elő. Ne épüljön párhuzamos routing- vagy location-rendszer.
- ⚠️ **A „Csak oda" A→B útvonal nem zár kört, ezért nem ad területet**, csak a
  megtett táv utáni GP-t. A felület ezt mondja ki indulás előtt.
- **A kerülő mérete a bezárt terület mérete, ezért játékkonstans**
  (`src/config/gameplay.ts`): az oldalirányú eltérés kis kerülőnél **±500 m**,
  közepesnél **±1 km**, nagynál **±2 km** (Geri döntése, 2026-09-12).
- **Az útvonaltervezés ugyanabba a heti generálási keretbe számít**, mint a
  küldetés-ajánló. Enélkül megkerülné a küldetés-ajánló korlátját.
- ⚠️ **Mérve (2026-09-12): a kétoldali loop megépíthető a meglévő
  GraphHopperrel**, a kérésbe ágyazott `custom_model.areas` + `in_<terület>`
  súlyozással — az odaút és a visszaút tényleg az egyenes ellentétes oldalára
  kerül. **Új routing library nem kell.**
- ⚠️ **De a kerülő méretét a jutalmazott sáv szélesítése NEM állítja** (mérve: a
  közepes és a nagy sáv ugyanazt az útvonalat adta). A méret **köztes pontból**
  jön, a `loopWaypoints` mintájára. Ne próbáld sávszélességgel megoldani.
- **A `areas` poligonok száma mérhetően drágít** (4 → 229 ms, 27 → 557 ms). A
  visszaút „ne az odaúton menj" korlátja ritka mintavétellel vagy egyetlen
  korridor-poligonnal épüljön.
- A poligonszámítás itt **routing-súlyozás, nem területszámítás** — a
  „poligon-algebra soha" szabály a területre vonatkozik, ezt nem sérti.
- **A geocoding az egyetlen új külső képesség.** A Mapbox Geocoding külön termék
  és külön számlázás, és korlátozza a találat tartós tárolását; a geocoding mögé
  ezért interfész kerül, hogy saját Photon/Nominatim is mögé tehető legyen.

### Az elágazási szabályok súlyként (2026-09-12)

- ⚠️ **A „merre forduljak" szabályok SÚLYOK, nem elágazásonkénti döntések.** A
  szabály előretekintést kér („ha később jobb fordulási lehetőség jön, menj
  egyenesen"), amit egy mohó bejáró elvileg sem tud: nem ismeri a folytatást,
  zsákutcába futhat, és nem garantálja, hogy `B`-be eljut. **Ne írj mohó
  útvonal-bejárót** — rosszabb útvonalat adna, mint a mai.
- **Három zóna a helyes oldalon**, nem egy széles sáv: `reached` (a kért kerülő
  ±30%-a, súly 1,0), `approach` (a tengely és a kerülő 70%-a között, 0,6 —
  „még távolodj"), minden más 0,3 („gyere vissza"). Ez a súlyozott alakja
  annak, hogy mikor kell távolodó és mikor közeledő irányt választani.
- ⚠️ **A zónák a tengely 15–85%-a között élnek.** Az `A` és a `B` a tengelyen
  van; végpontig érő zónánál maga az indulás és az érkezés esne büntetett
  területre, és a tervező a rajt körül kezdene kanyarogni.
- ⚠️ **A zónasúlyozás NEM helyettesíti a köztes pontot** (mérve: nélküle a kis,
  közepes és nagy kerülő ugyanazt az útvonalat adja — Deák→Hősök tere mindhárom
  esetben 2,8 km). A prioritás szorzó, nem kényszer: egy 3,3-szoros büntetés a
  rövid úton olcsóbb, mint a hosszú kerülő a jutalmazott sávban. **A köztes pont
  adja a MÉRETET, a zónák az ALAKOT — mindkettő kell.**
- ⚠️ **A kerülő méretét a KÖZVETLEN TÁV arányában kell korlátozni**
  (`MAX_OFFSET_AXIS_RATIO`, ma 0,45). Geri vizuális visszajelzése: 2,6 km-es
  A–B távnál a 2000 m-es kitérő a teljes táv 77%-a, és a generált útvonal nem
  kitérőt tesz, hanem **más irányba megy**, majd ugyanazon az úton hozza vissza
  a felhasználót. Rövid úton tehát a nagy kerülő közelebb kerül a közepeshez —
  ez az őszinte válasz, nem hiba.
- **A leggyorsabb útvonal MINDKÉT legnek kerülendő, de csak lágyan**
  (`FAST_LINE_PENALTY` 0,35). Korábban csak a visszaút kapott kerülendő
  területet, ezért az odaút a köztes pontig egyszerűen a közvetlen úton ment.
  ⚠️ De a majdnem-tiltás (0,05) itt MÉRHETŐEN ROMLOTT: nőtt a visszafordulás és
  a két leg közös szakasza, mert a router ugyanarra a kevés maradék
  alternatívára szorult. Az odaút újrajárása marad a kemény tiltás
  (`RETRACE_PENALTY` 0,05) — a kettő nem ugyanaz a szabály.
- **Gyalog és futva a forgalmas út mindig rossz**, nem csak a „csendes"
  állásban (Geri, 2026-09-12). A `fast` sem jelenti, hogy négysávos úton
  vezetünk végig sétálni. Ára mérhető: a gyalogos útvonalak hosszabbak és
  kanyargósabbak lettek.
- ⚠️ **`pass_through: true` KELL minden köztes pontos kérésbe.** A köztes pont
  kötelező állomás, és a GraphHopper alapból ENGEDI, hogy ott megforduljunk:
  ha a mértani pont egy mellékutca vagy rakparti szakasz közepére kapcsolódik,
  az útvonal odamegy és ugyanazon az úton visszajön. Ez volt a képeken látható
  „láb". A `pass_through` ennek a GraphHopper-megfelelője annak, amit a
  Mapbox-ág `continue_straight=true`-val old meg (`planLoop`). Mérve, 21 eset:
  **56 → 37 visszafordulás**, és az odaút 21-ből 18 esetben teljesen tiszta
  lett. **Ne vedd ki.**
- **A visszafordulásokat nem súllyal, hanem jelöltválasztással kezeljük.**
  Legenként 9 köztes pont megy ki párhuzamosan, és a legkevésbé hibás nyer.
- ⚠️ **A kérésbeli `turn_penalty` NEM megoldás — mérhetően ROMLIK tőle az
  útvonal.** (Egy korábbi mérésem „hatástalannak" mondta; az csak a köztes
  pontos beállításban volt igaz, ahol véletlenül ugyanazt adta. Sima A→B-n
  mérve hat.) Három páron, kanyarbüntetés nélkül → enyhe (+15) → erős (+60):
  Újpest U 0 → 5 → 6, Deák→Flórián U 0 → 1 → 5, Kelenföld U 2 → 5 → 5. A
  „menjen tovább és forduljon a következő utcán" tehát NEM érhető el a kanyarok
  árazásával. Ne próbáld újra.
- ⚠️ **A kis tömbkerülő hurkokat az ÚTHÁLÓZAT kényszeríti, nem a súlyozásunk.**
  Mérve: a kitérő be- és kilépési pontja között SEMMILYEN egyedi súlyozás
  nélkül kért útvonal bitre ugyanolyan hosszú (5/5 esetben, 2,0× a légvonal).
  Kanyarodási tilalom vagy egyirányú utca — a tervező helyesen viselkedik.
- **Sétálótérre bringával nem megyünk** (`road_class == PEDESTRIAN` → 0,02
  bike profilon), és a köztes pont sem kapcsolódhat rá (`snap_prevention`
  tartalmazza a `pedestrian`-t). Gyalog és futva a téren átvágás természetes,
  ezért ott nincs büntetés — egy enyhe (0,8) gyalogos büntetést megmértem, és
  semmit nem változtatott, ezért nem került be.
- **A felhasználói megállók CSAK az odaútra vonatkoznak** (Geri döntése,
  2026-09-12). A visszaút egyben megy `B`-ből `A`-ba, a megállók érintése
  nélkül — ettől marad a visszaút tervezése ugyanolyan egyszerű, mint megállók
  nélkül: egyetlen A–B tengelyhez képest kell csak oldalt választania. Ha
  megálló van, az odaút alakját AZOK adják, nem a mi köztes pontjaink.
- **Az odaút oldalát a megállók döntik el**, nem a rögzített „bal". Különben a
  keletre tett megállókat egy nyugatra terelt odaúttal küzdenénk le.
- ⚠️ **A BEZÁRT TERÜLET NEM A MATERIALIZÁLT CELLÁK SZÁMA.** Nagy huroknál a
  motor a belsőt tömör parentekben tartja (`loopInterior.ts`), ezért a
  `shapeCandidateCells().cells` gyakorlatilag csak a FAL. Abból területet
  számolni súlyos alulbecslés — mérve a labor első változatában: 1,498 km²
  a valódi 8,901 helyett. A helyes szám a `loopCellCount(loop)`, a
  reprezentációtól függetlenül. Ugyanez a kirajzolásra is igaz: a tömör belsőt
  külön, a saját felbontásán kell poligonná alakítani.
- ⚠️ **A GRAPHHOPPER A PRIORITÁST 1-NÉL ELVÁGJA — jutalmazni nem lehet, csak
  büntetni.** Mérve (2026-09-12): a „dombos" terepprofilhoz a meredek élekre
  tett `1.8`-as szorzó SEMMIT nem változtatott, mert a legtöbb él prioritása
  eleve 1. A működő alak a fordítottja: a SÍK éleket kell büntetni
  (`average_slope < 1.5` → 0,45). Ugyanez a csapda vár minden „ezt szeretném
  előnyben" szabályra.
- **A domborzat a HELYI gráfban be van kapcsolva** (`config-grundo.yml`:
  `graph.elevation.provider: srtm`, `average_slope` + `max_slope`), hogy a
  sík/dombos preferencia kipróbálható legyen. A `config-cloudrun.yml`
  SZÁNDÉKOSAN NEM tartalmazza: az éles DEM-forrás (licenc, frissítés,
  konténerméret) külön döntés — lásd `docs/routing/data-sources.md`.
  ⚠️ Domborzat nélküli gráfon az `average_slope`-ra hivatkozó szabály HIBÁT ad,
  nem útvonalat; a tervező ezért csak akkor küldi, ha a hívó kéri, a labor
  pedig a GraphHopper `/info` alapján tiltja le a választót.
- ⚠️ **A TERVEZŐNEK EL KELL TUDNIA ENGEDNI A KÖZTES PONTOT.** A jelöltek közt
  van egy köztes pont NÉLKÜLI tartalék is, és a hibapontszám tartalmazza az
  elmaradt kerülő büntetését (`OFFSET_SHORTFALL_WEIGHT`, 800 — szándékosan
  kevesebb egy visszafordulásnál). Enélkül a tartalék mindig nyerne (hibátlan,
  de nem kerül), így viszont csak akkor, ha MINDEN kerülős jelölt rossz.
  Erre a Duna menti tengely mutatott rá: a kért oldalon 400–500 méterre víz
  van, tehát mind a 9 köztes pont rossz helyre esett, és mindegyik jelölt
  kiment egy stégre, majd vissza — a jelöltkészlet volt rossz, nem a választás.
  Mérve: a Deák → Flórián kis kerülő odaútja 1 visszafordulás / 2 kitérő →
  **0 / 0**.
- ⚠️ **AMIT ERRE MEGMÉRTEM ÉS NEM HASZNÁLT:** sem a `road_class = other`
  rákapcsolás-tiltása, sem az áthaladásának büntetése nem változtatott semmit
  (bitre ugyanazok a jelöltek). A hiba nem az útosztályban van. Ne próbáld
  újra útosztály-szabállyal.
- ⚠️ **A KÖZTES PONT VÍZBE IS ESHET — nézd meg, hova kapcsolta a motor.**
  A Deák → Flórián tengely a Duna mentén fut, tehát a „bal oldal" nagyrészt
  maga a folyó. A vízbe eső mértani pontot a GraphHopper a legközelebbi
  járható útra teszi — egy STÉGRE —, és az útvonalnak ki kell mennie rá, majd
  vissza. Ugyanez vasúti területnél, zárt gyárudvarnál, repülőtérnél. A motor
  megmondja, hova kapcsolt (`snapped_waypoints`, a `DirectionsRoute`-ban
  `snappedWaypoints`); mérve ezen a tengelyen 1–204 m a szórás. A
  `VIA_SNAP_TOLERANCE_M` fölötti rákapcsolás erős hibapont a jelöltre.
  ⚠️ **Ez őrszem, nem gyógyszer:** a 21 mért eseten egyszer sem fordította meg
  a választást — a stég a folytonos korridor bevezetésétől tűnt el. Attól még
  kell, mert a hibaosztályt ez zárja ki.
- ⚠️ **A KERÜLENDŐ FOLTOK ÉRJENEK ÖSSZE** (`routeAvoidRings` → `continuous`).
  Szaggatott foltsornál (12 folt 6 km-en, ~500 m réssel) a tervező minden
  foltnál kitér és visszatér — épp ez adja a felesleges „ficakokat" a
  térképen. A sugár ezért a mintavételi lépés fele, `FAST_LINE_MAX_BUFFER_M`
  plafonnal. Mérve: 122 → 109 rövid kitérő 42 legen.
- **A rövid kitérők TÖBBSÉGE nem a mi hibánk.** Mérve, kitérőnként
  visszaellenőrizve (a kitérő két vége között súlyozás NÉLKÜL kért útvonal
  hossza): 9-ből 7 esetben ugyanolyan hosszú, tehát az úthálózat kényszeríti
  (tiltott kanyar, egyirányú utca, rámpa). A maradékot a köztes pont
  rákapcsolása okozza. **Mielőtt egy kitérőt hibaként javítanál, mérd meg,
  melyik fajta** — a `tmp/probeSpurOrigin.ts` mintája erre való.
- ⚠️ **AZ ÖNMAGÁBA VISSZATÉRÉS KÜLÖN MÉRTÉK, nem a visszafordulás változata**
  (`countSelfRevisits`, `src/game/routeShape.ts`). Amikor a `pass_through`
  megtiltotta a megfordulást a köztes pontnál, a tervező a hibák egy részét
  nem megszüntette, hanem **hurokká alakította**: megkerüli a tömböt, és
  ugyanoda tér vissza. A `countUTurns` erre VAK (nincs benne 180 fokos
  fordulat), a térképen viszont ez a legszembetűnőbb hiba — ebből derült ki,
  hogy a mérőszám és a felhasználói élmény elvált egymástól. A jelöltválasztás
  ezért a visszatérést súlyozza a legerősebben (10 000), a visszafordulást
  1 000-rel, a rövidkerülőt 1-gyel. Mérve: 26 → 14 visszatérés 42 legen, és
  minden gyalogos eset tiszta lett.
- ⚠️ **Amit le kell szállni, az sem útvonal.** Mérve: a bringás jelöltek
  LÉPCSŐN mentek át (`road_class` részletek: `residential, footway, steps`) — a
  GraphHopper járhatónak veszi, mert tolva teljesíthető. A `get_off_bike`
  jelzés 0,1-es büntetése ezt megszünteti; a legnagyobb egyszeri javulás a
  bringás eseteken (Újpest kis kerülő 7 → 3 visszafordulás).

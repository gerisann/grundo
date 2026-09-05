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

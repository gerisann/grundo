# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #8.** (A számozás a BESZÉLGETÉSEKÉ, nem a
munkameneteké: azt kell nézni, hány chat van. Lásd [AGENTS.md → 7. A
beszélgetések neve](AGENTS.md).)

## ÁLLAPOT

Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`. HEAD: `149bdef`.

Tesztek, most mérve: `npm test` → **377 zöld** (27 fájl). Typecheck (gyökér ÉS
`server/`) hibamentes. Az emulátoros készlet ebben a menetben NEM futott: a
Firestore viselkedése nem változott (nincs új lekérdezés, tranzakció, séma
vagy szabály) — csak felület és lokális tár.

## ⚠️ ELSŐ OLVASATRA: MI KELL A TELEPÍTÉSHEZ

**Csak frontend.** Backend, index, szabály, migráció NEM kell — ez a menet
egyetlen szerveroldali fájlhoz sem nyúlt.

## EBBEN A MENETBEN ELKÉSZÜLT

A menet a #7 három pontját vitte végig: szellemvonal → mentett útvonalak →
2D/3D nézetváltó. Mind a három az F2.5 küldetés-ajánló „féllábon állását"
javítja: eddig a kártya ígért egy útvonalat, az „Indítás most" viszont a
rögzítésre dobott, ahol annak nyoma sem volt.

### 0. `formatArea` — a háttérfeladat becsatornázva (`1042584`)

Geri külön háttérfeladata commitolatlanul állt a munkamásolatban. **Nem a
kódot húzta a spechez, hanem a specet a kódhoz**: a 2026-08-15-i m²-döntést
felülírja, a terület MINDIG km², három tizedessel. A `docs/03`, `docs/README`,
`docs/05` és az `AGENTS.md` 9. szabálya ehhez igazítva; új
`src/lib/format.area.test.ts` (9 teszt) rögzíti, hogy a kettő ne mehessen
újra szét. A `formatArea` addig teljesen fedezetlen volt.

### 1. Szellemvonal (`f5cff97`)

A kiválasztott küldetés vonala szaggatott vezetővonalként a rögzítés
térképére.

- Új `src/lib/ghostRoute.ts` — a `dailyMission` mintájára, lokális tár.
- `MapView`: új `ghostTrack` prop, külön forrás és réteg (`GHOST_SOURCE`),
  szaggatott `--info` színnel. **A valódi nyom réteg ALATT** rajzolódik, mert
  a kettő gyakran egy vonalon fut, és a tényleges GPS-nyomnak kell felül
  lennie.
- ⚠️ A takarítás a `useRecorder.discard()`-ba került, nem a képernyőre. Ez az
  EGYETLEN visszaállítási pont, amin minden eldobási ág átmegy — a képernyő
  gombjai ÉS a Dock „Új rögzítés" gombja is. A képernyőre téve az egyik út
  kimaradt volna.

### 2. Mentett útvonalak (`c005253`)

- Új `src/lib/savedRoutes.ts` — mentés, listázás, törlés, dedupe `polyline`
  szerint, max 20 elem.
- **Döntés (Geri, 2026-08-22): lokális tár, nem Firestore.** Eszközök közti
  szinkron tehát nincs. A modul úgy van megírva, hogy ha egyszer kell,
  szerveresre cserélhető a hívók módosítása nélkül.
- Új `src/lib/missionMeta.ts` — a négy küldetés-karakter címkéje, színe és a
  terület-rovat logikája. A `MissionsScreen` saját `KIND_META`/`areaStat`-ja
  ide költözött, mert most már két képernyő rajzolja ugyanazt.
- Új `SavedRoutesSheet` + CSS a `ConnectionsSheet` mintájára (Escape zár,
  z-index 60).
- A „Mentett útvonalak" gomb a rögzítés indítás előtti paneljén — a docs/02
  képernyőtérképe eleve ide kéri (kép #27).

### 3. 2D/3D nézetváltó (`149bdef`)

Új `src/lib/heading.ts` + 12 teszt. A gomb a recenter fölött, a választás
localStorage-ban marad meg, alapértelmezés a 2D (opt-in).

**Négy mért döntés — egyik sem tipp:**

1. **Nem a `coords.heading`.** Az eszköz iránymezeje asztali gépen és sok
   Androidon `null`, álló helyzetben `NaN`. A saját nyomvonalunkból viszont
   mindig kiszámolható.
2. **A bázisvonal 25 m, nem az utolsó két pont.** 400 szintetikus futáson
   mért szöghiba: ±4 m zajnál 6,7° átlag, ±6 m-nél 12,4°, ±10 m-nél 26,3°.
   **Ebből következik, hogy a simítás kötelező** — nélküle a térkép láthatóan
   remegne. A táblázat a `heading.ts`-ben.
3. **Megmértem és ELVETETTEM a végpontok súlypontozását.** 3 mintánál a
   javulás elhanyagolható (12,4° → 11,8°), 5-nél viszont a két súlypont
   összecsúszhat és az irány 180 fokot fordul — a mért legrosszabb hiba 179°
   volt. Ez a fajta hiba mérés nélkül élesben derült volna ki.
4. **A programozott kamera működik `dragRotate: false` mellett** — eldobható
   lapon, inline Mapbox-stílussal mérve: `easeTo({pitch:55, bearing:120})`
   után a térkép tényleg 55/120 állásban van. A `maxPitch` alapértelmezése
   ebben a verzióban **85** (nem 60), tehát az 55 belefér.

⚠️ **A 2D-re váltás kötelezően északra is visszaforgat.** A `dragRotate`
tiltva van, tehát a felhasználónak NINCS gesztusa, amivel egy elforgatva
ragadt térképet visszaigazítson. Ha valaki egyszer csak a `pitch`-et nullázza
itt, a világ ferdén marad.

## ⚠️ AMIT NEM TUDTAM ELLENŐRIZNI

**A `MapView` felületét élőben** — a komponens token nélkül `null`-t renderel
(`mapboxConfigured`), a fejlesztői környezetben pedig nincs Mapbox-token.
Tehát a szellemvonal szaggatott vonala, a 3D-be dőlt kamera és a gombok
tényleges kinézete **először élesben látszik**.

Amit helyette megmértem: a menetirány-számítás teszttel (12 eset), a Mapbox
kamera-viselkedése eldobható lapon (fent, 4. pont), a mentett útvonalak
felülete pedig **élőben, emulátorban, bejelentkezve** — mentés, lista,
törlés, üres állapot, mindkét témában (a `SavedRoutesSheet` nem tartalmaz
`MapView`-t, ezért az látszott).

**Telepítés után ezt nézd meg**: a rögzítés képernyőn a 3D gomb (jobb alsó
sarok, a pozíció-gomb fölött), és hogy futás közben a térkép a menetirányba
fordul-e. Ha remeg, a `smoothBearing` 0,2-es tényezője a hangolási pont a
`MapView`-ban.

## ⚠️ A BRINGÁS KÜLDETÉS — MÉG MINDIG NYITOTT

Az előző menet kétmenetes önkalibrálást tett a küldetés-generálásba, és a
`526ddb5` telepítve lett — de **hogy a bringa működik-e, nem tudjuk**. Ezt a
menet nem érintette.

Ha még mindig üres a válasz, a `reason` mező most már megmondja, miért:
`no_routes` (a Mapbox nem ad kerékpáros útvonalat innen), `no_loops` (ad, de
nem záródik), `no_fit` (záródik, de rossz hosszú). **Ez a három teljesen más
teendőt jelent** — érdemes ezzel kezdeni a következő menetet.

⚠️ A backend-telepítés KÖTELEZŐEN tartalmazza a Mapbox-tokent, mert a
`cloudbuild.yaml`-ban szándékosan üres:

```
cd ~/grundo && gcloud builds submit --config cloudbuild.yaml --substitutions=_MAPBOX_TOKEN=<grundo-server-directions>
```

A sima `gcloud builds submit --config cloudbuild.yaml` ÜRES tokennel telepít,
és onnantól a küldetés-generálás 503-at ad.

## MAPBOX-TOKENEK — HÁROM VAN, NE KEVEREDJENEK

| Token | Hol él | URL-korlátozás |
|---|---|---|
| `Default public token` | sehol (kiváltva) | nem is lehet ráállítani |
| `grundo-web` | Cloud Shell `~/grundo/.env` → bundle | `https://grundo.web.app` |
| `grundo-server-directions` | csak a deploy `--substitutions`-ben | **nincs, és nem is szabad** |

A szerver tokenjén azért nincs korlátozás, mert az URL-korlát a böngésző
`Referer` fejlécére épül — egy Cloud Run hívásnak nincs olyan. A védelme az,
hogy sehol nem publikus: se a repóban, se a bundle-ben.

## GERI VISSZAJELZÉSE (2026-08-22) — EZ A KÖVETKEZŐ MENET

Hat bejelentés érkezett a #7 lezárása után, screenshotokkal. **Egyiket sem
javítottam** — Geri kifejezetten kérte, hogy csak a HANDOFF-ba kerüljenek, és
új beszélgetésben (#8) folytassuk. Mindegyikhez van egy induló nyom, kódból
vagy mérésből — nem tippek.

### A. A napi küldetés-kártya „üresbe" mutat — VALÓDI HIBA, megvan az oka

A Home kártyája (`DailyMissionCard`, [HomeScreen.tsx:204](src/screens/HomeScreen.tsx))
a `readDailyMission()`-nel a localStorage-ból olvassa ki a küldetést, és
kiírja a szövegét/számait. A gombja viszont csak `navigate('/kuldetesek')`-et
hív — **semmit nem visz magával**. A `MissionsScreen` pedig üres állapotból
indul, nem tölti vissza a mentett napi küldetést. Eredmény: a Home mutat egy
konkrét ajánlatot, a célképernyő meg nem tud róla.

**Javítás iránya**: a `MissionsScreen` induláskor olvassa vissza
`readDailyMission()`-nel, és jelenítse meg kártyaként (a `result.missions`
állapotba téve, vagy egy külön „ma generált" ágban).

### B. Hol a Küldetések fül? / Hová kerülnek a mentett útvonalak?

Megmérve: a `/kuldetesek`-re **az egyetlen belépő a Home-kártya** — nincs a
dokkban, nincs a profilon, sehol máshol. A `docs/01-kepernyoterkep.md` viszont
már eldöntötte, hova valók:

```
Profil
├── Profil · Statisztikák
├── Útvonalak (generálás + mentettek)   ← ide tartozik mindkettő
├── Edzés · Jelvények · Beállítások
```

⚠️ A `ProfileScreen.tsx` (355 sor) **ma egyetlen folyó nézet, nincs
fül-szerkezet**. Ez tehát nem „még egy fül hozzáadása", hanem a
fül-szerkezet BEVEZETÉSE — érdemes úgy megépíteni, hogy a spec többi öt füle
(Statisztikák, Edzés, Jelvények, Beállítások már megvan külön útvonalon) is
beleférjen később.

A rögzítés képernyő „Mentett útvonalak" gombja (a #7-ben épült) MARADHAT —
azt a `docs/02` kép #27 külön kéri, indítás előtt van értelme.

### C. A célhossz-bemenet bővítése

Ma: `célhossz = perc × 60 ÷ tempó`, ahol a tempó a **saját utolsó 10
aktivitás** átlaga típusonként (`recentPaceSamples` +
`averagePaceSecPerKm`, [missions.ts:84](src/game/missions.ts)), alapérték
ha nincs elég minta: futás 360 mp/km, séta 780 mp/km, bringa 165 mp/km
(`src/config/gameplay.ts` → `MISSION_DEFAULT_PACE_S_PER_KM`).

Geri három javaslata:
1. **Kézi tempó-felülírás** — ma nincs, csak mérésből jön. Új felhasználónak
   (nincs 10 aktivitása) ez számítana a legtöbbet.
2. **Km-ben is megadható legyen az idő helyett** — a szerver úgyis
   `targetKm`-mel dolgozik ([missions.ts:65](src/game/missions.ts) →
   `targetDistanceKm`), a percet csak erre számolja át. Olcsó váltás.
3. **Prioritás/irány** — ⚠️ pontosítás: a négy karakter (hódítás/rablás/
   erősítés/felfedezés) **már ma is mind legenerálódik**, kártyánként külön.
   Ami TÉNYLEG hiányzik, az az IRÁNY (a rendszer nyolc égtájban keres,
   `missionBearings`) és a szűrők (kevés kereszteződés · zöldterület · lapos
   terep — a felület már kéri, a Directions API támogatja, csak nincs
   bekötve).

### D. Home-kártya — bezárhatóság + látható gomb

`DailyMissionCard` ma egy sima `<button>`, se X, se nyíl-ikon. A
`NotificationPanel`-nél már van bezárható-kártya minta, azt érdemes követni.

### E. A küldetés-tervező „lábakat" rajzol mellékutcákba (screenshot)

Geri három screenshotot küldött: a szaggatott javasolt útvonal több helyen
egy rövid, semmi értelmű **kitérőt** tesz egy mellékutcába és vissza —
mintha U-fordulót csinálna egy zsákutcában.

**Erős gyanú, MÉRVE NEM, csak kódból**: a Mapbox Directions hívás
([directions.ts:64](server/src/lib/directions.ts)) `continue_straight=false`-szal
megy. Ez a Mapbox dokumentációja szerint pontosan ezt engedi meg: a
köztes pontoknál (waypoints) a route bármelyik irányból érkezhet, U-fordulóval
is. A mi köztes pontjaink (`loopWaypoints`, [missions.ts:133](src/game/missions.ts))
tisztán geometriai helyek — ha egy pont egy mellékutca közelébe esik, a
Directions odaszalad, megfordul, és visszajön, mert ELÉG közel van hozzá, és
a `continue_straight=false` ezt nem tiltja.

**A következő menet első dolga legyen ennek MÉRÉSE**: egyetlen `planLoop`
hívás `continue_straight=true`-val ugyanazokra a koordinátákra, és a
polyline-ok összevetése. Ha eltűnnek a lábak, ez volt az ok — de a
`continue_straight=true` mellékhatása lehet, hogy néhány jelölt onnantól NEM
zár be kört (mert a route nem tud visszafordulni ott, ahol kellene), ezt is
mérni kell, nem feltételezni.

### F. Vizuális kérések a térképen

1. **A szellemvonal színe** `#FA5F73` legyen, nem kék. Ma `var(--info)`
   (`#3b82f6`, téma-független — lásd `src/styles/tokens.css` 34. sor) a
   `GHOST_SOURCE` réteg színe ([MapView.tsx](src/components/MapView.tsx) →
   `addLayers`). Egyszerű csere, de **új tokent érdemes bevezetni**
   (pl. `--route-ghost`), ne szám szerint írjuk be — a `#FA5F73` amúgy is
   majdnem pontosan a sötét téma `--territory-rival`-ja (`#ff5f6d`), érdemes
   megkérdezni Gerit, szándékosan ilyen közeli színt akar-e, vagy legyen
   attól is megkülönböztethető.

2. **Hexagon be/ki kapcsoló ikon a rögzítés térképén.** Van már precedens: a
   Terület képernyőn a szem-ikon (`overlayVisible`,
   [TerritoryScreen.tsx:85](src/screens/TerritoryScreen.tsx)) — DE az a
   teljes rátétet (panelek is) kapcsolja, nem csak a hexagonokat. Itt egy
   szűkebb kapcsoló kell: csak azt dönti el, mely `layers` mennek át a
   `MapView`-nak, a `track`/pozíció/gombok maradnak.

3. **Az elfoglalt cella színe a FATE szerint, nem egységesen lila.**
   Itt van a legtöbb meglepetés kódolvasásból:
   - A motor MÁR SZÁMOL cellánkénti sorsot: `resolveClaim`
     ([claim.ts:25](src/game/claim.ts)) egy `fates: Map<CellId, CellFate>`-et
     ad vissza, ahol `CellFate = 'free' | 'reclaimed' | 'stolen' |
     'breakthrough'`. A `'stolen'` pontosan az, amit Geri „elrabolt
     terület"-nek hív.
   - ⚠️ **Ez a per-cella infó ELVÉSZIK, mielőtt a felületre érne.** A
     `processActivity` ([game/index.ts:76](src/game/index.ts)) több
     bezárást összevon, és az eredmény egy lapos `Set<CellId>`
     (`claimedCells`) — a fate-eket eldobja. A TrackingScreen élő előnézete
     ([TrackingScreen.tsx:142](src/screens/TrackingScreen.tsx) → `preview`)
     ebből a Setből építi a `MapView` rétegeit, tehát a színnek és a
     szintszámnak sincs honnan jönnie.
   - **A javítás iránya**: a `ProcessResult` bővítése egy
     `Map<CellId, CellFate>`-tel (vagy legalább `Map<CellId, {fate, defense}>`),
     a TrackingScreen preview ezt adja tovább a `MapView`-nak `{cell, defense,
     owner}` helyett `{cell, defense, fate}` alakban, a `MapView` pedig a
     `stolen` fate-re `#FA5F73`-at (vagy az új `--route-ghost`-tól független,
     de hasonló hangnemű tokent) használ, egyébként marad a lila
     `--territory-own`. Az átlátszóság-lépcső (`--defense-alpha-1..5`)
     MÁR MEGVAN és MŰKÖDIK ([MapView.tsx](src/components/MapView.tsx) →
     `syncData`, `cssNumber('--defense-alpha-' + defense, …)`) — ezt nem kell
     újraépíteni, csak a színválasztást kell a fate-hez kötni.

4. **A védelmi szám (1–5) MOST NEM látszik élő rögzítés közben.** Megtaláltam,
   miért: `MapView.tsx` `syncData`-jában a `defenseLabel` kifejezetten
   `territory && !preview` esetén jelenik meg — **a `preview: true` cellákon
   szándékosan el van rejtve** ([MapView.tsx](src/components/MapView.tsx),
   a `defenseLabel:` sor). Ez a #3-mal ugyanaz a gyökér: amíg a preview-cellák
   nem hordoznak valódi `defense` értéket (ma mind alapból 1-esként rajzolódik,
   mert az `entry.defense` nincs kitöltve a TrackingScreen preview-jában),
   nincs mit kiírni. A #3 javítása (fate + defense átadása) ezt is megoldja —
   utána már csak a `!preview` feltételt kell levenni vagy módosítani.

## KÖVETKEZŐ MENET — JAVASLAT

1. **E. pont: a küldetés-tervező "lábai"** — MÉRÉSSEL kezdj (`continue_straight`
   összevetés), utána dönts. Ez zavarja a legjobban a küldetés-élményt.
2. **A. pont: a napi küldetés-kártya hibája** — kicsi, gyors, és most rontja
   el a legfontosabb visszahívó elemet.
3. **F. pont: a színek és a fate-adat átvezetése** (3–4. alpont együtt, mert
   ugyanaz az adatfolyam-hiány áll mögöttük) + a hexagon-kapcsoló (2.) és a
   szellemvonal-szín (1., triviális).
4. **B. pont: Profil → Útvonalak fül** — a fül-szerkezet bevezetése nagyobb
   falat, érdemes külön nekifutni.
5. **C. pont: a bemenet bővítése** (km, kézi tempó, irány/szűrők) — az irány
   és a szűrők a küldetés-generáló magját érintik, a másik kettő felületi.
6. **D. pont: Home-kártya bezárhatósága** — kicsi, bármikor beszúrható.
7. **A régebbi bringás küldetés kérdés és az F3 közösség** — változatlanul
   nyitva, lásd lent.

**Amit NEM javaslok**: valódi, kanyaronkénti hangnavigáció. Az a Mapbox
Navigation SDK terepe, webes verzióban korlátos, és jóval nagyobb falat.

## NYITOTT, KISEBB

- A mentett útvonalak **eszközfüggők** (lokális tár) — ha Geri több eszközön
  használja, ez fel fog tűnni. Szándékos döntés, nem hiba.
- A mentett küldetés adatai **pillanatképek**: a `areaM2`/`victimName` a
  generáláskori birtokviszonyt tükrözi. A hiteles eredményt úgyis a szerver
  számolja újra — a mentett szám csak tájékoztat.
- A küldetés **szűrői** — lásd fent, a következő menet 2. pontja.
- A követő-lista nem lapoz (max 100, `hasMore` jelzéssel).
- A harang olvasatlan-száma a betöltött ablakból számol (20 elem).
- A `modifier_started` broadcast szűrés nélkül megy mindenkihez.
- Az időjárás csak akkor jelenik meg magától, ha van tárolt pozíció.
- gpLedger-takarítás — előkészítve, futtatásra vár
  (`server/src/scripts/cleanGpLedgerJunk.ts`).
- A követési KÉRÉSEK elbírálására még nincs felület.
- Területi hatókörű hold-modifier nem hat: a `zones` kollekció még nincs meg.
- **Aktív akciók a térképen** — korábbról áthúzódó (`src/game/modifiers.ts`
  → `areaCells`, csak `scope: 'area'`-nál van geometria).
- A push-küldés és a `NotificationPanel` élő ellenőrzése valódi eszközön.

## HOL TARTUNK AZ ÜTEMTERVBEN (docs/06)

| Fázis | Állapot |
|---|---|
| F0 — Alapozás | ✅ kész |
| F1 — Tracking és aktivitás | ✅ kész |
| F2 — A játék | ✅ kész, sőt túlteljesítve (modifierek, időablakos ranglista) |
| F2.5 — Küldetés-ajánló | ✅ kész: generálás + szellemvonal + mentett útvonalak + 3D nézet |
| F3 — Közösség | 🟡 félkész: követés/tiltás/like/komment/értesítés/jelentés/keresés megvan; **üzenetek, klubok, kihívások, felfedezés, útlevél** nincs |
| F4 — Mélység és bevétel | 🟡 csak a jelvények |
| F5 — Konnektorok | ❌ nincs elkezdve |
| F6 — Éles indulás | 🟡 élesben fut, a formális checklist nincs |

## ÉLESBEN FUT

- Napi forduló, admin felület, futásidejű konfiguráció (`appConfig/gameplay`
  v1, „Gazdagrét Rush" akció — ellenőrizd, nem járt-e le), jelvény-katalógus.
- A korábbi menetek: mentés-átirányítás, időjárás, flat ikonok, ranglista +
  pódium + napi/heti/havi bontás, keresés, F2.5 küldetés-ajánló, az öt sürgős
  javítás és a küldetés-hangolás (`526ddb5`).
- 8 ranglista-index READY, mindkét migráció lefutott
  (`backfill:blocked-by`, `backfill:area-windows`).

## TELEPÍTETLEN

`1042584`, `f5cff97`, `c005253`, `149bdef` — a km²-egységesítés, a
szellemvonal, a mentett útvonalak és a 2D/3D nézetváltó. **Csak frontend.**

## Fejlesztői előnézet

**ÍRÓ funkcióhoz a helyi emulátor**:

1. `export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"`
   (Git Bash-ben mindig kell, a Java PATH-ja nélküle nem látszik).
2. `firebase emulators:start --only auth,firestore --project demo-grundo`
   (Bash-ben `firebase`, `.cmd` nélkül).
3. `server/`-ből `npm run seed:emulator`, majd `npm run dev:emulator`.
4. Gyökérből `npm run dev:emulator` (vagy a `grundo-emulator` launch-konfig).
5. Böngészőben: `await __grundoDevSignIn()`.

⚠️ **Port-ütközés**: az `npm run test:emulator` saját `emulators:exec`-et
indít — előbb állítsd le a kézit
(`Get-NetTCPConnection -LocalPort 8081,9099 | Stop-Process`).

💡 **Mérési fogások, amik ebben a menetben beváltak:**

- **A Browser pane MOST MŰKÖDIK** kattintásra, olvasásra, JS-futtatásra — a
  `read_page` + `computer` + `javascript_tool` hármassal a mentett útvonalak
  teljes folyamata végigjátszható volt. ⚠️ A **screenshot** viszont továbbra
  sem: „the Browser pane is not displayed, so the page is not compositing
  frames".
- ⚠️ **Háttértabban nincs `requestAnimationFrame`** — emiatt a Mapbox `load`
  eseménye SOHA nem tüzel. Ha egy mérés arra vár, örökre lóg. A kamera-API
  (`easeTo`, `getPitch`, `getBearing`) viszont szinkron, tehát `load` nélkül
  is mérhető.
- **Mapbox-viselkedés mérése token nélkül**: `tmp/`-be tett eldobható HTML,
  inline stílussal (`{ version: 8, sources: {}, layers: [] }`) — nincs
  hálózati kérés, nincs token, a kamera mégis valódi. A `tmp/` a
  `.gitignore`-ban van, tehát nem szennyezi a repót.
- **Szerver-válasz kiváltása**: `window.fetch` felülírása a
  `/api/missions/generate`-re — így a küldetés-kártyák Mapbox-token és valódi
  Directions-hívás nélkül is végigjátszhatók.
- **Zajmodell tesztfájl helyett**: a tervezési döntéseket (bázishossz,
  súlypontozás) 400 szintetikus futáson mértem egy eldobható `tsx`
  szkripttel, és a SZÁMOKAT írtam a kódba. Ez fogta meg a súlypontozás
  180 fokos hibáját.

## Infrastruktúra: éles, csak olvasó Firestore-hozzáférés

Változatlan. `grundo-reader@grundo.iam.gserviceaccount.com`
(`roles/datastore.viewer`), Geri (`gergely.marthon@gmail.com`) személyesíti
meg. Nincs kulcsfájl. PowerShellben `gcloud.cmd`, nem `gcloud`.

Index-státusz: `gcloud.cmd firestore indexes composite list --project=grundo
--database=grundo-db` — a `CREATING`/`READY` oszlop megmondja, felépült-e már.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Opus, emelt mélységgel** az 1–3. ponthoz (E, A, F): az E. pont mért
anomália hibakeresése (a `continue_straight` gyanú megerősítése vagy cáfolata
mérésen múlik), az F. pont pedig adatmodell-döntés (a `ProcessResult` új
mezője, ami a szerveres aktivitás-feldolgozást is érintheti, ha egyszer a
végleges eredményen is meg kell jeleníteni a fate-et, nem csak az élő
előnézeten).

**Sonnet, normál mélységgel** a 4–6. ponthoz (B fül-szerkezet, C bemenet
bővítése, D Home-kártya) — mind meglévő minta kiterjesztése.

Ha a bringás küldetéssel folytatod (7. pont) az is **Opus**: mért anomália
hibakeresése, a válasz `reason` mezőjéből kell visszafejteni, hol törik a
lánc.

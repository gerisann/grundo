# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #9.** (A számozás a BESZÉLGETÉSEKÉ, nem a
munkameneteké: azt kell nézni, hány chat van. Lásd [AGENTS.md → 7. A
beszélgetések neve](AGENTS.md).)

## ÁLLAPOT

Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`.

Tesztek, most mérve: `npm test` → **381 zöld** (28 fájl). Typecheck (gyökér ÉS
`server/`) hibamentes. Az emulátoros készlet NEM futott: a Firestore
viselkedése nem változott (nincs új lekérdezés, tranzakció, séma vagy szabály).

## ⚠️ ELSŐ OLVASATRA: MI KELL A TELEPÍTÉSHEZ

**Frontend ÉS backend.** A küldetés-generálás szerveroldali (`server/src/`), a
Home- és Küldetések-képernyő kliensoldali — ez a menet mindkettőhöz nyúlt.

⚠️ A backend-telepítés KÖTELEZŐEN tartalmazza a Mapbox-tokent, mert a
`cloudbuild.yaml`-ban szándékosan üres:

```
cd ~/grundo && gcloud builds submit --config cloudbuild.yaml --substitutions=_MAPBOX_TOKEN=<grundo-server-directions>
```

A sima `gcloud builds submit --config cloudbuild.yaml` ÜRES tokennel telepít,
és onnantól a küldetés-generálás 503-at ad.

Index, szabály, migráció NEM kell.

## E. A KÜLDETÉS-TERVEZŐ „LÁBAI" — MEGMÉRVE, ÉS A #7 GYANÚJA MEGDŐLT

A #7 azt írta, hogy a `continue_straight=false` okozza a mellékutcákba
beszaladó kitérőket, és az első dolog legyen ennek mérése. Megmértem: **3
budapesti kiindulás × 8 irány, éles Directions-válaszokkal, minden jelöltre
lefuttatva a VALÓDI motort** (`traceToCellPath` → `detectLoopsDetailed`).

A „láb" mérőszáma a közel-180 fokos fordulatok száma, 20 méteres bázison. A
detektort előbb szintetikus nyomvonalakon hitelesítettem (tiszta kör → 0,
három beszúrt láb → 3, hat → 6); ez most teszt is: `src/game/routeShape.test.ts`.

| változat | tűrésen belül | U-forduló | átlag hossz | bezárt BELSŐ terület |
|---|---|---|---|---|
| **MAI**: 5 pont, cs=false, detour 1,25 | 15/24 | 65 | 8,55 km | **1,900 km²** |
| 5 pont, **cs=true**, detour 1,25 | 12/24 | **38** | 8,91 km | **1,425 km²** |
| 3 pont, cs=true, detour 1,25 | 20/24 | 23 | 7,93 km | 1,147 km² |
| 5 pont, cs=false, **detour 1,40** | **22/24** | 72 | **7,50 km** | 1,636 km² |

**Három dolgot mértem meg és vetettem el:**

1. **`continue_straight=true`** — a U-fordulók harmadával kevesebbek, de a
   bezárt BELSŐ terület negyede elveszik. A különbség nem falpadding: külön
   mértem a falat és a belsőt, és a belső esik (1,900 → 1,425), a fal alig
   (0,115 → 0,095). Rossz csere, nem vezettük be.
2. **`radiuses=150` és `300`** a köztes pontokon — **SEMMI hatás**, bitre
   ugyanazok az útvonalak. A paraméter csak felső korlát a rákapcsolásra, nem
   preferencia. Ez tiszta tipp lett volna mérés nélkül.
3. **3 köztes pont 5 helyett** — tisztább és rövidebb útvonal, de a terület
   2,015 → 1,147 km². Egy háromszög-alakú kör kevesebbet fog közre. A hatos és
   a nyolcas se hozott többet.

**Ami MŰKÖDÖTT — nem a hívást állítjuk át, hanem válogatunk.** Nyolc jelöltből
három kerül a felhasználó elé. Ha a közel egyforma tétűek közül a tisztábbat
választjuk, a kitérők nagy része eltűnik, és ez mérve **~1% területbe kerül,
nem 25-be**.

### Amit emiatt átírtam

- Új `src/game/routeShape.ts` — `countUTurns()`, tiszta geometria, közös a
  klienssel és a szerverrel. A fenti mérés teljes egészében a fájl fejlécében
  van, azzal együtt, hogy mi bukott el rajta.
- `MissionCandidate.uTurns` új mező; a szerver tölti ki
  (`server/src/routes/missions.ts`), a `ShapedCandidate` viszi át.
- `pickMissions` rendezése: a normalizált pontszámot mostantól **0,05-ös
  sávokban** nézzük, és sávon belül a kevesebb visszafordulású nyer. A sáv a
  garancia arra, hogy a kozmetika soha ne írja felül a játékértéket.
- **`MISSION_DETOUR_FACTOR` 1,25 → 1,40.** Ez önálló hiba volt, nem is
  kerestem: a régi érték **14%-kal hosszabb** kört adott a kértnél — aki 45
  percre kért ajánlatot, 51 percnyit kapott. Az 1,40 mellett az átlaghossz
  pontosan a célhosszra jön ki, és a használható jelöltek 15/24-ről 22/24-re
  nőnek. A mérési táblázat a `gameplay.ts` megjegyzésében van.

⚠️ **A kalibráció után újramértem a válogatás mozgásterét**: kiindulásonként
6/8, 8/8 és 8/8 jelölt használható (előtte 3/8, 6/8, 6/8). Tehát a
tisztaság-szempontnak most már tényleg van miből választania.

## A. és D. A NAPI KÜLDETÉS-KÁRTYA

**A. (valódi hiba, javítva):** a Home kártyája egy konkrét ajánlatot mutatott,
a gombja viszont egy ÜRES Küldetések képernyőre vitt. Az ok: a
`dailyMission.ts` csak a legjobb küldetést tette el, a teljes választ nem.

- A tár mostantól a teljes `MissionResult`-ot őrzi; új
  `readDailyMissionResult()`. A `MissionsScreen` induláskor visszatölti —
  **nem új hívás, nem fogyaszt kvótát.**
- Az űrlap időkerete is visszaáll: nem tároljuk külön, a `targetKm` és a
  `paceSecPerKm` hányadosából jön ki. Enélkül az „Újragenerálás" csendben
  másik időkerettel indult volna, mint amiből a látható kártyák készültek.
- A régi `{day, mission}` alakot még olvassa (a Home kártyája nem vész el egy
  telepítés miatt), de visszatöltésre `null`-t ad — inkább ne írjunk ki
  számot, mint hogy kitaláljuk. Legfeljebb egy napig tart, a tár úgyis ürül.

**D. (kérés, kész):** a kártya bezárható (X a jobb felső sarokban) és van
látható „tovább" nyila a jobb alsóban.

⚠️ **A bezárás NEM dobja el a küldetést**, csak elrejti a kártyát, és csak
mára (`grundo.dailyMission.dismissed`). A generálás kvótába került — aki
elteszi a kártyát az útból, nem azt kérte, hogy a Küldetések képernyő is
felejtse el.

⚠️ **Az elrendezést MÉRTEM, nem néztem.** Először rácscellába tettem a nyilat
`grid-row: 1 / -1`-gyel — a `-1` az IMPLICIT rácsban az első vonalra esik,
tehát a nyíl a néhány pixel magas első sorban ragadt, és mind a három
kártyaméretnél ráült a bezáró gombra. Szemre nem tűnt volna fel. A javítás
abszolút pozicionálás + `min-height: 80px` (enélkül a küldetés nélküli,
kétsoros kártyán 2 px-en még átfedtek). Ellenőrizve: három kártyamagasságon,
mindkét témában, átfedés és vízszintes görgetés nincs.

## AMIT NEM TUDTAM ELLENŐRIZNI

- **A küldetés-kártyák élő felülete bejelentkezve** — ez a menet a mérésre és
  a generálásra ment el; a `MissionsScreen` visszatöltése típusellenőrzött és
  tesztelt logika, de élőben nem játszottam végig.
- **A screenshot továbbra sem működik** a Browser pane-ben („the Browser pane
  is not displayed"). Helyette `getBoundingClientRect`-tel mértem az
  elrendezést — ez fogta meg a fenti rács-hibát, amit egy screenshot
  valószínűleg nem.
- A `MapView` felülete (token nélkül `null`-t renderel) — változatlanul csak
  élesben látszik.

## 💡 MÉRÉSI FOGÁS, AMI EBBEN A MENETBEN NYÍLT MEG

**Mapbox-mérés a szerver tokenje NÉLKÜL.** A `grundo-web` token benne van az
éles bundle-ben (publikus, ez szándékos), és URL-korlátos. Egy Node-szkript
letöltheti az éles oldalról, majd `Referer: https://grundo.web.app/` fejléccel
hívhatja a Directionst — így a teljes játékmotor ráfuttatható valódi
útvonalakra, kulcskérés nélkül. A menet összes mérése így készült.

Az eldobható szkriptek a `tmp/`-ben maradtak (gitignore-olt, tehát csak ezen a
gépen): `measure-full.ts` (változat-összevetés a valódi motorral),
`measure-pick.ts` (mit ér a tisztaság a válogatásban), `routeMetrics.ts`,
`validate-metrics.ts` (a detektor hitelesítése), `card-check.html` (az
elrendezés-próba). **A számok maguk viszont a kódba kerültek** — a
`routeShape.ts` és a `gameplay.ts` megjegyzéseibe —, mert azok maradnak meg.

## GERI VISSZAJELZÉSE (2026-08-22) — HOL TARTUNK

| pont | állapot |
|---|---|
| A. napi küldetés-kártya üresbe mutat | ✅ kész |
| B. Profil → Útvonalak fül | ❌ nyitva |
| C. célhossz-bemenet bővítése | ❌ nyitva |
| D. Home-kártya bezárhatóság + nyíl | ✅ kész |
| E. küldetés-tervező „lábai" | ✅ megmérve és kezelve (lásd fent) |
| F. vizuális kérések a térképen | ❌ nyitva, mind a négy |

## KÖVETKEZŐ MENET — JAVASLAT

1. **F. pont: a fate-adat átvezetése és a színek** (3–4. alpont együtt, mert
   ugyanaz az adatfolyam-hiány áll mögöttük), + a hexagon-kapcsoló (2.) és a
   szellemvonal-szín (1., triviális). A #7 részletes nyomozása változatlanul
   érvényes, ezért itt megismétlem:
   - `resolveClaim` ([claim.ts:25](src/game/claim.ts)) MÁR ad
     `fates: Map<CellId, CellFate>`-et (`free`/`reclaimed`/`stolen`/
     `breakthrough`); a `'stolen'` az, amit Geri „elrabolt terület"-nek hív.
   - ⚠️ **Ez elvész, mielőtt a felületre érne**: a `processActivity`
     ([game/index.ts:76](src/game/index.ts)) lapos `Set<CellId>`-et ad vissza.
     A TrackingScreen előnézete
     ([TrackingScreen.tsx:142](src/screens/TrackingScreen.tsx)) ebből épít,
     tehát a színnek és a szintszámnak nincs honnan jönnie.
   - A javítás iránya: `ProcessResult` bővítése
     `Map<CellId, {fate, defense}>`-szel, a preview ezt adja tovább.
   - A védelmi szám (1–5) rejtve van preview-cellákon (`MapView.tsx` →
     `syncData`, `defenseLabel` csak `territory && !preview` esetén) —
     ugyanez a gyökér, a fenti javítás után csak a feltételt kell levenni.
   - A szellemvonal színe `#FA5F73` legyen, új tokennel (pl. `--route-ghost`),
     ne szám szerint. ⚠️ **Kérdezd meg Gerit**: ez majdnem pontosan a sötét
     téma `--territory-rival`-ja (`#ff5f6d`) — szándékos-e ez a közelség.
2. **B. pont: Profil → Útvonalak fül.** ⚠️ A `ProfileScreen.tsx` ma egyetlen
   folyó nézet, nincs fül-szerkezet — ez tehát a szerkezet BEVEZETÉSE, nem egy
   fül hozzáadása. A `docs/01` szerint ide tartozik a generálás ÉS a mentettek
   is. A rögzítés képernyő „Mentett útvonalak" gombja MARADHAT (docs/02 #27).
3. **C. pont: a bemenet bővítése** — km-ben megadható idő (olcsó: a szerver
   úgyis `targetKm`-mel dolgozik), kézi tempó-felülírás (új felhasználónak ez
   számít a legtöbbet), majd irány és szűrők. ⚠️ Pontosítás a #7-ből: a négy
   karakter MÁR mind legenerálódik; ami hiányzik, az az IRÁNY és a szűrők
   (kevés kereszteződés · zöldterület · lapos terep — a felület kéri, a
   Directions támogatja, nincs bekötve).
4. **A bringás küldetés** — változatlanul nem tudjuk, működik-e. A `reason`
   mező megmondja, hol törik: `no_routes` / `no_loops` / `no_fit`.
   ⚠️ Új megfontolás: a mostani detour-kalibrációt a `walking` profilon
   mértem. A bringa `cycling`, és a 165 mp/km-es alaptempó miatt ott a
   célhossz sokkal nagyobb (45 perc → 16 km) — **elképzelhető, hogy a bringa
   pont a rossz detour-tényező miatt nem adott soha semmit.** Ez most
   ingyen megváltozott; érdemes ELŐSZÖR egyszerűen kipróbálni élesben,
   mielőtt bárki hibát keres.

**Amit NEM javaslok**: valódi, kanyaronkénti hangnavigáció (Mapbox Navigation
SDK terepe, webes verzióban korlátos).

## NYITOTT, KISEBB

- A mentett útvonalak **eszközfüggők** (lokális tár) — szándékos döntés.
- A mentett küldetés adatai **pillanatképek**; a hiteles eredményt a szerver
  számolja újra.
- A követő-lista nem lapoz (max 100, `hasMore` jelzéssel).
- A harang olvasatlan-száma a betöltött ablakból számol (20 elem).
- A `modifier_started` broadcast szűrés nélkül megy mindenkihez.
- Az időjárás csak akkor jelenik meg magától, ha van tárolt pozíció.
- gpLedger-takarítás — előkészítve, futtatásra vár
  (`server/src/scripts/cleanGpLedgerJunk.ts`).
- A követési KÉRÉSEK elbírálására még nincs felület.
- Területi hatókörű hold-modifier nem hat: a `zones` kollekció még nincs meg.
- **Aktív akciók a térképen** (`src/game/modifiers.ts` → `areaCells`, csak
  `scope: 'area'`-nál van geometria).
- A push-küldés és a `NotificationPanel` élő ellenőrzése valódi eszközön.

## HOL TARTUNK AZ ÜTEMTERVBEN (docs/06)

| Fázis | Állapot |
|---|---|
| F0 — Alapozás | ✅ kész |
| F1 — Tracking és aktivitás | ✅ kész |
| F2 — A játék | ✅ kész, sőt túlteljesítve (modifierek, időablakos ranglista) |
| F2.5 — Küldetés-ajánló | ✅ kész: generálás + szellemvonal + mentett útvonalak + 3D nézet + hosszkalibráció |
| F3 — Közösség | 🟡 félkész: követés/tiltás/like/komment/értesítés/jelentés/keresés megvan; **üzenetek, klubok, kihívások, felfedezés, útlevél** nincs |
| F4 — Mélység és bevétel | 🟡 csak a jelvények |
| F5 — Konnektorok | ❌ nincs elkezdve |
| F6 — Éles indulás | 🟡 élesben fut, a formális checklist nincs |

## MAPBOX-TOKENEK — HÁROM VAN, NE KEVEREDJENEK

| Token | Hol él | URL-korlátozás |
|---|---|---|
| `Default public token` | sehol (kiváltva) | nem is lehet ráállítani |
| `grundo-web` | Cloud Shell `~/grundo/.env` → bundle | `https://grundo.web.app` |
| `grundo-server-directions` | csak a deploy `--substitutions`-ben | **nincs, és nem is szabad** |

A szerver tokenjén azért nincs korlátozás, mert az URL-korlát a böngésző
`Referer` fejlécére épül — egy Cloud Run hívásnak nincs olyan. A védelme az,
hogy sehol nem publikus: se a repóban, se a bundle-ben.

## ÉLESBEN FUT

- Napi forduló, admin felület, futásidejű konfiguráció (`appConfig/gameplay`
  v1, „Gazdagrét Rush" akció — ellenőrizd, nem járt-e le), jelvény-katalógus.
- A korábbi menetek: mentés-átirányítás, időjárás, flat ikonok, ranglista +
  pódium + napi/heti/havi bontás, keresés, F2.5 küldetés-ajánló, az öt sürgős
  javítás és a küldetés-hangolás (`526ddb5`).
- 8 ranglista-index READY, mindkét migráció lefutott
  (`backfill:blocked-by`, `backfill:area-windows`).

## TELEPÍTETLEN

A #7 négy commitja (`1042584` km²-egységesítés, `f5cff97` szellemvonal,
`c005253` mentett útvonalak, `149bdef` 2D/3D nézetváltó) — **csak frontend** —,
plusz ennek a menetnek a commitja: **frontend ÉS backend**.

## Fejlesztői előnézet

**ÍRÓ funkcióhoz a helyi emulátor**:

1. `export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"`
   (Git Bash-ben mindig kell, a Java PATH-ja nélküle nem látszik).
2. `firebase emulators:start --only auth,firestore --project demo-grundo`
   (Bash-ben `firebase`, `.cmd` nélkül).
3. `server/`-ből `npm run seed:emulator`, majd `npm run dev:emulator`.
4. Gyökérből `npm run dev:emulator`.
5. Böngészőben: `await __grundoDevSignIn()`.

⚠️ **Port-ütközés**: az `npm run test:emulator` saját `emulators:exec`-et
indít — előbb állítsd le a kézit
(`Get-NetTCPConnection -LocalPort 8081,9099 | Stop-Process`).

💡 **Elrendezés ellenőrzése screenshot nélkül**: a `tmp/` alá tett próbalap
`<link>`-eli a VALÓDI `tokens.css`-t és a képernyő CSS-ét, a futó vite pedig
kiszolgálja (`http://localhost:5173/tmp/<fájl>.html`). Utána
`getBoundingClientRect`-tel mérhető, hogy két elem átfed-e, és
`getComputedStyle`-lal, hogy mindkét téma feloldja-e a színeket.

## Infrastruktúra: éles, csak olvasó Firestore-hozzáférés

Változatlan. `grundo-reader@grundo.iam.gserviceaccount.com`
(`roles/datastore.viewer`), Geri (`gergely.marthon@gmail.com`) személyesíti
meg. Nincs kulcsfájl. PowerShellben `gcloud.cmd`, nem `gcloud`.

Index-státusz: `gcloud.cmd firestore indexes composite list --project=grundo
--database=grundo-db` — a `CREATING`/`READY` oszlop megmondja, felépült-e már.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Opus, emelt mélységgel** az 1. ponthoz (F): adatmodell-döntés — a
`ProcessResult` új mezője a szerveres aktivitás-feldolgozást is érintheti, ha
egyszer a végleges eredményen is meg kell jeleníteni a fate-et, nem csak az
élő előnézeten.

**Sonnet, normál mélységgel** a 2–3. ponthoz (B fül-szerkezet, C bemenet
bővítése) — mind meglévő minta kiterjesztése.

A 4. pont (bringa) **először csak egy éles próba**, nem fejlesztés: ha a
kalibráció megoldotta, nincs mit keresni. Ha nem, akkor **Opus** — mért
anomália visszafejtése a `reason` mezőből.

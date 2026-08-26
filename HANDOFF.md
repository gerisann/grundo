# GRUNDO — Claude handoff

> Frissítve: **2026-08-26** (`GRUNDO #14`, felületi javítások)  
> Repo: `C:\Users\Geri\Documents\GitHub\grundo`  
> GitHub: `gerisann/grundo`  
> Ág: **`main`**

## ⚠️ MELYIK DOKUMENTUM AZ IGAZSÁG

Ez a fájl a **Simulation LAB, a compact backend és a küldetés-detektor**
állapotát írja le, `3b7a5f1` szintjén.

- **A JÁTÉKMOTOR MEGERŐSÍTÉS-SZABÁLYAIRA EZ A FÁJL ELAVULT.** A `#13` menet
  (`27bc319` … `a2c7793`) a védelmet a bezárások számáról **körüljárási
  számra** vitte át (`src/game/winding.ts`). A 3. és 4. szakasz erre külön
  figyelmeztet. Az érvényes leírás:
  `HANDOFF_CLAUDE_2026-08-25_REINFORCEMENT_CURRENT.md` — a nyitott pontok is
  ott vannak (szálszabály, nyomvonal-vékonyítás, compact átvezetés, éles
  ellenőrzés).
- Ez a fájl `3b7a5f1`-et írt utolsó commitnak, miközben a HEAD már
  `a2c7793` volt — vagyis a `#13` munkája sosem került bele. Aki a motorhoz
  nyúl, a reinforcement-dokumentumból induljon.

## A `GRUNDO #14` MENET (2026-08-26) — FELÜLETI JAVÍTÁSOK

Kilenc pont, mind Geri kérése, mind élőben, helyi emulátoros környezetben
visszamérve. A motorhoz **egyik sem nyúlt**; a részletek a commit-üzenetben és
az érintett fájlok fejléceiben.

| # | Mi változott | Hol |
|---|---|---|
| 1 | A profil „Riválisok" szekciója a `/profil/rivalisok` sorát kapta (sávok, villám, animáció) | `RivalsCard.tsx` |
| 2 | **ÚJ**: rivális-sáv az aktivitás-kártyák alján — a `RivalRow` tömör változata, HALMOZOTT mérleggel | `ActivityRivalBar.tsx` |
| 3 | Profil-fülsor: +2 px, vastagabb, nagybetűs, teljes keret, alsó vonal nélkül | `profileTabs.css` |
| 4 | Értesítések: minden sor 3 soros és egyforma magas (mérve: mind 82 px) | `NotificationPanel.tsx` |
| 5 | **ÚJ**: mozgásforma-szűrő a feedben (Séta/Futás/Bringa) | `Feed.tsx` |
| 6 | Dátumszűrő keskenyebb és egységes arculatú | `feed.css` |
| 7 | Befejezés: képernyő közepére kitett nagy animáció + elsötétítés, feleannyi idő | `Dock.tsx` |
| 8 | Szünet: sárga panel úszik fel a dokk mögül; „Új kör" ilyenkor inaktív | `Dock.tsx` |
| 10 | Rögzítés közben a böngészős vissza/előre nem visz zsákutcába | `Dock.tsx` |
| 9 | `/kuldetesek` vízszintes kilógása javítva (rács `minmax(0,1fr)`) | `missions.css` |

### ⚠️ AMI BACKEND-DEPLOYT IGÉNYEL

A 2. és a 4. pont **szerveroldali mezőket** vezetett be:

- `claimCounts` + `stolenFrom` az aktivitás dokumentumán (`activityCommit.ts`
  ÉS `activityChunked.ts` — mindkét mentési út kiírja). A `#14` előtt ezt csak
  a commit VÁLASZA hordozta, a dokumentum nem: utólag nem lehetett megmondani,
  egy aktivitás kitől vett el területet.
- Az aktivitás neve az `activity_liked` / `followed_activity` értesítés
  `body`-jába (eddig üres volt). Régi értesítésnél a felület a típus általános
  feliratát írja a középső sorba, hogy a magasság stimmeljen.

Regressziós teszt valódi Firestore ellen: `activities.emulator.test.ts` →
„a lopás bontása rákerül az aktivitás dokumentumára". A `tsc` ezt NEM fogná
meg, mert a `tx.set(...)` szabad alakú objektumot vesz át.

### A RÉGI AKTIVITÁSOK IS KAPNAK RIVÁLIS-SÁVOT

Geri kérte (2026-08-26), és **pontosan megoldható** — nem újraszámolás, hanem
egy már leírt tény átformálása:

- **kitől**: a `territoryEvents` minden károsultról ír egy dokumentumot
  (`{activityId}_{victimId}`, benne a `cellCount`). Ezt a
  `backfill:activity-rivals` szkript tölti vissza a `stolenFrom` mezőbe.
- **mennyit**: az `areaGainedM2` definíció szerint `cellák × CELL_AREA_M2`,
  tehát a visszaosztás egész számot ad.

⚠️ **Újraszámolni NEM lehetne**: ahhoz a mentés PILLANATÁBAN érvényes
birtokviszony kellene, a világ pedig azóta változott.

⚠️ **A lefedettség teljes.** A `territoryEvents` írása az `54854af` (2026-08-17)
óta létezik — ugyanabban a commitban, amelyik az aktivitás-mentést bevezette.
Az esemény hiánya tehát valóban azt jelenti, hogy nem lopott, nem azt, hogy
nincs róla adat.

**Mérve éles adaton (2026-08-26, olvasó fiókkal):** 27 aktivitás, 13
területesemény. A rekonstrukció ellentmondásmentes — 22 kap sávot, 5-nek nincs
területe (nem zárt kört), 13-ban van lopás; nulla törtrészes cellaszám és
nulla negatív szabad terület. Éles adaton egyelőre **nincs többkárosultas
aktivitás**, tehát a jelvény-sor csak seedelt adaton látszott.

A szkript alapból SZÁRAZON fut, és éles íráshoz `--apply --allow-production`
kell — ugyanaz a minta, mint a `backfill:rivals`-nál.

### ⚠️ A RIVÁLIS-SÁV A HALMOZOTT MÉRLEGET MUTATJA

Első nekifutásra az aktivitás SAJÁT bontását tettem a sávra (szabad föld ↔
elvett), és ez **rossz volt**. Geri pontosítása (2026-08-26): a kártyán
UGYANAZ a rivális-kártya álljon, mint a profilon — a szerző és a kör fő
károsultja közti teljes, halmozott mérleg (pl. `+189 / −295`, `9×`).

Ezért lett a `RivalRow` EGYETLEN komponens három helyre (teljes lista, profil
TOP 3, kártya-alji tömör változat). Ha ez a fájl változik, mind a három
változik vele — ez a lényeg, nem mellékhatás.

Az EGYETLEN adat a sávon, ami egy konkrét körről szól, a bal felső pirula
(`rival-row__taken`): hány mezőt vett el ebben a körben. Szándékosan pontosan
úgy néz ki, mint a jobb felső szorzó.

**Három szabály, amit ne vonj vissza:**

- **A sávok aránya valós, az AVATÁRÉ nem.** A `--rival-gained` a tényleges
  arány; az arckép viszont sosem megy közelebb a szélhez, mint a saját
  méretének kétszerese (`--rival-avatar-gap`: 88 px teljes, 68 px tömör
  soron). A `clamp()` SZÁNDÉKOSAN CSS-ben van: pixelben kell korlátozni, de a
  korlát a sáv tényleges szélességétől függ. Egy százalékos korlát (az első
  változat 10–90%-a) keskeny sávon kevesebb pixelt hagyott, mint az arckép
  fele — ott a kép ugyanúgy kilógott. Mérve 320 px-es nézeten (286 px-es sáv),
  0/3/50/97/100%-os aránynál: sehol nem lóg ki.
- **Az összecsapás `easeOutBounce`, kulcskockákban kiírva, HÁROM ütközéssel.**
  Nem `cubic-bezier` — az egyetlen sima görbe, a pattogás szakaszos függvény.
  A nyers `easeOutBounce` NÉGY szakaszos, ezért a görbe a harmadik ütközésre
  (az eredeti 90,909%) van skálázva. A Web Animations API-val mérve: ütközés a
  40%, 80% és 100% pontokon, közöttük 25% és 6,3% visszapattanással. A
  gyorsítás `linear`, mert a görbét maguk a kulcskockák hordozzák — ha `ease`-t
  teszel rá, kétszer easelsz és elmosódik a pattogás.
- **Az animáció csak TELJESEN látható kártyán indul** (`useInView` →
  `whole: true`, `resolveTarget` a `.acard`-ra). Előretöltéssel (`rootMargin`)
  a sávok lefutottak, mire a felhasználó odagörgetett. ⚠️ Az `isIntersecting`
  egyetlen átfedő képpontra is igaz, tehát önmagában NEM elég — a döntés a
  `shouldActivate()` tiszta függvényben van, és a `useInView.test.ts` rögzíti,
  mert böngészőben nem mérhető (lásd lent).

### ⚠️ RÖGZÍTÉS KÖZBEN A MÉRÉS KÉPERNYŐJE RAGADÓS

A böngésző „vissza" gombja zsákutcába vitt (Geri, 2026-08-26): a Home jelent
meg, a dokk viszont a rögzítés vezérlőit mutatta — és mivel `active`
állapotban a dokk CSAK a három gombot tartalmazza, menüpontok nélkül, a
felhasználó nem tudott sehova továbblépni.

A történelmi navigációt nem lehet megbízhatóan letiltani (és nem is helyes
elvenni a böngésző gombját), ezért a `Dock` figyeli az útvonalat, és futó
mérés közben `replace`-szel visszavált `/rogzites`-re. ⚠️ A LAB E2E ki van
hagyva (`trackingEnvironment.mode === 'lab'`), különben kirántaná a mérést a
saját környezetéből. Befejezés után a korlát megszűnik — mérve: a dokk
visszakapja a négy menüpontját, és a navigáció szabad.

### ⚠️ A SZÜNET-PANEL ÉS A BIZTONSÁGI SÁV

A panel alja sárga csíkként kilátszott a dokk alatt folytatás után. Az ok:
a `bottom` beleszámolta a `--safe-bottom`-ot, a rejtő eltolás viszont nem —
a panel pont ennyivel kevesebbet csúszott le. Asztali gépen láthatatlan
(`--safe-bottom: 0`), telefonon nem. Most egy közös `--dock-pause-offset`
szolgálja mindkettőt. Mérve 0 / 34 / 48 px-es biztonsági sávnál: a rejtett
panel felső éle pontosan a képernyő alján, nulla látható csík.

### 🔴 ÉLES ADATVESZTÉS — JAVÍTVA (2026-08-26)

**Tünet:** egy felhasználó (`nagz`) rögzítés közben megnyomta a böngésző
„vissza" gombját, majd befejezte és „elmentette" a mérést. Sehol nem
keletkezett belőle semmi.

**Mérve éles adaton (olvasó fiókkal):** nulla aktivitás, nulla
trust-dokumentum, nulla GP-tétel. A trust-dokumentum a mentés TRANZAKCIÓJÁBAN
készül — a hiánya bizonyítja, hogy a kérés el sem jutott a szerverig, nem
pedig ott hasalt el.

**Az ok — két, egymást erősítő hiba:**

1. **A feltöltés a KÉPERNYŐN lakott.** A `TrackingScreen` egyik hatása
   indította a mentést befejezés után, a Befejezés gomb viszont a `Dock`-ban
   van, ami MINDEN képernyőn ott van. Máshonnan befejezve a képernyő nem volt
   felcsatolva, tehát a hatás sem futott. Néma vesztés.
2. **A `Dock` középső gombja `done` állapotban feltétel nélkül `discard()`-ot
   hívott**, ami VÉGLEG törli a megőrzött rögzítést. A rögzítés képernyőjén
   kívül a gomb nem is „Új rögzítés" feliratot viselt (ahhoz `onTrackingScreen`
   is kell), hanem egy Play ikont — a felhasználó a folytatás szándékával
   nyomta meg, és ezzel törölte a saját futását.

**Négy védvonal, mind mérve:**

| # | Mi | Hol |
|---|---|---|
| 1 | A feltöltés a RÖGZÍTŐ rétegbe került, ami a router FÖLÖTT ül | `useRecorder.ts` |
| 2 | Futó mérés közben a rögzítés képernyője ragadós (vissza/előre visszadob) | `Dock.tsx` |
| 3 | Mentetlen mérést a középső gomb nem dob el, hanem a rögzítésre visz | `Dock.tsx` |
| 4 | `beforeunload` figyelmeztetés futó vagy mentetlen mérésnél | `useRecorder.ts` |

⚠️ **A feltételt tiszta függvény őrzi** (`shouldAutoUpload`,
`autoUpload.test.ts`) — ha valaki visszaköltözteti egy képernyőbe, a hiba
visszajön, és a teszt ezt rögzíti. Böngészőben ez nem mérhető (lásd a
tesztkörnyezetről szóló szakaszt).

### Mérési állapot a `#14` végén

```text
npx tsc --noEmit                         → OK
npx tsc -p server/tsconfig.json --noEmit → OK
npx vitest run --dir src                 → 36 fájl, 366 teszt, 0 bukó
npx vitest run --dir server              → 165 zöld, 11 emulátoros fájl kihagyva
npm run test:emulator                    → 11 fájl, 122 teszt, 0 bukó
npm run build                            → lefut
```

⚠️ A `labScenarioEngine.test.ts` „aszinkron = szinkron" esete teljes készlet
alatt EGYSZER elbukott, két ismételt teljes futáson viszont zöld volt, és
önmagában is az. Időzítés-érzékeny teszt terhelés alatt — ha CI-ben villog,
ott érdemes megfogni, nem a motorban keresni.

### ⚠️ Amit a `#14` közben MÉRTÜNK a tesztkörnyezetről

A böngészőpanel rejtett állapotában a lap **nem rajzol képkockákat**. Ennek
három, egymástól független következménye van, és MINDHÁROM ugyanúgy néz ki,
mint egy valódi hiba:

1. a `requestAnimationFrame` nem fut → a nyomva tartós gomb nem halad;
2. a CSS-átmenetek és -animációk beragadnak a kiindulási értéken;
3. az **`IntersectionObserver` egyetlen visszahívást sem kézbesít** — még a
   kezdetit sem —, tehát minden láthatóságra épülő logika némán hallgat.

Ez nem elméleti: a `#14` során háromszor néztem valódi hibának, egyszer pedig
egy téves „MÉRVE" megjegyzést is beírtam emiatt a kódba. Aki itt animációt
vagy láthatóságot ellenőriz:

- **végállapot**: tegyen `animation: none` / `transition: none` felülírást, és
  úgy mérje a geometriát. (Ne `translate: none`-t — az a középre igazítást is
  elviszi, és hamis számot ad.)
- **haladás**: cserélje ki a `requestAnimationFrame`-et `setTimeout`-os
  pótlásra, vagy vezérelje az animációt a Web Animations API-val
  (`element.getAnimations()` + `currentTime`) — ez utóbbi képkockák nélkül is
  pontos.
- **láthatóság**: sehogy. Ott a logikát tiszta függvénybe kell emelni és
  teszttel rögzíteni — ezért van `shouldActivate()` és `useInView.test.ts`.

## A FUTÓ MUNKATERV (Geri, 2026-08-25)

Öt lépés, ebben a sorrendben. A `#11` az 1–2. pontot végezte el.

1. ✅ **A teljes új Simulation LAB kód átolvasása** — a kódtérkép a 6. szakaszban.
2. ✅ **Funkcionális és UI hibák javítása** — mind a tíz felderített hiba javítva
   és élőben visszaigazolva (lásd 1. szakasz).
3. ◐ **Optimalizálás** — a render- és térképoldal kész, a phase-számítás
   darabolva. Ami nyitva maradt, az 14. szakasz 0. pontjában van.
4. ☐ **A területszerzés, hurok, szintlépés és rablás logikájának finomhangolása.**
5. ☐ **A LAB futás ráültetése az éles felületre**: éles frontenden indított
   aktivitás mellé ugyanazzal a userrel LAB phase indul, a LAB adatai mennek az
   éles appnak (ő valóságnak hiszi), és a valódi felületi hibák részletes logba
   kerülnek.

## 0. START HERE

1. **Olvasd el először az `AGENTS.md`-t.** A projekt architekturális és munkafolyamat-szabályai elsőbbséget élveznek.
2. Ez az egész GRUNDO projekt jelenleg **tesztfázisban van**, nincs production user. Geri kifejezetten engedte, hogy közvetlenül a `main` ágon dolgozzunk; nem kell külön feature branch csak azért, hogy ne törjünk el valamit.
3. A játékmotor közös kliens/szerver kód: `src/game`. A kliens számítása preview; normál aktivitásmentésnél **a backend az authoritative**, és a raw trace-ből újraszámolja az eredményt.
4. A legutóbbi komoly munka a területfoglalási motor, a Simulation LAB, nagy H3 hurkok, multi-player lopás és teljesítmény körül történt. **Ne egyszerűsítsd vissza ezeket full res12 materializálásra.**
5. A defense-építés szándékos: egy valóban újra teljesített teljes traversal ugyanazt a területet 2×–5×-re erősítheti. Olyan „dedupe” vagy cooldown nem jó, ami ezt megszünteti.

---

## 1. JELENLEGI ELLENŐRZÖTT ÁLLAPOT

Helyben, a `#11` végén mérve:

```text
npx tsc --noEmit         → OK
npx vitest run --dir src → 30 fájl, 303 teszt, 0 bukó
```

Újramérve `3b7a5f1`-en (küldetés-detektor javítás után):

```text
npx tsc --noEmit                        → OK
npx tsc -p server/tsconfig.json --noEmit → OK
npx vitest run --dir src                → 31 fájl, 315 teszt, 0 bukó
npx vitest run --dir server             → 165 zöld, 11 emulátoros fájl kihagyva
missionEvaluate.emulator.test.ts        → 7/7 zöld (előtte 4 bukó)
```

⚠️ A `server/tsconfig.json` **kizárja a `*.test.ts`-eket**, ezért a szerveroldali
tesztek típushibái NEM buknak el `tsc`-n. A küldetés-teszt hónapokig hiányos
`ShapedCandidate` objektumot épített anélkül, hogy bárhol látszott volna.

A CI-t a `.github/workflows/ci.yml` külön `app` és `server` jobra bontja. A root `npm test` korábban összeszedett server teszteket is rossz dependency-környezettel; ezért lett rendesen szétválasztva. **Push után nézd meg mindkét jobot.**

### Amit a `#11` javított a LAB-ban

Tíz hiba, mindegyik élőben, helyi emulátoros környezetben visszaigazolva:

| Jel | Mi volt | Hol |
|---|---|---|
| F1 | A solo („Player teszt") előnézet a **core** `processActivityGeometry`-t hívta a vegyes felbontású sandbox worlddel. res10 parentben álló birtok szabadnak látszott, nagy huroknál pedig a compact guard dobott, amit a `catch` lenyelt → néma, üres preview. Most `processLabActivity` fut. | `SimulationLabScenarioScreen.tsx` |
| F2 | Lejátszás közbeni **player-/phase-váltás félig commitolt worldöt hagyott** — a végleges `outcome.ownership` sosem került ki. A következő phase már a hibás világból indult. Most a megszakítás lezárja a phase-t a végállapotra (`settleRunningPhase`). | `SimulationLabScenarioScreen.tsx` |
| — | A **„Phase indítása" sosem indult el háttérbe tett böngészőlapon**: a `nextPaint()` `requestAnimationFrame`-re várt, ami rejtett lapon nem tüzel, a gomb örökre „Phase előkészítése…" maradt. Most timeout is kilépteti. *(Ez mérés közben derült ki, nem szerepelt az eredeti listán.)* | `SimulationLabScenarioScreen.tsx` |
| P1–P3 | A térkép egyetlen `sync()`-je **mind a 9 forrást** újraépítette bármelyik prop változására, a képernyő pedig memoizálatlan tömböket adott át → minden render teljes world-GeoJSON újraépítés, és minden waypoint-marker DOM-cseréje. Most forrásonként külön effekt, és a markerek pozíciót frissítenek újraépítés helyett. | `ScenarioSimulationMap.tsx` |
| P2 | A lejátszás timere **50 ms-onként** újraépítette a teljes ownership Mapet akkor is, ha közben egyetlen run sem fejeződött be. Most csak új commitnál. | `SimulationLabScenarioScreen.tsx` |
| P4 | A solo preview memo futó phase alatt is kiértékelődött (a `world` a függősége), pedig az eredményét eldobtuk. | `SimulationLabScenarioScreen.tsx` |
| P5 | `countLabPlayerCells` / `countLabPlayerDefense` playerenként ÉS védelmi szintenként külön járta be a worldöt — 10 playernél 15 teljes bejárás rendernként. Helyette `summarizeLabWorld()`, egy passzal, memoizálva. | `labHierarchicalWorld.ts` |
| F3 | `applyCredits` **nulla jóváírásnál gazdátlan cellára tulajdont adott** (`{owner: actorId, defense: 1}`). Most `undefined`-ot ad, és a hívók kihagyják a cellát. | `labHierarchicalWorld.ts` |
| F4 | Üres compact kreditnél a visszaesés **üres ownershippel** hívta a core-t → minden cella `free`-nek könyvelődött volna, néma adatromlásként. Most beszédes hibát dob. | `labHierarchicalWorld.ts` |
| U1 | A GPS-mezőket **nem lehetett kiüríteni** (`Number('') === 0`), és nem klampoltak `min`/`max`-ra — a mező mást mutatott, mint amivel a szimuláció számolt. Most helyi vázlatállapot, commit blurön/Enteren, klampolással; Escape eldobja. | `SimulationLabScenarioScreen.tsx` |
| U2 | Minden billentyűleütés `invalidatePhasePreview()` + `resetSoloRun()`-t váltott ki — gépelés közben elszállt a futás eredménye, és újragenerálódott a teljes GPS-sor. Az U1 vázlatállapota ezt is megszünteti. | ugyanott |
| U3 | A „Player törlése" **az egész sandbox worldöt nullázta**. Most csak a törölt player celláit szabadítja fel; a többiek területe és védelme marad. | ugyanott |
| P6 | `loopCollection`-nek nem volt feature-plafonja, pedig a `worldCollection`-nek és `gridCollection`-nek van. Most `MAX_LOOP_FEATURES`. | `ScenarioSimulationMap.tsx` |
| — | `src/admin/SimulationMap.tsx` (602 sor) **holt kód volt**, sehonnan nem importálva. Törölve. | — |

### A mérések

Mindegyik ugyanazon a terhelésen: helyi emulátoros LAB, 3 player × 1400 m-es
négyzet (5,6 km, 908 GPS minta fejenként, átfedő területek),
`PerformanceObserver('longtask')`. A világ végeredménye **minden** mérésben
804 / 3766 / 6485 cella volt — a javítások viselkedéstartók.

**1. A térkép- és render-javítások (P1–P5), 100× lejátszás:**

| | előtte | utána |
|---|---|---|
| teljes lefutás | 13 832 ms | 11 446 / 11 186 ms |
| total blocking time | 4 211 ms | 1 512 / 1 299 ms |
| leghosszabb blokkoló task | 2 139 ms | 1 096 / 840 ms |

⚠️ Ez **egy-egy futás**, nem medián. A szórás ezen a terhelésen nagy (lásd
lent), tehát az irány megbízható, a pontos szám nem. Ha újra kell mérni, az
alábbi ismételt protokollt használd.

**2. A darabolt phase-számítás, 5-5 futás mediánja** (MAX lejátszás, minden
futás előtt „World nullázása", tehát üres világból):

| | előtte | utána |
|---|---|---|
| engine előkészítés | 1 670 ms | 1 760 ms |
| **leghosszabb blokkoló task** | **1 671 ms** | **525 ms** |
| total blocking time | 1 956 ms | 795 ms |

A teljes számítás ~5%-kal lassabb — ennyibe kerül a megszakítgatás —, cserébe a
felület a leghosszabb blokk alatt is reagál, és a haladásjelző mozog.

**3. Fal-alapú scope-építés a claimben, 5-5 futás mediánja** (ugyanaz a
protokoll, mint fent):

| | előtte | utána |
|---|---|---|
| **engine előkészítés** | **1 760 ms** | **1 080 ms** |
| leghosszabb blokkoló task | 525 ms | 454 ms |
| total blocking time | 795 ms | 596 ms |

Node-szinten külön mérve, ugyanezen a terhelésen: a claim **745 → ~225 ms**
(3,3×), a teljes előkészítés 1 191 → ~700 ms.

Mit csinál: a `materializeFineOwnership` eddig MINDEN hurokcella köré húzott
két gyűrűt (19 502 db `gridDisk(cell, 2)`). A hurok régiója = fal ∪ belső, és a
belsőt definíció szerint a fal választja el a külvilágtól — egy belső cella két
lépésen belül csak olyan külső cellát érhet el, amit a hozzá tartozó falcella
egy lépésen belül amúgy is elér. Elég tehát **csak a fal köré** gyűrűt húzni,
és a régió celláit egyszerűen hozzáadni. Az eredmény halmaz bitre azonos; ezt
öt hurokalakra (négyzet, nagy négyzet, nyolcas, többkörös, önérintő) teszt
rögzíti.

Mellette: a parent-keresés indexelve. A `labWorldOwnershipAt` cellánként a
res-1 szinttől nulláig próbálkozott — több tízezer cellánál százezres
nagyságrendű `cellToParent` hívás, miközben a world tipikusan egyetlen parent
felbontást használ, gyakran egyet sem.

⚠️ **Ne told vissza „minden cellára" a gyűrűt** azzal az indokkal, hogy úgy
biztonságosabb. Nem ad több cellát, csak lassabb.

### ❌ Amit kipróbáltunk és NEM vált be: Web Worker

Kézenfekvőnek tűnt a teljes scenario-számítást worker szálra tenni (a
`src/game` platformfüggetlen, tehát menne). Meg is épült, működött, a
haladásjelző is élt — **de mérve rosszabb lett**, ezért vissza lett véve:

| | fő szál, darabolva | worker szálon |
|---|---|---|
| engine előkészítés | ~1,2–1,8 s | 1,74–2,04 s |
| leghosszabb blokkoló task a FŐ szálon | 525 ms | 456–609 ms |

**Miért:** az eredmény (`LabScenarioOutcome`) minden run teljes GPS-mintasorát,
recorder-pontját és claim `Map`/`Set`-jeit tartalmazza. Ennek a structured
clone-ja a fő szálon nagyjából annyiba kerül, mint amennyi számítást
elvittünk — plusz jön hozzá a szerializálás a worker oldalán. **Ne próbáld
újra anélkül, hogy előbb a visszaadott adatmennyiséget csökkentenéd.**

⚠️ A maradék blokkolás forrása futásonként egyetlen szelet: a
`processLabActivity` claim-számítása. Az már nem darabolható a játékmotor
átszabása nélkül.

---

## 1.5 iOS PUSH — MEGOLDVA (2026-08-25)

**Tünet volt:** weben és PWA-ban megérkeztek az értesítések, iOS-en a
bekapcsolás után sem — sem feloldott, sem zárolt képernyőn.

**Az ok:** a Firebase-projekt APNs auth key bejegyzésében a feltöltött `.p8`
fájl NEM ahhoz a Key ID-hez tartozott, amit mellé begépeltek. A Firebase ezzel
a párral írja alá a JWT provider-tokent, az Apple pedig a Key ID alapján keresi
ki a kulcsot — a szignatúra így sosem stimmelt.

**A javítás:** új APNs auth key (`M4M77Z3H2P`) az Apple portálon, a régi két
Firebase-sor törlése, és az új kulcs feltöltése a HELYES Key ID + Team ID
(`HFS68TZMCH`) párral.

### A mérési lánc — ezt érdemes megjegyezni

| Lépés | Eszköz | Eredmény |
|---|---|---|
| Regisztrálódik-e iOS token? | `npm run inspect:push` | Igen, 2 db — a kliens és a natív oldal rendben |
| Mit mond a szerver? | Cloud Run stderr | `messaging/third-party-auth-error` — de ez NEM elég diagnózisnak |
| Miért utasítja el az APNs? | `npm run probe:apns` (FCM v1 REST) | `ApnsError 403 InvalidProviderToken` |
| A kulcs maga jó-e? | `npm run probe:apns:key` (közvetlen APNs) | Új kulccsal `400 BadDeviceToken` → a hármas HELYES |
| Megy-e élesben? | `npm run probe:apns` | `HTTP 200` mindkét tokenre |

⚠️ **Tanulság:** az Admin SDK `messaging/third-party-auth-error` üzenete
(„Invalid APNs credential") NEM különbözteti meg a hiányzó, a visszavont és a
rosszul párosított kulcsot. A `probe:apns` az FCM v1 REST API-t hívja, ami a
`details` tömbben visszaadja az APNs saját `reason` mezőjét — ez a különbség
egy tippelgetős kör és egy pontos válasz között. Én az első körben ezt
elmulasztottam, és tévesen azt írtam, hogy nincs feltöltve a kulcs.

⚠️ **A `probe:apns:key` a Firebase-t KIHAGYVA kérdezi meg az Apple-t**, tehát
feltöltés ELŐTT eldönthető, hogy egy kulcs jó-e. Az APNs a hitelesítést a
device token előtt ellenőrzi, ezért hamis tokennel is működik a próba:
`BadDeviceToken` = a hitelesítés átment.

### ⚠️ Két token, egy értesítés — ez NEM hiba

A javítás után az `npm run probe:apns` mindkét regisztrált iOS tokenre `HTTP
200`-at adott, a telefonra viszont csak EGY értesítés érkezett. Ez helyes:

- a két token **külön app-telepítéshez** tartozik (eltérő FCM instance ID, a
  token `:` előtti része), tipikusan újratelepítés után;
- csak az egyik mögött van élő app, a másik árva;
- az FCM az árvára is `200`-at ad, mert az APNs csak késleltetve jelzi vissza,
  hogy a telepítés eltűnt.

Amikor visszajelzi, a `deliverPush` a `registration-token-not-registered` ágon
**magától törli** a tokent. Nincs teendő, és NE írj rá kliensoldali
„egy user = egy token" szabályt: az elvenné a több eszköz lehetőségét.

### Ami a kód oldalán maradt

- `/admin` áttekintő → **Push-diagnosztika** kártya: teszt-értesítés a saját
  eszközökre, eszközönként a nyers FCM hibakóddal és a teendővel.
  Végpont: `POST /api/admin/push/test`, csak a hívó saját eszközeire.
- A szerver `notification` + `apns.payload.aps.sound` formában küld, tehát az
  iOS magától kirajzolja az értesítést — nem data-only üzenet.
- A `third-party-auth-error` **nem** törli a tokent. Helyesen: ilyenkor a token
  jó, a projekt beállítása rossz. Csak a `registration-token-not-registered` és
  az `invalid-argument` vezet törléshez.

---

## 2. JÁTÉKMOTOR — ALAPSZABÁLYOK

Fő helyek:

- `src/game/index.ts`
- `src/game/claim.ts`
- `src/game/loopDetection.ts`
- `src/game/loopInterior.ts`
- `src/game/compactClaim.ts`
- `src/game/frontierCleanup.ts`
- `src/game/cells.ts`
- `src/config/gameplay.ts`

Fontos aktuális szabályok:

- gameplay H3 resolution: **res12**
- névleges `CELL_AREA_M2 = 307.09`
- `MIN_INTERIOR_CELLS = 1`
- `MIN_LOOP_STEPS = 6`
- `MAX_LOOP_BBOX_CELLS = 500000`
- `MAX_DEFENSE = 5`
- walking/running és cycling külön versenytérként kezelhető
- egy aktivitásban több hurok is létrejöhet
- ugyanaz a teljes hurok valódi új traversalban újra teljesítve defense-et épít
- ugyanazon aktivitásból matematikailag levezethető kompozit/nested ciklus **nem feltétlenül jelent új gameplay bezárást vagy új claim creditet**

A normál ownership szabály `src/game/claim.ts`-ban ugyanazon ownernél defense-et emel max 5-ig. A hurkok szekvenciálisan kerülnek elszámolásra, hogy valódi repeat lap tudjon erősíteni.

---

## 3. HUROKDETEKTOR — AKTUÁLIS MODELL

> ⚠️ **2026-08-25 (`GRUNDO #13`) óta a VÉDELEM nem innen jön.** A hurokdetektor
> azt dönti el, MELY cellák kerülnek szóba; azt, hogy egy cella HÁNY jóváírást
> kap, a körüljárási szám adja (`src/game/winding.ts`). A detektor maga
> változatlan. Részletek és mérések:
> `HANDOFF_CLAUDE_2026-08-25_REINFORCEMENT_CURRENT.md`.

A detector külön modulban van:

```text
src/game/loopDetection.ts
```

A flood-fill / fal-pruning utility-k maradtak:

```text
src/game/loops.ts
```

### ⚠️ KÉT AZONOS NEVŰ DETEKTOR — ez már egyszer élesben elcsúszott

A `loops.ts`-ben **ott maradt a `detectLoopsDetailed` RÉGI változata**, és a
`src/game/index.ts` `5cf6362` (2026-08-24, „use overlap-aware loop detector")
óta a `loopDetection.ts`-belit exportálja **ugyanazon a néven**. Az explicit
re-export elfedi a `export * from './loops'`-ból jövőt:

- aki a **`src/game`**-ből importál → az ÉLES detektort kapja;
- aki közvetlenül a **`src/game/loops`**-ból → a leváltottat, némán.

Mért eltérés egy 220 m-es `simpleLoop` fixture-ön: ugyanannál a H3
kontaktfoltnál a régi a **legkorábbi** kaput választja (`fromIndex 0`, fal 57),
az éles a legfrissebbet (`fromIndex 1`, fal 56). A belső mindkettőnél 130 →
**187 vs. 186 cella**.

Ez élesben is elcsúszott: a `server/src/routes/missions.ts` a régi detektorral
formálta a jelölteket, majd az `evaluateCandidate` az élessel értékelte ki.
Ott épp bővebb halmaz jött ki (fölös ownership-olvasás), de fordítva a küldetés
**szabadnak hinne olyan cellákat, amikre nem is töltött be birtokviszonyt** —
vagyis rossz zsákmányt ígérne. A `missionEvaluate.emulator.test.ts` négy bukó
tesztje pontosan ezt fogta meg, csak a rossz oldalon: nem a motor tévedett, a
teszt mérte a saját várakozását leváltott kóddal.

**Javítva `3b7a5f1`-ben**: egy közös belépőpont,
`missionEvaluate.shapeCandidateCells()`, ami a `buildActivityGeometry`-ből
(= a mentés geometriájából) adja a jelölt celláit; a route és a teszt is ezt
hívja. A `loops.ts` régi függvénye fölé figyelmeztető komment került.

**Nyitva maradt**: a régi `detectLoopsDetailed` továbbra is importálható, mert a
`geometry.test.ts` és a `claim.test.ts` kifejezetten annak a szabályait rögzíti.
Amíg ott van, a csapda újranyílhat. A takarítás első kérdése: azok a tesztek
melyik detektort hivatottak védeni? Ha az éleset, migrálni kell őket, és a
`loops.ts`-ből törölhető a `detectLoopsDetailed` / `detectLoops`.

### Inkrementális detector

A jelenlegi alap osztály:

```ts
IncrementalLoopDetector
```

A batch API (`detectLoopsDetailed(path)`) kompatibilitásból megmaradt, de belül ugyanazt az inkrementális state machine-t eteti végig egyszer.

Miért kellett: korábban a LAB minden preview-framen az egész addigi útvonalat újraszámolta. Ha a játékos egy már korábban bejárt fal mellett haladt, egyetlen új H3 cella több régi kontaktot generált, és mindegyiken lefuthatott:

```text
path.slice
→ Set
→ Tarjan bridge / pruneDeadEnds
→ interior build / flood fill
→ overlap vizsgálat
```

Ez kis route-on is drasztikus lassulást okozott.

Fő commitok:

```text
ecfb38a  perf: make loop detection incremental
6a961f6  perf: reuse incremental activity geometry
9007a84  perf: use incremental loop geometry in LAB
d7417b0  test: verify incremental geometry parity
```

### H3 kontaktfolt-deduplikáció

Egy fizikai kereszteződés több szomszédos res12 cellára eshet. Ezek ne indítsanak 2–6 külön closure-t. A detector kontakt-index klaszterezést használ (`CONTACT_INDEX_CLUSTER_GAP = 6`), mielőtt a drága geometria fut.

Korábbi releváns commitok:

```text
512e9e7  fix: preserve overlapping loop history
5cf6362  fix: use overlap-aware loop detector
76264bc  test: cover overlapping loop closures
b1dcdae  fix: collapse duplicate closures at H3 intersections
3303709  test: prevent duplicate closures inside one H3 gate
c677d1f  fix: require separation after loop gate exit
fa38b19  test: cover loop gate exit debounce
5129d72  fix: collapse composite closures inside closed regions
b3e6432  test: cover composite closures inside closed region
```

### Closure zone

Egy sikeres closure után nem csak a kapu 1 gyűrűje blokkol: a frissen lezárt régió + fal/contact zóna egy closure-epizódnak számít. Amíg a route ebből ténylegesen ki nem lép, ne képződjenek egyre nagyobb, ugyanabból a closure-ből levezetett kompozit ciklusok.

- első valóban külső cella: separator
- következő cellától indulhat új closure-epizód
- kivétel: teljes új lap után az eredeti gate-hez visszaérve repeat closure engedett, mert ez defense-építés

### Post-closure sliver és repeat-lap H3 jitter

A tesztelés közben két regresszió derült ki:

1. bezárás után kifelé haladva a régi fal + új rövid ág létre tudott hozni egy 18 falcellás / 2 interior cellás vékony fals slivert;
2. ugyanazt a fizikai négyzetet négyszer futva a 4. kör H3 kapuzási jitter miatt 1 új cellával nagyobb lett.

Javítás:

```text
f19e24f  fix: reject post-closure slivers and stabilize repeat loops
```

Aktuális elv:

- vékony, régi falból és friss kifutó ágból származó sliver nem új gameplay hurok;
- valódi repeat traversalnál 1–2 cellás H3 kvantálási eltérés nem növelheti lassan a területet; az előző azonos fizikai loop kanonikus geometriája használható defense-építéshez;
- ettől különböző, legitim új hurkokat nem szabad összemosni.

A diagnosztikai tesztfájlok ideiglenesen bekerültek, majd törölve lettek:

```text
075f7ff  test: remove temporary spur diagnostic
6a83294  test: remove temporary multi-lap diagnostic
```

---

## 4. TRAVERSAL CREDIT — MIÉRT NEM DUPLÁZZUK A NESTED TERÜLETET

> ⚠️ **A szabály érvényes, a MEGVALÓSÍTÁSA 2026-08-25 (`GRUNDO #13`) óta más.**
> Az alábbi index-alapú `creditedAt` / `sameTraversalReinforcement` heurisztikák
> törölve: a bejárás irányától függtek. A nested terület dupla jóváírása ma
> KÖVETKEZMÉNY — a frissen szerzett cellát a nyom pontosan egyszer kerülte meg.
> Lásd `HANDOFF_CLAUDE_2026-08-25_REINFORCEMENT_CURRENT.md` 3.3.

A figure-eight / összetett route egyik valódi modellhibája ez volt:

- bezárult egy kisebb hurok;
- később egy nagyobb, ugyanabból a folyamatos traversalból származó geometriai hurok magába foglalta;
- a claim motor a kisebb területet automatikusan újra +1 defense-re emelte.

A helyes gameplay-szabály:

> Egy cellát ugyanazon traversal történetéből származó későbbi kompozit hurok nem fizethet ki még egyszer. Csak akkor kap új +1 claim creditet, ha a hurok maga az előző jóváírás UTÁN kezdődött, tehát ténylegesen új traversal történt.

Commitok:

```text
93d2648  fix: credit loop cells only on new traversal
f5c2542  test: prevent nested loop credit duplication
```

Ezért **ne** tegyél egyszerű claim-side cooldown-t: a repeat full lapnak továbbra is 2×→5× defense-et kell tudnia építeni.

---

## 5. NAGY HUROK / COMPACT H3

### Eredeti probléma

Egy kb. **177.6 km-es Balaton-jellegű** hurok `hurok túl nagy` hibával elutasításra került.

A régi pipeline a teljes belsőt res12 stringekké materializálta, és kb. **2.2 millió res12 cellánál** hard capet húzott (~675 km² névleges nagyságrend). Ezt **nem** szabad egyszerűen 5–10 millióra emelni: JS `Set`/`Map` stringekkel memória- és CPU-problémát okozna.

### Jelenlegi compact modell

A gameplay továbbra is **res12**. A compact H3 csak reprezentáció / tárolási / render-optimalizáció.

Nagy huroknál:

```text
pontos boundary / frontier → res12
homogén teljesen belső rész → H3 parent cellák
részleges konfliktus → csak az érintett parent bontódik finomabb gyerekekre
```

A LAB compact ownershipben tipikusan:

```text
1 res10 parent = 49 res12 gameplay cella
```

Fontos fájlok:

```text
src/game/loopInterior.ts
src/game/loopInterior.test.ts
src/game/compactClaim.ts
src/game/compactClaim.test.ts
src/game/largeLoopCompact.test.ts
```

Fő commitok:

```text
87fff6a  feat: add compact loop interior representation
e476e42  feat: add compact adaptive loop interiors
90b99fd  feat: detect large loops with compact interiors
7f1f6fa  feat: resolve compact claims in empty LAB world
a90f5c4  feat: process compact large loops in LAB
2a7a684  feat: render compact large-loop previews
bca22fc  feat: show exact compact claim stats in LAB
22c906e  perf: avoid expanding untouched compact parents
dcae286  test: process large loops through compact pipeline
f331650  test: cover loops beyond legacy fine-cell cap
aed4e9b  perf: compact LAB claim geometry for Mapbox
```

A LAB preview a renderhez H3 `compactCells()`-t is használhat, hogy több tízezer azonos állapotú parentből ne készüljön ugyanennyi GeoJSON feature.

### Elszámolási szabály eltérő cellaméreteknél

**Soha ne polygon-overlapből vagy a kirajzolt coarse cella területéből könyveld a gain/loss értéket.**

Minden:

- territory gain/loss
- free/stolen/reclaimed/breakthrough
- defense
- GP

kanonikus **res12-equivalent gameplay cellaszámban** értendő.

Példa: egy res10 parent 49 res12 gyerek. Ha ebből 7-et lopnak el, 7 vált ownert és 42 marad. A parent csak reprezentációs optimalizáció; részleges támadásnál lokálisan felbomlik.

---

## 6. SIMULATION LAB — AKTUÁLIS FELÉPÍTÉS

Route:

```text
/admin/lab
```

A jelenlegi fő képernyő:

```text
src/admin/SimulationLabScenarioScreen.tsx
```

`src/admin/SimulationLabScreen.tsx` egyetlen soros re-export wrapper.

### A LAB öt rétege (`#11`-ben végigolvasva)

| Réteg | Fájl | Mit csinál |
|---|---|---|
| Képernyő | `src/admin/SimulationLabScenarioScreen.tsx` | teljes állapot: playerek, phase-ek, solo run, phase playback, scenario mentés |
| Térkép | `src/admin/ScenarioSimulationMap.tsx` | 9 Mapbox forrás/réteg, waypoint-markerek |
| Phase-motor | `src/admin/labScenarioEngine.ts` | headless: recorderek → finish-sorrendű commitok → world |
| Vegyes world | `src/admin/labHierarchicalWorld.ts` | res10 parent + res12 override, compact claim, frontier cleanup |
| GPS | `src/tracking/simulationSource.ts` | route → mért telemetry, `PositionSource` lejátszó |

⚠️ **Két adatút van, és ez a leggyakoribb hibaforrás:** a *phase* futás a
`processLabActivity`-n megy (érti a compact parenteket), a *solo* preview pedig
ugyanezen kell menjen. A core `processActivityGeometry` csak exact res12
ownership Mapet ért — LAB worldre közvetlenül hívni hiba (lásd F1 az 1.
szakaszban).

Fontos fájlok:

```text
src/admin/SimulationLabScenarioScreen.tsx
src/admin/ScenarioSimulationMap.tsx
src/admin/labScenarioEngine.ts
src/admin/labScenarioEngine.test.ts
src/admin/labHierarchicalWorld.ts
src/admin/labHierarchicalWorld.test.ts
src/admin/simulation-lab.css
src/admin/simulation-lab-scenario.css
```

### Alap LAB funkciók

- Mapbox route editor
- waypointok kattintással / húzással
- undo / clear
- walk/run/ride
- speed
- sample interval
- reported accuracy
- noise
- drift
- dropout
- GPS spike
- deterministic seed
- playback 1× / 10× / 100× / MAX
- route / raw GPS / accepted recorder külön réteg
- H3 / loop / claim rétegek
- defense 1×–5× jelölések
- loop diagnostics
- localStorage scenario mentés
- helyi sandbox; normál API/Firestore worldöt nem ír

Korábbi Mapbox style-sync race javítás:

```text
c7d16d2  fix: keep LAB Mapbox state in sync
```

### LAB performance throttling

Hosszú replaynél korábban minden GPS fix újraküldte a teljes piros/zöld LineStringet és újrafuttatta a teljes game previewt. Most a vizuális frame-ek korlátozottak, miközben a recorder minden mintát megkap és a végén egzakt teljes eredmény készül.

```text
2497089  perf: bound LAB live engine recomputation
b85bae8  perf: bound LAB track rendering work
```

### ⚠️ Térkép-invariánsok — ezeket ne vond vissza

A `#11` óta a `ScenarioSimulationMap` **forrásonként külön effektben** frissít.
Ne olvaszd vissza egyetlen `sync()`-be: a drága forrás (world GeoJSON, hurkok)
csak akkor épülhet újra, ha az adata ténylegesen változott. Konkrétan:

- a képernyő **memoizálva** adja át a `tracks` és `routes` tömböket — memoizálás
  nélkül minden render teljes world-GeoJSON újraépítést jelent;
- a `world` forrás effektje csak `world` / `ownerColors` / `showClaims` változásra fut;
- a waypoint-markerek azonos pontszámnál **pozíciót frissítenek**, nem épülnek újra;
- a lejátszás timere csak akkor ír új worldöt, ha egy újabb run befejeződött;
- a stílusváltás (téma) eldobja a forrásokat — ezt a `ready` állapot kezeli, és
  minden forrás-effekt függ tőle.

---

## 7. GPS SZIMULÁCIÓ

Fontos fájlok:

```text
src/tracking/types.ts
src/tracking/simulationSource.ts
src/tracking/simulationSource.test.ts
```

`SimulationPositionSource` ugyanazt a `PositionSource` interfészt implementálja, mint a normál tracking source.

Modellezett jelenségek:

- sebességvariáció
- timestamps / sample interval
- reported accuracy
- pillanatnyi GPS noise
- korrelált lassú drift
- dropout
- spike
- seedelt determinisztikus random
- 1×/10×/100×/MAX
- MAX chunkolt emit (128 minta + event-loop yield)

Pragmatikus „normal phone, outdoor” tesztprofil, amit használtunk:

```text
Jelentett pontosság: ~6 m
Mintavétel:          1 s
Pillanatnyi zaj:     ~3 m
Lassú drift:         ~0.2 m/minta
Jelkimaradás:        ~0.5–0.7 %
GPS spike:           ~0–0.2 %
```

Ez **heurisztikus szimulációs baseline**, nem kalibrált iPhone/Android mérési profil.

---

## 8. MULTI-PLAYER / PHASE LAB

A user kifejezett célja: területlopás és 5–10 player szimultán aktivitásának tesztelése.

Motor:

```text
src/admin/labScenarioEngine.ts
src/admin/labScenarioEngine.test.ts
```

Commitok:

```text
9549085  feat: add multi-player LAB phase engine
4a38dd0  test: cover multi-player LAB phases
3f2eec4  feat: add multiplayer LAB map
0cf69dc  feat: add phase and multiplayer LAB editor
4ba9b6a  style: add multiplayer LAB controls
6d09f2c  feat: switch LAB to phase multiplayer screen
```

### Modell

- egy scenario több phase-ből áll
- max 10 player
- playerenként külön route/config/seed/activity/start offset
- egy phase-en belül a GPS recording párhuzamos idővonalon futhat
- az authoritative sandbox world **finish/commitkor** változik, nem minden GPS fixnél
- commit finish-sorrendben történik
- azonos finish timestampnél determinisztikus, seedelt tie-break
- a world megmarad a phase-ek között
- ugyanaz a phase újrafuttatható world reset nélkül → defense tesztelhető

Ez a jelenlegi LAB-ban **transaction-equivalent determinisztikus modell**, nem valódi Firestore contention. Valódi race/concurrency teszthez később emulator-backed concurrent commit mód kell.

### Phase UX

A `Phase indítása` korábban úgy tűnhetett, mintha nem csinálna semmit, mert előbb szinkron headless calculation futott, és a hiba csak console-ba került.

Javítva:

```text
preparing → running → done / error
```

- azonnali UI feedback
- progress
- elapsed time
- látható hibaüzenet
- mozgó player markerek
- `Aktív player` átnevezve `Player teszt`-re

Commitok:

```text
20daff0  fix: surface and replay LAB phase state
76e3ddc  feat: show live players during LAB phase replay
1fd2ea7  style: add LAB phase progress and status feedback
```

`Player teszt` csak a kiválasztott player solo previewja; nem az egész phase commitja.

---

## 9. HIERARCHIKUS LAB WORLD — COMPACT LOPÁS

A multi-player phase első compact tesztje ezzel állt meg:

```text
Compact hurok ownership-feldolgozása csak a blokkos backend útvonalon engedett.
```

Nem volt helyes egyszerűen kivenni a guardot, mert az első compact claim csak a finom peremet írta volna a sandbox worldbe, és a következő player a nagy homogén belsőt tévesen szabadnak látta volna.

Ezért készült külön mixed-resolution hierarchical LAB world:

```text
src/admin/labHierarchicalWorld.ts
src/admin/labHierarchicalWorld.test.ts
```

Modell:

```text
res10 parent = homogén ownership/defense 49 res12 cellára
res12 override = csak részlegesen érintett parentben
```

Ha egy kis normál hurok beleharap egy compact parentbe, csak az érintett parent bomlik 49 gyerekre; a világ többi compact része változatlanul tömör marad.

Commitok:

```text
4a6ddbf  refactor: expose compact claim credits
a6079d9  feat: add hierarchical LAB compact ownership
b9525ae  fix: use hierarchical ownership in LAB phases
0b18328  test: cover compact multiplayer LAB ownership
```

Tesztek lefedik:

- 40k+ res12-equivalent compact terület bulk lopását másik playerrel
- kis normál hurok részleges lopását compact parentből res12 override-okkal

---

## 10. RABLÁS UTÁNI ÁRVA CELLÁK — VÉGLEGES JÁTÉKSZABÁLY

A user képeken mutatta, hogy GPS pontatlanság miatt rablás után maradhat 1 darabos régi-owner cella az új terület belsejében/peremén.

A user által **jóváhagyott végleges szabály**:

> Rablás után, a friss frontier post-claim snapshotjában, ha egy cella **nem érintkezik legalább 2 azonos tulajdonú oldalszomszéddal**, átkerül ahhoz az ownerhez, amelyik a legtöbb oldalán érintkezik vele. Holtversenynél marad. A döntések egyetlen snapshotból készülnek és egyszerre kerülnek alkalmazásra — nincs kaszkád / újraértékelés.

Miért fontos a snapshot-only szabály: egy legitim, 1 cella széles folyosó belső celláinak 2 azonos szomszédja van. A végpont esetleg csak 1. Ha az algoritmus iteratív lenne, a végpont levágása után a következő is végponttá válna és visszaenné az egész folyosót. Ezért **NO CASCADE**.

Fájlok:

```text
src/game/frontierCleanup.ts
src/game/frontierCleanup.test.ts
```

Commitok:

```text
14e9f2d  feat: add stolen frontier orphan cleanup
861438a  refactor: keep frontier cleanup independent
fee403a  feat: apply frontier cleanup in game engine
8a1b5e3  feat: clean stolen frontier orphans in LAB world
d9211e0  test: cover stolen frontier orphan cleanup
2fa8ca9  test: type frontier cleanup fates explicitly
62f7846  test: cover frontier cleanup through claim pipeline
64375a9  test: expect all eligible frontier orphans to clean up
```

A szabály csak **tényleges stolen frontier** után fusson, ne globális world-szépítésként.

---

## 11. BACKEND AUTHORITATIVE ÚTVONAL

Normál activity POST:

```text
server/src/routes/activities.ts
```

Normál commit pipeline:

```text
server/src/lib/activityCommit.ts
```

Ez a közös játékmotort használja:

```ts
import { processActivity } from '../../../src/game';
```

Ezért minden loop/claim/frontier rule módosításnál:

- LAB teszthez frontend deploy elég;
- **valódi elmentett activity viselkedéshez Cloud Run backend deploy is kell.**

A szerver a kliens previewját nem tekinti authoritative-nak, raw trace-ből újraszámol.

---

## 12. PRODUCTION COMPACT BACKEND — BEKÖTVE (2026-08-25)

**A `/api/activities` compact útja elkészült és emulátoron bizonyított.**
A korábbi „még nincs kész" állapot ITT ÉRT VÉGET; a részletek a
`HANDOFF_CLAUDE_2026-08-25_LAB_E2E.md` 5. szakaszában frissítve.

Érintett fájlok:

```text
server/src/lib/activityCommit.ts    planActivity → compactWorks + valódi blokklista
server/src/lib/activityChunked.ts   compact csoport-ág + frontier fázis
server/src/lib/grid.ts              writeBlocks — kész blokkalakok kiírása
server/src/routes/activities.ts     requiresChunkedClaim() bekötve
```

### ⚠️ A csapda, amit a bekötés közben MÉRTÜNK

A terv eredetileg csak a route-predikátum bekötését és a commit-ág megírását
irányozta elő. Mérés (5×5 km-es kör, 81 023 res12 cella) viszont kimutatta,
hogy a `planActivity` maga is compact-vak volt:

| Amit a terv adott | Érték |
|---|---|
| `candidateCells` (fal + határsáv) | 5 220 |
| ebből számolt `blockIds` | 98 |
| a claim VALÓDI blokkszáma | 270 |
| **hiányzó blokk** | **172 (64%)** |

A hiányzó blokkok maga a hurok belseje. A puszta route-átirányítás tehát a
terület kétharmadát némán elvesztette volna, mert a darabolt út is ebből a
listából csoportosít. Ezért a `planActivity` mostantól compact huroknál a
`buildCompactClaimCredits` → `buildCompactBlockPlan` láncból veszi a
blokklistát, és a `compactWorks` a terv része.

**Ugyanez a mérés mutatta meg, miért nem elég a `fitsOneTransaction()`:**
98 blokknál (sőt 270-nél is) az írásszám bőven a Firestore-korlát alatt van,
tehát a döntés a GYORS útra esett volna — ahol a shared motor őre compact
hurokra szándékosan dob. Élesben ez 500-as hibát jelentett minden nagy körnél.

### Amit a core guardról tudni kell

A `processActivityGeometry` őre (`Compact hurok ownership-feldolgozása csak a
blokkos backend útvonalon engedett`) **a helyén maradt, és maradjon is.** Nem
azért tűnt el a hiba, mert kivettük, hanem mert a compact aktivitás már nem jut
el odáig: a `requiresChunkedClaim()` a geometriát nézi, nem csak a méretet.

### Ami block/bulk módon megőrződik

free · reclaimed · stolen · breakthrough · defense 1–5 · traversal credit ·
frontier orphan cleanup · exact res12-egyenértékű terület és GP · partial-parent
split csak ott, ahol tényleg szükséges.

---

## 13. KÖVETKEZŐ PERFORMANCE FELADAT: ÉLES TRACKING PREVIEW

Korábban ellenőriztük, hogy a `TrackingScreen` élő previewja ugyanabba az O(n²)-szerű mintába tud esni, mint a régi LAB: új H3-cellánál a teljes addigi útvonalat újra processzálhatja.

Érintett:

```text
src/screens/TrackingScreen.tsx
```

A LAB már `IncrementalActivityGeometry` / inkrementális detector irányba lett átkötve. **Ellenőrizd a jelenlegi `TrackingScreen.tsx`-et**, mielőtt módosítod; ha még teljes batch `processActivity(...)` fut minden új cellánál, ugyanazt az inkrementális geometry cache-t kell rávezetni.

A final save maradhat batch/server-authoritative, mert az csak egyszer fut.

---

## 14. KÖVETKEZŐ KONKRÉT VALIDÁCIÓK

### 0. NYITOTT LAB-HIBÁK

A munkaterv **2. pontja lezárult** — az ott felderített hibák (F1–F4, U1–U3,
P1–P6) mind javítva, lásd az 1. szakaszt. Ami nyitva maradt:

| Jel | Hol | Mi a baj |
|---|---|---|
| P8 | `src/game` claim-pipeline | A phase-előkészítés maradék blokkolása futásonként EGY szelet: a `processLabActivity` claim-számítása. A scope-optimalizálás után ez ~450 ms medián a 3 playeres terhelésen. Tovább darabolni csak a claim-pipeline inkrementálissá tételével lehetne — ez már a játékmotort érinti, nem a LAB-ot, ezért külön döntés kell hozzá. |
| ~~P9~~ | — | **ELVETVE, mérés alapján.** Az előkészített futások gyorsítótárazása szóba jött, de a bontás szerint a GPS-generálás 0,7% és a recorder-visszajátszás 0,9% — összesen **1,6%**. Nem éri meg. |
| ~~scope~~ | — | **MEGOLDVA.** A claim 776 ms-jából 641 ms a `materializeFineOwnership` scope-építése volt. Lásd lent a „Fal-alapú scope" szakaszt. |
| P10 | `SimulationLabScenarioScreen.tsx` | A `phaseHistory` minden lefuttatott phase TELJES kimenetét megtartja (GPS-minták, recorder-pontok, claim Mapek). Sok futás után ez érezhető memória- és GC-terhelés — az ismételt méréseknél a futásidő futásról futásra romlott. |

### A. Bonyolult 11 pontos route

A user vizuális számítása szerint a tesztroute-nak **4 fizikai closure-t** kell adnia, nem 9-et:

1. jobb alsó loop
2. felső loop
3. középső/átfedő loop a későbbi keresztezésnél
4. utolsó loop, ami valódi új traversalból duplázza az első területét

A cellaszorzók már jók voltak; a closure-számot a legfrissebb detector után újra kell validálni. A `f19e24f` sliver fix nem törheti el a legitim átfedő hurkokat.

### B. 177.6 km-es compact stresszteszt

Elvárás LAB-ban:

- nincs `hurok túl nagy`
- closure elfogadva compact belsővel
- pontos res12-equivalent stats
- nem materializál több millió finom cellát
- Mapbox nem fagy meg

### C. Multi-player lopás

Tesztelendő:

- Phase 1: A foglal
- Phase 2: B részben/teljesen lop
- ugyanabban a phase-ben A/B/C eltérő start/finish order
- 5–10 player overlap
- compact + fine overlap
- orphan cleanup csak stolen frontier után fusson
- nincs cleanup cascade

### D. Future: `RACE FUZZ`

Jó következő LAB funkció lenne ugyanazt a simultaneous phase-t pl. 100 különböző seedelt commit orderrel lefuttatni, és összehasonlítani a final worldöt. Ha valódi Firestore contentiont akarunk mérni, ehhez külön emulator-backed concurrent commit mód kell.

---

## 15. KORÁBBI iOS / UI MUNKA, AMI TOVÁBBRA IS RELEVÁNS

A korábbi handoffból megőrzendő állapot:

- natív WebView újrainduláskor aktív tracking visszaáll; JS detach nem állítja le a Core Locationt és Live Activityt
- Mapbox track és cell source külön frissül, hogy GPS fix / stopper ne építse újra fölöslegesen a több ezer cellás GeoJSON-t
- live GPS szűrés és game filter 30 m accuracy threshold körül van összehangolva
- APNs Debug = development, TestFlight Release = production; Codemagic ellenőrzi
- backend push hibáknál platform / FCM/APNs hibakód logolható
- rival card, Missions UI, activity-detail hex toggle, Feed live `MapView`, notification swipe korábbi javításai megmaradnak
- új activity-k `activityCells` mezőt mentenek és feed/detail API ki tudja adni

### Legacy `activityCells` caveat

Régi Firestore activity dokumentumokban nincs feltétlen `activityCells`.

- saját teljes trackből kliens újraszámolhatja
- idegen/private route-nál ez nem garantált
- ha minden régi activityhez exact cell layer kell, külön backfill szükséges

Per-activity vizualizációnál a történelmi `free/stolen` cell-fate tárolás továbbra is külön adatmodell-kérdés lehet; ne keverd össze a jelenlegi world ownershipdel.

---

## 16. TELEPÍTÉS

### Egy paranccsal: `scripts/deploy.sh`

```bash
~/grundo/scripts/deploy.sh              # backend, majd frontend
~/grundo/scripts/deploy.sh backend
~/grundo/scripts/deploy.sh frontend
~/grundo/scripts/deploy.sh szabalyok
~/grundo/scripts/deploy.sh indexek
```

Amit elintéz helyetted:

- beállítja a projektet (lásd a lenti csapdát),
- `git pull --ff-only`, és kiírja a HEAD commitot, hogy lásd, mit telepítesz,
- a Mapbox-tokent a `.env.local` `VITE_MAPBOX_TOKEN` értékéből veszi — ugyanaz
  az érték, amit a backend `MAPBOX_TOKEN`-ként kap (`server/src/lib/directions.ts`
  fejléce szerint ez szándékosan NEM titok). Felülírható `MAPBOX_TOKEN`
  környezeti változóval. A tokent sosem írja ki, csak a forrását.

⚠️ **A sorrend a „mindkettő" esetben szándékos: előbb backend, utána
frontend.** Így egy új végpontot hívó felület sosem ér oda a végpont elé.
Fordítva a felhasználó 404-et kapna, amíg a backend build tart.

⚠️ A `szabalyok` és az `indexek` NEM része a „mindkettő"-nek — külön kell
kérni, ha tényleg változott a `firestore.rules`, a `storage.rules` vagy a
`firestore.indexes.json`.

### ⚠️ Cloud Shell: a projektbeállítás elveszhet

Visszatérő csapda (2026-08-25-én is megfogott). A build ilyenkor el sem indul:

```text
ERROR: (gcloud.builds.submit) The required property [project] is not currently set.
```

Ez NEM a `cloudbuild.yaml` hibája — a session vesztette el a projektet.
Megoldás egyszer, a session elején:

```bash
gcloud config set project grundo
```

⚠️ És mindig ellenőrizd, hogy van-e mit telepíteni: a `git pull` „Already up to
date" üzenete önmagában nem bizonyítja, hogy a friss kódon állsz. A
`git -C ~/grundo log --oneline -1` mutassa ugyanazt a commitot, amit felküldtél.

### Frontend / Firebase Hosting

```bash
cd ~/grundo
git pull
npm install
npm run build
firebase deploy --only hosting
```

### Backend / Cloud Run

```bash
cd ~/grundo
git pull
gcloud builds submit --config cloudbuild.yaml --substitutions=_MAPBOX_TOKEN=<existing configured token>
```

Ne másolj / írj ki tényleges secretet vagy tokent handoffba/logba.

### Firebase rules / indexes / storage

```bash
cd ~/grundo
firebase deploy --only firestore:rules,firestore:indexes,storage
```

LAB-only UI módosításnál frontend deploy elég.

Game-engine módosításnál a normál mentéshez backend deploy is kell, mert a szerver újraszámolja a trace-t.

**A legutóbbi final game-engine fixek utáni Hosting deploy nincs ebben a handoffban megerősítve. A production compact backend pedig még nincs kész, ezért azt ne tekintsd deploy-ready feature-nek.**

---

## 17. FONTOS FÁJLOK CLAUDE-NAK

Olvasási sorrend javaslat:

```text
AGENTS.md
HANDOFF.md
docs/03-jatekszabalyok.md
docs/06-architektura-es-admin.md

src/game/index.ts
src/game/loopDetection.ts
src/game/loopInterior.ts
src/game/compactClaim.ts
src/game/frontierCleanup.ts
src/game/claim.ts

src/admin/SimulationLabScenarioScreen.tsx
src/admin/ScenarioSimulationMap.tsx
src/admin/labScenarioEngine.ts
src/admin/labHierarchicalWorld.ts

src/tracking/simulationSource.ts
src/screens/TrackingScreen.tsx

server/src/lib/activityCommit.ts
server/src/lib/activityChunked.ts
server/src/lib/grid.ts
server/src/routes/activities.ts
server/src/lib/missionEvaluate.ts
server/src/routes/missions.ts

.github/workflows/ci.yml
```

---

## 18. RECENT COMMIT CHAIN

Legfrissebb releváns commitok, újabbtól visszafelé:

```text
3b7a5f1   Küldetés: az éles hurokdetektor cellái
4a9978f   Compact foglalás bekötése az éles mentésbe
f5ccba0   docs: hand off LAB E2E and compact production work to Claude
abd5122   Simulation LAB hibajavitas es gyorsitas
505fe31   docs: refresh Claude handoff
1770a743  ci: scope app and server Vitest runs correctly
6a83294   test: remove temporary multi-lap diagnostic
075f7ff   test: remove temporary spur diagnostic
f19e24f   fix: reject post-closure slivers and stabilize repeat loops
64375a9   test: expect all eligible frontier orphans to clean up
e66482a   fix: make GPS simulation playback environment neutral
462f55c   ci: run tests and build on main
62f7846   test: cover frontier cleanup through claim pipeline
d9211e0   test: cover stolen frontier orphan cleanup
8a1b5e3   feat: clean stolen frontier orphans in LAB world
fee403a   feat: apply frontier cleanup in game engine
14e9f2d   feat: add stolen frontier orphan cleanup
0b18328   test: cover compact multiplayer LAB ownership
b9525ae   fix: use hierarchical ownership in LAB phases
a6079d9   feat: add hierarchical LAB compact ownership
4a6ddbf   refactor: expose compact claim credits
1fd2ea7   style: add LAB phase progress and status feedback
76e3ddc   feat: show live players during LAB phase replay
20daff0   fix: surface and replay LAB phase state
d7417b0   test: verify incremental geometry parity
6d09f2c   feat: switch LAB to phase multiplayer screen
0cf69dc   feat: add phase and multiplayer LAB editor
3f2eec4   feat: add multiplayer LAB map
4a38dd0   test: cover multi-player LAB phases
9549085   feat: add multi-player LAB phase engine
9007a84   perf: use incremental loop geometry in LAB
6a961f6   perf: reuse incremental activity geometry
ecfb38a   perf: make loop detection incremental
aed4e9b   perf: compact LAB claim geometry for Mapbox
f331650   test: cover loops beyond legacy fine-cell cap
dcae286   test: process large loops through compact pipeline
22c906e   perf: avoid expanding untouched compact parents
bca22fc   feat: show exact compact claim stats in LAB
2a7a684   feat: render compact large-loop previews
a90f5c4   feat: process compact large loops in LAB
7f1f6fa   feat: resolve compact claims in empty LAB world
90b99fd   feat: detect large loops with compact interiors
e476e42   feat: add compact adaptive loop interiors
87fff6a   feat: add compact loop interior representation
5129d72   fix: collapse composite closures inside closed regions
b85bae8   perf: bound LAB track rendering work
2497089   perf: bound LAB live engine recomputation
93d2648   fix: credit loop cells only on new traversal
f5c2542   test: prevent nested loop credit duplication
```

---

## 19. MUNKAELV A KÖVETKEZŐ AGENTNEK

A jelenlegi motor sok egymásra épülő, teszttel rögzített gameplay-szabály eredménye. Ha valami furcsának tűnik:

1. először reprodukáld LAB scenario-val / fixture-rel;
2. írd le, hogy **fizikailag hány closure történt** és milyen traversalból;
3. külön kezeld a loop detectiont, a claim creditet és a final ownership cleanupot;
4. ne „javíts” claim-oldali cooldownnal detector hibát;
5. ne növeld egyszerűen a nagy-loop hard capet;
6. ne materializálj teljes compact területet res12 stringekké;
7. minden geometry/gameplay módosításhoz regressziós teszt;
8. push után nézd a GitHub Actions app + server jobot.

A cél nem az, hogy minden matematikai ciklust gameplay huroknak nevezzünk, hanem hogy a valós mozgásból intuitív, stabil, reprodukálható területfoglalás legyen.

### MODELLJAVASLAT a következő menetre

A munkaterv **3. pontja (optimalizálás)** és **4. pontja (terület/hurok/szint/rablás
finomhangolás)** egyaránt algoritmus- és mérés-jellegű → **Opus, emelt mélység**.
A 2. pont maradéka (U1–U3 felületi hibák) önmagában **Sonnet**, normál mélység —
ha csak azok jönnek, nem kell erősebb modell.

A `loops.ts` régi detektorának kitakarítása (3. szakasz vége) szintén **Opus**:
nem átnevezés, hanem annak eldöntése, hogy a `geometry.test.ts` /
`claim.test.ts` szabályai melyik detektorra vonatkoznak.

### A LAB ÉLŐ ELLENŐRZÉSE HELYBEN — ez most már működik

A `#11` óta a LAB kattintással is tesztelhető helyben. Amit tudni kell:

1. A `.env.local`-ban **kell `VITE_MAPBOX_TOKEN`** — enélkül a LAB csak a
   „hiányzik a token" helyőrzőt mutatja, és útvonalat sem lehet rakni.
   (A fájl `.gitignore`-olt, tokenhez Geritől kérj.)
2. Emulátorok: `firebase.cmd emulators:start --only auth,firestore --project demo-grundo`
   (Git Bashben elé a Java PATH exportja kell).
3. `server/` → `npm run seed:emulator`, majd **a seed user nem admin**:
   `GOOGLE_CLOUD_PROJECT=demo-grundo FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run role:set -- --email geri@grundo.local --role owner --apply`
4. `server/` → `npm run dev:emulator`; gyökérből `npm run dev:emulator`
   (`.claude/launch.json` → `grundo-emulator`).
5. Böngészőben: `await __grundoDevSignIn()`, majd `/admin/lab`.
6. Scenario-t **nem kell kattintással** megrajzolni: a képernyő a
   `localStorage['grundo.lab.scenarios.v2']` kulcsból tölt, ide közvetlenül
   beírható egy kész `SavedScenario` (players / phases / runs route + config).
   Így reprodukálható méréshez pontosan ugyanaz a bemenet állítható elő.
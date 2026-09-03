# GRUNDO — reinforcement / loop detection · AKTUÁLIS ÁLLAPOT

> Frissítve: **2026-08-25, GRUNDO #13 vége**
> Repo: `gerisann/grundo` · Ág: **`main`**
> Előzmény: `HANDOFF_CLAUDE_2026-08-25_LAB_E2E.md` (compact backend, LAB E2E, production architektúra — **továbbra is érvényes**)
> Ez a fájl **teljesen felülírja** a korábbi, azonos nevű dokumentumot.

---

# 0. START HERE

1. `AGENTS.md` végig.
2. Ez a fájl.
3. A `#13` menet **megoldotta** a bejelentett fő hibát (irányfüggő védelem, túl korai megerősítés) és a Geri rajza szerinti „3 box" esetet is (2.1). A nyitott pontok a 6. fejezetben.

---

# 1. EGY MONDATBAN

A védelem mostantól **nem a bezárások számából** jön, hanem abból, hogy a nyomvonal hányszor **kerülte meg** az adott cellát (körüljárási szám, `src/game/winding.ts`). A hurokdetektor változatlanul azt dönti el, MELY cellák kerülnek szóba; a körüljárás azt, HÁNYSZOR.

---

# 2. MIÉRT EZ A MEGOLDÁS — A MÉRÉS

A hiba oka az volt, hogy a bezárások száma **nem a fizikai körök száma**. A H3-rácson egy kifelé táguló spirál minden sarokérintésénél levezethető egy újabb, nagyobb kompozit ciklus, és ez a bejárás irányától függ.

Három körös spirál, 35 m/kör, védelmi hisztogram:

| | oda | vissza |
|---|---|---|
| **régi motor** | `{1:191, 2:79, 3:224}` | `{1:496}` ← a védelem teljesen eltűnt |
| **körüljárással** | `{1:159, 2:120, 3:215}` | `{1:160, 2:121, 3:215}` |

Négy növekvő lap, 25 m/kör:

| | oda | vissza |
|---|---|---|
| **régi motor** | `{1:151,2:66,3:54,4:154}` | `{1:173,2:73,3:195}` ← nincs 4× |
| **körüljárással** | `{1:136,2:87,3:58,4:144}` | `{1:152,2:87,3:58,4:144}` |

Valódi irányfüggetlenség (azonos lapsorrend, ellenkező forgásirány) — ez a 7.6 szerinti teszt:

| kör/lap | CW | CCW |
|---|---|---|
| azonos lap 4× | `{4:154}` | `{4:154}` |
| 12 m | `{1:8, 4:226}` | `{1:9, 4:226}` |
| 18 m | `{1:32, 4:246}` | `{1:32, 4:246}` |
| 25 m | `{1:110,2:118,3:60,4:148}` | `{1:114,2:115,3:60,4:148}` |

**A védelmi szintek minden mért esetben azonosak.** A cellaszámok pár cellával eltérnek: a megfordított nyom H3-kvantálása más — ez a rács határa, nem a szabályé.

## 2.1 A „3 box" eset — Geri rajza és két LAB-videó

A rajz: bezárul egy négyzet (KÉK, 1×), alatta egy második (VILÁGOSKÉK, 1×), végül egy nagy külső kör, ami a KÉK-et újra bekeríti (2×) és mellé egy új területet is hoz (RÓZSASZÍN, 1×). **Három bezárás.**

A LAB-videók (2026-08-25 22:17) a JAVÍTÁS ELŐTTI kódot mutatják: **6 bezárás**, védelem `1×:127, 2×:129, 3×:119` — egy teljes négyzet 3×-en, pedig 2× a maximum.

A javítás után, mérve, mindkét bejárási irányban:

```
pont  400   1 closure  {1:328}        ← KÉK bezárul
pont  700   2 closure  {1:642}        ← VILÁGOSKÉK bezárul
pont 1300   3 closure  {1:951}        ← a nagy kör bezárul
pont 1400   3 closure  {1:628, 2:323} ← KÉK → 2×, RÓZSASZÍN → 1×
```

Két külön hiba volt benne, és külön javítás kellett rájuk:

**(a) Fölös kompozit bezárás.** A `#5→162, belső 503` hurok pontosan az első két hurok uniója volt, nulla új cellával. A detektor mostantól elutasítja azt a jelöltet, amelyik a LEGUTÓBBI BEZÁRÁS ELÉ nyúl vissza és közben egyetlen új cellát sem kerít be. Az ismételt teljes kört ez nem érinti: ott a kapu a legutóbbi bezárás UTÁNRÓL való, mert a lapok egymás után futnak.

**(b) Túl korai védelem.** A régi terület három oldalát újrafutva a szögösszeg ~1,75 teljes kör, ami KEREKÍTVE már 2. Emiatt ugrott a védelem 280 GPS-ponttal a nagy kör bezárása előtt. Mostantól lefelé csonkolunk egy kis ráhagyással (`FULL_TURN_TOLERANCE`), és a valaha elért LEGNAGYOBB szögelfordulást nézzük — így egy hazasétálás sem tudja visszatekerni azt, amit a játékos már körbejárt.

## 2.2 A 43 lépéses folyamatábra — AZ ELŐJEL VOLT A HIBA

Geri lépésről lépésre megrajzolta, mit vár egy négykörös útvonaltól három dobozzal (A bal felső, B jobb felső, C bal alsó). Elvárt végállapot: **A = 3×, B = 2×, C = 2×**.

A mérés `C = 1×`-et adott. Az ok nem a hurokdetektorban volt:

- az 1., 3. és 4. kör **óramutató szerint** halad (−1 mindegyik),
- a 2. kör, ami a C dobozt zárja, **ellenkezőleg** (+1).

A C dobozra a 2. kör `+1`, a 4. kör `−1` — az ELŐJELES összegük nulla. A körüljárást addig előjeles szögösszegként számoltuk, ezért a két ellentétes irányú kör kioltotta egymást.

**A javítás:** a `windingCounts()` nem szögösszeget ad vissza, hanem egy racsnit — valahányszor a szögelfordulás az utolsó jóváírás óta összegyűjt egy teljes kört BÁRMELYIK IRÁNYBAN, az egy bekerítés. Ez egyszerre oldja meg az előjel-kioltást, a félig megtett kört (nem lép a racsni) és a kör utáni elsétálást (a racsni nem számol vissza).

A javítás után minden lépés stimmel:

| folyamatábra | elvárt | mért |
|---|---|---|
| 7. lépés (16%) | 1. hurok, A = 1× | 17% |
| 13. lépés (30%) | 2. hurok, C = 1× | 30% |
| 25. lépés (58%) | B = 1×, majd A = 2× | 54% / 59% |
| 37. lépés (86%) | A = 3×, B = 2× | 79% / 84% |
| 43. lépés (100%) | C = 2× | 100% |

**NYITOTT:** a bezárásszám 5, Geri számozása 6-ot ír. A 3. és a 4. kör felső szakaszát a detektor egyetlen, A+B-t együtt bekerítő hurokként könyveli, nem kettőként (előbb B, aztán A). A védelmi eredményt és az időzítést ez nem befolyásolja — a jóváírásokat a körüljárás adja, nem a bezárások száma —, de a LAB-panel számlálója ettől eltér a rajztól.

---

# 3. HOGYAN MŰKÖDIK

## 3.1 `src/game/winding.ts`

`windingCounts(path, cells)` → cellánként a körüljárási szám abszolút értéke.

- **Nyitott nyomvonal, záró húr NÉLKÜL.** Egy zárt görbe szögösszege pontos egész többszöröse a teljes körnek. Záró húrral egy hosszú hazasétálás hamis körüljárást vinne be — mérve emiatt esett ki két cella egy bezárt területből.
- **Racsni, nem szögösszeg.** Valahányszor a szögelfordulás az utolsó jóváírás óta összegyűjt egy teljes kört — bármelyik irányban —, az egy bekerítés. Ez három hibát old meg egyszerre: az ellentétes irányú körök nem oltják ki egymást (2.2), egy félig megtett kör nem lép (~0,75 körnél a racsni áll), és a kör utáni elsétálás nem tekerhet vissza. A `FULL_TURN_TOLERANCE` ráhagyás azért kell, mert a nyom vége nem mindig pontosan a kezdőcellában van.
- **Régiónként számolunk, nem cellánként.** A görbén kívüli, egymással szomszédos cellák körüljárási száma szükségképpen azonos. Ez nem közelítés, hanem ugyanaz az eredmény olcsóbban: 836 cellás nyomvonal + 3544 claim-cella **66 ms → 26 ms**.
- **A falcellák örökölnek.** Egy falcella közepe RAJTA van a görbén, ezért a szögösszege nem konvergál egész értékhez: mérve a falcellák harmada-fele fél-egész közelében állt, 0 és 7 közötti szórással. Ezek a legközelebbi, görbén kívüli szomszédaiktól kapják a legnagyobb értéket — a fal ahhoz a régióhoz tartozik, amelyiket határolja. A keresés 3 gyűrűig tágul, mert a nyomvonal helyenként 2–3 cella vastag (lásd 5.2).

## 3.2 `resolveLoopClaims()` — `src/game/index.ts`

A `resolveSequentialLoopClaims` helyére lépett. **Szignatúra-változás: kapja a `path`-t is.**

```
claimedCells = az összes hurok cellájának uniója
turns        = windingCounts(path, claimedCells)

cellánként a jóváírások száma:
  ownedAtStart ? turns : max(1, turns)      — 2 × MAX_DEFENSE-re vágva
```

- Ami **nem a miénk** az aktivitás elején, azon a bezárás önmagában jár egy művelettel (megszerzés / áttörés) — ez a bekerítés következménye.
- A **védelem** növelése kizárólag a tényleges körüljárásból jön, ezért a már saját cellának nincs ilyen alapjuttatása.
- A jóváírásokat a **későbbi** bezárásokhoz rendeljük (a megerősítés ott jár, ahol a kör ténylegesen bezárult), az **első megszerzést** viszont az elsőhöz (ott foglaltuk el a területet). A `perLoop` tömb indexben továbbra is a `loops`-hoz igazodik — az `activityAudit.ts` erre épül.

## 3.3 A két időbeli szabály KÖVETKEZMÉNY LETT, nem külön kód

- **1.4** (a traversal közben szerzett cella nem erősödik azonnal): a frissen szerzett cellát a nyom pontosan egyszer kerülte meg → egy jóváírás → marad 1×.
- **1.5** (átfedő closure-ok nem farmolnak): hiába négy kompozit ciklus, a körüljárás egy.

A `creditedAt` / `actorAcquiredAt` / `lastReinforcement` / `sameTraversalReinforcement` heurisztikák **mind törölve**. Az `ecc56d4`-ig tartó láncban leírt „first wins" probléma megszűnt.

## 3.4 Az élő előnézet időzítése

A körüljárás a **path prefixből** számolódik, ezért az előnézet magától jó pillanatban vált: amíg a játékos nem futotta körbe a régi területet, a körüljárás 0, tehát nincs megerősítés. A `7.5` teszt ezt prefixenként végigméri, és megköveteli, hogy a védelem soha ne ugorjon a végérték fölé és ne is essen vissza.

---

# 4. TESZTEK

**`src/game/reinforcement.test.ts` — új, 319 sor, VALÓDI geometriával.**

A korábbi `overlappingReinforcement.test.ts` és `loopClaimCredit.test.ts` **törölve**: kézzel gyártott `DetectedLoop` objektumokkal dolgoztak (`wall-small-0`, `blue-existing`), és emiatt index-heurisztikákat rögzítettek, nem geometriát. Az irányfüggő hibát épp ezért egyik sem fogta meg.

Lefedve: 7.1 (ismételt kör 1–5×, GPS-zajjal három maggal), 7.2 (növekvő lapok), 7.3 (egy cellával nagyobb lap), 7.4 (köztes lebeny + záró nagy hurok), 7.5 (élő előnézet időzítése), 7.6 (irányfüggetlenség), 7.8 (nyolcas), 7.9 (sliver + korridor anti-farm), a nyomvonal végi elsétálás, rivális terület, kifelé tartó spirál.

`src/admin/labReinforcement.test.ts` átírva valódi nyomvonalra (üres `cellPath`-szal gyártott hurkokkal a körüljárás nem mérhető).

Külön blokk fedi Geri „3 box" rajzát (2.1): három bezárás, a védelem csak a harmadiknál nő, mindkét bejárási irányban.

Külön blokk fedi a 43 lépéses folyamatábrát (2.2): a végállapot mindkét irányban, és a szintek sorrendje prefixenként.

**Állapot: `npm test` → 517 zöld, 119 kihagyva. `npx tsc --noEmit` tiszta. `npm run build` lefut. Szerver: 165 zöld.**

---

# 5. GERI KÉT ÚJ JAVASLATA A #13 MENETBŐL

## 5.1 Szálszabály — MEGVIZSGÁLVA, MÉRVE, EGYELŐRE NEM LANDOLT

> „Amikor bezárunk egy hurkot, akkor attól a ponttól egy új szál jöjjön létre, amit egészen addig követünk, ameddig az a szál nem zárja be önmagát, és azt tekintsük egy újabb huroknak, aminek defense-t kell pluszolnia."

Megépítettem és végigmértem. **Sok helyen javít, de még nem kész.**

Amit hozott (a régi detektorhoz képest, irány-eltérés a foglalt cellaszámban):

| eset | régi detektor | szálszabállyal |
|---|---|---|
| növekvő lapok 18 m | 10,5% | **1,2%** |
| növekvő lapok 35 m | 11,8% | **0,8%** |
| spirál 12 m | 10,4% | **0,4%** |

Amibe beleütközött:

1. **Ütközik az 1.2-es szabállyal** („a már megszerzett terület lehet egy új hurok fala"). A szó szerinti alak — „a bezárás után minden korábbi index tilos" — a kifelé tartó spirált tönkretette (34% és 38% irány-eltérés), és megbuktatta a `loopDetection.test.ts` erre írt tesztjét.
2. A helyes alak a **hurok-kivágás**: a bezárás kivágja magát a szálból, de a KAPU ELŐTTI rész nyitva marad. Enélkül egy nagy kör közben bezáruló kis lebeny elviszi a nagy kört (a `7.4` teszt kék területe 2× helyett 1×-en maradt) — ez pontosan az 1.3-as szabály sérülése.
3. A hurok-kivágás viszont túl megengedő: a bezárás utáni kilógó érintés újra hurkot csinál. Erre a legjobb, geometriailag tiszta feltétel, amit találtam: **egy bezárás falának legalább a fele frissen bejárt szakasz legyen** (`MIN_FRESH_WALL_SHARE = 0.5`). Ez a fal SAJÁT tulajdonsága, nem index-ablak, tehát nem irányfüggő. A 20/40/100 m-es rávezető teszteket megjavította, de a `loopDetection.test.ts` és a `claim.test.ts` néhány esetében még maradt egy fölös bezárás laponként.

**A félkész változat elmentve:** `_archive/loopDetection.szalszabaly-kiserlet.ts`. Tartalmazza a `consumed[]` hurok-kivágást, az `acceptedWallCells` 1.2-kivételt és a `MIN_FRESH_WALL_SHARE` szabályt.

**Fontos:** a körüljárás nélkül ez a szabály nem oldotta volna meg a bejelentett hibát, a körüljárással viszont a hiba enélkül IS megoldott. A szálszabály tehát **finomítás, nem alapkő** — nyugodtan lehet külön menet.

## 5.2 Nyomvonal-vékonyítás — JÓ ÖTLET, NEM KEZDTEM EL

> „Menet közben ne 2–3 cellaszélességgel haladjunk a GPS-pontatlanság miatt, hanem redukáljuk 1 cella vastagságra az irány és a sebesség alapján leginkább valószínű cella megtartásával."

**Ez a mostani munka egyik mért fájdalompontját célozza.** A `winding.ts`-ben azért kell 3 gyűrűig tágítani a fal-öröklést, mert a nyomvonal helyenként 2–3 cella vastag. Egy 1 cella vastag nyom ezen felül kevesebb ál-kontaktot, kevesebb sliver-jelöltet és szimmetrikusabb oda-vissza eredményt adna.

**Miért nem most:** a `traceToCellPath()` a `src/game/cells.ts`-ben van, közös a szerverrel, és MINDEN számot elmozdít (terület, GP, fixture-elvárások, éles adat). Ha ugyanabban a menetben megy be, mint a megerősítés-átállás, egyik mérés sem értelmezhető. Külön menet, előtte-utána méréssel.

---

# 5.3 ÉLESÍTÉS A VALÓS RÖGZÍTÉSRE — MEGTÖRTÉNT

Geri a `#13` végén elfogadta a modellt, és kérte az élesítést. Az eredmény:

**A szemantika már mindenütt közös volt.** Az éles rögzítés (`src/screens/TrackingScreen.tsx`) és a szerveroldali mentés (`server/src/lib/activityCommit.ts`) is a közös `processActivity`-t hívja, ahogy a LAB is. Nem volt „LAB-only" ág.

**Amit át kellett állítani, az a TELJESÍTMÉNY.** Az éles felület minden ötödik cellánál a teljes nyomvonalat újraszámolta. Mérve, városi útvonalon:

| útvonal | teljes `processActivity` | ebből geometria | ebből claim + körüljárás |
|---|---|---|---|
| ~4 km | 139 ms | 128 ms | 11 ms (körüljárás 9) |
| ~11 km | 197 ms | 164 ms | 33 ms (körüljárás 18) |
| ~20 km | 337 ms | 289 ms | 48 ms (körüljárás 34) |

A költség java a geometria újraépítése, nem a körüljárás. A `TrackingScreen` mostantól `IncrementalActivityGeometry`-t használ, ugyanúgy, mint a LAB: **frissítésenként átlag 29 ms, legrosszabb 64 ms**.

A gyorsítótár a rögzítés azonosságához van kötve (`activityId` + az első pont időbélyege). Az `update()` magától újraépít, ha az új nyomvonal nem a régi folytatása — de ha valaki ugyanarról a pontról indít új futást, az első cellák véletlenül egyezhetnének, és akkor az előző futás hurkai bennragadnának.

**Kötelező egyezés.** Az `incrementalGeometry.test.ts` mostantól nem csak a geometriát, hanem a TELJES eredményt (minden claim-cella, hurokszám, GP) is összeveti az élő és a kötegelt út között, három forgatókönyvön. Ha ez a kettő eltérne, a felhasználó azt látná, hogy „a telefonon más területet írt, mint amit végül kaptam".

**Ellenőrzés:** 520 teszt zöld, `tsc` tiszta, build lefut, a felület hibamentesen indul. A `LabE2eTrackingScreen` a VALÓDI `TrackingScreen`-t ágyazza be, tehát a LAB sandbox-futás pontosan ezt a kódot járja be.

---

# 6. AMI MÉG NYITOTT

0. **A bezárásszám 5 a rajz szerinti 6 helyett** (2.2 vége). Csak a LAB-panel számlálóját érinti, a játékeredményt nem. Valószínűleg a szálszabály (5.1) rendezné.
1. **A szálszabály befejezése** (5.1). Konkrét maradék: laponként egy fölös bezárás a `loopDetection.test.ts` `overlap-aware` eseteiben és a `claim.test.ts` négykörös tesztjében.
2. **Nyomvonal-vékonyítás** (5.2).
3. **A körüljárás inkrementálissá tétele.** Ma minden előnézet-ütemben újraszámol: 836 cellás nyomvonalon 26 ms. Hosszú aktivitáson ez nőni fog. A szögösszeg szakaszonként additív, tehát régiónként eltárolható és az új szakaszokkal frissíthető.
4. **Production compact út — EZ MOST MÁR SÜRGŐSEBB.** A `buildCompactClaimCredits()` (`src/game/compactClaim.ts`) továbbra is a régi, index-alapú `creditedAt` heurisztikával számol, tehát a nagy hurkokra ugyanaz az irányfüggés áll fenn, amit a normál úton megszüntettünk. Ez nem elméleti: egy 5 km oldalú kör (25 km²) már compact, és azt egy bringás valóban megteszi. Jó hír, hogy olcsón átvezethető: a körüljárás egy összefüggő régión belül állandó, ezért a teljes parenteknek elég EGYSZER kiszámolni a középpontjukra — nem kell res12-re bontani. A `claimCredits` / res9 blokkos ág — a `HANDOFF_..._LAB_E2E.md` 9. pontja szerint ez a helyes sorrend. Az `applyClaimCredits()` (`src/game/claimCredits.ts`) már most is „N jóváírás egy cellára" alakú, tehát a körüljárás oda természetesen beköthető, ha a normál út stabil.
5. **Éles ellenőrzés.** A `#13` munkája nincs éles adaton mérve. Backend deploy csak a szálszabály lezárása után.

---

# 7. AMIT NE CSINÁLJ

- Ne told vissza az index-alapú heurisztikákat (`creditedAt`, `sameTraversalReinforcement`, `closureBlock` 75%-os ablak). Mind a bejárás irányától függött; ez volt a hiba forrása.
- Ne írj tesztet kézzel gyártott `DetectedLoop`-ból nyomvonal nélkül. A megerősítés geometriából jön, tehát nyomvonal nélkül nincs mit mérni.
- Ne vezesd át a szemantikát a compact production útra, amíg a 6.1 nyitva van.

---

# 8. MODELLJAVASLAT A KÖVETKEZŐ MENETRE

| feladat | javaslat |
|---|---|
| Szálszabály befejezése (6.1) | **Opus, emelt mélység** — geometriai döntés, mérés kell hozzá |
| Nyomvonal-vékonyítás (6.2) | **Opus, emelt mélység** — közös modul, minden számot elmozdít |
| Inkrementális körüljárás (6.3) | **Sonnet**, normál — meglévő képlet gyorsítótárazása |
| Compact átvezetés (6.4) | **Opus**, emelt mélység |

---

# 9. FÁJLOK, AMIKET A KÖVETKEZŐ AGENTNEK ISMERNIE KELL

| fájl | mi van benne |
|---|---|
| `src/game/winding.ts` | a körüljárási szám, a régiónkénti számolással és a fal-örökléssel |
| `src/game/index.ts` → `resolveLoopClaims()` | a jóváírások száma és hurkokhoz rendelése |
| `src/game/reinforcement.test.ts` | a teljes szabálykészlet valódi geometriával |
| `src/game/loopDetection.ts` | a detektor — **változatlan**, a `9b2a898` állapotában |
| `_archive/loopDetection.szalszabaly-kiserlet.ts` | a befejezetlen szálszabály |
| `src/game/claimCredits.ts` | „N jóváírás egy cellára" — a compact út beköthető pontja |

# Terepi főszál-mérés — 2026-09-04, két készülék

> A #37 handoff 1. nyitott ügyének kiértékelése. Nyers adat: `perfSnapshots`
> gyűjtemény (éles) + a két aktivitás privát nyomvonala.
> Újrajátszó szkriptek: `tmp/replay-field-track.ts`, `tmp/replay-field-phases.ts`,
> `tmp/replay-field-rejections.ts` (mind csak olvas).

## Mit mértünk

| | Android | iOS |
|---|---|---|
| készülék | Samsung SM-G780F (Galaxy S20 FE), Android 13, WebView Chrome 151 | iPhone, iOS 18.7, WKWebView |
| aktivitás | `3676e44d-0b6d-4e7b-82dc-0744cc4353c0` | `cac2275f-017a-410e-98e7-75a25c301e27` |
| mérés | `8de449a8-7e4b-4adf-b55b-6b4f86c35c30` | `af94307d-5ddd-4f3c-b05d-f9b93d1773da` |
| jelölés | „háttér" | „előtér" |
| időtartam | 39,5 perc | 41,6 perc |
| táv | 8 623 m | 8 962 m |
| pont / cella / hurok | 580 / 518 / 10 | 583 / 543 / 10 |

A mérés–aktivitás párosítás biztos: a mérés `notes` mezője
(`points`/`cells`/`loops`/`fates`) **cellára pontosan egyezik** az aktivitás
`pointCount`/`cellCount`/`activityCells` értékeivel. A Geri által küldött két
azonosító az AKTIVITÁSOKÉ; a mérések saját dokumentum-azonosítón vannak
(`perfMeter.newHistoryId()`), ezért nem közvetlenül kereshetők.

Egy harmadik mérés (`60fe313d…`, 15:55, android, 1 minta, 2 pont) bemelegítés,
nem használható.

## A számok

Minden érték ezredmásodperc. Az `átlag` és a `p95` az **utolsó 120 futás**
ablakára vonatkozik (`perfMeter.WINDOW_SIZE`), a `max` és a `count` a teljes
mérésre.

### iOS — 440 futás, 10,63 futás/perc (1 futás / 5,6 s)

| kulcs | átlag | p95 | max | utolsó |
|---|---|---|---|---|
| `preview.geometry` | **11,99** | 29,0 | 126,0 | 0 |
| `preview.process` | 2,79 | 9,0 | 19,0 | 2 |
| `preview.fates` | 0,39 | 1,0 | 7,0 | 1 |
| `preview.total` | **15,22** | 31,0 | **128,0** | 3 |

### Android — 164 futás, 4,11 futás/perc (1 futás / 14,6 s)

| kulcs | átlag | p95 | max | utolsó |
|---|---|---|---|---|
| `preview.geometry` | 13,69 | 18,3 | **855,0** | 855,0 |
| `preview.process` | 2,56 | 8,8 | 26,9 | 3,8 |
| `preview.fates` | 0,48 | 1,3 | 4,6 | 0,2 |
| `preview.total` | 16,79 | 26,7 | **859,0** | 859,0 |

Az androidos átlagot EGYETLEN kiugró érték viszi: a 859 ms benne van a 120-as
ablakban. Nélküle a tipikus futás `geometry` **6,62** ms, `total` **9,72** ms —
tehát a Samsung normál üzemben GYORSABB volt, mint az iPhone.

## Öt megállapítás

### 1. Az átlagos főszál-terhelés elhanyagolható — nem ez az akadozás oka

Az asztali újrajátszás szerint a teljes kör geometriája **1,3–1,4 s** CPU-idő;
a készülékfaktorral (lásd 5. pont) telefonon **2,0–2,6 s** egy ~40 perces
menetre. Ez **0,1% kitöltési tényező**. Az összesített költség optimalizálása
önmagában semmit nem old meg.

### 2. A `preview.geometry` a költség, és annak 99,5%-a a hurokkeresés

Fázisbontás a valódi nyomvonalon (579 pontonkénti hívás összesítve):

| fázis | Android nyom | iOS nyom | arány |
|---|---|---|---|
| H3 cellaút (`IncrementalCellPath`) | 6,0 ms | 6,0 ms | 0,4% |
| hurokkeresés (`IncrementalLoopDetector.append`) | **1 293,2 ms** | **1 385,5 ms** | **99,5%** |
| `snapshot()` másolás | 0,5 ms | 0,6 ms | 0,0% |

⚠️ **Ez megcáfolja a #37 handoff 2. pontjának feltevését.** Az asztali mérőpad
(9 hurok / 16 898 belső cella) az elszámolásra és a körüljárásra mutatott
(17,8 ms / 10,3 ms). A terepi köríven a `preview.process` — ami az elszámolást
ÉS a körüljárást is tartalmazza — mindössze **2,6–2,8 ms**, a teljes költség
17%-a. A cél a hurokdetektor, nem a körüljárás.

### 3. A hurokkeresés ideje szinte teljes egészében ELUTASÍTOTT jelöltekre megy

| | Android | iOS |
|---|---|---|
| elfogadott hurok | 10 | 10 |
| elutasított jelölt | 499 | 547 |
| elutasítás oka | 100% `interior_too_small` | 100% `interior_too_small` |
| elutasított jelöltek fala (átlag / max) | 167,0 / 275 cella | 172,3 / 282 cella |
| elfogadott hurkok fala összesen | 337 cella | 322 cella |
| **hiábavaló feltöltés** | **247×** | **293×** |

Minden elutasított jelölt előtt lefut a `pruneDeadEnds` + `buildLoopInterior`
feltöltés egy **átlagosan 167 cellás falra** — és a fal a *megmetszés utáni*
méret, tehát ezek nem zsákutcák.

⚠️ **Itt először azt írtam, hogy „vékony folyosók, üres belsővel". EZ TÉVES
VOLT** — a lenti utólagos mérés megcáfolta: 499-ből 491 jelöltnek VALÓDI
belseje van (medián 214 cella), csak minden cellája már bekerített. Lásd
lent, „Az elutasítás valódi oka".

Ez magyarázza a költség **növekedését is** — átlag hívásonként a nyom
ötödeire bontva (Android nyom): 0,82 → 1,22 → 2,50 → 3,76 → **4,62 ms**,
azaz **×5,6 a menet során**. A hajtóerő nem a távolság, hanem az újralátogatás.

### 4. A 859 ms-os fagyás a HÁTTÉRBŐL VISSZATÉRÉS ára

Két független bizonyíték:

- **Az androidos `lastMs` = `maxMs` = 859.** A mérő utolsó rögzített futása volt
  a legrosszabb — pont az a pillanat, amikor Geri előhozta az appot menteni.
  Az iOS-en, ahol a menet végén már előtérben futott, a `lastMs` mindössze
  **3 ms**, a 128 ms-os csúcs korábban, egy váltásnál keletkezett.
- **Az újraszámolás gyakorisága.** Közel azonos GPS-ütem mellett (14,7 vs 14,0
  pont/perc) az iOS **440-szer**, az Android csak **164-szer** számolt újra —
  futásonként 1,3 vs **3,5 pont**. A háttérben ritkábban fut le a React-render,
  a minták felgyűlnek, és egyetlen kötegben kerülnek feldolgozásra.

A kötegméret-söprés megadja a pontos alakot — **ugyanaz az összmunka, más
eloszlásban**:

| köteg (pont/hívás) | hívás | összesen | leghosszabb blokk (asztali) |
|---|---|---|---|
| 1 | 580 | 1 462 ms | 23,8 ms |
| 4 | 146 | 1 363 ms | 50,1 ms |
| 8 | 74 | 1 262 ms | 89,3 ms |
| 16 | 38 | 1 289 ms | 175,8 ms |
| 32 | 20 | 1 289 ms | 268,2 ms |
| 64 | 11 | 1 287 ms | **388,3 ms** |

Az összeg végig 1,26–1,46 s — **nincs érdemi hívásonkénti fix teher**. A
leghosszabb blokk viszont a kötegmérettel arányosan nő: 64-es kötegre asztalon
388 ms, telefonon ×1,5 ≈ 600 ms. Egy ~120 pontos háttér-torlódás pontosan a
mért **859 ms**-ot adja.

### 5. Kizárva: NEM a gyorsítótár esik szét

Felmerült, hogy a 859 ms egy teljes újraépítés (`isExtension === false` a
`IncrementalActivityGeometry.update`-ben, ha a pontlista új objektumokból épül
újra). **Nem az:** hideg teljes újraépítés a teljes pontsorral **asztalon**
1 248 ms (Android nyom) / 1 389 ms (iOS nyom) — telefonon ennél csak több
lehetne, a mért csúcs 859 ms. Az inkrementális gyorsítótár végig működött.

Készülékfaktor (a telefonos ablak és az azonos szakasz asztali költsége
alapján, becslés): **Samsung ≈ 1,55×**, **iPhone ≈ 1,85×** az asztali
újrajátszáshoz képest. Az asztali pad tehát használható proxy, ~1,5–2-es
szorzóval.

## Amit ebből következik

1. **A Web Worker az elsődleges** — a 2. nyitott ügy sorrendje megfordul.
   A baj nem az összköltség (0,1%), hanem az egyetlen 859 ms-os blokk a
   főszálon. A worker pontosan ezt szünteti meg: az előnézet később érkezik,
   de a felület nem fagy. Az előnézet amúgy is tájékoztató — az elszámolás
   szerveroldali (`DECISIONS.md`, „A kliens activity/claim számítása előnézet").
2. **Az olcsóbbá tétel másodlagos, de nem elhagyható** — a per-hívás költség a
   menet során ×5,6-ra nőtt 8,6 km alatt. Egy 25 km-es kör ennek a többszöröse
   lesz, workerrel is (akkumulátor, késleltetés). A célpont **nem** a körüljárás.
   (⚠️ Itt eredetileg „az `interior_too_small` jelöltek korai kiszűrése" állt.
   A lenti utólagos mérés szerint ilyen szűrő NINCS biztonságosan — helyette a
   durva előkészület memoizálása lett a megoldás, −55%.)
3. **A 3. nyitott ügy („körbe-körbe futásnál a cache sosem talál") téves
   diagnózis volt.** A gyorsítótár talál (5. pont); ami az ismételt bejárásnál
   drágul, az a jelöltkeresés (3. pont).

## Amit a mérő nem tudott megmondani

A `perfMeter` csak összesítést ment, ezért a 859 ms-ot csak abból tudtam a
háttérváltáshoz kötni, hogy `lastMs === maxMs`. **Ha újra mérünk, a mérő
bontsa a mintákat láthatósági állapot szerint** (`document.visibilityState`),
és tartson meg egy rövid idősort a legdrágább N futásról időbélyeggel.
Enélkül minden háttér-előtér kérdés következtetés marad, nem mérés.

---

# Utólag: a hurokkeresés bontása (ugyanaznap)

A worker után megmértem, mi teszi ki a hurokkeresés 1 293 ms-át, hogy a
„tegyük olcsóbbá" pontnak legyen célja. Szkriptek: `tmp/measure-candidate-cost.ts`,
`tmp/measure-adaptive-internals.ts`.

## Az elutasítás valódi oka — NEM az, amit a diagnosztika mutat

A `rejected` lista mind az 499 jelöltre `interior_too_small`-t ír, de a kód
KÉT helyen írja ezt, és a kettő teljesen mást jelent:

| ág | db | feltöltés |
|---|---|---|
| a belső tényleg üres | 8 | 2 ms |
| **valódi belső, de MINDEN cellája már bekerített** (`addsNewGround`) | **491** | **1 075 ms** |

A jelöltek belseje mediánban **214 cella**. Ezek tehát valódi hurkok, amik a
már megszerzett területet zárják be újra — a szabályok dolgoznak rendesen.

## Ami a feltöltésen belül van

| fázis | ms | % | mitől függ |
|---|---|---|---|
| durva fal képzése | 46 | 6,8% | a res12 faltól |
| durva régió polyfill | 147 | 21,9% | **a durva faltól** |
| durva kitöltés | 12 | 1,8% | **a durva faltól** |
| sáv építése | 37 | 5,5% | **a durva faltól** |
| finom magkeresés | 220 | 32,9% | **a durva faltól** |
| finom árasztás | 208 | 31,1% | a res12 faltól |

**499 jelölt, de mindössze 29 különböző durva fal** — a jelöltek res12 fala
cellánként eltér, két felbontással feljebb viszont a különbség eltűnik.
Innen jön a `coarseContextOf` memoizálás: −55% böngészőben, −30% Node-ban,
bitre azonos eredménnyel.

## Amit végigmértem és NEM működik

- **Területküszöb** (shoelace a cellaközéppontokon): az elutasított jelöltek
  területe NAGY (medián 50 000 m², max 120 568 m²), a legkisebb ELFOGADOTT
  hurok 932 m². Nincs szétválasztó küszöb.
- **Tartalmazás egyetlen korábbi hurokban**: 499-ből 2-t fog meg. A fal
  mediánban 13 cellával lóg ki a legjobban fedő hurok régiójából — nem
  jitter, hanem az, hogy a fal TÖBB hurok régióján ér át.
- **Az olcsó ellenőrzések előrehozása** a feltöltés elé: a `sameLoopGeometry`
  első ága a belsőt hasonlítja, tehát a sorrend nem cserélhető fel
  jelentésváltozás nélkül.
- **A bekerített cellák UNIÓJÁRA szűrni**: a fal 98%-a benne van, de ez
  **nem biztonságos** — több hurok gyűrűt formálhat, aminek a lyuka valódi új
  terület, és azt csendben elvennénk a felhasználótól.

## Ami maradt

A jelöltek SZÁMA (499 jelölt 518 cellára, azaz ~1 minden új cellára). Ezt
csökkenteni már játékszabály-döntés, nem optimalizálás — a `DECISIONS.md`
kifejezetten tiltja az index-alapú heurisztikák visszahozatalát, mert azok a
bejárás irányától függtek.

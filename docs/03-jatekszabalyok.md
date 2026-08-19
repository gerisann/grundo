# 03 — Játékszabályok: a terület

Ez a fejezet a GRUNDO magja. Minden szabály **szerveroldalon** kényszerül ki; a kliens csak megjelenít és élő előnézetet számol.

> **Alapdöntés (2026-08-15):** a terület nem szabad alakú poligon, hanem **hexagon-rács** (H3, 12-es felbontás). Ez a döntés hatja át az egész fejezetet. Az indoklás a [06 — Geometria-modell](06-architektura-es-admin.md#gt-geometria-modell-döntés) fejezetben.

---

## Alapfogalmak

| Fogalom | Jelentés |
|---|---|
| **Cella** | A világ H3 res 12 hexagonra van osztva. Egy cella ≈ **18,8 m hosszú átló**, ≈ **307 m²**. Ez a birtoklás legkisebb egysége. |
| **Terület mértékegysége** | **m²** (lásd [Megjelenítés](#a-terület-megjelenítése)) |
| **Réteg (layer)** | `foot` (futás + gyaloglás) vagy `bike`. Két teljesen külön rács: külön tulajdonlás, külön ranglista. |
| **Nyom (trail)** | A rögzítés közben érintett cellák. **Ideiglenes** — magától nem ér semmit. |
| **Bezárás** | A nyom önmagát metszi → a közrezárt cellák a tieid. |
| **Zóna** | Megjelenítési fogalom: az azonos tulajdonosú, összefüggő cellák egy csoportja. Ebből jön a „36 terület" szám a ranglistán. |
| **Védelem** | 1–5 közötti szint **cellánként**. Ennyiszer kell áttörni, mielőtt gazdát cserél. |

### Miért hexagon?

1. **Elnyeli a GPS-hibát.** A telefon városban 5–20 m-t téved. Szabad alakú poligonnál ugyanaz az utca kétszer lefutva két *különböző* alakzatot ad, és a határvonalak körül örökös, megnyerhetetlen vita van. Rácsra vetítve viszont ugyanaz a futás ugyanazokat a cellákat adja — a birtoklás **diszkrét és stabil**.
2. **Nincs átlós szivárgás.** Négyzetrácson két, csak sarokban érintkező mező között „átfolyik" a kitöltés, ezért a bezárás detektálása bonyolult és hibás. A hexagonnak **mind a 6 szomszédja élszomszéd** — egy összefüggő cellalánc mindig vízhatlan fal. Ez teszi a bezárás-felismerést triviálissá.
3. **Egyenlő távolság.** Minden szomszéd középpontja ugyanolyan messze van, tehát a „terjeszkedés" minden irányban egyforma — négyzetrácson az átló 41 %-kal hosszabb.
4. **Az egész geometria halmazműveletté válik.** Metszés, unió, kivonás = cellahalmaz-műveletek. Nincs lebegőpontos hiba, nincs érvénytelen poligon, nincs önmetsződési korrekció.

### Felbontás: miért pont res 12?

| H3 szint | Hosszú átló | Terület | Értékelés |
|---|---|---|---|
| res 10 | ~132 m | 15 048 m² | Túl durva — egy háztömb 1 cella |
| res 11 | ~50 m | 2 150 m² | A minimum (1 000 m²) kisebb lenne egy cellánál |
| **res 12** | **~18,8 m** | **307,1 m²** | **Ez kell.** A GPS-hiba nagyságrendje, és 1 000 m² ≈ 3,3 cella |
| res 13 | ~7,1 m | 43,9 m² | Kisebb, mint a GPS-hiba → visszahozza a jittert, 7× több adat |

A 10–20 m-es átló, amit ösztönösen megcéloztál, és az 1 000 m²-es minimum **pontosan a res 12-nél találkozik**. Ez jó jel.

**Egy cella névleges értéke: 307,09 m².** A H3-cellák valós területe a Földön ±néhány százalékot ingadozik; szándékosan **fix névleges értéket** használunk, hogy egy budapesti és egy oslói cella ugyanannyit érjen. A terület = cellaszám × 307,09 m², egész m²-re kerekítve.

### A terület megjelenítése

**Alapegység: m²** *(döntés: 2026-08-15)*.

| Érték | Megjelenítés | Példa |
|---|---|---|
| < 1 000 000 m² | m², ezres tagolással | `9 421 m²` · `184 500 m²` |
| ≥ 1 000 000 m² | km², 2 tizedessel | `1,84 km²` · `55,83 km²` |

- Egy listán belül (ranglista, profil) **mindig egységes** a mértékegység: ha a legnagyobb elem ≥ 1 km², az egész lista km²-ben megy.
- A választás oka: a felhasználók túlnyomó többsége hónapokig 1 km² alatt lesz. A `0,009 km²` semmitmondó, a `9 400 m²` viszont érzékelhető siker — és pont a kezdeti szakaszban kell a legerősebb visszajelzés.
- A belső számítás és tárolás mindig **cellaszám**; a m²/km² csak formázás.

> ⚠️ **A felbontás visszafordíthatatlan döntés.** Élő adattal res 12-ről res 11-re váltani teljes migrációt jelent. Ezt most kell jól eldönteni — de a fenti tábla alapján a res 12 nem közeli döntés.

---

## A rögzítés és a bezárás

### 1. Nyom (ideiglenes birtoklás)

Rögzítés közben minden érintett cella a **nyomhoz** kerül:

```
GPS pont → h3.latLngToCell(lat, lng, 12)
két egymást követő cella között → h3.gridPathCells(a, b)   // hézagmentes lánc
```

A hézagkitöltés kritikus: 10 km/h-nál a másodperces mintavétel 2,8 m-t lép, de ha a jel kihagy, két pont között 50 m is lehet. A `gridPathCells` a köztes cellákat is felveszi, így a fal **soha nem lyukas**.

> **A területszámítás mindig a TELJES nyomvonalból megy**, a [privát zóna](02-funkcionalis-spec.md#privát-zóna) levágásától függetlenül. A levágás kizárólag megjelenítési művelet. Ha a foglalás a levágott nyomvonalból számolna, a privát zóna csalási felületté válna: bekapcsolom 200 m-re, és a levágott szakaszon nem érvényesülnek a szabályok.

A nyom a térképen halványan világít („ez most a tiéd — ha bezárod"). **Önmagában semmit nem ér**: ha az aktivitás bezárás nélkül ér véget, a nyom eltűnik. Idegen cellát a nyom nem vesz el, két játékos ugyanabban a cellában nem ütközik.

### 2. Bezárás-felismerés (folyamatos, nem csak a végén)

Amint a nyom olyan cellába lép, amelyben **már járt** ebben az aktivitásban:

```
belépés a c cellába, aktuális lépésindex i
ha c már szerepel a nyomban j indexen  ÉS  (i − j) ≥ MIN_LOOP_STEPS:
    hurokjelölt = a nyom j..i közötti szakasza
    BELSŐ = flood_fill(hurokjelölt)
    ha |BELSŐ| ≥ 4 cella:
        IGÉNY = hurokjelölt ∪ BELSŐ      → feldolgozás
        a felhasznált szakasz megjelölve, hogy ne ismétlődjön
```

Ebből következik, amit kértél:

- **Minden metszet bezárás.** Nem kell a kiindulóponthoz visszaérni — a korábbi 30 m-es „visszaérkezési tűrés" szabály **megszűnik**, feleslegessé vált. A kiindulóponthoz visszaérés csak a legegyszerűbb esete az önmetszésnek.
- **Konvex és konkáv is működik.** A kitöltés nem alakfüggő: bármilyen csavart, csillag alakú, karéjos hurkot kitölt.
- **Nyolcas alakú útvonal két területet ad**, mert a két hurok külön-külön detektálódik.
- **Egy aktivitás alatt több bezárás is lehet** — ahányszor metszed magad, annyiszor. **De minden bezárás csak az előző bezárás UTÁN bejárt útból épülhet.** Ez nem finomhangolás, hanem a szabály lényege: enélkül a kör előtti és utáni út összeérése újra és újra „bezárná" ugyanazt a területet.

> **Miért kellett ezt külön kimondani?** Mert a természetes használat pont ilyen: a rögzítést a kaputól indítod, kimész a körhöz, megcsinálod, és ugyanazon az úton jössz vissza. A rávezető szakasz mezőit így kétszer érinted, és a két érintés között ott van az egész bezárt terület. 2026-08-19-ig minden ilyen mező újabb bezárásnak számított ugyanarra a területre: egy valódi 11 km-es körnél **26 bezárás**, minden mező az **5-ös maximumon**, és **631 igénypont a helyes 126 helyett**. Már 40 méter rávezető elég volt a maximumhoz. Az ismételt kör jutalma ettől függetlenül megmarad: a másodszor megfutott kör a *saját* mezőin záródik, tehát önálló bezárás.
- **Menet közben, azonnal.** A bezárás nem a mentéskor derül ki: a kliens élőben mutatja a kitöltött területet és a becsült pontot. (A hiteles számítás mentés után, szerveroldalon fut újra.)
- **A bezáráshoz kihagyott mező kell.** Ha ugyanazon a nyomvonalon jössz vissza, az nem bezárás — és az sem, ha a visszaút a szomszédos cellasorban fut. Legalább **egy kihagyott mezőnek** kell lennie a két nyomvonal között; a gyakorlatban ez ~30 méteres hézag. Egy átlagos utca két járdája nem elég, egy háztömb megkerülése igen.

  > **Ez a szabály oda-vissza járt.** Egy ideig elengedtük, hogy a keskeny kör is számítson — de kiderült, hogy kaput nyit. Ha ugyanazokon a cellákon térsz vissza, **minden cella újralátogatás**, és mindegyik saját beágyazott hurkot szül: egyetlen oda-vissza séta egy 250 méteres utcán **tizenhárom** hurkot generált, és a folyosót azonnal 5-ös védelemre vitte. Egy 6 km-es cikcakkal így be lehetett betonozni egy kis területet öt napra.
  >
  > A valódi körök ettől nem sérülnek: a négyzet alakú kör egy hurok, a négyszer megfutott kör négy — pontosan annyi, amennyi kell a védelem növeléséhez.

- **Csak az számít, ami körön fekszik.** Két dolog esik ki: a **zsákutca** (kimész néhány mezőt és ugyanazon jössz vissza) és a **két területet összekötő folyosó** (átmész egy vonalon, majd ugyanazon vissza). A közös bennük, hogy egyik sem része egyetlen körnek sem — a bejárt mezők közül csak azok lesznek a tiéd, amelyeket megkerül egy kör.

  > **Miért nem a szomszédok számából döntjük el?** Kézenfekvő lenne azt mondani, hogy „legalább három szomszéd kell" — de egy egy mező vastag gyűrűben minden mezőnek pontosan **kettő** van: az előző és a következő. Megmérve: egy 200 m-es kör 50 fal-mezőjéből **34-nek (68%)** csak két szomszédja van, egy 600 m-esnél 150-ből 104-nek. Ez a szabály tehát minden valódi kör kétharmadát törölné.
  >
  > Ezért a döntés nem a szomszédszám, hanem az, hogy a mező **körön fekszik-e**. A zsákutca és a folyosó élei „hidak": elvágva őket a bejárt hálózat szétesik. Egy körön fekvő él sosem híd, mert a kör másik fele megkerüli.

### 3. Flood fill — a bezárt belső megtalálása

```
1. befoglaló doboz = a hurokcellák bbox-a + 1 cella margó
2. a doboz peremcelláiból indított kitöltés, a hurokcellák akadályok
3. amit a kitöltés kívülről NEM ér el  →  BELSŐ
```

Ez a hexagon-modell legnagyobb nyeresége. Szabad alakú poligonnál egy önmetsző nyomvonalból érvényes sokszöget képezni a legtörékenyebb művelet az egész rendszerben (csomópontosítás, gyűrű-orientáció, lebegőpontos élmetszések, degenerált esetek). Rácson ez egy **determinisztikus szélességi bejárás**, ami mindig ugyanazt az eredményt adja, és nem tud „érvénytelen geometriát" előállítani.

**Védőkorlát:** ha a befoglaló doboz > 500 000 cella (≈150 km²), a hurkot elutasítjuk („túl nagy hurok — valószínűleg GPS-hiba"). Repülő- vagy vonatút így nem foglal fél megyét.

### 4. Minimumok

| Szabály | Érték | Mikor számít |
|---|---|---|
| Az aktivitás menthető | **≥ 100 m** | ez alatt nincs mentés (kép #45) |
| Bezárt terület elfogadva | **≥ 1 belső cella** (≈307 m²) | ez alatt a hurok nem ad területet |
| Hurok minimális hossza | **≥ 6 lépés** | GPS-remegésből eredő ál-hurkok kiszűrése |

> **Számtani megjegyzés:** a küszöb egyetlen belső cella, ami névlegesen 307 m² — de a *bezárás* geometriája ennél szigorúbb. Mérve (res 12): egy 30 m oldalú négyzetes kör még nulla belső mezőt zár be, egy 40 m oldalú (160 m kerület, 1 600 m²) már kettőt. A területszerzés gyakorlati alsó határa tehát egy **~40 méteres kör** — egy belső udvar vagy egy kicsi háztömb —, nem a névleges 307 m².
>
> A küszöb 2026-08-18-án rövid ideig 4 volt. Méréssel kiderült, hogy ez nem GPS-remegést szűrt (az nulla belső mezőt ad), hanem valódi kis köröket vágott le; ezért állt vissza 1-re. Az indoklás a `MIN_INTERIOR_CELLS` mellett van a `src/config/gameplay.ts`-ben.

---

## Birtoklási szabályok

Az IGÉNY cellahalmaz minden cellájára, egyesével:

| A cella állapota | Történik | Pont |
|---|---|---|
| **Szabad** | a tiéd lesz, védelem = 1 | IGÉNY ×1,0 |
| **A tiéd** | védelem +1 (max 5) | IGÉNY az **új** védelmi szint szorzójával |
| **Idegené, védelem = 1** | átkerül hozzád, védelem = 1 | IGÉNY ×1,0 + **LOPÁS** +50 % |
| **Idegené, védelem ≥ 2** | **nem cserél gazdát**, védelem −1 | **ÁTTÖRÉS** +25 % |

Nincs külön „kiharapás" és „bekebelezés" szabály — mindkettő ugyanennek a cellánkénti eljárásnak a következménye. Ha a hurkod körbezár egy idegen zónát, annak minden cellája végigmegy a fenti táblán.

**Zónák (megjelenítés):** a cellák birtoklása után a rendszer összefüggő komponenseket számol tulajdonosonként — ebből lesz a „36 terület" a ranglistán és a térképen a körberajzolt határvonal. A zóna tehát **származtatott** adat, nem tárolt entitás.

### Egycellás, izolált maradványok

GPS-ingadozás miatt egy nagyobb foglalás szélén maradhat egyetlen rivális cella
úgy, hogy a saját tulajdonosának semmilyen más cellájához nem kapcsolódik. A
foglalás végén ezt a maradványt a rendszer automatikusan a támadóhoz rendeli,
ha mindhárom feltétel teljesül:

- pontosan egyetlen, saját tulajdonosú szomszéd nélküli celláról van szó;
- közvetlenül érinti az aktivitásban frissen megszerzett területet;
- a védelme **1-es**.

A 2–5-ös védelem nem kerülhető meg: az ilyen izolált cella is csak a normál
gyengítési és gazdacsere-szabállyal támadható. Az ellenőrzés a claim
kétgyűrűs környezetének aktuális állapotából, ugyanabban a Firestore-
tranzakcióban történik, ezért konkurens mentéskor is determinisztikus.

### Tranzakcionalitás

Az igény feldolgozása egyetlen Firestore-tranzakcióban, cellablokkonként történik (lásd [05](05-adatmodell.md)). Két egyszerre érkező, ugyanazt a területet érintő aktivitás közül az nyer, amelyiknek a tranzakciója **először sikeresen commitol**. A `startedAt` és `endedAt` nem foglal le területet előre.

A tranzakció a teljes candidate halmazhoz — minden hurok fala és belseje — beolvassa az aktuális grid blockokat, majd ezekből újraszámolja a foglalást. Ha egy konkurens commit miatt a Firestore újrapróbálja a tranzakciót, az ownership, a GP és az aggregátumok is az új állapotból számolódnak. A rögzítés közben látott térkép ezért pillanatkép és előnézet; a tulajdonjog csak a mentés sikeres commitjakor dől el.

### Mekkora kör fér bele?

**A méret önmagában nem ok az elutasításra.** Egy hosszú aktivitás mindig
elmentődik a metrikáival, az alap-GP-jével és az útvonalával együtt — korábban
állt itt egy jóval szigorúbb korlát, ami egy hétköznapi, 8 km-nél hosszabb
körfutást is visszautasított, méghozzá úgy, hogy a futás egyáltalán nem
mentődött el. Ez megszűnt.

Két valódi plafon maradt, és mindkettő technikai, nem játékszabály:

| Plafon | Hol | Érték | Mi történik |
|---|---|---|---|
| Foglalás mérete | `MAX_CLAIM_CELLS` (`loops.ts`) | 1,2 millió cella ≈ **370 km²** ≈ 76 km kerület | a hurok **kimarad** a foglalásból |
| ~~Tranzakció írásszáma~~ | ~~Firestore~~ | — | **Megszűnt** 2026-08-19-én: a darabolt mentés blokkcsoportonként külön tranzakcióban számol el. |

Mért értékek négyzet alakú körökre: 10 km → 20 445 cella / 80 blokk; 20 km →
81 114 cella / 270 blokk; 48 km → 464 996 cella / 1 444 blokk (4,2 s);
64 km → 825 955 cella / 2 524 blokk (7,3 s); 76 km → 1 164 235 cella /
3 541 blokk (10,3 s). 88 km fölött a foglalás mérete a korlátba ütközik.

⚠️ **A korlát ma NÉMÁN vág.** A `detectLoopsDetailed`
`too_large` okkal rögzíti a kihagyott hurkot a diagnosztikában, és az aktivitás
összegzőjébe is bekerül `oversizedLoops` néven — de a felhasználó ebből semmit
nem lát: nulla területet kap magyarázat nélkül. Ez ismert hiányosság.

A cél a **200 km-es kör** kiszolgálása (a Balaton-kör ~600 km², ~1,95 millió
cella, ~5 700 blokk). A két algoritmikus akadály elhárult:

- **A tranzakciós írásplafon** — megoldva a darabolt mentéssel (16 000 blokkig,
  ≈1 680 km²), lásd [05](05-adatmodell.md).
- **A kitöltés befoglaló doboza** — megoldva az adaptív kitöltéssel: a munka
  mostantól a KERÜLETTEL nő, nem a területtel.

Ami maradt, az nem algoritmus, hanem **memória**: a megtalált cellákat tárolni
kell, mérve ~420 bájt darabonként. A Balaton-kör 1,95 millió cellája így
~800 MB lenne. A megoldás nem a kitöltés további finomítása, hanem a
**cellafelbontás**: res 11-en ugyanaz a terület már csak ~280 ezer cella. Ennek
játékmenetbeli ára mérve van (lásd a `MIN_INTERIOR_CELLS` melletti
feljegyzést), és külön döntést igényel.

---

## Védelem

- **Cellánként** 1–5 közötti szint.
- **Növelés:** saját cella ismételt bezárása → +1. Ugyanaz a kör négyszer megfutva = 4× védelem.
- **Csökkentés:** sikeres idegen áttörés → −1.
- **Napi elévülés:** minden cella védelme naponta **egy szintet veszít**, de **sosem esik 1 alá**. A tulajdonos nem változik az elévüléstől — a cella a tiéd marad, csak egyre könnyebb elvenni.

> Ez tartja mozgásban a játékot, kímélet nélkül, de nem kegyetlenül. Egy 5-ös védelmű folt négy napig még ad valamit, tehát egy kihagyott nap nem nyitja ki az egész birodalmadat — de aki hetekig nem futott, annak a területe ugyanolyan sebezhető, mint bárkié.
>
> **Miért nem napi nullázás?** Mert az a napi megfelelést jutalmazná a rendszeres mozgás helyett: egyetlen kihagyott nap ugyanoda vezetne, mint egy kihagyott hónap.

**Az elévülés OLVASÁSKOR számolódik, nincs mögötte ütemezett feladat.** A cellához odaírjuk a szerzés napját, és az érvényes védelem `max(1, szint − eltelt napok)`. Egy naponta futó „mindent visszaír" job több tízezer dokumentumot írna át azért, hogy egy számot csökkentsen — ráadásul félbeszakadhatna, amitől a rács fele elévülne, a másik fele nem.

**A nap egyetlen, rögzített időzóna szerint** (`Europe/Budapest`) telik, nem a felhasználó helyi ideje szerint. Egy cellának nincs időzónája: ha a tulajdonos és a támadó két kontinensen van, a védelem attól függne, ki nézi — és utazással vagy órát állítva lehetne napot váltani. A **streak** és a napi célok maradnak helyi idő szerint, azok tényleg a felhasználó napjához tartoznak.

A védelem a cellához tartozik, nem a felhasználóhoz. Gazdacsere után az új tulajdonosnál 1-es szinten indul.

### Napi forduló — **helyi idő szerint** *(döntés: 2026-08-15)*

- A forduló a **cella tulajdonosának helyi ideje** szerinti éjfélkor történik.
- A `daily-rollover` job **óránként** fut, és mindig azokat a felhasználókat dolgozza fel, akiknél az elmúlt órában fordult éjfél. Így a terhelés egyenletesen oszlik el a nap 24 órájára — ez üzemeltetési szempontból még kényelmesebb is, mint egyetlen UTC-csúcs.
- Sorrend: **hold-bónusz kiosztása → védelem visszaállítása → streak-értékelés**.
- Az időzóna forrása: `users.timezone`, amit az app az eszközből állít be. **Visszaélés-védelem:** az időzóna-váltás naplózva van, és 30 naponta legfeljebb egyszer vehető figyelembe a forduló szempontjából. Így nem lehet oda-vissza utazgatással kétszer beszedni a napi bónuszt.

---

## Rétegek

|  | `foot` | `bike` |
|---|---|---|
| Aktivitás | futás, gyaloglás | kerékpár |
| Tipikus kör | 2–10 km | 10–40 km |
| Ellenfelek | csak gyalogosok | csak bringások |
| Rács | saját cellatulajdonlás | saját cellatulajdonlás |

Ugyanaz a cella egyszerre lehet más gyalogos és más bringás birtoka. „Egy város, két birodalom."

---

## Trust Score — aktivitás-hitelesség *(döntés: 2026-08-15)*

Minden mentett és importált aktivitás kap egy **0–100 közötti bizalmi pontszámot**, mielőtt bármit módosítana a birtokviszonyokon. Nem bináris döntés, hanem súlyozott jelekből álló pontszám — mert a valóság sem bináris: egy alagútban kihagyó GPS gyanúsnak *tűnik*, de ártatlan.

### A hét jelforrás

| # | Jel | Súly | Mit néz |
|---|---|---|---|
| 1 | **Sebesség** | 20 | Átlag és csúcs a típushoz képest: futás ≤ 25 km/h · gyaloglás ≤ 12 km/h · bringa ≤ 80 km/h. Tartós plafonközeli sebesség önmagában is gyanús. |
| 2 | **Gyorsulás** | 15 | Emberi gyorsulási profil. Ember nem gyorsul 0→20 km/h egy másodperc alatt, és nem tart *tökéletesen* állandó sebességet 10 percig. **A túl sima profil ugyanolyan gyanús, mint a túl ugrálós.** |
| 3 | **GPS-pontosság** | 15 | Jelentett pontosság (accuracy/HDOP), pontsűrűség (< 0,2 pont/s tartósan → ritkított vagy rajzolt nyom), pontosság-eloszlás. A hamisított jel tipikusan *irreálisan jó és állandó* pontosságot jelent. |
| 4 | **Teleport / folytonosság** | 20 | Két szomszédos pont közti táv/idő fizikai lehetetlensége. **Cellalánc-ugrás**: ha a `gridPathCells` egy lépésben > 40 cellát kell kitöltsön (>750 m hézag). Ez a hexrács saját fegyvere: a hamis GPS túl egyenletes, túl nagy lépésekkel halad, ami a cellaláncon azonnal látszik. |
| 5 | **Szenzor-konzisztencia** | 15 | Egymásnak ellentmondanak-e a források: lépésfrekvencia vs. tempó · pulzus vs. terhelés · barométer vs. GPS-magasság · gyorsulásmérő „mozgásban van" jelzése vs. a rögzített sebesség. **Autóval „futni" itt bukik le**: 30 km/h sebesség lépésfrekvencia és pulzusemelkedés nélkül. |
| 6 | **Történeti viselkedés** | 10 | A felhasználó saját előzményéhez képest: hirtelen 2× jobb tempó · új eszköz · szokatlan földrajzi hely · a fiók kora és eddigi tisztasága. |
| 7 | **Kézi jelentés / moderáció** | 5 (+erős lehúzó) | Közösségi bejelentések és admin-előzmény. |

Kiegészítő ellenőrzések, amelyek önmagukban is elutasítanak: **duplikáció** (ugyanaz a cellahalmaz rövid időn belül), **egyidejűség** (időben átfedő aktivitások ugyanattól a felhasználótól), **hurokméret** (befoglaló doboz > 150 km²), **túl szabályos geometria** (tökéletes egyenesek, azonos szögek).

### Küszöbök és következmények

| Pontszám | Állapot | Mi történik |
|---|---|---|
| **≥ 80** | `trusted` | Azonnal feldolgozva: terület átkerül, GP jóváírva. |
| **50–79** | `pending_review` | **Az aktivitás megjelenik a profilban és a feedben** „Ellenőrzés alatt" jelöléssel — de **nem módosít birtokviszonyt**, és a GP is függőben van, amíg nem validálódik. |
| **< 50** | `rejected` | Nincs terület, nincs GP. Az aktivitás látszik, jelölve, indoklással. Fellebbezhető. |

Ez pontosan az, amit kértél: a gyanús aktivitás **nem tűnik el** (nem büntetjük az ártatlant azzal, hogy letagadjuk a futását), de **nem is nyúlhat bele a játéktérbe**, amíg nincs igazolva.

### Validálás — lehetőleg ember nélkül

A `pending_review` állapotból négy út vezet ki, ebből három automatikus:

1. **Eszköz-bizonyíték** — ha az aktivitáshoz csatlakoztatott eszköz szolgáltat pulzust, lépésfrekvenciát vagy teljesítményt, és az konzisztens, a pontszám azonnal felül a küszöbön. *(Ez egyben erős érv a konnektorok használata mellett — érdemes is így kommunikálni: „csatlakoztass órát, és a futásaid azonnal érvényesek".)*
2. **Ismerős útvonal** — ha a felhasználó ezt a kört korábban már tisztán lefutotta, a történeti jel felülírja a gyanút.
3. **Türelmi automatika** — magas felhasználói bizalom (lásd lent) esetén az aktivitás **60 perc** után automatikusan érvényesül, ha nem érkezett ellenjel.
4. **Admin döntés** — minden más eset a moderációs sorba kerül, **24 órás SLA-val**.

### Felhasználói bizalmi szint

Az egyes aktivitások pontszámából épül egy hosszú távú **felhasználói bizalom** (`users.trust`), ami a küszöböket mozgatja:

| Szint | Feltétel | Hatás |
|---|---|---|
| `new` | < 10 aktivitás | Szigorúbb küszöbök (85 / 60), nincs türelmi automatika |
| `established` | 10+ tiszta aktivitás | Alap küszöbök |
| `trusted` | 100+ tiszta aktivitás, 0 megalapozott bejelentés | Enyhébb küszöbök (70 / 40), 60 perces automatika |
| `watched` | megalapozott bejelentés vagy elutasított aktivitás után | Minden aktivitás kézi ellenőrzésre megy 30 napig |

### Fontos részletszabályok

- **A pontszám soha nem publikus.** Sem a felhasználó, sem más nem látja a számot vagy a részjelek súlyát — csak az állapotot („Érvényes" / „Ellenőrzés alatt" / „Elutasítva"). Ha a szám látszana, visszafejthető és kijátszható lenne.
- **Késleltetett érvényesítés esetén a birtokviszonyt a jóváhagyás pillanatában érvényes állapot ellen dolgozzuk fel** — nem foglalunk le területet előre. Ez néha azt jelenti, hogy a zsákmány közben elveszett; ezért kritikus a rövid átfutás (automatika 60 perc, admin 24 óra).
- **A bejelentés nem fegyver.** A közösségi jelentés csak akkor húzza le a pontszámot, ha **több, egymástól független és maga is jó hírű** felhasználótól érkezik. Egyetlen bosszúból tett bejelentés nem visz senkit ellenőrzés alá.
- **Minden pontszám naplózva** (`activityTrust` rekord: részjelek, súlyok, végeredmény, döntés). Enélkül a fellebbezés kezelhetetlen, és a küszöbök sem hangolhatók.
- **A küszöbök és súlyok az `appConfig`-ban vannak** — indulás után hangolni kell őket valós adaton, kódmódosítás nélkül.
- Ismételt, szándékos csalás → shadowban (csak magának látszik), majd tiltás, a megszerzett területek visszavonásával.

---

## Élő előnézet a kliensen

Rögzítés közben a kliens **saját maga** számol cellákat és flood fillt — ez elég gyors telefonon is (egy 2 km²-es hurok ~6 500 cella). A felhasználó azonnal látja a bezáruló területet és a becsült pontot.

A hiteles számítás mentéskor szerveroldalon fut újra, ugyanazzal a geometriai algoritmussal. A geometria determinisztikus, de a végleges cellasorsok eltérhetnek az előnézettől, mert közben más játékos foglalhatott, védhetett vagy veszíthetett területet. Mindig a sikeres mentési tranzakcióban beolvasott ownership az igazság.

# GRUNDO — Claude handoff: reinforcement / loop detection CURRENT checkpoint

> Frissítve: **2026-08-25 este**  
> Repo: `gerisann/grundo`  
> Ág: **`main`**  
> A dokumentum írásakor a kód checkpointja: **`ecc56d43432ffc8e2dbcf3728659c77667f1175f`**  
> Előzmény / architekturális háttér: `HANDOFF_CLAUDE_2026-08-25_LAB_E2E.md`  
> **FONTOS:** az előző handoff `7.9 ISMÉTELT KÖRÖK VÉDELMI SZINTJE — MÉRVE, NYITOTT` része gameplay-döntés szempontjából **ELAVULT**. A szabályt Geri azóta részletesen eldöntötte; ezt a dokumentumot tekintsd elsődlegesnek.

---

# 0. START HERE

1. Olvasd el először az `AGENTS.md`-t.
2. Utána ezt a fájlt olvasd végig.
3. A régi `HANDOFF_CLAUDE_2026-08-25_LAB_E2E.md` továbbra is fontos a compact backend, LAB E2E és production architektúra miatt, de a reinforcement/loop témában az itt leírt szabályok felülírják a régi 7.9-et.
4. A legutóbbi `ecc56d4` CI-je zöld volt:
   - app test ✅
   - app build ✅
   - server test ✅
   - server build ✅
5. A jelenlegi reinforcement munka **LAB/browser oldalon van tesztelve**. A legutóbbi core módosításokat Geri csak `deploy.sh frontend`-del vitte ki a LAB teszthez. Ne feltételezd, hogy a production Cloud Run backend ugyanezen HEAD-en fut.
6. A compact/nagy-hurok production kreditmodellre a mostani új reinforcement-szemantikát **még nem vezettük át véglegesen**. Előbb a normál res12/LAB viselkedést kell stabilizálni.

---

# 1. A GAMEPLAY-SZABÁLY MÁR ELDŐLT — NE NYISD ÚJRA

A fő elv:

> **Mindig az számít, hogy létrejött-e egy valódi, a loop-generálási szabályoknak megfelelő új bekerítés.**

Ha egy új érvényes hurok részben vagy teljesen átfedi a játékos korábbi saját területét, az átfedés **nem kizáró ok**.

## 1.1 Saját terület reinforcement

Ha egy új érvényes hurok bezárul:

- a hurok traversalének **kezdetekor már saját** cellák, amelyek az új hurok belsejében vannak → **defense +1**, max 5;
- a hurok traversalének kezdetekor szabad cellák → megszerzés 1×;
- idegen cellák → normál steal / breakthrough szabály;
- egy korábban már saját cella újra és újra erősíthető valódi új traversalekkel:

```text
1× → 2× → 3× → 4× → 5×
```

Ez akkor is igaz, ha a következő kör:

- 10–20 méterrel kijjebb fut;
- részben más nyomvonalat használ;
- nagyobb területet zár;
- csak **egy cellával nagyobb teljes külső kört** ír le.

Egy teljes, egy cellával kijjebb futó új lap **érvényes reinforcement traversal**. Ezt ne keverd össze az egy cella vastag lokális GPS-sliverekkel.

## 1.2 A már megszerzett terület lehet egy új hurok fala

A saját terület / saját korábbi nyomvonal használható egy későbbi kisebb hurok egyik oldalaként.

Példa:

```text
korábbi kék terület széle + új külső piros nyom
→ közöttük kis sárga lobe záródik
→ a sárga rész megszerezhető 1×-en
```

Ez önmagában teljesen jogos, ha a kis lobe megfelel a loop-validációs szabályoknak.

## 1.3 A nagy külső hurok nem veszhet el a köztes kis hurkok miatt

Ha a játékos a korábbi saját terület körül egy nagyobb külső kört jár be, az út közben a saját falhoz való visszaérintések / GPS-jitter miatt több kisebb hurok is bezárulhat.

**Ezek a kis hurkok NEM akadályozhatják meg a végső nagy külső hurok felismerését.**

Ha a teljes új külső traversal végül bezárul, akkor annak a huroknak is létre kell jönnie és hatnia kell a korábbi belső területre.

## 1.4 Kritikus baseline-szabály: a traversal KÖZBEN megszerzett cella nem erősödik azonnal

Ez Geri külön, explicit döntése.

Ha egy nagy külső traversal közben kisebb hurkok új cellákat szereznek, akkor a később bezáródó nagy hurok **nem adhat ezekre még egy azonnali +1 defense-et**.

Példa:

```text
A nagy traversal kezdetekor:
KÉK = már saját, defense 1
SÁRGA = szabad

menet közben kis lobe:
SÁRGA → saját, defense 1

végül bezárul a teljes nagy külső kör:
KÉK 1 → 2      ✅
SÁRGA marad 1  ✅
```

Tehát a hurok reinforcement-baseline-ja az ownership állapota **a hurok traversalének kezdetekor**.

## 1.5 Ugyanazon fizikai traversal köztes closure-ai nem farmolhatják a defense-et

Egyetlen nagy fizikai körbejárás közben több egymásba kapcsolódó / kompozit closure keletkezhet.

Ezek:

- szerezhetnek külön új területeket;
- de ugyanazt a traversal előtt már saját cellát **nem erősíthetik többször**.

A kívánt végső szemantika:

> ugyanazon fizikai traversal-epizódban egy pre-existing saját cella legfeljebb **egy** reinforcement-creditet kapjon.

**És a credit időpontja is számít:** a defense-emelkedésnek annál a closure-nál kell megtörténnie, amelyik ténylegesen befejezi a releváns nagy körbezárást — nem egy korábbi részclosure-nál.

## 1.6 Irányfüggetlenség

Azonos fizikai geometriára ugyanazt az eredményt kell kapni:

- óramutató járásával megegyező irány;
- ellenkező irány.

A loop érvényessége, a végső nagy enclosing loop megléte és a defense-kreditek **nem függhetnek a bejárás irányától**.

## 1.7 GPS-zaj

Valós GPS-zaj:

- generálhat extra kis hurokjelölteket;
- mozgathatja a H3 kontaktpontokat / gate-eket;
- nem szabad, hogy emiatt a teljes fizikai külső lap eltűnjön;
- nem szabad, hogy végtelen / mikro-loop defense farm keletkezzen.

A meglévő minimum-loop / sliver / duplicate szabályokat meg kell őrizni vagy javítani, de **nem úgy**, hogy valódi új teljes traversaleket eldobunk.

---

# 2. A RAJZOKBÓL RÖGZÍTETT KONKRÉT ESETEK

Geri három külön rajzzal pontosította a szabályt.

## 2.1 Egyszerű egymás utáni hurkok

- első hurok: saját 1×;
- külön második hurok: más terület 1×;
- harmadik nagyobb hurok részben újrafedi az elsőt:
  - korábbi saját rész → 2×;
  - újonnan bekerített rész → 1×.

## 2.2 Egy cellával nagyobb új teljes kör

Egy már birtokolt terület körül pontosan egy cellával kijjebb futó teljes új lap:

- ugyanúgy új érvényes hurok;
- korábbi belső saját cellák → +1 defense;
- új külső gyűrű → 1×.

## 2.3 Szabálytalan külső út + lokális kis hurkok + végső nagy hurok

A szabálytalan külső nyom menet közben kis hurkokat generálhat a régi saját fal és az új nyom között.

- kis hurkok új sárga részei → jogosan 1×;
- a végén a teljes piros külső nyom önmagában bezár egy nagy hurkot;
- a nagy hurok a traversal előtt már meglévő kék belső területet → +1 defense;
- a traversal közben megszerzett sárga részek → **nem** kapnak +1-et ugyanettől a nagy huroktól.

---

# 3. AMIT CHATGPT A CLAUDE-LIMIT ALATT MÓDOSÍTOTT

## 3.1 Cellaszín rendszer — elkészült és működik

Claude eredeti 16+8 implementációja után tovább lett fejlesztve.

### Normál színek — 16

```text
#DDC3A1
#E1A344
#D1712F
#BD505C
#E06E70
#CB5043
#8F3A40
#76462D
#566F49
#418D7A
#315F89
#5B4A69
#2D5653
#709EAA
#7F7F7F
#2E2E2E
```

### Pro színek — 12

```text
#2879FD
#00E4FE
#01FEA9
#FF6000
#FFD502
#E3FF00
#01FF1F
#FD012F
#FF00A8
#027501
#0D034D
#7C00FF
```

### UI

- normál 16 szín méhsejt/hexagon blokkban;
- külön 12 Pro hexagon blokk;
- hover / touch-hold preview: az adott blokk összes cellája ideiglenesen a hoverelt színre vált;
- Pro blokk külön kezelve;
- Pro mentési szabály 12 színre bővítve.

### Térkép

- minden játékos saját választott színével jelenik meg;
- rivális terület külső piros körvonala megmarad;
- bezoomolt egyedi H3 cellák is a tulajdonos választott színét használják, nem fix lila/piros role-színt;
- régi profil `cellColor` nélkül fallbacket kap (`#DDC3A1`).

### Docker build regresszió

A backend új `src/lib/cellColors.ts` importja miatt a Cloud Build elhasalt, mert a Dockerfile nem másolta be a fájlt.

Javítás:

```text
8a15c80 Backend build: cellaszín modul másolása
```

`server/Dockerfile`:

```dockerfile
COPY src/lib/cellColors.ts ./src/lib/cellColors.ts
```

A cellaszín munka utáni checkpoint egyik releváns commitja:

```text
9b6965e Régi profilok alapértelmezett cellaszíne
```

Ez a terület jelenleg nem blokkoló.

---

# 4. REINFORCEMENT IMPLEMENTÁCIÓ — EDDIGI COMMITOK

A régi `creditedAt` logikát azért kezdtük bontani, mert a spirális / nagyobb átfedő köröket minden második alkalommal kidobta.

Releváns commitlánc:

```text
9b21df4 Gameplay: érvényes átfedő hurkok reinforcementje
acee963 Teszt: nested hurok reinforcement baseline
5094516 LAB teszt: nagy hurok és köztes kis hurkok
495f52b Teszt: átfedő closure ugyanazon traversalben csak egyszer erősít
49beba1 Gameplay: átfedő closure-ok egyszeri reinforcementje
7f545ec8 LAB: élő defense előnézet futás közben
ecc56d4 Loop detector: irányfüggetlen repeat closure feloldás
```

## 4.1 `resolveSequentialLoopClaims` jelenlegi iránya

Fájl:

```text
src/game/index.ts
```

Bejött:

```text
actorAcquiredAt[cell]
```

Ez azt követi, hogy egy cella mikor került az adott aktivitáson belül az actorhoz, hogy a traversal közben megszerzett cella ne kapjon azonnali enclosing reinforcementet.

Bejött továbbá:

```text
lastReinforcement[cell]
```

és a `sameTraversalReinforcement(...)` heurisztika, hogy ugyanazon átfedő traversal-epizódban ne kapjon ugyanaz a saját cella kétszer +1-et.

Ez a végső cellaszinteket több tesztben megjavította, **de a jelenlegi megoldás szemantikailag még nem jó**, mert `first wins` jellegű: a korábbi részclosure kapja meg a reinforcementet, a későbbi enclosing closure pedig csak nem kap még egyet.

Geri live previewval kimérte, hogy ez túl korán emeli a defense-et.

## 4.2 LAB live defense preview

Commit:

```text
7f545ec8 LAB: élő defense előnézet futás közben
```

Fájl:

```text
src/admin/ScenarioSimulationMap.tsx
```

A `Player teszt` futása közben a `ProcessResult.claim.updates` vizuálisan rávetül a sandbox worldre, így a cellák `1×/2×/3×...` értéke már menet közben látszik.

Ez debug preview, nem commit.

**Ezzel vált láthatóvá a jelenlegi fő timing-hiba.**

## 4.3 `closureBlock` gate lazítás — legutóbbi kísérlet

Commit:

```text
ecc56d4 Loop detector: irányfüggetlen repeat closure feloldás
```

Fájl:

```text
src/game/loopDetection.ts
```

Korábban a repeat closure csak az előző closure konkrét eredeti gate-zónájánál oldhatta fel a blockot.

A módosítás után kellően hosszú új traversal esetén az előző lezárt régió bármely `insideClosureZone(...)` kontaktja feloldhatja a blockot és ugyanazon cellán már lefut a candidate search.

**FONTOS: ez a módosítás NEM oldotta meg véglegesen az irányfüggést / timingot. A legutóbbi manuális teszt után a hiba továbbra is reprodukálható.**

---

# 5. JELENLEGI FŐ HIBA — EZT KELL CLAUDE-NAK ÁTVENNIE

## 5.1 Az eredmény irányfüggő

Geri ugyanazt a fizikai kétfedéses / nagy enclosing geometriát két ellentétes bejárási irányban futtatta le.

Az eredmény eltért.

Egy irányban például:

```text
370 saját cella
4 closure
242 cella 1×
128 cella 2×
0 cella 3×
```

Másik irányban ugyanennek megfelelő geometriára:

```text
372 saját cella
6 closure
6 cella 1×
244 cella 2×
122 cella 3×
```

A különbség nem elfogadható. A semanticsnak irányfüggetlennek kell lennie.

## 5.2 Volt olyan fordított irányú futás is, ahol a végső nagy hurok EL SEM KÉSZÜLT

Diagnosztika egy ilyen futásnál:

```text
#1 0→46   fal 47   belső 81
#2 36→81  fal 46   belső 89
#3 24→115 fal 91   belső 175
#4 47→138 fal 92   belső 278
```

A várható végső nagy enclosing closure nem jelent meg külön olyan módon, hogy a teljes korábbi belső terület megkapja a reinforcementet.

Ez bizonyítja, hogy nem csak claim-credit könyvelési kérdésről van szó: a **loop detection / closure episode state machine** is problémás.

## 5.3 A defense még mindig TÚL KORÁN emelkedik

A live defense previewban Geri látta:

- a nagy külső kör még nincs befejezve;
- de a bal felső és jobb felső korábbi területek már `2→3`, illetve `1→2` szintre váltanak;
- ez egy köztes closure pillanatában történik;
- a kívánt szabály szerint ez a reinforcement csak a releváns nagy enclosing traversal **tényleges befejezésekor** járna.

Tehát a jelenlegi `sameTraversalReinforcement` csak a **dupla creditet** fogja meg, de nem a **helyes credit-időpontot**.

## 5.4 Korábbi konkrét #5/#6 reprodukció

Egy korábbi LAB futásban:

```text
#5: 150→220
#6: 164→258
```

A `#6` már a `#5` lezárása előtt elindult.

Korábban ez okozta:

```text
bal felső: 2 → 3 → 4   (hibás dupla reinforcement)
jobb felső: 1 → 2 → 3  (hibás dupla reinforcement)
bal alsó: 1 → 2        (helyes)
```

A `49beba1` ezt végállapot szinten megfogta, így a kívánt végállapot előállhatott:

```text
bal felső: 3×
jobb felső: 2×
bal alsó: 2×
```

**De** a live preview bizonyította, hogy a felső régiók reinforcementje a `#5`-nél történik meg, nem a végső nagy `#6`-nál. Ez továbbra is hibás.

---

# 6. MI LENNE A HELYES ARCHITEKTURÁLIS IRÁNY

Ne tekintsd ezt kötelező implementációnak; előbb olvasd végig a detektort és a teszteket. De a probléma lényege:

A jelenlegi megoldás a closure-okat azonnal könyveli, ezért amikor egy részclosure megjelenik, még **nem tudja**, hogy ugyanazon folyamatban később egy nagyobb enclosing closure fogja-e lezárni ugyanazt a fizikai traversalt.

A helyes semantics valószínűleg nem oldható meg pusztán egy újabb `if (index...)` dedupe-pal.

Érdemes explicit fogalmakban gondolkodni:

```text
closure candidate
physical traversal episode
partial/local closure
final/enclosing closure
reinforcement entitlement
reinforcement commit point
```

A kulcs:

- az új területet egy köztes kis/local closure akár azonnal megszerezheti;
- a traversal előtt már saját cellák reinforcementje viszont lehet, hogy **pending** marad az adott physical traversal episode végéig / enclosing closure-ig;
- ha ugyanazon episode később nagyobb enclosing closure-t ad, akkor ott commitolódik a +1;
- ugyanaz a saját cella egy episode-ban max egyszer;
- egy valódi következő lap új episode → új +1;
- a megoldásnak incremental/live preview kompatibilisnek kell maradnia.

Ezt Geri gameplay-szabálya alapján kell megoldani, nem pusztán a jelenlegi heurisztikát foltozni.

---

# 7. KÖTELEZŐ REGRESSZIÓS TESZTEK A KÖVETKEZŐ FIXHEZ

A fixet ne csak egy LAB screenshot alapján készítsd.

Minimum:

## 7.1 Ugyanaz a loop N-szer

```text
1× → 2× → 3× → 4× → 5×
```

Perfect + GPS-noise fixture-rel.

## 7.2 Egyre nagyobb teljes lapok

Minden új teljes lap a korábbi közös belső cellákat +1-ezi.

A cellaszám nőhet, az új gyűrű 1×.

## 7.3 Egy cellával nagyobb teljes második lap

Érvényes reinforcement, nem sliver/duplicate.

## 7.4 Nested local lobes + final enclosing loop

Traversal elején:

```text
BLUE = saját 1×
YELLOW = free
```

Menet közben local lobes:

```text
YELLOW → saját 1×
```

Final enclosing closure:

```text
BLUE → 2×
YELLOW → marad 1×
```

## 7.5 Ugyanazon physical traversal overlapping closure-ok

A `150→220` / `164→258` jellegű eset:

- ugyanaz a pre-existing saját cella csak egyszer +1;
- **a +1 a final enclosing closure időpontjában jelenjen meg**, ne a partial closure-nál.

## 7.6 Irányfüggetlenség

Ugyanazt a waypoint-geometriát futtasd:

```text
forward
reverse
```

Elvárás:

- azonos semantic closure set / equivalens claimed region;
- azonos defense histogram;
- azonos végső ownership;
- a final enclosing reinforcement mindkét irányban létrejön.

Nem szükséges, hogy a nyers `fromIndex/toIndex` számok numerikusan azonosak legyenek; a játékeredmény legyen azonos.

## 7.7 GPS-noise / gate jitter

Legalább több seed.

A final enclosing loop ne tűnjön el csak azért, mert a kapucella 1–2 H3 cellát mozdul.

## 7.8 Figure-eight / külön fizikai hurkok

Ne olvaszd össze külön, valódi fizikai hurkokat egyetlen episode-dá.

## 7.9 Sliver / corridor anti-farm

Továbbra se adjon defense-et:

- ugyanazon úton oda-vissza;
- szomszédos cellasor;
- egysoros H3 sliver;
- GPS self-touch.

---

# 8. LAB DEBUG — AMI MOST MÁR HASZNÁLHATÓ

A Scenario LAB jobb oldali panelen:

- closure count;
- `fromIndex→toIndex`;
- fal cellaszám;
- belső cellaszám;
- defense histogram;
- GPS filter reject count.

A `7f545ec8` óta a térképi cellákon **futás közben** látszik az aktuális projected `1×/2×/3×` defense.

Ez kritikus: a következő fixnél ne csak a végállapotot nézd, hanem azt a pillanatot is, amikor a defense először változik.

A kívánt timing regresszió így ellenőrizhető:

```text
partial/local closure előtt: 2×
partial/local closure után:  2×   ← reinforcement még NEM jár
final enclosing closure után: 3×  ← itt jár
```

---

# 9. FONTOS: PRODUCTION / COMPACT

A mostani reinforcement munka a normál `resolveSequentialLoopClaims` és `IncrementalLoopDetector` vonalat érinti.

A production compact backend külön infrastruktúrával rendelkezik (`claimCredits`, res9 block planner/group claim/frontier/chunked commit).

**Ne vezess át félkész semanticsot a compact production útra addig, amíg a normál LAB regressziós mátrix nem zöld.**

Ha a normál szabály stabil:

1. ugyanazt a reinforcement-credit semanticsot formalizáld közös primitívben, amennyire lehet;
2. compact pathon ugyanazt az eredményt kell kapni materializáció nélkül;
3. utána emulator E2E + stress.

---

# 10. DEPLOY / BUILD ÁLLAPOT

A legutóbbi checkpoint:

```text
ecc56d43432ffc8e2dbcf3728659c77667f1175f
```

A hozzá tartozó CI végül teljesen zöld lett.

A LAB tesztekhez Geri frontend deployt használt:

```bash
cd ~/grundo
~/grundo/scripts/deploy.sh frontend
```

A mostani gameplay-core módosításokat **ne tekintsd production backend deploynak**.

Teljes backend deploy csak akkor jöjjön, ha a szabály stabil és a server tesztek / emulator kapu rendben vannak.

---

# 11. LEGELSŐ KÖVETKEZŐ FELADAT CLAUDE-NAK

**Ne UI-val kezdj. Ne compacttal kezdj. Ne új gameplay-döntést kérj.**

Első feladat:

> A normál res12 loop detection + reinforcement pipeline-t tedd irányfüggetlenné és időben helyessé úgy, hogy a partial/local closure-ok megszerezhessék a saját új területüket, de ugyanazon physical traversal pre-existing saját területének +1 defense-e csak egyszer és a tényleges final/enclosing closure-nál könyvelődjön.

Közben kötelező megőrizni:

- repeated full lap reinforcement;
- one-cell-larger full lap reinforcement;
- traversal-start baseline;
- local lobe claim;
- sliver/jitter anti-farm;
- GPS noise tolerancia;
- figure-eight külön hurkai.

**A jelenlegi `first wins` reinforcement heurisztika nem végleges megoldás.**

---

# 12. RÖVID ÁLLAPOT EGY MONDATBAN

**A gameplay-szabály már egyértelmű: minden valódi új teljes bekerítés erősíti a traversal kezdetekor már saját, újra bekerített cellákat, miközben a traversal közbeni kis hurkokkal frissen megszerzett cellák nem kapnak az enclosing looptól azonnali +1-et; a jelenlegi motor végállapotot néha már jól ad, de a reinforcementet túl korai partial closure-nál könyveli, és ugyanaz a geometria ellenkező bejárási irányban továbbra is eltérő closure/defense eredményt ad — ezt kell most algoritmikusan rendbe tenni.**

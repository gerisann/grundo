# GRUNDO — átadás

## ÁLLAPOT

- Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`.
- Jelenlegi HEAD: `a583af0 Értesítés olvasott gesztusának javítása`.
- A 2026-08-23-i iOS terepteszt kritikus rögzítési, hurok- és push-hibáinak
  javítása elkészült; push/telepítés még nincs.
- Teljes unit teszt: **412 zöld**, 112 emulátoros teszt kihagyva. Frontend és
  backend production build zöld.

## ELKÉSZÜLT

- Natív WebView-újrainduláskor az aktív mérés automatikusan visszaáll; a JS
  leválása nem állítja le a Core Location szolgáltatást és Live Activityt.
- A Mapbox nyomvonal- és cellaforrása külön frissül. GPS-pont vagy stopper nem
  építi újra a több ezer cellás GeoJSON-t, megszüntetve a WKWebView
  újraindulásának azonosított memória/GPU-terhelését.
- A GPS élő szűrése és a játékmotor egyaránt 30 m pontossági küszöböt használ.
- Az élő előnézet minden új H3-cellánál frissül, nem öt GPS-pontonként.
- A hurok azonos vagy élszomszédos korábbi falcellánál záródik; a GPS-vonalnak
  nem kell kereszteznie önmagát. A flood fill minimuma kizárja az üres
  oda-vissza folyosót. A nyolcas második hurka is ugyanazzal a közös motorral
  számolódik élőben és mentéskor.
- Az elrabolt előnézeti cellák meglévő `stolen` rétege `#FA5F73`; a terepi
  képeken a hiányzó hurok miatt nem jött létre elrabolt előnézet.
- APNs Debugban `development`, TestFlight Release-ben `production`; Codemagic
  ezt archive előtt ellenőrzi. A backend naplózza a sikertelen FCM/APNs
  küldések platformját és hibakódját.
- A specifikáció ezekkel a döntésekkel frissült.

### UI-IGAZÍTÁSOK (2026-08-23/24)

- A rivális-lista kártyája arányos lila (`#8F5CF2`) / korall (`#FB5F73`)
  háttérrel, a két szélen címkés `+`/`−` cellamérleggel és középre tett
  avatárral készül. A szorzó jobb felső, sötét kiemelést kapott.
- A legalább egy kedvelést kapott aktivitások szíve korall (`#FB5F73`).
- A Küldetések képernyő egyszerű nézetében az időkeret és a mozgásforma
  látszik. A további tempó/sebesség, cél és irány a részletes nézetben van;
  a sebesség/tempó `− / érték / +` vezérlővel állítható. A nézetváltó és a
  Mentett küldetések együtt az alsó gombsorban vannak.
- Aktivitás-részletező: hexagon kapcsoló, aktív állapot, teljes hurokcellák
  kliensoldali visszaszámítása régi aktivitásokhoz. A Mapbox-attribúció 28 px
  feljebb és 32% opacityvel jelenik meg (jogi okból nem távolítható el).
- Feed: a hexagon kapcsoló megnyitásakor már élő `MapView` réteget használ,
  nem félrecsúszó SVG-t; a backendből érkező `activityCells` elsőbbséget kap.
- Új aktivitások `activityCells` mezőjét a normál és a darabolt backend
  feldolgozás is menti és a feed/részletező API visszaadja.
- Az értesítés olvasottra húzásának maximuma 120 px, a commit-küszöb 84 px;
  a zöld animáció lezárásakor a lokális állapot is nullázódik, így nem ragadhat
  bent a zöld sáv.

### FONTOS KORLÁT / KÖVETKEZŐ JAVÍTÁS

- Régi, már elmentett aktivitások Firestore-dokumentumában nincs
  `activityCells`. Saját, teljes track esetén a kliens ezt újraszámolja; idegen
  vagy privát útvonalnál ez nem garantálható. Ha minden régi aktivitáshoz
  pontos cellaréteg kell, külön backfill script szükséges.
- Az aktivitásonkénti cellák ma egyszínű `interior` rétegben látszanak. Az új
  és elrabolt cellák külön színéhez a backendnek cellánkénti sorsot (`free` /
  `stolen`) is kellene eltárolnia és kiadnia.

## TELEPÍTÉSI SORREND

1. Push.
2. Adatbázis-, szabály- és indexlépés nem kell.
3. A `f14317c` és `48f9fa5` óta backend **és** frontend telepítés kell az
   aktivitás-cellák éles működéséhez. A későbbi tiszta UI commitokhoz csak
   frontend kell.
4. Codemagic/TestFlight build kell a natív javításokhoz.

## KÖVETKEZŐ ELLENŐRZÉS

1. TestFlight: 10+ perc, előtér, 2D/3D, képernyőzár, visszatérés; nem jelenhet
   meg félbehagyott rögzítés.
2. Egyszerű szomszédos cellafalú hurok és nyolcas: élőben és mentés után is.
3. Rivális terület hurka: elrabolt előnézet `#FA5F73`.
4. Natív push lezárt képernyőn. Hiba esetén Cloud Run `[push]` log.
5. Értesítés: lassú balra húzás, gyors pöccintés, sikertelen hálózat esetén is
   ne maradjon zöld sáv.
6. A küldetés-útvonal minősége külön következő menet.

## MODELLJAVASLAT

Terepi ellenőrzéshez **Terra, közepes** elég; új iOS lifecycle vagy APNs
hibakód elemzéséhez **Sol, erős**.

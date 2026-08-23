# GRUNDO — átadás

## ÁLLAPOT

- Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`.
- Kiinduló HEAD: `8bfa2c4 Küldetés útvonalgeometria újratervezése`.
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

### UI-IGAZÍTÁSOK (2026-08-23)

- A rivális-lista kártyái széles, két tónusú mérleghátteret és erősebb vizuális
  hierarchiát kaptak; a rivális címke kisebb, de jobban olvasható lett.
- A legalább egy kedvelést kapott aktivitások szíve korall (`#FB5F73`), az
  értesítés olvasottra húzásának küszöbe kétszeresére nőtt.
- A Küldetések képernyő alapból egyszerű időkeret-választót mutat; a további
  cél-, irány-, tempó- és mozgásforma-beállítások a „Részletes keresés” alatt
  nyithatók meg.
- Ezek kizárólag frontend/UI módosítások; backend- vagy adatbázis-deploy nem
  szükséges hozzájuk.

## TELEPÍTÉSI SORREND

1. Push.
2. Adatbázis-, szabály- és indexlépés nem kell.
3. Backend és frontend telepítés kell.
4. Codemagic/TestFlight build kell a natív javításokhoz.

## KÖVETKEZŐ ELLENŐRZÉS

1. TestFlight: 10+ perc, előtér, 2D/3D, képernyőzár, visszatérés; nem jelenhet
   meg félbehagyott rögzítés.
2. Egyszerű szomszédos cellafalú hurok és nyolcas: élőben és mentés után is.
3. Rivális terület hurka: elrabolt előnézet `#FA5F73`.
4. Natív push lezárt képernyőn. Hiba esetén Cloud Run `[push]` log.
5. A küldetés-útvonal minősége külön következő menet.

## MODELLJAVASLAT

Terepi ellenőrzéshez **Terra, közepes** elég; új iOS lifecycle vagy APNs
hibakód elemzéséhez **Sol, erős**.

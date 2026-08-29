# GRUNDO útvonalmotor (GraphHopper)

Ez a mappa a küldetés-ajánló útvonalmotorjának konfigurációja. A motor **saját
üzemeltetésű GraphHopper 11** (Apache 2.0), magyar OpenStreetMap-kivonattal.

## Miért nem a Mapbox

A Mapbox Directionsnek **nincs kör-generálása**: mértani körpontokat kellett
kötelező köztes pontként ráerőltetni, azokat pedig sorrendben, legrövidebb úton
kötötte össze. Mérés (2026-08-29, 3 helyszín, 3 eset, 204 jelölt):

| | Mapbox (a régi lánc) | GraphHopper |
|---|---|---|
| hibátlan jelölt (0 U-forduló, 0 kerülő) | 1 / 204 | 14 / 216 |
| kanyar 2,5 km-es futókörön | 14–20 | 7–8 |
| átlagos egyenes szakasz | 117–354 m | 264–443 m |
| bringakör köralakja (kör = 1,00) | 0,06–0,11 | 0,08–0,39 |
| kérés ára és ideje | fizetős, 100–200 ms | ingyenes, 14 ms |

A 14 ms a lényeg: körönként több tucat jelöltet generálhatunk, és a **saját
pontozásunk** választ közülük (bezárt terület, hibátlanság, hosszeltérés,
kanyarszám).

Három olyan eszköz van benne, ami a Mapboxban elvileg sincs:

- `algorithm=round_trip` — kör adott hosszra (`round_trip.distance`,
  `round_trip.seed`, `headings`), `ch.disable=true` mellett;
- `turn_penalty` a `change_angle` szerint — ez adja a felületen a
  **„kanyargós / hosszú egyenesek"** választást, kérésenként;
- egyedi útsúlyozás OSM-tulajdonságokból (`road_class`, `bike_network`,
  `surface`, `smoothness`, `max_speed`, `urban_density`), lásd
  `custom_models/`.

## Helyi futtatás

Két letöltés kell (egyik sincs verziókövetve):

```bash
curl -L -o graphhopper-web-11.0.jar https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/11.0/graphhopper-web-11.0.jar
```

```bash
curl -L -o hungary-latest.osm.pbf https://download.geofabrik.de/europe/hungary-latest.osm.pbf
```

Indítás ebből a mappából (Java 17+ kell; a gépen a Firebase-emulátorhoz
telepített Temurin 21 megfelel):

```bash
java -Xmx4g -jar graphhopper-web-11.0.jar server config-grundo.yml
```

Az első indítás importál (Magyarország: néhány perc). Utána a `graph-cache`
mappából indul másodpercek alatt. **A konfiguráció módosítása után töröld a
`graph-cache` mappát**, különben a régi gráffal indul.

Mért méretek (2026-08-29, teljes Magyarország): a gráf a lemezen **184 MB**, a
futó szerver **~1,5 GB** memóriában (6 GB-ot kapott). Élesben ez kicsi
konténer, nem nagygép.

## Amibe bele fogsz futni

- **`snap_prevention` vesszős listát nem fogad** GET-ben: ismételni kell
  (`&snap_prevention=ferry&snap_prevention=motorway`). Vesszővel néma
  `Cannot find snap_prevention` hibát ad, és nulla jelölt jön.
- **A kanyarbüntetéshez három dolog kell együtt**: `orientation` az
  `graph.encoded_values` listában, a profilon `turn_costs` **nem üres**
  `vehicle_types`-szal, és `allow_turn_penalty_in_request: true`. Bármelyik
  hiányzik → a szerver a kérést utasítja vissza, nem a konfigurációt.
- **A `round_trip` a kért hosszat közelíti**, nem tartja pontosan (mérve
  7,5 km-re 5,8–8,9 km). Ezért kell a jelöltek közül a hossz szerinti szűrés,
  ahogy eddig is.
- A kanyarköltséges (`turn_costs`) profil lassabb: ugyanaz a kérés 14 ms
  helyett ~250 ms. Ha ez élesben szűk lesz, a `profiles_lm` (landmark)
  előkészítés a megoldás.

## Élesítés

Külön Cloud Run szolgáltatás vagy kis VM, a gráffal a képbe sütve — a
`#19`-es menet feladata. A kliens felé sosem nyílik meg: csak a `server/`
hívja, belső címen.

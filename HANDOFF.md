# GRUNDO handoff

> Frissítve: **2026-08-29** · átadás a **GRUNDO #17** menetből a **#18**-ra
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · ez a menet **kódot nem változtatott**: mérés, döntés,
> specifikáció és az útvonalmotor konfigurációja került be.

## ⚠️ ELSŐ OLVASNIVALÓ

**1. A területmegjelenítés ügye LEZÁRVA.** Az előző handoff figyelmeztetése
elavult; éles adaton ellenőrizve 2026-08-29-én:

- a `territoryBlobs` composite index **READY** (mezők: `layer, level, tile,
  areaM2, __name__`), a 24 éles index között;
- a végpont lekérdezés-alakja éles adaton **lefut, nincs `FAILED_PRECONDITION`**,
  valódi tile-okra 9 foltot ad vissza (68 174 … 307 m²);
- a **backfill lefutott**: 14 folt, mind 2026-08-29 08:10:01–08:10:04 CEST
  között írva, 5 tulajdonos/réteg csoportban (kötegelt futás lenyomata).

Nincs teendő. A térkép **vizuális** ellenőrzése (kizoomolva látszanak-e a
területek) továbbra is Gerire vár, de az adatút bizonyítottan él.

**2. A küldetés-ajánló élesben nem ad útvonalat.** A felület minden kérésre az
`no_routes` üzenetet adja („Az útvonaltervező most nem adott vissza útvonalat
erről a pontról"). Amit kizártam méréssel:

- **nem kódhiba**: ugyanaz a `planLoop` a fejlesztői gépről **72/72** kérésre
  adott útvonalat, 100–200 ms-mal, a `.env.local` tokenjével;
- **nem elavult telepítés**: a `directions.ts` 2026-08-23 óta változatlan, a
  backend 08-28 23:34-kor települt, tehát élesben ez a kód fut;
- **nem elállított hangolható konstans**: az éles `appConfig/gameplay`
  `overrides` mezője üres;
- **nem hiányzó változó**: a `MAPBOX_TOKEN` létezik a Cloud Runon (ha üres
  lenne, a `directions_unavailable` 503 menne, más szöveggel).

Marad a szerverre telepített token értéke, URL-korlátozása vagy a Mapbox-kvóta.
A Cloud Run környezetének kiolvasását a jogosultság-osztályozó blokkolta, ezért
**Geri futtatja Cloud Shellben** (a fejlesztői gépen működő token 93 karakter,
`pk.eyJ1IjoiZ` kezdetű):

```bash
gcloud run services describe grundo-api --region=europe-west1 --project=grundo --format=json | python3 -c "import json,sys;e={v['name']:v.get('value','') for v in json.load(sys.stdin)['spec']['template']['spec']['containers'][0]['env']};t=e.get('MAPBOX_TOKEN','');print('token hossz:',len(t),'eleje:',t[:12]);open('/tmp/mbtoken','w').write(t)"
```

```bash
curl -s -o /dev/null -w '%{http_code}\n' "https://api.mapbox.com/directions/v5/mapbox/walking/19.0537,47.4979;19.0600,47.5000?access_token=$(cat /tmp/mbtoken)"
```

200 → a token jó, a Mapbox-fiók oldalán a limit. 401/403 → rossz vagy
korlátozott token. **Ez rövid távú javítás**: a #18-as menetben az egész motor
lecserélődik, és a Mapbox kikerül a küldetés-ajánlóból.

## A MENET FŐ EREDMÉNYE: DÖNTÉS AZ ÚTVONALMOTORRÓL

Geri panasza (cikcakk, 180 fokos visszafordulás, fölösleges hurok) mérve
igazolódott, és **szerkezeti**, nem hangolási kérdés. A Mapbox Directions nem
tud kört generálni; mértani körpontokat kényszerítettünk rá kötelező köztes
pontként, azokat pedig sorrendben, legrövidebb úton kötötte össze.

**A jelenlegi lánc, 204 jelölten (3 helyszín, 3 eset):**

| eset | hibátlan jelölt | köralak (medián) | kapott hossz |
|---|---|---|---|
| futás 2,5 km | 1 / 56 | 0,32–0,48 | 2,2–4,1 km |
| futás 7,5 km | 0 / 59 | 0,30–0,56 | 5,9–14,6 km |
| bringa 16 km | 0 / 89 | **0,04–0,05** | 15,5–27,4 km |

(„Köralak" = a bezárt terület az azonos hosszú szabályos körhöz mérve; 1,00 a
tökéletes kör. Egy 16 km-es bringakör tehát a lehetséges terület 4–5 %-át zárja
be.)

**Ugyanez saját GraphHopperrel** (Magyarország OSM, helyi szerver), mindkét
oldalon a legjobb jelöltet választva:

| eset | hely | GraphHopper (köralak · kanyar · átlag egyenes) | Mapbox |
|---|---|---|---|
| futás 2,5 km | Deák tér | 0,42 · 8 · **264 m** | 0,69 · 14 · 149 m |
| futás 2,5 km | Budaörs | **0,79** · 7 · **324 m** | 0,60 · 20 · 117 m |
| futás 7,5 km | Deák tér | 0,59 · 21 · **304 m** | 0,64 · 30 · 206 m |
| futás 7,5 km | Budaörs | 0,48 · 21 · **314 m** | 0,55 · 38 · 171 m |
| bringa 16 km | Deák tér | **0,22** · 50 · 303 m | 0,06 · 59 · 277 m |
| bringa 16 km | Budaörs | **0,39** · 54 · 265 m | 0,06 · 58 · 263 m |

- hibátlan (0 U-forduló, 0 kerülő) jelölt: **14 / 216** a GraphHoppernél,
  **1 / 216** a Mapboxnál;
- kanyarból feleannyi, egyenes szakaszból 1,5–2,7-szer hosszabb — **és ez még a
  kanyarbüntetés bekapcsolása előtt**;
- bringán 3–6-szoros bezárt terület;
- **14 ms / kérés** (357 kérésen mérve) a Mapbox 100–200 ms-jával szemben, és
  ingyen: körönként több tucat jelölt generálható, a választást a saját
  pontozásunk végzi.

**Miért nem hosztolt szolgáltatás:** a GraphHopper ingyenes csomagja nem
kereskedelmi célra szól (500 kredit/nap, egy körkérés 2 kredit), a kereskedelmi
€69/hó-tól indul 1 kérés/mp korláttal; az openrouteservice ingyenes kulcsa napi
2000 irány-kérés, szintén nem kereskedelmi. A motor maga **Apache 2.0**, tehát
saját konténerben korlátlanul és díjmentesen futtatható — ez illik ahhoz is,
hogy a jelöltgenerálást bőkezűen akarjuk használni.

**Mapboxon belül nincs megoldás:** a Directionsnek nincs kör-generálása, az
Optimization API `roundtrip=true` paramétere pedig más feladat (megadott
pontokat jár be és tér vissza), nem hurokgenerálás.

### A kanyargós ↔ hosszú egyenesek kapcsoló — mérve

A kanyarbüntetés (`turn_penalty` a `change_angle` szerint) bekapcsolva,
ugyanazon a jelöltkészleten:

| eset | hely | kanyargós (kanyar · átlag egyenes · terület) | hosszú egyenesek |
|---|---|---|---|
| bringa 16 km | Deák tér | 37 · 375 m · 3,16 km² | **26 · 518 m** · 1,12 km² |
| bringa 16 km | Budaörs | 58 · 249 m · 6,59 km² | **33 · 487 m** · 1,46 km² |
| futás 7,5 km | Budaörs | 21 · 350 m · 1,98 km² | 20 · 331 m · 1,82 km² |

**A kapcsoló működik, és van ára**: bringán 30–43 %-kal kevesebb kanyar és
40–95 %-kal hosszabb egyenesek, cserébe **lényegesen kevesebb bezárt terület**
(a tempózható kör keskenyebb). Ezt a felületen ki kell mondani, nem elrejteni:
a „hosszú egyenesek" kevesebb területet hoz. Futásnál a különbség kicsi.
⚠️ A két oszlop rangsorolása szándékosan más volt (terület, illetve egyenes
hossz szerint), tehát ez irány, nem tizedespontos összevetés.

### Amit a saját motor ezen felül tud (Geri kérései a menetből)

- **Bringázhatóság valódi adatból**: `road_class` (van-e kerékpárút),
  `bike_network` (kerékpáros útvonalhálózat), `surface`, `smoothness`,
  `max_speed`, `urban_density`; az egyirányúságot a profil betartja.
  ⚠️ Valódi **forgalomszám nincs** az OSM-ben — az úttípus, sávszám és
  sebességkorlát a közelítés; fizetős forgalmi adat autós torlódást mérne, nem
  bringás kényelmet, ezért nem javasolt.
- **AI szerepe**: a geometriát ne az AI adja (nem ismeri az úthálózatot).
  Ahol értelme van: szándék → paraméter („van 45 percem, lapos, ne legyen
  forgalmas"), és a küldetés megfogalmazása/elnevezése. A kiválasztás maradjon
  determinisztikus, mert mérhető.
- **Saját hőtérkép**: a rögzített aktivitások celláiból idővel tudjuk, hol
  futnak/bringáznak ténylegesen az emberek — ez a jelöltek pontozásában
  használható, külső szolgáltató nélkül.

## AMI BEKERÜLT A REPÓBA EBBEN A MENETBEN

- `graphhopper/` — a motor konfigurációja, két egyedi modell (futás/bringa) és
  README a helyi futtatással, a mért számokkal és a buktatókkal.
- `docs/02-funkcionalis-spec.md` — a küldetés-ajánló szakasza átírva a saját
  motorra, plusz három új, dátumozott döntés: **útvonal-karakter kapcsoló**,
  **utólagos hüvelykujjas értékelés**, **élő útszakasz-visszajelzés** (a
  tracking képernyő szakaszában, a gombok pontos helyével).
- `AGENTS.md` — a mappaszerkezetben megjelenik a `graphhopper/`.

**Kód nem változott**, tehát telepíteni sincs mit.

## A KÖVETKEZŐ MENETEK — GERI JÓVÁHAGYTA A SORRENDET

1. **#18 — a GraphHopper bekötése + a kanyargós/egyenes kapcsoló.** Ez egy
   munka: szolgáltató-réteg a `server/src/lib/directions.ts` helyén
   (`GRAPHHOPPER_URL` env, Mapbox marad tartaléknak), `round_trip` alapú
   jelöltgenerálás sok jelölttel, a saját pontozás kiterjesztése kanyarszámmal
   és átlagos egyenes szakasszal, a felületen a karakterválasztó. A
   `loopWaypoints`-os geometria a Mapbox-ághoz tartozik, nem kell átvinni.
2. **#19 — élesítés**: a GraphHopper konténerbe (gráf a képbe sütve), Cloud Run
   vagy kis VM. A #18 e nélkül nem élesíthető.
3. **#20 — utólagos hüvelykujj** a küldetés-kártyán (kicsi).
4. **#21 — élő útszakasz-visszajelzés** és a tervezői felhasználása.

### Nyitott kérdések a következő menetekhez

- **Az élő útszakasz-visszajelzés alapból be- vagy kikapcsolva induljon?**
  (Enélkül nem gyűlik adat, viszont két gomb helyet foglal a térképen.)
- **Hol fusson a motor élesben**: Cloud Run min-instance=1, vagy kis VM? A mért
  igény: gráf 184 MB lemezen, futó szerver ~1,5 GB memóriában (6 GB-ot kapott),
  tehát kicsi gép is elég.
- **Kell-e landmark (LM) előkészítés?** Kanyarköltséges profillal a kérés
  14 ms-ról 75–250 ms-ra lassul. Több tucat jelöltnél ez már számít.
- A `round_trip` a kért hosszat **közelíti** (7,5 km-re 5,8–8,9 km) — a hossz
  szerinti szűrés tehát marad, ahogy eddig is.

## ELLENŐRZÉSEK

Ebben a menetben nem változott kód, tehát tesztfutás sem volt. A legutóbbi
ismert állapot (#16): kliens `vitest` 387 sikeres, szerver 165 sikeres
(122 emulátoros kihagyva), `npx tsc --noEmit` mindkét oldalon tiszta.

A mérőszkriptek a `tmp/` alatt maradtak (nincsenek verziókövetve):
`probe-matrix.ts` (Mapbox-lánc), `probe-graphhopper.ts` (round_trip),
`probe-compare.ts` (három stratégia egymás mellett), `probe-final.ts`
(kanyargós/egyenes). A `tmp/` takarítása után a `graphhopper/README.md`
alapján újra előállíthatók.

## HELYI FEJLESZTŐI KÖRNYEZET

Változatlan (emulátor + seed + dev szerver):

```bash
firebase.cmd emulators:start --only auth,firestore --project demo-grundo
```

```bash
cd server && npm run dev:emulator
```

```bash
npm run dev:emulator
```

Belépés: `geri@grundo.local` / `grundo-emulator`, vagy a böngészőkonzolból
`await __grundoDevSignIn()`. Teszt-világ: `npm run seed:budapest -- --reset --count 1000` a `server/` mappából.

**Új**: az útvonalmotor helyi indítása a `graphhopper/README.md` szerint (két
letöltés, majd `java -Xmx4g -jar graphhopper-web-11.0.jar server config-grundo.yml`).
A Git Bash PATH-ja nem látja a Javát, ezért kell elé:
`export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"`.

## NYITOTT KISEBB ÜGYEK

- **295 KB-os válaszcsúcs** a 33–66 km-es térképnézetben minden mozgatásnál.
  Wi-Fi-n észrevehetetlen, mobiladaton érezhető. Olcsó javítás: erősebb
  körvonal-egyszerűsítés távoli nézetre, vagy kliensoldali gyorsítótár.
- A foltok háttérsora Cloud Runon elveszíthet egy frissítést, ha a példány a
  válasz után leáll; védőháló a `backfill:territory-blobs` időzítése.
- `MAX_BLOCKS_PER_USER = 400` a foltszámolásban — nagyon nagy birodalomnál
  hiányos folt. Ma nem éles probléma.
- A **natív alkalmazások** ikonja csak új buildben cserélődik (`npx cap sync`
  + Codemagic).
- Natív **Android Google-belépés** készüléken még nincs visszaigazolva; a Play
  Console / Play App Signing beállítása szándékosan későbbre maradt (az app
  signing SHA-1-et fel kell venni a Firebase Android apphoz, és frissíteni a
  `google-services.json`-t a Codemagic Secretben).
- Windows alatt az iOS SPM auth-plugin symlink `EPERM`-mel kimaradt; a macOS
  Codemagic `npx cap sync ios` lépésének kell létrehoznia.
- Android 13+ engedélyág, lezárt kijelzős hosszú út, appváltás,
  szünet/folytatás, offline pontsor, FCM és OEM akkumulátorkezelés terepi
  ellenőrzése.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

- **#18 bekötés és felület**: **Sonnet, normál mélység** — a döntés megvan, ez
  meglévő minta kiterjesztése és UI-munka.
- Ha a jelöltpontozás hangolása vagy mért anomália kerül elő (nem stimmelnek a
  hosszak, gyanúsan kevés a tiszta jelölt): **Opus, emelt mélység**.

## FORRÁSOK SORRENDJE

1. `AGENTS.md` — különösen a Munkamódszer szakasz
2. `HANDOFF.md` (ez a fájl)
3. `graphhopper/README.md` — a motor, a mért számok és a buktatók
4. `docs/02-funkcionalis-spec.md` → Küldetés-ajánló és Élő útszakasz-visszajelzés
5. `server/src/routes/missions.ts` és `server/src/lib/directions.ts` fejlécei

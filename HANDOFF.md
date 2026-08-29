# GRUNDO handoff

> Frissítve: **2026-08-29** · a **#20** menet vége, átadás **#21**-re
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` (EGYETLEN klón — a második
> `Documents\ChatGPT\GRUNDO` törölve) · GitHub: `gerisann/grundo`
>
> Ág: **`main`**, MÉG NEM pusholva (Geri dolga). **GraphHopper élesítve és
> bizonyítottan működik.** A #20 menetben javítva: GPS-drift hamis
> aktivitás, a cellák látható betöltődése, a nagy bringakör+meglévő birtok
> "nincs küldetés" hibája (ÉLŐ PREVIEW ÉS A KÜLDETÉS-AJÁNLÓ IS), a
> küldetés-ajánló kevés találata (MÉRVE: a blokk-plafon volt az ok), az
> 1-5 találatszám beállítás, az ADATVÉDELMI útvonal-levágás (az egész
> útvonal eltűnt), a HEXAGON-kitöltés nagy hurkoknál, admin oldalak
> szélessége, dock háttere/border-je és 50/50 arány. `npx tsc --noEmit`
> tiszta, teljes `npx vitest run`: 568/691 sikeres (123 kihagyva, nincs
> regresszió — egy ÚJ teszt emulátor hiányában kihagyva, lásd lent).

## #20 MENETBEN JAVÍTVA

### GPS-drift hamis aktivitás — MEGOLDVA

A #19 diagnózisa (telefont zárolt képernyővel egy órán át hagyva, meg sem
mozdulva, az app 2,99 km futást és 703 m emelkedést rögzített) alapján:

- **Horgony (anchor) alapú távolságszámítás.** Új tunable:
  `GAMEPLAY.GPS_STATIONARY_RADIUS_M = 12` (`src/config/gameplay.ts`). Amíg
  egy minta ezen a körön belül marad egy rögzített horgonyhoz képest, a táv
  nem nő és a horgony nem mozdul — csak TARTÓS elmozdulásnál "ébred fel".
  Ez a régi pontpáronkénti `MIN_MOVE_M` szűrő hibáját oldja: egy 5-15 m-es
  beltéri ugrás önmagában mindig "elfogadható" volt, és sok ilyen összeadva
  adta a hamis kilométereket.
  - `src/tracking/recorder.ts`: `applySample` (O(1) append eset) és az új
    `anchoredTotal()` (újraszámolási eset + `currentSpeedMps`) — utóbbi
    javítja az induláskori hamis 10-20 km/h-t is.
  - `src/tracking/filter.ts`: `FILTER.STATIONARY_RADIUS_M` a közös
    konstansra mutat.
  - `src/game/splits.ts`: `computeSplits` és `elevationProfile` UGYANEZT a
    horgonyt használja — ez oldja az `ELEVATION_NOISE_M` hamis emelkedését
    is, horizontális elmozdulás nélkül nincs szintszámítás.
  - Új tesztek: `src/tracking/recorder.test.ts` ("GPS-horgony" leírás, 2
    teszt: egy órányi beltéri zajra 0 a táv, valódi 200 m-es séta viszont
    pontosan mérve) és `src/game/presentation.test.ts` (beltéri zaj sem
    táv-, sem szintsort nem ad).
  - **NEM lett bevezetve**: `altitudeAccuracy` a típuslánchoz — a horgony
    már horizontális szinten kiszűri az indoor esetet, ez elegendőnek tűnt
    a mért esetre. Ha később kiderül, hogy VALÓDI (kültéri, mozgó) aktivitás
    ad hamis emelkedést, ez még mindig nyitott továbblépés.

### Grund-térkép: cellák látható betöltődése — MEGOLDVA

`src/screens/TerritoryScreen.tsx`: új `padView()` a `loadTiles()`-ban, a
`tiles`-hívás határát 2,5×-ösére tolja ki minden irányban
(`TILE_PREFETCH_PAD = 0.75`, azaz +75% mindkét oldalon), MIELŐTT elmegy a
szerverre — a `blobs`-hívás változatlan (előszámolt egység, nem kell). A
válaszméret-hatást (nagy nagyításnál sok cella, kicsi nagyításnál nagy
terület) **még nem mértük élesben** — érdemes ránézni, ha a `/api/tiles`
válaszidő vagy méret gyanúsan megnő.

### Nagy bringakör + meglévő birtok = nincs küldetés — MEGOLDVA (KÉT HELYEN)

A gyanú beigazolódott, és KÉT különálló helyen ugyanaz a gyökérok
jelentkezett — a motor (`src/game/index.ts` `processActivityGeometry`)
SZÁNDÉKOSAN dob, ha a hurok compact belsejű (nagy hurok, `hasCompactLoop`)
ÉS `ownership.size > 0` — ez majdnem MINDIG igaz, mihelyt a játékosnak van
bármi birtoka a közelben, hiszen a valódi elszámolás csak a szerver
blokkos útján (`server/src/routes/activities.ts` `requiresChunkedClaim`)
történhet.

1. **Élő preview rögzítés közben** — `src/screens/TrackingScreen.tsx`
   `preview` (kb. 190. sortól) VALÓDI `nearby` ownershippel hívta a motort;
   a `catch` ág ezt "GPS-ugrásnak" félreértelmezve némán nullázta a
   preview-t (0 claim, 0 GP), miközben a feltöltés után a terület
   ténylegesen bekerült.
2. **A KÜLDETÉS-AJÁNLÓ maga** — ez a SÚLYOSABB, mert Geri screenshotjain
   ez látszott: 50 km és 150 km célhossznál a jelöltek geometriája/távja
   kiszámolt (a "SZÁMÍTÁS" kártyák helyes km-t mutattak), de a VÉGSŐ lista
   üres lett, "Most nincs ajánlható küldetés" — mert `server/src/lib/
   missionEvaluate.ts` `evaluateCandidate` a jelöltet VALÓDI (Firestore-ból
   olvasott) ownershippel adta át a motornak, ami minden nagy hurkos
   jelöltre dobott; a `catch` ág `null`-t adott vissza MINDEGYIKRE, a
   `pickMissions` pedig üres listát ad, ha nincs egyetlen használható
   jelölt sem.

Mindkét helyen ugyanaz a javítás: ha a geometria compact belsejű
(`hasCompactInterior`), üres `Map()` ownershippel hívjuk a motort — ez az
"üres világ" (LAB-szerű) becslést adja, pontos GP-vel és cellaszámmal,
csak a lopott/visszafoglalt cella MEGKÜLÖNBÖZTETÉSE (és ezáltal a `raid`/
`fortify` küldetés-karakter) vész el nagy huroknál. Élő preview-nál ez a
térképen csak a hurok fal/határsávjának kirajzolását jelenti (a compact
belső parent-cellák vizuális megjelenítése nincs bekötve — lásd NYITOTT
ÜGYEK).

⚠️ **Új emulátoros regressziós teszt íródott** (`server/src/lib/
missionEvaluate.emulator.test.ts` → "nagy (compact belsejű) hurok MEGLÉVŐ
birtok mellett is ad küldetést"), DE a #20 menetben a Firestore emulátor
8081-es portja már foglalt volt (másik munkamenet futtatta) — a tesztet
NEM sikerült lefuttatni éles emulátor ellen, csak `tsc` igazolja, hogy
fordul. **Első dolog #21-ben**: `firebase.cmd emulators:exec --only
firestore --project demo-grundo "npx vitest run server/src/lib/
missionEvaluate.emulator.test.ts"` (a Java PATH-csapdára lásd AGENTS.md).

### Admin oldalak szélesség-maximalizálása — MEGOLDVA

`src/admin/admin.css` `.admin__body`: a `max-width: 900px; margin: 0 auto;`
törölve. A `/admin/lab` már korábban is felülírta ezt (`simulation-
lab.css` `:has(.lab-shell)`), az a szabály most redundáns, de nem árt.

### `.dock` háttér/border — MEGOLDVA

`src/components/Dock.css:19-21`: `background: none; border: none;` (a
`border-radius`, `box-shadow`, `backdrop-filter` és a `.dock--blend`/
`.dock--paused` állapotváltozatok érintetlenek, mert Geri kifejezetten csak
a háttért és a bordert kérte).

### Küldetés-ajánló: kevés/egyetlen ajánlat — MEGOLDVA, MÉRVE

Geri #20-as bejelentése: „100 km fölött először bead két opciót, de mire
befejezi a számítást, már csak 1 marad", és „csak 1 rajtaütés + 1 hódítás".

**MÉRVE, nem tippelve** (`src/game/` próbaszkript, azóta törölve):

- A HASONLÓSÁG-SZŰRÉS ÁRTATLAN: két nagy budapesti kör átfedése **0,0027**,
  meg sem közelíti a 0,6-os küszöböt. A korábbi gyanú téves volt.
- **A VALÓDI OK a blokk-plafon**: egyetlen 113 km-es kör **431 res9 blokkot**
  érint — már önmagában a `MAX_OWNERSHIP_BLOCKS = 400` FÖLÖTT —, két ilyen
  kör együtt 844-et. A `limitByBlocks` ezért mindig eldobta a második
  jelöltet. Referencia-számok: 63 km → 230 blokk, 31 km → 118, 12,5 km → 42.
- A plafon célja a Firestore-olvasás korlátozása. De a compact (nagy)
  jelöltekhez a mai javítás óta EGYETLEN blokkot sem olvasunk (üres
  ownershippel értékeljük őket) — vagyis pont azok buktak el egy keretet,
  amit nem is használtak.

**Javítás** (`server/src/lib/missionEvaluate.ts`): a `ShapedCandidate` kap egy
`compact` mezőt (a `shapeCandidateCells` tölti), a `limitByBlocks` a compact
jelölteket kihagyja a plafonból, az `evaluateShapedCandidates` pedig a
`loadOwnership` cellahalmazából is — kevesebb olvasás, több ajánlat.
**Igazolva ugyanazzal a méréssel: ugyanaz a két nagy kör most 2 ajánlatot ad
(hódítás + felfedezés) az eddigi 1 helyett.**

⚠️ **Ami MEGMARAD korlátnak**: 100 km fölött a `shapedCandidateLimit`
(`routes/missions.ts`) teljesítményi okból csak **2 jelöltre** futtatja a
drága geometriát (200 km → 15,9 s/jelölt), tehát ott a gyakorlati plafon 2
ajánlat, akármennyit kér a felhasználó. 30 km alatt 6, 100 km-ig 4. Ezt nem
emeltem — előbb mérni kellene, elfér-e a válaszidőben.

### Találatszám 1–5 — KÉSZ

Geri régi kérése bekötve: a részletes kereső „Hány ajánlatot kérsz?"
steppere (`GAMEPLAY.MISSION_RESULT_DEFAULT/_MIN/_MAX` = 3/1/5), a `limit`
végigmegy az API-n (`generateMissions`, `missionsPlan`, `missionsEvaluate`)
a `pickMissions`-ig.

A szám FELSŐ KORLÁT, ahogy Geri kérte: a `pickMissions` első menete a
szigorú (karakterenként egy ajánlat), és ha az kevesebbet ad, egy második
menet ugyanazt a KARAKTERT is kiosztja másodszor, valamint 0,75-ig lazít az
átfedés-küszöbön. ⚠️ **0,75-nél megáll, mérésből**: a „tíz közös cella,
egyikben eggyel több" teszteset Jaccard-értéke 0,909, tehát egy magasabb
lépcső ugyanazt a kört adta volna vissza kétszer, más címkével — pont az a
csapda, ami ellen az eredeti küszöb véd.

### Elsődleges cél — RÉSZBEN javítva, korlátjával együtt

`prioritizeMissions` eddig CSAK sorrendezett a kész listán. Mostantól a
`pickMissions` is megkapja a `priority`-t, és a kért karakter választ először
a jelöltek közül — így ha egy kör rajtaütésre ÉS erősítésre is alkalmas, a
kért karakter viszi el, nem az, amelyik a saját mezőnyében kiugróbb.

⚠️ **Amit ez NEM old meg, és Geri esete valószínűleg ez**: ha EGYETLEN
jelölt sem megy át a saját területén, az „erősítés" pontszáma
(`kindScore` → `counts.reclaimed`) mindenhol nulla, tehát ilyen ajánlat nem
létezik — a beállítás nem tud elővarázsolni nem létező kört. Ehhez az
útvonal-GENERÁLÁSNAK kellene a saját terület felé irányítania (a
`missionBearings` ma vakon oszt nyolc irányt), és a felületnek meg kellene
mondania, ha a kért karakterre nem sikerült ajánlatot találni. Egyik sincs
kész — **ez a küldetés-ajánló következő érdemi köre.**

### Aktivitás-adatvédelem: az EGÉSZ útvonal eltűnt — MEGOLDVA, MÉRVE

Geri bejelentése: egy 17 km-es, háromhurkos aktivitás teljes útvonala rejtve
volt 200 méteres beállítás mellett; kikapcsolva láthatóvá vált.

**OK** (`src/game/privacy.ts` → `trimPrivateEnds`): a VÉGI vágás összefüggő
szakaszt vett, az ELEJI viszont a teljes nyomvonalat végignézve az UTOLSÓ
rajt-közeli pontig vágott. Egy útvonal, amely menet KÖZBEN visszatér a rajt
közelébe (több hurok, oda-vissza szakasz), így a visszatérésig elveszett.
Mérve, szintetikus nyomvonalakon:

| alak | elveszett |
|---|---|
| egyszerű kör, közbenső visszatérés nélkül | 14 % (ez a helyes) |
| hurok + 3,5 km-es második kör | 44 % |
| hurok + 1,5 km-es második kör | 66 % |
| hurok + 600 m-es második kör | 84 % |
| hurok + 350 m-es második kör | 90 % |

**Javítás**: az eleje is összefüggő szakaszként vágódik, ÉS a megmaradó
nyomvonalból a védőkörbe eső pontok mindenhol kimaradnak (a vonal egyenes
húrral vág át a körön). Így a védelem szándéka megmarad — a védőkörből nem
szivárog ki pont —, de nem visz magával fél útvonalat. Mérés a javítás után:
5-10 % veszteség. A meglévő adatvédelmi tesztek (köztük a „visszatérő
szakaszt is levágja") változatlanul zöldek.

⚠️ `PUBLIC_ROUTE_VERSION` **2 → 3**: enélkül a MÁR MENTETT aktivitások
tévesen elrejtett útvonala úgy maradt volna. A `publicRouteNeedsRebuild`
ebből tudja, hogy újra kell építeni — lekéréskor magától megtörténik.

### Hexagon-kitöltés: a „nyolcas" alsó fele üres — MEGOLDVA, ÉLES ADATON MÉRVE

Geri bejelentése ugyanarra az aktivitásra. **Éles Firestore-olvasással
mérve** (`77cbb397…`, olvasó szolgáltatásfiók):

- 3 hurok: #0 = 30 cella, #1 = 4 134 cella, **#2 = 15 745 cella → COMPACT**
- a tárolt `activityCells`: **6 582**, a valódi foglalás **15 745**
- **hiány: 9 163 cella (58 %)** — pontosan a compact hurok belseje, ezért
  volt a nagyobbik hurok kitöltetlen, a kisebbik pedig kitöltve
- ráadásul az API `slice(0, 5000)` a tárolt 6 582-t is megnyirbálta

Ok: a `candidateCells` compact huroknál SZÁNDÉKOSAN csak a falat és a
határsávot tartalmazza (a belsőt a parentek képviselik) — de a kliens ebből
rajzol. Mérve: a hiányzó 9 163 cellát **85 index, ~1 kB** írja le tömören.

**Javítás**: új `activityCellParents` mező (H3-compactolt, ≤ res10) a mentés
mindkét útján, az API továbbadja, a kliens `expandActivityCells()`-szel
bontja ki res12-re (`src/lib/activityCells.ts`, saját tesztekkel). Az
`activityCells` plafonja 5 000 → 20 000, a parenteké 4 000.

A RÉGI aktivitásokhoz **migrációs szkript készült**:
`server/src/scripts/migrateActivityCellParents.ts`. Csak MEGJELENÍTÉSI
mezőt ír (`activityCells`, `activityCellParents`), foglalást/GP-t nem
számol újra, és idempotens. Olcsó előszűrője a `claimCounts`-ot hasonlítja
a tárolt cellaszámhoz, tehát csak az érintetteken futtat geometriát.

⚠️ **ÉLES DRY-RUN LEFUTOTT** (2026-08-29, olvasó fiókkal): 40 aktivitásból
2 jelölt, **1 valóban javítandó** — pont a bejelentett `77cbb397…`:
`tarolt=6582 -> cellak=6582 + parentek=85`, **9 163 pótolt cella**. Az írás
Gerié, Cloud Shellben:

```bash
cd ~/grundo/server && npm run migrate:cell-parents -- --apply --allow-production
```

(`--limit N` kapcsolóval előbb néhány darabon is kipróbálható. A kliens
visszaesési ága addig is számol parenteket a nyomvonalból, de a NÉZŐ csak a
levágott nyomvonalat kapja, ezért migráció nélkül a kitöltés közelítő.)

### Rivális-sáv a felhasználó SAJÁT cellaszínével — KÉSZ

Geri kérése (2026-08-29): az aktivitás-kártyák alján futó sáv ne a rögzített
lila-magenta párost használja, hanem a `/beallitasok/megjelenes` oldalon
választott cellaszínt.

**Értelmezés (Geri választotta):** mindenki a SAJÁT színén jelenik meg,
ugyanaz az elv, mint a térképen — a bal (nyert) sáv az aktivitás szerzőjéé, a
jobb a riválisé. Amelyik fél nem választott színt, annak az oldala marad a
megszokott lila/korall; **oldalanként külön dől el.**

- Szerver: az `Author` objektum kap egy `cellColor` mezőt (`null`, ha nincs
  választva). **Extra Firestore-olvasás nélkül** — ugyanabból a user
  dokumentumból jön, amit a név/kép miatt már beolvasunk.
- ⚠️ `cellColorHexOrNull()` az új segéd (`src/lib/cellColors.ts`), NEM a
  meglévő `cellColorHex()`: utóbbi a hiányzó értékre az alapértelmezett
  palettaszínt adja, amivel nem lehetne megkülönböztetni a "nem választott"
  esetet attól, aki történetesen a bézst választotta.
- A színátmenet megmarad: a CSS `color-mix()`-szel képez sötétebb és
  világosabb végpontot EGY hexből, így nem kell palettánként három árnyalatot
  karbantartani. Az arányok (76 % sötét / 64 % világos) az EREDETI lila
  gradiensből számolva — az első próbám (62 %) egy eleve sötét színt szinte
  feketévé tett, ezt böngészős színpróbán láttam meg.
- **AZONOS SZÍN mindkét oldalon**: ilyenkor a sáv egyetlen összefolyó folt
  lenne, ezért a bal oldal a szín VILÁGOSABB, a jobb a SÖTÉTEBB tartományában
  marad (`rival-row--twin`). Geri külön kérte, böngészőben ellenőrizve.
- Bekötve az aktivitás-kártyán. A `RivalsCard`/`RivalsSheet` (profil, TOP 3)
  ugyanezt a komponenst használja, de oda a szerver ma nem küld cellaszínt —
  ott tehát a megszokott megjelenés marad, amíg valaki be nem köti.

⚠️ **TANULSÁG, ami eddig hiányzott a dokumentációból**: a repo gyökerében
futtatott `npx tsc --noEmit` **NEM ellenőrzi a `server/` mappát**. A szerver
külön: `cd server && npx tsc --noEmit`. Ez a körben három valódi típushibát
fogott meg, amit a gyökér-ellenőrzés zölden átengedett.

### Dock: 50/50 arány és a húzásos felirat — KÉSZ

Geri kérése (2026-08-29): a két oldalsó gomb újra egyforma széles (a 40/60
helyett), így a Play gomb pontosan középen ül. Húzásos befejezésnél
(`finishGesture === 'swipe'`) az „Új kör" és a „Befejezés" felirata 15 → 13
px, a „Befejezés" bal padding-ja 22 → 40 px. Az „Új kör" a
`.dock__center:has(.swipe-finish)` szelektorral van módhoz kötve — a
„Befejezés" felirata (`.swipe-finish__label`) eleve csak ebben a módban
létezik.

## NYITOTT TÉMA — küldetés-ajánló, ami MÉG hátravan

1. **A kért „Elsődleges cél"-ra nincs visszajelzés, ha nem teljesíthető** —
   lásd fent. Az irányított generálás + felületi üzenet együtt egy önálló kör.
2. **GPS-ingadozás → más eredmény ugyanarra a kérésre.** Mérve: 10-20 m
   eltolt kiindulópont 1 vs. 3 kártyát ad. Javaslat (még nem kezdve): a
   kiindulópont rácsra kerekítése a küldetés-generáláshoz.
3. **Sík / emelkedős választó.** GraphHopperrel megoldható, de domborzati
   adat (SRTM) és TELJES újraimportálás kell hozzá — külön, hosszabb kör.
   **Ez a felületen ma NINCS ott, és nem is volt** — Geri #20-ban kereste.
4. **100 km fölött a jelöltszám 2** (`shapedCandidateLimit`) — ez korlátozza
   a találatszám-beállítást. Emeléshez előbb újramérni a geometria idejét az
   élesített GraphHopperrel.
5. **Az `activityCellParents` migrációt LE KELL FUTTATNI** — a szkript kész
   és éles dry-runon igazolt, de az írás még nem történt meg (lásd fent a
   parancsot). Amíg nem fut le, a régi nagy hurkok kitöltése idegen nézőnél
   közelítő marad.

## ÉLESBEN FUT — ELLENŐRIZVE

### GraphHopper (ÚJ ebben a menetben, működik)

Külön Cloud Run szolgáltatás (`grundo-graphhopper`), a gráf BUILD KÖZBEN
épül fel (`graphhopper/Dockerfile` → `import`), `--no-allow-unauthenticated`.
A `grundo-api` Google-aláírt ID-tokennel hívja a metaadat-szervertől
(`server/src/lib/directions.ts` → `graphhopperIdToken`, saját kulcs/Secret
Manager nélkül).

**Élőben igazolva**: `POST /route` → `200 OK` a `grundo-graphhopper`
naplójában, pontosan a küldetés-generálás időpontjában. Kanyargós/egyenes
karakter eltérő útvonal-hosszakat ad (7,3/6,9/6,9 vs 7,2/8,2/7,5 km).

⚠️ **Telepítés csak ritkán, külön paranccsal**:
```bash
~/grundo/scripts/deploy.sh graphhopper
```
NEM része az `all` módnak — a gráf csak OSM-frissítésnél vagy a
`graphhopper/` mappa változásakor épül újra (percekig tart).

**Egyszeri beüzemelés (MÁR MEGTÖRTÉNT, dokumentálva ha meg kell ismételni):**
1. `gcloud run services add-iam-policy-binding grundo-graphhopper --region=europe-west1 --member="serviceAccount:65689674957-compute@developer.gserviceaccount.com" --role="roles/run.invoker"`
2. Backend újratelepítése `--substitutions=_GRAPHHOPPER_URL=https://…`

⚠️ **Csapda, amibe belefutottunk és javítva**: a `deploy.sh` mód-ellenőrzése
a `git pull` ELŐTT volt, ezért egy elavult helyi másolat sosem jutott el
odáig, hogy frissítse magát — új módot (mint a `graphhopper`) a régi
szkript nem ismert, és azonnal elhalt, `info` sorok nélkül. JAVÍTVA
(`de98101`): az ellenőrzés a dispatch `case` végén van, a pull UTÁN.
**Ha ismét „Ismeretlen mód" jön minden `▸` sor nélkül**: `cd ~/grundo &&
git pull` kézzel, utána a szkript már önmagától is frissül.

Mért hidegindítás: ~8-15 s hosszú szünet után (nullára skálázva), utána
percekig meleg. Összemérhető a backend saját hidegindításával (~12 s).

### Küldetés-ajánló (a #19-ből, változatlanul él)

Gyors fázis + lassú fázis szétválasztva, ~0,7-0,8 s meleg állapotban. Lásd
a #19/#20-as HANDOFF-tartalmat a git történetben, ha a részletek kellenek
(`git show b149cdf:HANDOFF.md` stb.) — ez a fájl a hellyel spórolva csak a
MOST aktuális állapotot tartja.

### Mapbox token — megoldva, Secret Managerből jön

`MAPBOX_TOKEN` a Secret Managerből (`--set-secrets`), a telepítés nem tudja
kiütni. Csere: `gcloud secrets versions add MAPBOX_TOKEN --data-file=-` +
újratelepítés, kódváltozás nélkül. Élesben a KLIENS token fut szerveroldalon
(közös, nem korlátozott) — külön szerver token még nyitott, kis prioritású
ügy.

## KISEBB, KÉSZ JAVÍTÁS EBBEN A MENETBEN

**Stepper mezők** (`src/screens/MissionsScreen.tsx`, `missions.css`):
kézzel gépelhetők (eddig csak −/+), és az érték a doboz KÖZEPÉN áll, nem a
szélén (`size` attribútum a tartalomhoz igazítva, mérve: 0 px eltérés a
középtől minden értéknél).

## NYITOTT ÜGYEK

1. 300 km-es kérésnél a gyors fázis is ~17 s (16 GraphHopper-hívás egyszerre)
   — GraphHopper élesítése után érdemes újramérni, lehet, hogy javult. Még
   nem mérve.
2. Android: Codemagic build + készülékes teszt még nem történt meg.
3. **A nagy/compact hurok élő preview-ja csak a fal/határsávot rajzolja ki**
   (lásd fent, „Nagy bringakör…" — MEGOLDVA rész). A GP-szám pontos, de a
   compact belső parent-cellák vizuális kirajzolása nincs bekötve. Ha Geri
   ezt is látni akarja élőben: `result.compactClaim` kellene átadni a
   `HexMap`-nek/`MapView`-nak, réteges (parent-szintű) rendereléssel. Nincs
   megbecsülve, mekkora munka.

## ELLENŐRZÉSEK

- `npx tsc --noEmit` mindkét oldalon tiszta.
- Teljes `npx vitest run`: 559 sikeres, 123 kihagyva — nincs regresszió (4 új
  teszttel bővült: `recorder.test.ts` GPS-horgony leírás [2], `presentation.
  test.ts` beltéri zaj eset [1], `missionEvaluate.emulator.test.ts` nagy
  compact hurok + meglévő birtok [1, emulátor nélkül kihagyva — lásd fent]).
- GraphHopper Dockerfile: NEM lett helyben lebuildelve (nincs helyi Docker),
  csak a `gcloud builds submit` igazolta — az sikerrel lefutott élesben.
- Éles kéréssel igazolva: küldetés-generálás, kanyargós/egyenes eltérés,
  Cloud Run napló (`POST /route` → 200).
- A #20 menet fenti javításai (GPS-horgony, tiles-bbox, compact-preview,
  admin szélesség, dock) valós telefonon/böngészőben MÉG NINCSENEK
  kipróbálva — csak tsc + vitest igazolja őket.

## FORRÁSOK SORRENDJE

1. `AGENTS.md` — Munkamódszer szakasz, és az ÚJ „natív appok" rész
2. `HANDOFF.md` (ez a fájl)
3. `src/config/gameplay.ts` → `GPS_STATIONARY_RADIUS_M` — a GPS-drift javítás
   közös konstansa
4. `src/tracking/recorder.ts` — `applySample`, `anchoredTotal`,
   `currentSpeedMps`
5. `src/game/splits.ts` — `computeSplits`, `elevationProfile`
6. `server/src/lib/missionEvaluate.ts` — `evaluateCandidate` (a küldetés-
   ajánló "nincs küldetés" hibájának VALÓDI helye)
7. `graphhopper/README.md` → Élesítés — ha a GraphHopper-t kell újratelepíteni
8. `server/src/lib/directions.ts` → `graphhopperIdToken`

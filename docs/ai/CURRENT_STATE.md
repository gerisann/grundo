# Jelenlegi állapot

> Frissítve: **2026-09-11** · Menetszám: **nem megadott · lezárva**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **main** · funkció-HEAD: **d2bdcd0**
> Utoljára dolgozott: **Codex (modell/erősség nem ismert)**
> Átadva: **Codex**

## Jelenlegi cél

A Route Intelligence első navigációs szelete elkészült: a Küldetésekből
indított útvonal manőverekkel kerül a vezetett rögzítésbe, ahol GRUNDO és
Navigáció nézet között lehet váltani. Az iOS egyszeri helymeghatározási hibája
készüléken visszaigazolva javult. A következő fő cél a domborzat és az
adatforrással igazolható preferenciaszűrő/rangsorolás.

## Elkészült

- Route Intelligence dokumentáció: architektúra, adatmodell, adatforrások,
  fázisokra és mérési kapukra bontott megvalósítási terv.
- GraphHopper `instructions: true` és Mapbox `steps=true`; közös szemantikus
  `RouteManeuver` normalizálás, API-kompatibilitás és tesztek.
- Tartós vezetési csomag geometriával és manőverekkel; hibás régi adatok
  eldobása az útvonal elvesztése nélkül.
- Helyi `RouteProgressEngine`: útvonalra vetítés, monoton haladás, következő
  manőver, hátralévő táv, ETA-alap és opcionális eltérésállapot.
- Két indítás: központi Play = szabad rögzítés; Küldetés `Indítás most` =
  vezetett rögzítés, alapból Navigáció nézettel.
- Egyetlen MapView két megjelenítéssel. GRUNDO nézetben cellák/statisztika és
  egysoros navigáció; Navigáció nézetben nagy manőverpanel, megtett/hátralévő
  táv és ETA. Nézetváltás nem indít új rögzítést vagy map loadot.
- Mindkét nézetben elérhető szünet/befejezés; navigációs panel lekerekítése,
  elválasztók eltávolítása, ikonközpontosítás, 2D/3D aktuális állapot felirat,
  némítás és főszálmérő közös vezérlőoszlopa.
- Mobil küldetéskereséshez natív helyzet-timeout és érthető hibakezelés;
  `cloudbuild.yaml` GraphHopper alap-URL-je nem ürül ki standard deploykor.
- iOS bridge-regisztráció javítva: a storyboard a
  `GRUNDOBridgeViewController`-t indítja, ezért a helyi pluginek betöltődnek.
  Geri készüléken visszaigazolta: a Grund/Rögzítés pozícióra ugrik, a
  Küldetések találatot ad, a `localhost` engedélykérés nem tért vissza.
- Natív készülékirány iOS-en `CLHeading`, Androidon rotation vector alapon;
  a pozíciópont iránynyila álló helyzetben is követi a készüléket. A szenzor
  háttérben leáll, webes geolokációt nem hív.
- Külön `1D` preferenciaszűrő munkacsomag: elsődleges stratégia, terepprofil,
  kombinálható jellemzők és konfliktusmátrix. Ez még terv, nem kész UI.
- Forrásdöntés: első körben OSM + saját GRUNDO-előzmény + DEM; Google Maps nem
  pontozási adatforrás. Zaj és forgalom csak sikeres licenc/lefedettség PoC után.

## Módosított fájlok (`976e92b..d2bdcd0`, 6 commit)

| Fájlcsoport | Állapot | +/− | Tartalom |
|---|---|---:|---|
| `docs/02*`, `docs/README`, `docs/routing/*` | ÚJ/M | +614/−0 | Route Intelligence teljes tervezési gerince és preferenciaszűrő |
| `server/src/lib/directions*`, `missionEvaluate`, `routes/missions` | M | +346/−18 | manőveres GraphHopper/Mapbox válasz és API-normalizálás |
| `cloudbuild.yaml` | M | +5/−7 | GraphHopper deploy-alapérték megőrzése |
| `ios/App/**`, `android/app/**` | ÚJ/M | +278/−1 | iOS pluginregisztráció és két natív irányszenzor |
| `src/types`, `lib/api`, `ghostRoute`, `routeProgress` + tesztek | ÚJ/M | +491/−10 | közös séma, vezetési csomag és helyi haladásmotor |
| `MapView*`, `useDeviceHeading`, `deviceHeading*`, `currentPosition*` | ÚJ/M | +366/−4 | mobil helyzet/irány kliensoldala és pozíciónyíl |
| `TrackingScreen`, `MissionsScreen`, kapcsolódó CSS | M | +450/−69 | vezetett indítás, két nézet és navigációs UI |
| **Összesen** | **34 fájl** | **+2550/−109** | — |

## Élesben fut / telepítetlen

- A `dbfb423` iOS helyplugin-regisztráció új buildben, készüléken működik.
- A vezetett navigáció korábbi buildjeit Geri tesztelte; a jelzett UI-hibák a
  `4b9dd06` commitban javítva vannak.
- A `d2bdcd0` natív heading commit az `origin/main` része, de belőle még nincs
  visszaigazolt iOS/Android készülékes build.
- A headinghez frontend- vagy backend-deploy nem kell; új natív build kell.
- A `643932b` GraphHopper URL deploy-konfigurációja repóban van, de az éles
  Cloud Run környezeti értékét a következő backend-telepítés előtt újra mérni kell.

## Ellenőrzések

- `npm run test`: **912 zöld**, 181 skip.
- Kliens és szerver `tsc --noEmit`: zöld; produkciós frontend build: zöld.
- Android heading `javac` és Capacitor Android sync: zöld.
- A teljes Gradle-build Windows-fájlzáron bukott, nem Java fordítási hibán.
- iOS Capacitor sync a helyi SPM-symlink Windows-jogosultságán jelzett hibát.
- **NEM ellenőrzött:** iOS-fordítás; valós heading pontosság, kalibráció,
  forgatás, mágneses zavar, háttér/előtér és különböző kijelzőméretek.

## Nyitott ügyek — javasolt sorrend

1. Új iOS és Android build a `d2bdcd0` commitból; heading készülékes mátrix.
2. Budapesti útvonal-korpusz és alapmérések: idő, fallback, manőver, átfedés.
3. `1D` preferenciaszűrő statikus UI + verziózott kérésmodell és konfliktusteszt.
4. Copernicus DEM PoC, GraphHopper elevation és terepprofilos árnyékrangsor.
5. OSM út-, világítás-, kereszteződés- és zöldjellemzők importja, coverage-dzsel.
6. Kedvelt, kerülendő és új szakaszok aggregálása manipulációs méréssel.
7. Budapest zaj/forgalom licenc-, frissesség- és lefedettség-PoC-ja.
8. Útvonalelhagyás mérése, kézi újratervezés és WebView-helyreállítás.
9. Domborzati GP árnyékmérés; aktiválás csak külön jóváhagyás után.
10. Éles GraphHopper URL és fallback arány ellenőrzése backend deploy előtt.

## Modelljavaslat

DEM/adatpipeline, pontozás és mérési korpusz: **Astra, Erős**. A jóváhagyott
preferenciamodell UI-jához: **Terra, Közepes**.

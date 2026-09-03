# Jelenlegi állapot

> Frissítve: **2026-09-03** · GRUNDO **#28** optimalizálási menet
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**

## Jelenlegi cél

Az 5–10+ km-es rögzítéseknél növekvő térképi akadozás megszüntetése Android-
prioritással, közös iOS/web megoldással. A fix méretű render-munkakészlet, a
grafikai profilok, valamint a külön 3D látótávolság elkészült; a következő
kötelező lépés a hosszú, valódi készülékes mérés Androidon és iOS-en.

## Elkészült

1. **Fix méretű térképi munkakészlet** (`src/components/MapView.tsx`,
   `src/lib/mapRender.ts`). A teljes nyomvonal és a teljes cellageometria
   továbbra is megmarad az elszámoláshoz, de Mapbox GeoJSON-ba csak a kamera
   kivágása + 8–30% profilfüggő ráhagyás kerül. Élő rögzítésnél ezt metszi a
   pozíció körüli beállított sugár. A cellákat a drága H3-poligonépítés előtt
   vágjuk, a kitöltés és körvonal ugyanazt a már szűrt listát használja.
2. **Látható útvonalszakaszok és ritkítás.** A kamerahatár két oldalán egy-egy
   pont megmarad, ezért a vonal nem szakad le a képernyő szélén. Low/Medium
   módban 4×/2× pont-ritkítás fut csak a renderpéldányon; a rögzített adat nem
   változik. A 20 000 pontos szintetikus tesztből Low módban 60-nál kevesebb
   pont kerül a renderkimenetbe.
3. **Beállítások → Grafika oldal.** Low, Medium, High és Ultra minőség, külön
   250–2000 m-es render-sugár, valamint új, 250–5000 m között 50 méterenként
   állítható **Viewing Distance (3D)** érhető el. Mindhárom beállítás
   eszközön tárolódik. A menü, szöveg, logó és játékszámítás nem változik.
4. **Méteres 3D látótávolság és fokozatos perem.** A Viewing Distance a döntött
   kamera zoomját skálázza: kétszeres méterérték pontosan egy zoomszinttel
   távolabbi nézet. A 3D térkép távoli széle témához illő szürke ködbe olvad;
   2D-re váltva az alaptérkép eredeti ködbeállítása áll vissza. A render-sugár
   és a 3D látótávolság egymástól független marad.
5. **Android-kímélő Low/Medium profil.** Low: nincs térképi átmenet, szabad
   háttérrács, védelmi címke, 3D épület és kisebb POI; 24 csempés cache és 5 s
   útvonalfrissítés. Medium: nincs 3D épület, 40 csempés cache, 4 s frissítés.
   High őrzi a korábbi vizuális alapminőséget; Ultra nagyobb előtöltést,
   cache-t és MSAA-t enged.
6. **Dokumentáció:** a funkcionális specifikáció és a tartós renderdöntés
   mindkét térképi távolság pontos szerepével frissítve.

## Ellenőrzések

- Célzott tesztek: **12/12 zöld** (`graphicsSettings.test.ts`,
  `mapRender.test.ts`), beleértve a látótávolság normalizálását, korlátait és a
  zoomskálázást.
- Teljes Vitest: **714 zöld, 137 kihagyva** (79 fájl zöld, 13 kihagyva).
- Gyökér TypeScript: tiszta; `server/` TypeScript: tiszta.
- Production build: sikeres. A Grafika chunk 3,30 kB (gzip 1,36 kB), a
  MapView chunk 20,32 kB (gzip 7,03 kB).
- Böngészős vizuális QA: a Grafika oldal és a 3D köd világos/sötét témán
  rendben; a 250 m, 1000 m és 5000 m beállítás skálázza a kamerát; 2D-ben
  nincs hozzáadott köd. A tesztállapot sötét témára és 1000 m-re visszaállt.
- `git diff --check`: tiszta.

## Amit készüléken kell mérni

1. Androidon legalább 10–20 km-es rögzítés High, majd Low profillal: FPS/jank,
   WebView memória, hőmérséklet és akkufogyás; különösen Samsung/Xiaomi
   készüléken.
2. Ellenőrizni, hogy gyors kanyar, 2D/3D és menetirány-követés közben nincs
   üres térképszél a beállított ráhagyással, továbbá a 250 m-es és 5000 m-es
   3D látótávolság használható marad eltérő képernyőméreteken.
3. iOS-en ugyanilyen hosszú rögzítés és memóriaellenőrzés; háttérből
   visszatérés és térképstílus-váltás után a rétegek és a köd maradjanak meg.
4. Low/Medium profilon vizuálisan ellenőrizni a POI- és 3D-rétegcsökkentést a
   tényleges éles Mapbox stílusokkal.

⚠️ Natív build és valódi 10+ km-es terepmérés ebben a menetben nem készült;
platformviselkedésről ezért még nincs készülékes bizonyíték. Natív Java/Swift
kód nem változott: a közös Capacitor/WebView térképréteg optimalizálása hat
mindkét platformra.

## Módosított fájlok

`docs/02-funkcionalis-spec.md` · `docs/ai/DECISIONS.md` ·
`docs/ai/CURRENT_STATE.md` · `src/components/MapView.tsx` ·
`src/lib/graphicsSettings.ts` és tesztje · `src/lib/mapRender.ts` és tesztje ·
`src/screens/settings/GraphicsScreen.tsx` · `src/styles/tokens.css`

Az optimalizálási implementáció a `main` ágra commitolva és felpusholva. A
munkafa a menet lezárásakor tiszta.

## Telepítés

Frontend-, backend- vagy natív telepítés nem történt.

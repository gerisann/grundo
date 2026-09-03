# Jelenlegi állapot

> Frissítve: **2026-09-03** · GRUNDO **#28** optimalizálási menet
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**

## Jelenlegi cél

Az 5–10+ km-es rögzítéseknél növekvő térképi akadozás megszüntetése Android-
prioritással, közös iOS/web megoldással. A kód és a webes ellenőrzés elkészült;
a következő kötelező lépés a hosszú, valódi készülékes mérés Androidon és iOS-en.

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
3. **Új Beállítások → Grafika oldal** (`GraphicsScreen.tsx`): Low, Medium,
   High, Ultra minőség és 250–2000 m-es kirajzolási sugár, eszközön tárolva.
   A profilok csak a térképi animációt, cella-/útvonalrészletet, GeoJSON-
   toleranciát, csempe-cache-t és alaptérképi rétegeket változtatják; menüt,
   szöveget, logót és játékszámítást nem.
4. **Android-kímélő Low/Medium profil.** Low: nincs térképi átmenet, szabad
   háttérrács, védelmi címke, 3D épület és kisebb POI; 24 csempés cache és 5 s
   útvonalfrissítés. Medium: nincs 3D épület, 40 csempés cache, 4 s frissítés.
   High őrzi a korábbi vizuális alapminőséget; Ultra nagyobb előtöltést,
   cache-t és MSAA-t enged.
5. **Dokumentáció:** a funkcionális specifikáció és a tartós renderdöntés
   frissítve (`docs/02-funkcionalis-spec.md`, `docs/ai/DECISIONS.md`).

## Ellenőrzések

- Célzott tesztek: **9/9 zöld** (`graphicsSettings.test.ts`,
  `mapRender.test.ts`).
- Teljes Vitest: **711 zöld, 137 kihagyva** (79 fájl zöld, 13 kihagyva).
- Gyökér TypeScript: tiszta; `server/` TypeScript: tiszta.
- Production build: sikeres. Az új Grafika chunk 2,45 kB (gzip 1,19 kB), a
  MapView chunk 19,45 kB (gzip 6,75 kB).
- Böngészős vizuális QA: Grafika oldal világos és sötét témán rendben; Low–
  Ultra váltás és csúszka működik; a rögzítési Mapbox nézet konzolhiba nélkül
  betöltött.
- `git diff --check`: tiszta.

## Amit készüléken kell mérni

1. Androidon legalább 10–20 km-es rögzítés High, majd Low profillal: FPS/jank,
   WebView memória, hőmérséklet és akkufogyás; különösen Samsung/Xiaomi
   készüléken.
2. Ellenőrizni, hogy gyors kanyar, 2D/3D és menetirány-követés közben nincs
   üres térképszél a beállított ráhagyással.
3. iOS-en ugyanilyen hosszú rögzítés és memóriaellenőrzés; háttérből
   visszatérés után a térképi rétegek maradjanak meg.
4. Low/Medium profilon vizuálisan ellenőrizni a POI- és 3D-rétegcsökkentést a
   tényleges éles Mapbox stílusokkal.

⚠️ Natív build és valódi 10+ km-es terepmérés ebben a menetben nem készült;
platformviselkedésről ezért még nincs készülékes bizonyíték. Natív Java/Swift
kód nem változott: a közös Capacitor/WebView térképréteg optimalizálása hat
mindkét platformra.

## Módosított fájlok

`docs/02-funkcionalis-spec.md` · `docs/ai/DECISIONS.md` ·
`docs/ai/CURRENT_STATE.md` · `src/App.tsx` · `src/components/MapView.tsx` ·
`src/hooks/useGraphicsSettings.ts` · `src/lib/graphicsSettings.ts` és tesztje ·
`src/lib/mapRender.ts` és tesztje · `src/screens/settings/SettingsScreen.tsx` ·
`src/screens/settings/GraphicsScreen.tsx` · `graphics.css`

Az implementáció a `29c7c6f` commitban a `main` ágra felpusholva. A munkafa
a menet lezárásakor tiszta.

## Telepítés

Frontend-, backend- vagy natív telepítés nem történt.

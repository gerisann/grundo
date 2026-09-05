# Teljesítmény-célok — a rögzítés optimalizációjának fókusza

> Rögzítve: **2026-09-05** · Geri megfogalmazása alapján, Claude Sonnet 5
> Ez a dokumentum **a célt** rögzíti, nem a módszert. A módszertani tervet lásd:
> [terv-2026-09-05-rogzites-hangolas-es-test-lab.md](terv-2026-09-05-rogzites-hangolas-es-test-lab.md).

Cél: minden GRUNDO-teljesítmény-munkát ehhez a hét ponthoz köss vissza, hogy a
mérések és javítások ne szóródjanak szét. Ha egy javaslat egyik pontra sem
felel, kérdezd meg, mielőtt belevágsz.

## A hét cél

| # | Cél | Mit jelent | Státusz (2026-09-05) |
|---|---|---|---|
| 1 | **Gyors indulás rögzítéskor** | a Tracking-képernyő megnyitása és az első GPS-fix közti idő rövid | **mérve, 5 minta** — 1512 / 3139 / 3232 / 3239 / 3305 ms, medián **3232 ms**, átlag **2885 ms** (Samsung SM-G780F, 2026-09-05, `tracking.timeToFirstFix`) |
| 2 | **Hosszú rögzítés stabilitása** | sok km / hosszú idő alatt se lassuljon, ne akadjon | **részben mérve, ÚJ gyökérok azonosítva (2026-09-05, 2. futás)** — ugyanaz a scenario, ugyanaz a worker-teljesítmény (`preview.total` átlaga/p95-e még JOBB is lett: 8,92/11,6 ms a reggeli 11,49/44,5 ms helyett), mégis a teljes wallclock **609,8 s volt 236,2 s helyett (×2,6)**. A worker tehát NEM hibás — a különbség a **térképrajzolásból** jön: Geri élőben kikapcsolta a hexagon-réteget → azonnal ~2× gyorsult, majd a teljes térképet kikapcsolta → tovább gyorsult. Lásd alább, „Mapbox-rétegrajzolás". **Hiányzik:** a térképrajzolás önálló mérőszáma (ma csak A/B megfigyelés, nem számszerűsített). |
| 3 | **Magas hurokszám stabilitása** | sok hurok/cella esetén se lassuljon, ne akadjon | **mérve, a worker-oldal rendben** — Game Loop scenario 2, 2. futás: 17 hurok, 14 799 cella, `preview.total` max **327,9 ms** (worker szálon, nem blokkolja a főszálat — `FŐSZÁL küldés` végig <10 ms). A látható akadás nem innen jön (lásd 2. pont) |
| 4 | **Sima mérés** | a GPS-mintavétel/feldolgozás ne akadozzon a UI-tól függetlenül | nincs önállóan mérve — a 2–3. pont mérése ezt is érinti, de nincs elkülönítve |
| 5 | **Gyors, akadásmentes háttér→előtér váltás** | app-visszatéréskor ne legyen látható szünet/dermedés | mérve, ismert ok — **859 ms-os blokk** háttérből visszatéréskor, kötegelt GPS-feldolgozásból ([archive](archive/2026-09-04-terepi-fosszal-meres.md)) |
| 6 | **Pontos adat lezárt telefon (screen-off) alatt** | kikapcsolt kijelzővel is pontosan rögzítsen | **első valódi minta, könnyű terhelésnél** — Samsung SM-G780F, valódi lezárás (Doze), a natív `BackgroundLocationPlugin` már **8 másodperccel a zárolás után** mintát adott (`Notifying listeners for event location`), tehát a háttér-GPS zárolva is működik. **Hiányzik:** hosszú (10+ perces) zárolás, sok felgyűlt ponttal — ez csak állva, pár perces zárolással volt tesztelve (12 pont összesen) |
| 7 | **Ébredéskor ne fagyjon le** | a lezárás alatt felgyűlt adat feldolgozása induláskor ne blokkoljon | **első valódi minta, könnyű terhelésnél** — ébredéskor a felület azonnal reszponzív volt (Szünet/Befejezés gombok éltek), a visszatérési feldolgozás **46,9 ms** volt. **Hiányzik:** a súlyos eset — sok (több száz) felgyűlt minta egyszerre történő feldolgozása ébredéskor, ami a valódi kockázat (lásd az 5. pont 859 ms-os blokkja) |

Összefoglalva: **optimalizáció** — mind a hét pont ugyanarra a gyökérre megy
vissza, a `src/game/` motor és a köré épülő adatfeldolgozás terhelésére és
ütemezésére.

## Amit még nem tudunk

- Az 1. pont 5 mintája **1,8 másodperces szórást** mutat (1512–3305 ms)
  ugyanazon a készüléken, ugyanott — a leggyorsabb futás majdnem fele a
  leglassúnak. Nincs viszonyítási alap (mi számít jónak egy Android GPS-nél),
  és nem tudjuk, a szórás forrása a hardver (meleg/hideg fix) vagy a kód.
- A 4. pontra **nincs mérési adat** — saját mérési helyzet kell hozzá.
- A 6. és 7. pont csak **könnyű terheléssel** (12 pont, pár perces zárolás)
  van tesztelve — a valódi kockázat (sok felgyűlt pont ébredéskor, mint az
  5. pont 859 ms-os blokkja) még nincs reprodukálva zárolt képernyőn.
- A mentési út (kliens feltöltés + szerveroldali `activityCommit`) **teljesen
  méretlen** — ez a 2. és 4. pontot is érinti.
- **A Mapbox-rétegrajzolás a fő gyanúsított rögzítés KÖZBEN is, nem csak
  utólagos megtekintésnél.** Két külön mérés mutatja ugyanazt:
  1. Az aktivitás-UTÓLAGOS megtekintésnél (148 717 cellás jamal-aktivitás)
     főszál-blokkoláson át ÖSSZEOMLASZTOTTA az appot — javítva, lásd
     [DECISIONS.md](DECISIONS.md), „Térképi teljesítmény".
  2. RÖGZÍTÉS közben (Game Loop scenario 2, 25 km, 100×, 2026-09-05, 2. futás)
     a wallclock ×2,6-ra nőtt (609,8 s / 236,2 s), miközben a worker-oldali
     `preview.total` NEM romlott. Geri élő A/B-je igazolta: hexagon-réteg ki
     → ~2× gyorsabb; teljes térkép ki → még gyorsabb.
  **Hiányzik:** a térképrajzolás (`setData`, GPU-feltöltés) önálló mérőszáma
  a `perfMeter`-ben — enélkül csak A/B megfigyelés van, nem szám.

## Eszköz a folytatáshoz

**Game Loop scenario 4** (`1000>1@0.9`, lásd `gameLoopScenarios.ts`): 1000×
lejátszás az útvonal 90%-áig, utána 1×-re lassul (~6-7 perc valós idő egy
már 8+ hurkos, sok cellás állapotban) — Geri kérése, arra való, hogy a
térképrajzolás költsége VALÓS ütemben, de gyors felfutás után legyen
megnézhető, a teljes ~68 perc végigvárása nélkül.

## Kapcsolódó dokumentumok

- [terv-2026-09-05-rogzites-hangolas-es-test-lab.md](terv-2026-09-05-rogzites-hangolas-es-test-lab.md) — mérőpad, pályakorpusz, CI-regresszió, Firebase Test Lab bekötés
- [archive/2026-09-04-terepi-fosszal-meres.md](archive/2026-09-04-terepi-fosszal-meres.md) — a 2. és 5. pont mért alapja
- [CURRENT_STATE.md](CURRENT_STATE.md) — legfrissebb mérési eredmény (scenario 2, natív Android)
- [DECISIONS.md](DECISIONS.md) — tartós megvalósítási döntések

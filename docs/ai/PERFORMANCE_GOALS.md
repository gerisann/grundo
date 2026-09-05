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
| 1 | **Gyors indulás rögzítéskor** | a Tracking-képernyő megnyitása és az első GPS-fix közti idő rövid | nincs mérve |
| 2 | **Hosszú rögzítés stabilitása** | sok km / hosszú idő alatt se lassuljon, ne akadjon | részben mérve — ×5,6 per-hívás növekedés 8,6 km alatt ([archive](archive/2026-09-04-terepi-fosszal-meres.md)) |
| 3 | **Magas hurokszám stabilitása** | sok hurok/cella esetén se lassuljon, ne akadjon | mérve — Game Loop scenario 2: 17 hurok, 14 799 cella, `preview.total` max 175,8 ms ([CURRENT_STATE](CURRENT_STATE.md)) |
| 4 | **Sima mérés** | a GPS-mintavétel/feldolgozás ne akadozzon a UI-tól függetlenül | nincs önállóan mérve — a 2–3. pont mérése ezt is érinti, de nincs elkülönítve |
| 5 | **Gyors, akadásmentes háttér→előtér váltás** | app-visszatéréskor ne legyen látható szünet/dermedés | mérve, ismert ok — **859 ms-os blokk** háttérből visszatéréskor, kötegelt GPS-feldolgozásból ([archive](archive/2026-09-04-terepi-fosszal-meres.md)) |
| 6 | **Pontos adat lezárt telefon (screen-off) alatt** | kikapcsolt kijelzővel is pontosan rögzítsen | nincs mérve |
| 7 | **Ébredéskor ne fagyjon le** | a lezárás alatt felgyűlt adat feldolgozása induláskor ne blokkoljon | nincs önállóan mérve — rokon az 5. ponttal (kötegelt feldolgozás), de más helyzet (app-indulás vs. háttér→előtér) |

Összefoglalva: **optimalizáció** — mind a hét pont ugyanarra a gyökérre megy
vissza, a `src/game/` motor és a köré épülő adatfeldolgozás terhelésére és
ütemezésére.

## Amit még nem tudunk

- Az 1., 4., 6. és 7. pontra **nincs mérési adat** — ezekhez saját mérési
  helyzet kell (némelyik natív Android-szintű teszt, nem csak JS-motor mérés).
- A mentési út (kliens feltöltés + szerveroldali `activityCommit`) **teljesen
  méretlen** — ez a 2. és 4. pontot is érinti.
- A Mapbox-rétegrajzolás költsége **nincs elkülönítve** a preview-számítástól
  — ez a 3. és 5. pontot is érintheti.

## Kapcsolódó dokumentumok

- [terv-2026-09-05-rogzites-hangolas-es-test-lab.md](terv-2026-09-05-rogzites-hangolas-es-test-lab.md) — mérőpad, pályakorpusz, CI-regresszió, Firebase Test Lab bekötés
- [archive/2026-09-04-terepi-fosszal-meres.md](archive/2026-09-04-terepi-fosszal-meres.md) — a 2. és 5. pont mért alapja
- [CURRENT_STATE.md](CURRENT_STATE.md) — legfrissebb mérési eredmény (scenario 2, natív Android)
- [DECISIONS.md](DECISIONS.md) — tartós megvalósítási döntések

# src/game — a játékmotor

**Ez a modul közös a kliens és a szerver között.** Ugyanez a kód fut a telefonon
(élő előnézet rögzítés közben) és a Cloud Run szolgáltatásban (hiteles számítás
mentés után). Ezért a két oldal eredménye bitre azonos — nem kell mentegetőzni
azért, hogy „a telefonon mást írt".

## Szabályok, amiket be kell tartani

1. **Csak tiszta függvények.** Se DOM, se Firebase, se `fetch`, se Node API,
   se `Date.now()` a logikában — az idő és az állapot mindig paraméterként jön.
2. **Nincs platformelágazás.** Ha valahol `typeof window` kellene, akkor a
   határ rossz helyen van; emeld ki a hívóba.
3. **Nincs beégetett szám.** Minden konstans a `src/config/gameplay.ts`-ből jön.
4. **Egész számokkal dolgozunk.** A cellák azonosítók, a halmazműveletek
   pontosak. Soha ne vezess be lebegőpontos geometriai műveletet (turf.js
   boolean, poligon-metszés) — pontosan ezt kerültük el a rácsos modellel.

## Fájlok

| Fájl | Feladat |
|---|---|
| `cells.ts` | GPS-minták → összefüggő cellalánc (hézagkitöltéssel) |
| `loops.ts` | Önmetszés-felismerés + flood fill a közrezárt cellákra |
| `claim.ts` | Cellánkénti birtoklási szabályok (szabad / saját / lopás / áttörés) |
| `scoring.ts` | GP-képlet, sorozat-szorzó, lágy plafon, szintek |
| `index.ts` | `processActivity()` — a teljes folyamat |

## Tesztek

A `docs/04-pontrendszer.md` számpéldái közvetlenül teszteknek íródtak. Az
A) példa (6,83 km futás, 840 000 m², 8. napos sorozat → **1 456 GP**) legyen az
első teszteset. A geometriára valós GPX-fájlokkal érdemes tesztelni: sima kör,
nyolcas, többszörös kör ugyanazon az útvonalon, és egy nyitott (be nem zárt) út.

```bash
npm test
```

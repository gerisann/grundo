# Changelog

A GRUNDO verziótörténete. Formátum: [Keep a Changelog](https://keepachangelog.com/hu/1.0.0/)
elve, magyarul, mert ez admin-felületen (`/admin/verziotortenet`) is megjelenik.

**Hogyan kerül ide bejegyzés?** `.claude/rules/versioning.md` szerint minden
érdemi commit előtt eldöntjük, kell-e verzióemelés (patch/minor/major), majd:

```
node scripts/bump-version.mjs <patch|minor|major> "változás 1" ["változás 2" ...]
```

Ez frissíti a `package.json`-t, az iOS `MARKETING_VERSION`-t és ezt a fájlt.
Deploy után a Firestore-tükröt (admin felület) a
`node server/scripts/sync-changelog.mjs` frissíti.

A zárójeles build-szám (Codemagic `BUILD_NUMBER`, iOS `CURRENT_PROJECT_VERSION`,
Android `versionCode`) ettől függetlenül, minden CI-futásnál tovább nő — apró
módosításoknál nem kell hozzá verzióemelés.

⚠️ **Minden `- ` felsorolás EGY sorba kerüljön, ne törd tördelve** — a
`server/scripts/sync-changelog.mjs` soronként olvassa a tételeket, a
folytatósorokat elveszítené.

<!-- ÚJ BEJEGYZÉS IDE -->
## [1.3.0] - 2026-09-12 (Új funkció)

- Útvonaltervezés a Rögzítés képernyőn: Barangolás | Útvonal választó, teljesképernyős tervező (rajt, cél, megállók, címkereső, jelenlegi pozíció, térképi kijelölés)
- Zsákmány panel indulás előtt: mennyi mezőt szerzel, ebből mennyi új és mennyi elvett, mekkora terület, mennyi GP, és a top 3 rivális — egy Gyerünk! gombbal
- Hatszöges betöltő animáció a hosszú műveletekhez (útvonaltervezés, küldetés-ajánló, mentés): egy mező, majd sorban a hat szomszédja
- A mozgásformát az útvonaltervezés előtt ki kell választani — enélkül a tervező nem tudná, gyalog vagy bringával mész
- A Jelleg beállítás gyalogos módban kiszürkítve, Hamarosan felirattal: mérés szerint gyalog egyik állás sem változtat az útvonalon

## [1.2.0] - 2026-09-12 (Új funkció)

- A→B útvonaltervezés API-végpontja (POST /api/routes/plan): hitelesítés, a küldetés-ajánlóval közös heti keret, 100 km-es plafon, őszinte nemleges válasz
- Zsákmány-előnézet a tervhez: hány cellát szerzel, ebből mennyi új és mennyi elvett, mekkora terület, mennyi GP, és a top 3 rivális
- A geometria-számítás külön szálon fut, 8 másodperces időkorláttal — így egy nagy kör nem blokkolja a kiszolgálót a többi felhasználó elől
- Címkeresés az útvonaltervezéshez (GET /api/routes/geocode): két Mapbox-forrás összefésülve, távolság szerint rendezve, gyorsítótárral; a címet nem tároljuk
- Az útvonal Jelleg „Védett út” beállítása mostantól valóban más útvonalat ad — a korábbi szabálya mérés szerint ugyanazt adta, mint a Gyors

## [1.1.2] - 2026-09-12 (Javítás)

- Útvonal-labor: nagy körnél a terület szétszórt foltokban jelent meg (konfetti) — a tömör belsőt egy 200 000-es plafonig bontottuk ki előre, nem térbeli sorrendben; mostantól nincs előre-kibontás
- Útvonal-labor: a távoli nézet foltja a tömör belső parentjeiből épül, durva felbontáson — egy Balaton-kör 2,1 millió cellája így 1 poligon, 122 KB
- Útvonal-labor: a cellarács a látható nézetre töltődik, a tömör belső csak ott bomlik ki
- Útvonal-labor: a birtokviszony-lekérdezés az éles MAX_OWNERSHIP_BLOCKS (400) plafont használja — enélkül egy Balaton-kör lefagyasztotta a labort

## [1.1.1] - 2026-09-12 (Javítás)

- Útvonal-labor: a bezárt terület némán eltűnt a térképről, ha a rajzolandó cellahalmazban ismétlődő cella volt (h3-js: Duplicate input) — a halmaz mostantól deduplikált
- Útvonal-labor: a cellánkénti rajz 40 000 cella fölött sem marad el, hanem a látható nézetre töltődik (mint az appban a csempés lekérés)
- Útvonal-labor: részletező stopper — a teljes idő fázisokra bontva (GraphHopper, geometria, átvitel, rajzolás)
- Útvonal-labor: a némán elvetett hurkok (too_large, interior_too_small) megjelennek a telemetriában

## [1.1.0] - 2026-09-12 (Új funkció)

- A→B útvonaltervező motor: pont-pont útvonal, kétoldali oda-vissza kör, köztes megállók
- Új alakmértékek a közös motorban: irányfüggetlen közös szakasz és önmagába visszatérés
- A kerülő mérete játékkonstans (±500 m / ±1 km / ±2 km), a közvetlen táv 45%-ára vágva
- Kézi útvonal-labor próbapad: címkereső, terep- és kerékpárút-preferencia, geometria és birtokviszony

## [1.0.0] - 2026-09-09 (Nagy verzió)

- Verziókövetési rendszer bevezetése: szemantikus verziószám (`MAJOR.MINOR.PATCH`) a korábbi, kizárólag zárójeles build-számos követés mellé.
- Ez a bejegyzés az indulási alapállapotot jelöli — a korábbi build-előzmény (build 1–54) nem lett visszamenőleg feldolgozva.

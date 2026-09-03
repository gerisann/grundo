# Kontextus-gazdálkodás

A használati limit **tokenben** mér, és minden eszközhívásnál a teljes addigi
beszélgetés újra elmegy. A századik hívás ugyanazért a munkáért sokszorosába
kerül, mint az első. Nem a képességet korlátozzuk — a **fölösleges ismétlést**.

## Keresés és olvasás

- **Előbb keress, aztán olvass.** `rg`/Grep mintával találd meg a helyet, és
  csak a releváns tartományt nyisd meg (`sed -n '120,180p'`, `offset`+`limit`).
- **Soha ne olvasd végig a repót**, és ne töltsd be a teljes `docs/` fát vagy a
  teljes `server/src/`-t „hogy megértsem".
- **Ne olvass újra változatlan fájlt.** Ami már a kontextusban van, az megvan.
- **Sose olvass be** lockfile-t (`package-lock.json`), `dist/`-et,
  `node_modules/`-t, `.apk`/`.ipa`-t, trace-eket (`Trace-*.json.gz`),
  minified fájlt, `_archive/`-ot, `tmp/`-t — hacsak nem pont az a feladat.
- Nagy fájl (≳600 sor) vagy sok fájl megnyitása előtt kérdezd meg magadtól:
  **megválaszolja-e egy szűkebb keresés?** Általában igen.
- Kép/PDF/videó megnyitása drága. Csak akkor, ha a feladat vizuális.

## Kontextus-figyelmeztetés

Ha egy művelet **aránytalanul sok** kontextust enne, előre szólj egy mondattal,
és ajánlj szűkebb utat:

> **Kontextus-figyelmeztetés:** ez a művelet sok adatot tölthet be. Előbb
> szűkíthetem a keresést.

Tipikus esetek: sok fájl megnyitása; nagyon nagy fájl; teljes build- vagy
teszt-log; teljes repo-átvizsgálás; nagy JSON/adatfájl; több ügynök indítása;
széles git-történet elemzés; terjedelmes külső dokumentáció.

**De ne szakítsd meg a normál fejlesztést.** Csak akkor szólj, ha a várható
költség érdemben nagy VAGY van nyilvánvalóan olcsóbb alternatíva. Egyetlen
fájl megnyitásához, egy célzott kereséshez, egy célzott teszthez nem kell
figyelmeztetés — azt csináld meg.

## Parancskimenet

- Szűrj: `| tail -30`, `| grep -E "FAIL|Error"`, csendes/riport módok.
- Ha a kimenet így is nagy, **mentsd fájlba és abban keress**:
  `npm run build > /tmp/build.log 2>&1; tail -40 /tmp/build.log`
  (átmeneti fájlnak a scratchpad vagy a `tmp/` mappa való, verziókövetésbe nem
  kerül).
- Git: `git diff --stat` a tájékozódáshoz, `git diff -- <fájl>` a részlethez.
  Teljes `git log`-ot ne dumpolj; `--oneline -10` bőven elég.
- Nyers stack trace helyett a releváns 5-10 sort idézd.

## Amit kerülj — ezek viszik el a limitet

- „olvasd végig a repót" / „előbb értsek meg mindent";
- ugyanaz a széles keresés többször;
- ismételt teljes build vagy teljes tesztkészlet;
- teljes log-dump a beszélgetésbe;
- fölösleges git-történet;
- egyszerre tucatnyi fájl megnyitása;
- több ügynök ugyanarra a kódterületre;
- egy lezárt, nem kapcsolódó feladat végtelen cipelése a beszélgetésben.

## Mikor van vége a beszélgetésnek

**Jelezd magadtól, ha új beszélgetés hatékonyabb lenne** — ne várd meg, hogy
megkérdezzék. Egy mondat elég a folyó munka végén: mi az ok, és mi kerül a
`docs/ai/CURRENT_STATE.md`-be. Tipikus jelek:

- egy logikai egység lezárult, és a következő lépés más témával indulna;
- a beszélgetés sok nagy eszközkimenetet hordoz, amire a hátralévő munka már
  nem hivatkozik;
- modellváltás lenne indokolt (az úgyis új menetet jelent);
- **a feladat érdemben megváltozott** — ilyenkor kérdezd meg magadtól, hogy az
  eddigi kontextus nem avult-e el; ha igen, javasolj átadást.

Ha egy apró javítás van hátra ugyanabban a témában, **ne szakítsd meg** csak
azért, mert „elég sok minden történt". A szál közepén vágni drágább, mint
végigvinni.

## Választás a menet végén

| Helyzet | Mit tegyél |
|---|---|
| Részfeladat kész, ugyanaz a téma folytatódik | menj tovább, ne csinálj semmit |
| Részfeladat kész, a következő más témájú | frissítsd a `CURRENT_STATE.md`-t, javasolj új beszélgetést |
| A beszélgetés nagy, de a feladat félkész | fejezd be a logikai egységet, aztán átadás |
| A feladat félbeszakadt és a kontextus elavult | azonnal átadás (`/handoff`), új beszélgetés |

# GRUND — projekt gerinc

**Státusz:** V0.2 specifikáció · 2026-08-15 (10 alapdöntés rögzítve)
**Cél:** production ready közösségi mozgás- és területfoglaló app (iOS/Android + web admin)
**Stack:** Google AI Studio (fejlesztés) · Firebase (Auth, Firestore, Storage, FCM, Hosting) · Cloud Run (geo/konnektor/job szolgáltatások) · Mapbox

Ez a mappa a GRUND funkcionális és technikai gerince. A `../*.jpg` (49 db) referencia-képernyőkép egy hasonló appról (Stryde) — ezekből lett a képernyőtérkép és a UI-elemzés. A GRUND ezekhez képest **más játéklogikát** kap: a területfoglalás mellé egy különálló, de összekapcsolt **pontrendszer** kerül, ami az aktivitást önmagában is jutalmazza.

## Dokumentumok

| # | Fájl | Tartalom |
|---|------|----------|
| 01 | [Képernyőtérkép](01-kepernyoterkep.md) | Mind a 49 kép besorolása, navigációs architektúra, dock, képernyőlista |
| 02 | [Funkcionális specifikáció](02-funkcionalis-spec.md) | Képernyőnkénti funkciók, üres/hiba állapotok, felhasználókezelés, Pro, konnektorok, értesítések |
| 03 | [Játékszabályok — terület](03-jatekszabalyok.md) | Hurokzárás, geometria, elvétel, védelem, rétegek, anti-cheat |
| 04 | [Pontrendszer](04-pontrendszer.md) | GP-képlet, szorzók, streak, napi hold-bónusz, szintek, badge-ek, számpéldák |
| 05 | [Adatmodell](05-adatmodell.md) | Firestore/PostGIS séma, kollekciók, indexek, biztonsági szabályok |
| 06 | [Architektúra és admin](06-architektura-es-admin.md) | Szolgáltatások, jobok, admin felület, analitika, üzemeltetés, ütemterv |

## A GRUND egy mondatban

> Fuss, sétálj vagy bringázz → zárd a kört → urald a területet → védd meg, ami a tiéd.
> És közben minden méter pontot ér — akkor is, ha nem zárul a kör.

## Két játék, egy app

|  | **Terület** (m²) | **GRUND pont (GP)** |
|---|---|---|
| Jellege | állapot, **elvehető** | halmozódó, **soha nem vész el** |
| Mit mér | pillanatnyi birodalom | tartós aktivitást |
| Hol jelenik meg | Terület oldal, terület-ranglista | Profil szint, GP-ranglista, jelvények |
| Kinek szól | versengőknek | mindenkinek, aki mozog |

A kettő **össze van kötve**: a területszerzés a legnagyobb GP-forrás, a birtokolt terület pedig naponta passzív GP-t termel — de aki sosem zár kört, az is szintet lép a megtett távból.

## Alapkonstansok (gyorsreferencia)

| Konstans | Érték |
|---|---|
| **Rács** | H3 **res 12** hexagon — ~18,8 m átló, **307,09 m²/cella** |
| Terület mértékegysége | **m²** (1 000 000 m² fölött km²) |
| Minimális aktivitás mentéshez | 100 m |
| Legkisebb megszerezhető terület | **4 cella** ≈ 1 228 m² |
| Bezárás | **bármely önmetszés** — nem kell visszaérni a rajthoz |
| Rétegek | `foot` (futás+gyaloglás), `bike` (kerékpár) |
| Max védelmi szint | 5× |
| Védelem visszaállása | naponta 1×-esre, **helyi idő** szerint |
| GP terület után | **1 GP / 1 000 m²** |
| Trust Score küszöbök | ≥80 érvényes · 50–79 ellenőrzés alatt · <50 elutasítva |
| Privát zóna | kezdet/vég külön, 50/100/200 m, alap: BE 200 m |
| Pro ár | 4,99 €/hó · 39,99 €/év (–33%) |

## Eldöntött kérdések

| # | Kérdés | Döntés | Hol |
|---|---|---|---|
| 1 | Geometria-modell | **Firestore + H3 hexrács.** Nincs PostGIS, nincs poligon-algebra | [06](06-architektura-es-admin.md#gt-geometria-modell-döntés) |
| 2 | Szintlépés alapja | **GP** — a távolság-létra a jelvényekben marad | [04](04-pontrendszer.md#szintek) |
| 3 | Napi forduló | **helyi idő** szerinti éjfél, óránként futó job | [03](03-jatekszabalyok.md#napi-forduló--helyi-idő-szerint-döntés-2026-08-15) |
| 4 | E-mail-hitelesítés türelmi ideje | **7 nap**, utána csak a közösségi írás zárol | [02](02-funkcionalis-spec.md#regisztráció-és-hitelesítés) |
| 5 | Területvesztés push | **minden támadásról**, plafon nélkül (1 támadás = 1 értesítés) | [02](02-funkcionalis-spec.md#értesítések) |
| 6 | Lokális feed | **ingyenes**, nem Pro-funkció | [02](02-funkcionalis-spec.md#előfizetés-kép-25) |
| 7 | Terület mértékegysége | **m²** | [03](03-jatekszabalyok.md#a-terület-megjelenítése) |
| 8 | Útvonalgenerátor | **küldetés-ajánló**: idő alapú bemenet, területi hozadék a kimenet | [02](02-funkcionalis-spec.md#útvonalak-fül--küldetés-ajánló) |
| 9 | Anti-cheat | **Trust Score** (7 jelforrás); gyanús aktivitás látszik, de nem módosít birtokviszonyt | [03](03-jatekszabalyok.md#trust-score--aktivitás-hitelesség) |
| 10 | Jelentés-kategóriák | GPS-manipuláció · jármű · hibás mérés · sértő · adatvédelem · egyéb | [02](02-funkcionalis-spec.md#jelentés) |
| 11 | **Privát zóna** | az onboarding **kötelező lépése**; kezdet és vég külön, 50/100/200 m, alapból BE 200 m-en, kikapcsolható | [02](02-funkcionalis-spec.md#privát-zóna) |

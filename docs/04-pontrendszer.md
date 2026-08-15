# 04 — Pontrendszer (GRUND pont / GP)

## A tervezés elve

A területfoglalás önmagában **kirekesztő játék**: aki lassabb, kevesebbet ér rá, vagy ritkás lakóövezetben él, az mindig veszíteni fog, és abbahagyja. A GRUND célja viszont az, hogy **mozgásra ösztönözzön** — ezért kell egy második, párhuzamos játék.

|  | **Terület (m²)** | **GRUND pont (GP)** |
|---|---|---|
| Természete | pillanatnyi állapot | halmozott előzmény |
| Elvehető? | **igen** | **soha** |
| Kit jutalmaz | a legerősebbet | a legkitartóbbat |
| Ranglista | globális/lokális terület | heti / havi / összesített GP |
| Vizuális helye | Terület oldal, térkép | Profil szint, jelvények |

**Összekötés:** a területszerzés messze a legnagyobb GP-forrás, és a birtokolt terület naponta passzív GP-t termel. Aki a területjátékot játssza, gyorsabban szintet lép. De aki csak sétál minden nap, az is folyamatosan halad — csak lassabban. **Senki nem veszít GP-t soha.**

---

## A képlet

```
GP_aktivitás = kerekít( (ALAP + IGÉNY + LOPÁS + ÁTTÖRÉS) × STREAK_SZORZÓ )
```

### 1. ALAP — minden méter számít

```
ALAP = táv_km × alapráta(típus)
```

| Típus | Ráta |
|---|---|
| Futás | **10 GP/km** |
| Gyaloglás | **10 GP/km** |
| Kerékpár | **4 GP/km** |

> A bringa alacsonyabb rátája a nagyobb megtehető távot ellensúlyozza. Egy 40 km-es bringázás (160 GP) és egy 16 km-es futás (160 GP) hasonló erőfeszítés.

Ez akkor is jár, ha **nem zárul be a kör** — ez a rendszer legfontosabb ösztönző eleme.

### 2. IGÉNY (claim) — a terület pontértéke

```
IGÉNY = Σ  darab_m² / 1000 × védelmi_szorzó
```

**1 GP minden 1 000 m² után** (azaz 1 km² = 1 000 GP). Egy hexagon-cella (307,09 m²) így **0,307 GP**-t ér. A számítás belül mindig cellaszámmal megy, a kerekítés a végén történik.

**Védelmi szorzó** — a saját terület ismételt bezárása egyre értékesebb (ez a „körbe-körbe futás" jutalma):

| Új védelmi szint | Szorzó |
|---|---|
| 1× (első foglalás) | ×1,0 |
| 2× | ×1,5 |
| 3× | ×2,0 |
| 4× | ×3,0 |
| 5× (maximum) | ×5,0 |

### 3. LOPÁS bónusz

Idegentől elvett területre: **+50 %** az adott darab igény-pontjára.

### 4. ÁTTÖRÉS bónusz

Ha védett (defense ≥ 2) idegen zónát támadsz és a terület még nem cserél gazdát, de a védelem csökken: **a darab igény-értékének 25 %-a** jár. Így az „eredménytelen" támadás sem hiábavaló.

### 5. STREAK szorzó

Napi sorozat (egymást követő napok legalább egy mentett aktivitással):

```
STREAK_SZORZÓ = min( 1 + 0,05 × (napok − 1) ,  1,5 )
```

| Sorozat | Szorzó |
|---|---|
| 1. nap | ×1,00 |
| 3. nap | ×1,10 |
| 7. nap | ×1,30 |
| 11. naptól | ×1,50 (plafon) |

- A sorozat **egy nap kihagyással megszakad** — de van **napi 1 „fagyasztás" hetente** (egy kihagyott nap nem töri meg, legfeljebb heti egyszer). Ez megakadályozza, hogy egy betegség vagy utazás lenullázza a 200 napos szériát.
- A **heti sorozat** (a képeken „0 WKS Streak") külön fut: hány egymást követő héten volt legalább 3 aktív nap. Mérföldkő-jutalmak:

| Heti sorozat | Egyszeri jutalom |
|---|---|
| 4 hét | +500 GP + jelvény |
| 12 hét | +2 000 GP + jelvény |
| 26 hét | +5 000 GP + jelvény |
| 52 hét | +12 000 GP + jelvény |

---

## Napi tartás (hold) bónusz

Minden nap végén, a védelem visszaállítása **előtt**:

```
HOLD_GP = min( birtokolt_m² / 10 000 ,  1 000 )
```

- **1 GP minden 10 000 m² után naponta** (100 GP/km²) — a foglalási érték 10 %-a.
- **Napi 1 000 GP plafon**, azaz 10 000 000 m² (10 km²) fölött nem nő tovább. Ez akadályozza meg, hogy egy korán induló nagybirtokos passzívan elszaladjon.
- A két réteg (gyalogos + kerékpáros) **külön-külön** számolódik, saját plafonnal.
- **Feltétel:** csak akkor jár, ha a felhasználó az elmúlt **7 napban** rögzített legalább egy aktivitást. Az inaktív birodalom nem termel.

---

## Napi lágy plafon

```
Ha a napi GP > 5 000:  az afölötti rész 50 %-os értéken számít.
```

Nem kemény korlát — az extrém teljesítmény továbbra is jutalmazott, csak csökkenő hozammal. Véd a maratoni „farmolás" és a többfiókos manipuláció ellen.

---

## Számpéldák

### A) Területet foglaló futás

6,83 km futás, bezárul **840 000 m²**:
500 000 m² üres · 200 000 m² saját (védelem 1→2) · 140 000 m² idegentől elvéve (védelem 1 volt). 8. napos sorozat.

| Tétel | Számítás | GP |
|---|---|---|
| ALAP | 6,83 × 10 | 68,3 |
| IGÉNY (üres) | 500 000 / 1000 × 1,0 | 500,0 |
| IGÉNY (saját, 2×) | 200 000 / 1000 × 1,5 | 300,0 |
| IGÉNY (lopott) | 140 000 / 1000 × 1,0 | 140,0 |
| LOPÁS bónusz | 140 000 / 1000 × 0,5 | 70,0 |
| **Részösszeg** | | **1 078,3** |
| Streak (8. nap) | × 1,35 | |
| **Összesen** | | **1 456 GP** |

### B) Kör nélküli séta

5,2 km séta, nem zárult be, 3. napos sorozat:
`5,2 × 10 = 52` → `× 1,10` = **57 GP**

Kevés — de minden nap jár, és pár hét alatt szintlépéssé áll össze.

### C) Körbe-körbe futás (védelemépítés)

Ugyanaz a **300 000 m²**-es kör négyszer egymás után, egyetlen 8 km-es futás alatt:

| Kör | Új védelem | Szorzó | GP |
|---|---|---|---|
| 1. | 1× | ×1,0 | 300 |
| 2. | 2× | ×1,5 | 450 |
| 3. | 3× | ×2,0 | 600 |
| 4. | 4× | ×3,0 | 900 |
| ALAP | | | 80 |
| **Összesen** | | | **2 330 GP** |

A zóna másnap reggelig **4× védett**: négyszer kell áttörni, hogy elvegyék.

### D) Passzív nap

3 100 000 m² (3,10 km²) birtok, nincs aktivitás (de a héten volt): `3 100 000 / 10 000` = **310 GP**.

---

## Szintek

**A szint a GP-ből számít** *(döntés: 2026-08-15)*, nem a megtett távolságból. Indok: a GP már tartalmazza a távot, a területet és a kitartást is — egyetlen, mindent összefogó mérték.

| Szint | Név | GP küszöb |
|---|---|---|
| 1 | ÚJONC | 0 |
| 2 | FELDERÍTŐ | 2 500 |
| 3 | BIRTOKOS | 7 500 |
| 4 | ŐRSZEM | 17 500 |
| 5 | HÓDÍTÓ | 35 000 |
| 6 | HADVEZÉR | 65 000 |
| 7 | URALKODÓ | 110 000 |
| 8 | LEGENDA | 180 000 |
| 9 | TITÁN | 280 000 |
| 10 | GRUNDMESTER | 420 000 |

Nagyságrend: heti 3 közepes futás területtel ≈ 4–5 000 GP/hét → a 2. szint 4–6 hét, a 10. szint komoly, éves elköteleződés.

A szint **soha nem csökken**. A profilon: szint-chip + haladásjelző („2 340 GP a következő szintig").

### A távolság-létra megmarad — a jelvények szintjén

*(döntés: 2026-08-15)* A referencia-app táv-alapú szintlépése („50,00 KM A KÖVETKEZŐ SZINTIG", kép #04) **nem tűnik el**, csak átkerül a jelvényrendszerbe, párhuzamos sávként:

| Fokozat | Táv | Fokozat | Táv |
|---|---|---|---|
| 1 | 10 km | 6 | 1 000 km |
| 2 | 50 km | 7 | 2 500 km |
| 3 | 100 km | 8 | 5 000 km |
| 4 | 250 km | 9 | 10 000 km |
| 5 | 500 km | 10 | 25 000 km |

- **Rétegenként külön** vezetve (gyalogos és kerékpáros távlétra).
- A profilon **két haladásjelző** fut egymás alatt: felül a GP-szint, alatta „**38,4 / 50 km a következő távjelvényig**".
- Miért kell mindkettő: a GP-szint a *játékot* méri, a távlétra a *puszta mozgást*. Aki nem érdeklődik a területháború iránt, annak a távjelvény adja a haladás érzését — és ez pont az a felhasználó, akit a legkönnyebb elveszíteni.

---

## Ranglisták

| Lista | Időszak | Alap |
|---|---|---|
| **Terület** | pillanatnyi | birtokolt m², rétegenként |
| **GP — heti** | hétfő 00:00-tól | az adott héten szerzett GP |
| **GP — havi** | hónap 1-től | havi GP |
| **GP — összesített** | mindenkori | teljes GP |

Mindegyik **globális** és **lokális** (kerület / város / ország) bontásban. A heti GP-lista a legfontosabb közösségi felület: **hetente mindenki nulláról indul**, tehát az újonnan csatlakozó is nyerhet — miközben a km²-lista a régi motorosoké marad.

---

## Jelvények

| Kategória | Példák |
|---|---|
| **Első lépések** | Első aktivitás · Első bezárt kör · Első lopás · Első visszaszerzés |
| **Távolság** | a fenti 10 fokozatú távlétra, rétegenként |
| **Terület** | 100 000 / 500 000 / 1 000 000 / 5 000 000 / 25 000 000 / 50 000 000 m² összesen elfoglalva |
| **Hódító** | 10 / 50 / 100 / 500 elvett zóna |
| **Védő** | 10 / 50 / 100 sikeres áttörés-elhárítás · 5× védelem elérése |
| **Kitartás** | 7 / 30 / 100 / 365 napos sorozat · 4 / 12 / 26 / 52 hetes sorozat |
| **Hűség** | 1 hónap / 6 hónap / 1 év / 2 év az appban |
| **Felfedező** | 5 / 25 / 50 ország az útlevélben |
| **Közösség** | Klubalapító · 100 like · kihívás megnyerése |
| **Pro** | Pro előfizető · Alapító tag (az első 1 000 Pro) |

Minden jelvény: ikon · név · leírás · megszerzés dátuma · **ritkasági szint** (bronz/ezüst/arany/platina) · a hozzá tartozó egyszeri GP-jutalom. A jelvény-katalógus **adatvezérelt** (`badges` kollekció), adminból bővíthető kódmódosítás nélkül.

---

## Konstansok (`appConfig/gameplay`)

Minden érték szerveroldali konfiguráció, admin felületről verziózva állítható — a hangolás a launch után elkerülhetetlen.

```jsonc
{
  "H3_RESOLUTION": 12,
  "CELL_AREA_M2": 307.09,
  "MIN_DISTANCE_M": 100,
  "MIN_INTERIOR_CELLS": 4,
  "MIN_LOOP_STEPS": 6,
  "MAX_LOOP_BBOX_CELLS": 500000,
  "MAX_DEFENSE": 5,
  "DEFENSE_MULTIPLIER": [1.0, 1.5, 2.0, 3.0, 5.0],
  "CLAIM_GP_PER_KM2": 1000,
  "BASE_GP_PER_KM": { "run": 10, "walk": 10, "ride": 4 },
  "STEAL_BONUS": 0.5,
  "BREAKTHROUGH_BONUS": 0.25,
  "HOLD_GP_PER_KM2": 100,
  "HOLD_GP_DAILY_CAP": 1000,
  "DISTANCE_BADGE_LADDER_KM": [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000],
  "TRUST_THRESHOLD_ACCEPT": 80,
  "TRUST_THRESHOLD_REJECT": 50,
  "TRUST_AUTO_APPROVE_MINUTES": 60,
  "HOLD_REQUIRES_ACTIVE_DAYS": 7,
  "DAILY_STREAK_STEP": 0.05,
  "DAILY_STREAK_MAX": 1.5,
  "STREAK_FREEZES_PER_WEEK": 1,
  "WEEK_STREAK_MILESTONES": { "4": 500, "12": 2000, "26": 5000, "52": 12000 },
  "SOFT_CAP_GP_PER_DAY": 5000,
  "SOFT_CAP_RATE": 0.5,
  "LEVELS": [0, 2500, 7500, 17500, 35000, 65000, 110000, 180000, 280000, 420000]
}
```

**Minden GP-tranzakció naplózódik** (`gpLedger`): forrás, összeg, aktivitás-hivatkozás, időbélyeg. Ez teszi auditálhatóvá a rendszert, lehetővé teszi a visszavonást csalás esetén, és ebből épül a „Honnan jött a pontom?" felület a profilon.

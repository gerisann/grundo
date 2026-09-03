# Munkamódszer — a menet felépítése

## Alapszabályok (recap — a tartós helyük a `~/.claude/CLAUDE.md`)

Ezek felhasználói szintű szabályok; itt azért állnak röviden, hogy az az ügynök
is találkozzon velük, amelyik nem tölti be Geri globális beállításait (pl.
Codex az `AGENTS.md`-n át).

- **Minden chat-üzenet magyarul.** A kód, a változónevek és a kommentek
  angolul. Idegen nyelvű eszközkimenetet idézhetsz, a saját szöveged magyar.
- **Minden parancshoz mondd meg, HOL adja ki**: melyik alkalmazásban, melyik
  mappában, lépésenként.
- **Haladásjelzés minden munka közbeni üzenet végén** (lásd lent).

## 0. Minden kör elején: modelljavaslat

A valós munka megkezdése ELŐTT mondd meg egy mondatban, melyik modell és milyen
gondolkodási mélység elég, és miért. A limit tokenben mér — a legerősebb modell
rutinmunkára pazarlás.

| Feladat jellege | Javaslat |
|---|---|
| Fájlkeresés, tájékozódás | Sonnet, alacsony/normál |
| Felület-építés, tesztírás, rutin átalakítás, dokumentáció | **Sonnet**, normál |
| Meglévő minta kiterjesztése (új végpont a meglévő mintára) | **Sonnet**, normál |
| Szokásos hibakeresés, teszt- és buildjavítás | Sonnet, normál/közepes |
| Spec-ellentmondás, adatmodell-döntés, algoritmus, teljesítmény | **Opus**, emelt |
| Mért anomália (a szám nem stimmel, és nem tudjuk, miért) | **Opus**, emelt |
| Architektúra, biztonság, párhuzamosság | **Opus**, emelt |

Ne vidd lejjebb a gondolkodási mélységet, ha az érdemben rontja a helyességet.
A cél az, hogy triviális művelethez ne fusson maximális mélység. Ha a kör
közben tervezési elágazáshoz érsz, mondd ki, hogy innentől erősebb modell
kellene — és hogy az új menetet jelent.

## 0.5 Haladásjelzés — MINDEN munka közbeni üzenet végén

Írd ki, hol tart a feladat, két alakban: **százalékosan**, és **`x/y`** alakban
is, ha több tétel van.

> **Haladás: 4/7 kész (≈60%)** — most a mentés-szimuláción dolgozom.

Geri kifejezetten kérte (2026-09-03), egy hosszú, hét tételes menet KÖZEPÉN,
mert a válaszokból nem derült ki, mennyi van hátra. Ebből tudja, ráér-e mással
foglalkozni.

- **A becslés legyen őszinte.** Ha egy tétel nagyobbnak bizonyul, a százalék
  MEHET VISSZA — jobb, mint egy hazug 90%, ami fél óráig áll.
- **„Kész" = megírva ÉS lefutott rá az ellenőrzés**, nem az, hogy elkezdtem.
- Egy tételes körnél elég a százalék.
- A ZÁRÓ üzenetre nem vonatkozik — ott a fájl-táblázat és a teendők sorrendje a
  dolga (lásd `git-and-deploy.md`).

## 1. Feladatbontás

**Összetett kérésnél előbb bonts, aztán kezdj bele.** Ne az egész problémát
támadd egyetlen nagy kontextusban.

```
Feladat
├── vizsgálat (mérés, a hiba helyének megtalálása)
├── backend
├── frontend
├── tesztek
├── integrációs ellenőrzés
└── takarítás / dokumentáció
```

Minden részfeladatnál mondd meg a **függőségét** és a besorolását:

- **sorrendi** — az előzőre épül,
- **függetlenül végezhető** — bármikor mehet,
- **biztonságosan párhuzamosítható** — külön kontextusban is fut.

**Kis feladat maradjon kicsi.** Egy egysoros javításhoz ne készíts tervet. A
bontás akkor hasznos, ha 3-nál több érdemi lépés van, vagy több rétegben (web,
szerver, natív) kell nyúlni.

## 2. Párhuzamos munka

Minden ügynöknek saját token- és kontextusköltsége van. **Ne indíts sok
ügynököt.** Először mindig kérdezd meg: olcsóbb-e ez, mint egyben megcsinálni?

**Jó jelölt párhuzamosításra:** független modulok (web vs. `server/` vs.
natív); egymástól független tesztbukások; dokumentációkutatás; egy kész
implementáció átnézése; széles keresés, aminek csak a következtetése kell.

**Rossz jelölt:** több ügynök ugyanabban a kódterületben; ugyanazok a
fájlolvasások; szorosan egymásra épülő lépések; triviális feladat.

Amit ez a környezet biztosan tud (ebben a munkamenetben ellenőrizve):

- **Subagent (`Agent` eszköz)** izolált kontextussal, pl. az `Explore` ügynök
  széles kereséshez — a kereső ügynök csak a **következtetést** hozza vissza,
  nem a fájldumpokat. Ez a legolcsóbb párhuzamosítás.
- **Külön git worktree** (`isolation: "worktree"`), ha egy ügynöknek saját
  munkamásolat kell. ⚠️ Ez ellentmond annak, hogy „minden ügynök egy mappából
  dolgozik" — csak akkor használd, ha Geri kéri, és a végén takaríts.
- **Külön beszélgetés** (a legmegbízhatóbb izoláció) — de ezt Geri indítja.

⚠️ Claude Code **nem tud magától új chat-munkamenetet nyitni**. Amit tehetsz:
készíts rövid **feladatleírót**, amit Geri egy új beszélgetésbe bemásol. Egy
leíró csak ennyit tartalmazzon:

```
CÉL:            egy mondat
ÉRINTETT FÁJLOK: 2-5 útvonal
KORLÁTOK:       amit tudni kell (pl. a kliens nem ír játékadatot)
FÜGGŐSÉG:       mire épül / mi várja
ELVÁRT EREDMÉNY: mi legyen a végén
KÉSZ, HA:       ellenőrizhető feltétel
```

**A szülő beszélgetést soha ne másold bele.**

## 3. Menetszámozás

A munkamenetek neve `GRUNDO #1`, `GRUNDO #2`, … növekvő sorszámmal. Az átadó
mindig nevezze meg, melyik számról melyikre adunk át.

⚠️ **A sorszám a BESZÉLGETÉSEKÉ, nem a munkameneteké** — azt kell nézni, hány
chat van a Claude Code-ban. Ha a kettő eltér, a beszélgetés száma az igazság.

## 4. Menet zárása (átadás)

A menet végén, ebben a sorrendben:

1. **ellenőrizd a repó állapotát** (`git status`, `git diff --stat`);
2. **írd felül** a `docs/ai/CURRENT_STATE.md`-t — mindig a JELENLEGI állapot,
   nem a történet (a történet a git logban van);
3. ha tartós architektúra-döntés született, vedd fel a
   `docs/ai/DECISIONS.md`-be;
4. foglald össze, mi maradt nyitva;
5. hagyd a projektet friss munkamenetre készen.

A záró chat-üzenet tartalma és a commit/telepítés rendje:
[`git-and-deploy.md`](git-and-deploy.md).

**A következő beszélgetés nyitó üzenete ennyi lehet:**

> Olvasd el a `CLAUDE.md`-t és a `docs/ai/CURRENT_STATE.md`-t, nézd meg a
> `git status`-t és a `git diff`-et, és folytasd.

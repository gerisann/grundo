---
name: grundo-session-start
description: GRUNDO menetindítás — állapot beolvasása, menetszám, modelljavaslat, terv. Használd egy új GRUNDO beszélgetés elején, vagy ha a felhasználó azt kéri, hogy „kezdjük a menetet" / „folytasd, ahol abbahagytuk".
---

# Menetindítás

Ebben a sorrendben, és **ne olvass be mást**:

1. `docs/ai/CURRENT_STATE.md` (a `CLAUDE.md` már betöltődött).
2. `git status --short` és `git diff --stat`. Ha a munkamásolat piszkos, mondd
   meg, mi változott azóta, hogy az állapotfájl készült — **a repóban más forrás
   is dolgozik** (Codex, másik beszélgetés).
3. `git log --oneline -5`.

Ezután — még mielőtt bármit megnyitnál vagy írnál — add meg:

- **Menetszám**: a következő `GRUNDO #N`. ⚠️ A sorszám a **beszélgetéseké**,
  nem a munkameneteké: azt kell nézni, hány chat van a Claude Code-ban. Ha az
  állapotfájl mást ír, a beszélgetés száma az igazság.
- **Modelljavaslat** egy mondatban:

  | Feladat jellege | Javaslat |
  |---|---|
  | Felület-építés, tesztírás, rutin átalakítás, dokumentáció | Sonnet, normál |
  | Meglévő minta kiterjesztése (új végpont a meglévő mintára) | Sonnet, normál |
  | Spec-ellentmondás, adatmodell-döntés, algoritmus, teljesítmény | Opus, emelt |
  | Mért anomália (a szám nem stimmel, és nem tudjuk, miért) | Opus, emelt |

- **Mit javasolsz elvégezni**, legfeljebb 3 tétel az állapotfájl „Nyitott
  ügyek" listájából. Amit a felhasználó kér, az felülír.
- Ha a feladat 3-nál több érdemi lépés, kérj `/task-plan`-t vagy adj rövid
  bontást függőségekkel.

Végül várd meg a jóváhagyást, mielőtt kódot módosítasz.

## Ellenőrzés a menet elején (opcionális, ha hosszú menet várható)

`/usage` — mennyi maradt az ablakból · `/context` — mi tölti a kontextust ·
`/model`, `/effort` — a javaslatnak megfelelő beállítás. Nem kell minden
menetnél; akkor, ha a kvóta szűk vagy a feladat nagy.

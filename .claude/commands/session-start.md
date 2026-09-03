---
description: GRUNDO menetindítás — állapot beolvasása, modelljavaslat, terv
---

Indítsd el a GRUNDO munkamenetet, ebben a sorrendben. **Ne olvass be mást,
csak amit itt kérek.**

1. Olvasd el a `docs/ai/CURRENT_STATE.md`-t (a `CLAUDE.md` már betöltődött).
2. Futtasd: `git status --short` és `git diff --stat`. Ha a munkamásolat
   piszkos, mondd meg, mi változott azóta, hogy az állapotfájl készült.
3. `git log --oneline -5`.

Ezután — még mielőtt bármit megnyitnál vagy írnál — add meg:

- **Menetszám**: a következő `GRUNDO #N` (az állapotfájl fejlécéből + hány chat
  volt; ha bizonytalan, kérdezd meg).
- **Modelljavaslat** egy mondatban a `.claude/rules/workflow.md` 0. pontja
  szerint.
- **Mit javasolsz elvégezni ebben a menetben**, legfeljebb 3 tétel, az
  állapotfájl „Nyitott ügyek" listájából. Ha a felhasználó mást kér, az felülír.
- Ha a feladat 3-nál több érdemi lépés, adj **feladatbontást** függőségekkel
  (`.claude/rules/workflow.md` 1. pont).

Végül várd meg a jóváhagyást, mielőtt kódot módosítasz.

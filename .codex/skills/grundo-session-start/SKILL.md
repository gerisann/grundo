---
name: grundo-session-start
description: GRUNDO menetindítás Codexben — állapot, munkapéldány, menetszám, modelljavaslat és rövid terv. Használd új GRUNDO-beszélgetés elején vagy a korábbi munka folytatásakor.
---

# Menetindítás

1. Ellenőrizd, hogy az aktuális munkakönyvtár pontosan
   `C:\Users\Geri\Documents\GitHub\grundo`. Eltérésnél állj meg és szólj;
   másik klónt vagy worktree-t ne hozz létre.
2. Olvasd el a gyökér `AGENTS.md` és `.codex/README.md` utasításait,
   majd a `docs/ai/CURRENT_STATE.md`-t. Amit már olvastál, ne töltsd újra.
3. `git status --short`, `git diff --stat`, `git log --oneline -5`.
   Más forrás változásait őrizd meg; az állapotfájlhoz képesti eltérést csak
   ellenőrizhető bizonyíték alapján tulajdonítsd valakinek.
4. Olvasd el a `.codex/rules/skill-discovery.md` szabályt, és csak a feladathoz
   szükséges további szabályokat, specifikációkat, skilleket nyisd meg.

Röviden jelezd, kitől származik az átadó (`Utoljára dolgozott`, `Átadva`).
A menetszám a beszélgetést azonosítja: Geri által megadott szám az elsődleges;
ha nincs más hiteles adat, a CURRENT_STATE utolsó számából következő `#N`
csak javaslat. Ne számold a Claude/Codex oldalsáv feladatait, és ne állíts
biztos számozást hiányos lista alapján. Ugyanazon beszélgetés folytatása nem új szám.

Modellt és erősséget a `.codex/models.md` szerint javasolj, egy mondatban.
Ne állítsd át automatikusan a modellt, és ne állj meg a javaslat elfogadására várva.

A felhasználó aktuális kérése az elsődleges feladat. Ha konkrét munkát kért,
kezdd el; nincs külön menetindítási jóváhagyás. Ha csak állapotfelmérést kért,
adj legfeljebb három következő lépést a nyitott ügyek alapján.
Nagy feladatnál adj rövid bontást függőségekkel; ne kérj nem létező `/task-plan`
parancsot. Claude-specifikus `/usage`, `/context`, `/model`, `/effort` helyett
az aktuálisan elérhető Codex-eszközt vagy beállítást használd; ne találj ki
kontextus- vagy kvótaadatot. Kvótát csak indokolt esetben ellenőrizz.
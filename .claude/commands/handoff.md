---
description: GRUNDO menetzárás — állapotfájl frissítése és átadás a következő beszélgetésnek
---

Zárd le a menetet. Lépések sorrendben:

1. **Ellenőrizd a repó állapotát**: `git status --short`, `git diff --stat`, és
   `git log --oneline -3`. A fájl-táblázat sorszámai innen jönnek, **soha ne
   emlékezetből**.
2. **Írd FELÜL** a `docs/ai/CURRENT_STATE.md`-t a jelenlegi állapottal. Ne
   toldd hozzá — a fájl a JELENT mutatja, nem a történetet. A meglévő
   szakaszcímeket tartsd meg: Jelenlegi cél · Amit a legutóbbi menet elvégzett ·
   Módosított fájlok · Élesben fut / telepítetlen · Elvégzett ellenőrzések ·
   Amit készüléken kell ellenőrizni · Nyitott ügyek · Modelljavaslat · Olvasási
   sorrend.
   - Ami már nem aktuális, azt **töröld**, ne archiváld a fájlban.
   - Legyen benne őszintén, **mit NEM ellenőriztél** (emulátor, készülék).
3. Ha tartós architektúra-döntés vagy „ezt soha ne csináld" tanulság született,
   vedd fel a `docs/ai/DECISIONS.md`-be — röviden, indoklással.
4. Ha a menet során olyan hibamintát követtél el, ami megismételhető, vedd fel
   a `.claude/rules/lessons.md`-be.
5. **Commitold** a változásokat (a `CURRENT_STATE.md` frissítése ugyanabba a
   commitba megy), majd **pushold**, és **szólj, hogy megvolt** — lásd
   `.claude/rules/git-and-deploy.md`.

Végül írd ki a záró üzenetet, csak ennyit:

- **fájl-táblázat**: fájl · ÚJ/MÓDOSÍTOTT · +/− sorok (`git diff --stat`) · egy
  mondat, mi változott;
- **teendők sorrendje**: push → adatbázis-lépés → melyik telepítés (szavakkal:
  frontend / backend / szabalyok / indexek — parancs nélkül);
- egy mondat: „a részletek a `docs/ai/CURRENT_STATE.md`-ben";
- **a következő beszélgetés nyitó üzenete**, pontosan másolható alakban:

  > Olvasd el a `CLAUDE.md`-t és a `docs/ai/CURRENT_STATE.md`-t, nézd meg a
  > `git status`-t és a `git diff`-et, és folytasd.

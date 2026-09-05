---
name: grundo-handoff
description: GRUNDO menetzárás — CURRENT_STATE.md frissítése, tartós döntések rögzítése, commit, push, és a következő beszélgetés nyitó üzenete. Használd a menet végén, vagy ha a felhasználó azt kéri, hogy „zárjuk le", „adj át", „készíts handoffot".
---

# Menetzárás

1. **Ellenőrizd a repó állapotát**: `git status --short`, `git diff --stat`,
   `git log --oneline -3`. A fájl-táblázat számai innen jönnek, **soha ne
   emlékezetből**.

2. **Írd FELÜL a `docs/ai/CURRENT_STATE.md`-t.** Ne toldd hozzá — a fájl a
   JELENT mutatja, nem a történetet; a történet a git logban van.

   A fejlécbe (a „Frissítve" sor mellé) mindig kerüljön két mező:
   - **Utoljára dolgozott:** ki/mi végezte az imént lezárt munkát, és milyen
     modell/komplexitás — pl. „Codex (Astra, Erős)" vagy „Codex (Sol,
     Erős)".
   - **Átadva:** kinek megy a munka most — „Claude", „ChatGPT" vagy „Codex".

   Lásd a névtáblázatot lent. Mivel a `CURRENT_STATE.md` minden menet végén
   commitolva van, a `git log -p -- docs/ai/CURRENT_STATE.md` visszamenőleg is
   megmutatja, melyik kört ki végezte.

   ⚠️ **Méretkorlát: normál esetben 50–100 sor.** Ha a fájl efölé nő, az azt
   jelenti, hogy történetet írsz bele. Ilyenkor:
   - ami már megtörtént és le van commitolva → **töröld** (a git őrzi);
   - ami tartósan korlátoz → **`DECISIONS.md`**;
   - ami hosszú, részletes elemzés → `docs/ai/archive/`, és csak hivatkozz rá.

   Szakaszok: Jelenlegi cél · Elkészült · Módosított fájlok · Élesben fut /
   telepítetlen · Ellenőrzések · Nyitott ügyek · Modelljavaslat. Legyen benne
   őszintén, **mit NEM ellenőriztél** (emulátor, készülék).

3. **Tartós döntés** (architektúra, „ezt soha ne csináld") → `docs/ai/DECISIONS.md`,
   röviden, indoklással.

4. **Új, megismételhető hibaminta** → a `grundo-lessons` skill fájljába.

5. **Commit + push, ha Geri kérte vagy korábban engedélyezte.** Más esetben a kész helyi változásokat add át; a menetzárás önmagában nem új push-felhatalmazás. Csak a saját feladathoz tartozó fájlokat stage-eld. A `CURRENT_STATE.md` frissítése ugyanabba a commitba megy.
   Commit-üzenet: első sor tömör Summary (max ~50 karakter), üres sor, majd
   felsorolásos Description, magyarul. Hosszú üzenetet fájlba írj és
   `git commit -F`-fel adj át. ⚠️ **Push után SZÓLNI KELL, hogy megvolt** —
   Geri a GitHub Desktopban követi a repót. A telepítés külön: `$grundo-deploy`.

## Névtáblázat — modell és komplexitás

A Codex modelljei: **Astra, Sol, Terra, Luna**. Erősségek és feladat szerinti
megfeleltetés: [models.md](../../models.md). Az átadóba a ténylegesen ismert
beállítást írd, az ajánlást külön. Más rendszer nevét csak valódi átadásnál használd.

## A záró chat-üzenet — csak ennyi

- **fájl-táblázat**: fájl · ÚJ/MÓDOSÍTOTT · +/− sorok (`git diff --stat`) · egy
  mondat, mi változott;
- **teendők sorrendje**: push → adatbázis-lépés → melyik telepítés, szavakkal:
  **frontend** / **backend** / **szabalyok** / **indexek** — ⚠️ parancs nélkül,
  és az „indexek" KÜLÖN van;
- egy mondat: „a részletek a `docs/ai/CURRENT_STATE.md`-ben";
- **a következő beszélgetés nyitó üzenete**, másolható alakban:

  > A `C:\Users\Geri\Documents\GitHub\grundo` mappában olvasd el az `AGENTS.md`-t, a `.codex/README.md`-t és a `docs/ai/CURRENT_STATE.md`-t, nézd meg a `git status`-t és a
  > `git diff`-et, és folytasd.

**Git-parancsot ne adj a felhasználónak.**

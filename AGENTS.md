# AGENTS.md — GRUNDO

**A projekt szabályai a [`CLAUDE.md`](CLAUDE.md)-ben vannak.** Ez a fájl csak
átirányítás, hogy minden ügynök (Claude, Codex, bármi más) ugyanazt olvassa —
így egyetlen helyen kell karbantartani.

## Kötelező olvasás minden munkamenet elején

1. [`CLAUDE.md`](CLAUDE.md) — a projekt, a tíz sérthetetlen szabály, a
   konvenciók, a parancsok (200 sor alatt, szándékosan)
2. [`docs/ai/CURRENT_STATE.md`](docs/ai/CURRENT_STATE.md) — hol tartunk, mi a
   következő lépés
3. `git status` és `git diff --stat`

Ezután **célzott kereséssel** nyisd meg azt, ami az adott feladathoz kell. Ne
olvasd végig a repót.

## A többi szabály — csak témába vágóan

| Fájl | Mikor |
|---|---|
| `.claude/rules/context-efficiency.md` | mindig: keresés, olvasás, kimenetkezelés |
| `.claude/rules/workflow.md` | mindig: modellválasztás, haladásjelzés, menetzárás, feladatbontás |
| `.claude/rules/testing.md` | teszt vagy build előtt |
| `.claude/rules/git-and-deploy.md` | commit, push, telepítés |
| `.claude/rules/native-and-release.md` | `android/`, `ios/`, GPS, értesítés |
| `.claude/rules/tooling-traps.md` | fájlírás, PowerShell, YAML/JSON |
| `.claude/rules/lessons.md` | mért tanulságok, ismert hibaminták |
| `docs/ai/DECISIONS.md` | amit nem szabad visszacsinálni, és miért |

⚠️ **Minden ügynök ebből az egy mappából dolgozik:**
`C:\Users\Geri\Documents\GitHub\grundo`. Ne hozz létre másik klónt; ha a
munkamenet más útvonalon indul, állj meg és szólj.

⚠️ **Geri felé minden chat-üzenet magyarul** (a kód és a kommentek angolul), és
**minden munka közbeni üzenet végén jelezd a haladást** százalékban, több
tételnél `x/y` alakban is. Részletek: `.claude/rules/workflow.md`.

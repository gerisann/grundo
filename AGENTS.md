# AGENTS.md — GRUNDO

**A projekt szabályai a [`CLAUDE.md`](CLAUDE.md)-ben vannak.** Ez a fájl csak
átirányítás, hogy minden ügynök ugyanazt olvassa — egy helyen kell karbantartani.

> **Claude Code-nak nem kell elolvasnia ezt a fájlt**: ő a `CLAUDE.md`-t és a
> `.claude/rules/` útvonalhoz kötött szabályait tölti be magától. Ez a fájl a
> Codexnek és más ügynököknek szól, amelyek `AGENTS.md`-t keresnek.

## Minden munkamenet elején

1. [`CLAUDE.md`](CLAUDE.md) — a projekt, a sérthetetlen szabályok, a parancsok
2. [`docs/ai/CURRENT_STATE.md`](docs/ai/CURRENT_STATE.md) — hol tartunk
3. `git status` és `git diff --stat`

Ezután **célzott kereséssel** nyisd meg, ami az adott feladathoz kell. Ne
olvasd végig a repót.

## Amit csak akkor olvass el, ha odanyúlsz

| Ha ehhez nyúlsz | Olvasd el |
|---|---|
| `src/game/`, `src/config/` | `.claude/rules/game-engine.md` |
| `server/` | `.claude/rules/server.md` |
| `src/screens/`, `components/`, `styles/`, `lib/`, `hooks/`, `store/` | `.claude/rules/frontend.md` |
| `android/`, `ios/`, `src/tracking/` | `.claude/rules/native.md` |
| `firebase.json`, `*.rules`, `.env*` | `.claude/rules/firebase-config.md` |
| tesztfájl | `.claude/rules/testing.md` |
| telepítés, kiadás | `.claude/skills/grundo-deploy/SKILL.md` |
| menetzárás, átadás | `.claude/skills/grundo-handoff/SKILL.md` |
| mért tanulságok, hibaminták | `.claude/skills/grundo-lessons/SKILL.md` |
| tartós döntések | [`docs/ai/DECISIONS.md`](docs/ai/DECISIONS.md) |

⚠️ **Minden ügynök ebből az egy mappából dolgozik:**
`C:\Users\Geri\Documents\GitHub\grundo`. Ne hozz létre másik klónt; ha a
munkamenet más útvonalon indul, állj meg és szólj.

⚠️ **Geri felé minden chat-üzenet magyarul** (a kód és a kommentek angolul), és
**minden munka közbeni üzenet végén jelezd a haladást** százalékban, több
tételnél `x/y` alakban is.

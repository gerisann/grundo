# AGENTS.md — GRUNDO / Codex

## Kötelező munkakönyvtár és kommunikáció

Minden GRUNDO-munkát kizárólag innen végezz:
`C:\Users\Geri\Documents\GitHub\grundo`.
Induláskor ellenőrizd az aktuális könyvtárat. Ha eltér, állj meg és szólj.
Ne hozz létre másik klónt vagy worktree-t; új feladatnál is a mentett projekt
közvetlen helyi (local) munkapéldányát használd.

Geri felé minden chat-üzenet magyarul legyen; kód és kommentek angolul.
Minden munka közbeni üzenet végén jelezd a haladást százalékban,
több tételnél `x/y` alakban is.

## Minden munkamenet elején

1. [`.codex/README.md`](.codex/README.md) — projekt, szabályok, Codex-munkarend.
2. [`docs/ai/CURRENT_STATE.md`](docs/ai/CURRENT_STATE.md) — aktuális állapot.
3. `git status --short` és `git diff --stat` — más forrás munkáját őrizd meg.
4. [skill-discovery.md](.codex/rules/skill-discovery.md).
5. [grundo-session-start](.codex/skills/grundo-session-start/SKILL.md)
   — az előbb már olvasott fájlokat ne olvasd újra.

A Codex projektutasításainak forrása a `.codex/` mappa.
A `CLAUDE.md` és `.claude/` a Claude saját munkarendje.
A közös termékspecifikáció forrása továbbra is `docs/`.
Ezután célzottan keress (`rg`); ne olvasd végig a repót.

## Feladathoz kötött kötelező olvasás

Módosítás előtt minden illeszkedő szabályfájlt olvass el.
A szabályok YAML `paths` mezője dokumentáció; Codexben a betöltést ez az
explicit táblázat biztosítja.

| Ha ehhez nyúlsz / ezt végzed | Olvasd el |
|---|---|
| `src/game/**`, `src/config/**`, `server/src/lib/activity*.ts` | [game-engine.md](.codex/rules/game-engine.md) |
| `server/**` | [server.md](.codex/rules/server.md) |
| `src/screens/**`, `src/components/**`, `src/styles/**`, `src/lib/**`, `src/hooks/**`, `src/store/**` | [frontend.md](.codex/rules/frontend.md) |
| `android/**`, `ios/**`, `src/tracking/**`, `capacitor.config.*` | [native.md](.codex/rules/native.md) |
| `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `.env*`, `src/lib/firebase.ts`, `server/server.ts` | [firebase-config.md](.codex/rules/firebase-config.md) |
| `**/*.test.ts`, `**/*.test.tsx`, `vite.config.ts`, tesztelési stratégia | [testing.md](.codex/rules/testing.md) |
| Telepítés, kiadás | [grundo-deploy](.codex/skills/grundo-deploy/SKILL.md) |
| Menetzárás, átadás | [grundo-handoff](.codex/skills/grundo-handoff/SKILL.md) |
| Mért tanulságok, hibaminták, mérés nélküli magyarázat vagy új megkötés | [grundo-lessons](.codex/skills/grundo-lessons/SKILL.md) |
| Modelljavaslat | [models.md](.codex/models.md) |
| Tartós döntések | [DECISIONS.md](docs/ai/DECISIONS.md) |
| Teljesítmény-optimalizáció (bármelyik oldal) | [PERFORMANCE_GOALS.md](docs/ai/PERFORMANCE_GOALS.md) |

A workflow-khoz a hivatkozott `SKILL.md` fájlt közvetlenül nyisd meg.
Nem szükséges, hogy a `.codex/skills` megjelenjen az alkalmazás skillválasztójában.
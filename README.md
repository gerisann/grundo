# GRUNDO

Közösségi mozgás-app területfoglalós játékkal. Futás, séta és kerékpározás
közben hexagon-cellákat foglalsz el a térképen: **zárd be a kört, és a
közrezárt terület a tiéd.**

> Fuss, sétálj vagy bringázz → zárd a kört → urald a területet → védd meg, ami a tiéd.
> És közben minden méter pontot ér — akkor is, ha nem zárul a kör.

## Indulás

```bash
npm install
cp .env.example .env.local     # töltsd ki
npm run dev
```

A backend külön fut:

```bash
cd server && npm install && npm run dev
```

## Fontos tudnivalók, mielőtt kódot írsz

1. **Olvasd el a [CLAUDE.md](CLAUDE.md)-t.** Abban vannak a projekt szabályai (az [AGENTS.md](AGENTS.md) is oda mutat).
2. **A `docs/` mappa a specifikáció** — magyarul, teljes egészében. Ha a kód és
   a spec eltér, a spec nyer.
3. **A Firestore adatbázis neve `grundo-db`**, nem a `(default)`. Ha ezt elrontod,
   minden „működni fog", csak rossz helyre kerülnek az adatok.
4. **A `src/game/` közös a szerverrel.** Ne tegyél bele platformfüggő kódot.

## Felépítés

```
src/
  config/     játékkonstansok — soha ne írj számot a logikába
  game/       A JÁTÉKMOTOR (kliens + szerver közös). Tiszta függvények.
  lib/        firebase, formázás, segédek
  screens/    képernyők
  components/ UI-elemek
  styles/     designrendszer (tokens.css) — beégetett szín tilos
server/       Cloud Run backend: az EGYETLEN hely, ahol játékadat íródik
docs/         a teljes specifikáció
scripts/      üzemeltetési szkriptek
```

## Parancsok

| Parancs | Mit csinál |
|---|---|
| `npm run dev` | fejlesztői szerver |
| `npm run build` | típusellenőrzés + éles build |
| `npm test` | tesztek (a pontrendszer számpéldái) |
| `npm run emulators` | Firebase emulátorok |
| `.\scripts\deploy-rules.ps1` | Firestore + Storage szabályok élesítése |

## Hol tartunk

A váz áll, a **játékmotor (`src/game/`) és a konfiguráció kész és tesztelt**.
A képernyők üres helyőrzők.

A javasolt sorrend és a kockázatok: `docs/06-architektura-es-admin.md`.
A kritikus út a **háttér-GPS** — ezt kell először valós terepen kipróbálni.

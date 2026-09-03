# Eszközhasználati csapdák

Mind mért eset. Mindegyik mögött konkrét kár áll.

## Backslash a Bash eszközön át

⚠️ **A visszaper (backslash) a Bash eszközön át elveszik vagy átfordul.** A
`\n` valódi sortörésként landol a fájlban, a sorvégi visszaper összeránthatja a
sorokat — akkor is, ha a heredoc határolója idézőjeles.

Ez háromszor fogott meg egyetlen menetben, és egyszer élesben elvitte a
buildet: a `cloudbuild.yaml` egy **megjegyzése** tette érvénytelenné a YAML-t.

**Ezért: visszapert tartalmazó tartalmat `Write`/`Edit` eszközzel írj**, ne
Bash heredockal. Ez érint minden Windows-útvonalat is
(`C:\Users\Geri\Documents\GitHub\grundo`).

Dokumentációba szánt parancsot **egy sorban** adj meg, sorvégi visszaper
nélkül.

## Szerkezetes fájlok

**YAML/JSON módosítása után validálj**, ne csak nézz rá. A hibás YAML a diffben
ártalmatlannak látszott.

```
node -e "JSON.parse(require('fs').readFileSync('firebase.json','utf8'))"
```

## PowerShell

- `npm.cmd`, `firebase.cmd`, `gcloud.cmd` — a `.cmd` kiterjesztés kell.
- **Nincs `&&`.** Helyette: `A; if ($?) { B }`.
- A `gcloud` / `gcloud.ps1` alak a futtatási házirend miatt elhasal.
- Hosszú szöveget (commit-üzenet) ne here-stringgel adj át — fájlba írd.

## Git Bash

- Az emulátoros parancsok elé kell a **Java PATH exportja**.
- A hosszú kimenetet szűrd (lásd
  [`context-efficiency.md`](context-efficiency.md)).

## Firestore-cache hamis „nincs ilyen dokumentum"

A helyi Firestore-gyorsítótár olyankor is „nincs ilyen dokumentum" választ
adhat, amikor a dokumentum létezik. Ha egy lekérdezés üres, de a konzolon ott
az adat: **ne a kódot kezdd javítani**, előbb ellenőrizd frissítéssel /
cache-megkerüléssel.

## Parancsokhoz kontextus

**Minden parancshoz mondd meg, HOL adja ki**: melyik alkalmazásban (Git Bash,
PowerShell, GitHub Desktop), melyik mappában, lépésenként.

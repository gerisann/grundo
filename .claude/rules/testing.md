# Teszt- és build-gazdálkodás

**Ne futtass feleslegeset.** A teljes készlet és a build kimenete drága, és a
harmadik lefutás ugyanazt mondja, mint a második.

## A ritmus

1. **Fejlesztés közben célzott futás** — csak az érintett tesztfájl:
   `npx vitest run src/game/loop.test.ts`
2. javítás,
3. újra célzott futás,
4. **a kör végén EGYSZER** a kötelező teljes ellenőrzés.

*Konkrét eset:* a 3. menetben háromszor futott le a teljes készlet, pedig kettő
elég lett volna — és minden futás teljes kimenete a kontextusba került.

## Mit mikor

| Ellenőrzés | Parancs | Mikor |
|---|---|---|
| Célzott teszt | `npx vitest run <útvonal>` | fejlesztés közben, mindig |
| Teljes készlet | `npm run test` | commit előtt, **egyszer** |
| Típusellenőrzés (gyökér) | `npx tsc --noEmit` | kör végén |
| Típusellenőrzés (szerver) | `cd server && npx tsc --noEmit` | kör végén, **külön** |
| Emulátoros készlet | `npm run test:emulator` | **csak** ha Firestore-viselkedés változott (tranzakció, lekérdezés, séma, szabály) |
| Production build | `npm run build` | ha a csomagméret/chunk a tét, vagy telepítés előtt |

⚠️ **A gyökér `tsc --noEmit` NEM ellenőrzi a `server/` mappát.** Ez már fogott
meg valódi típushibát, amit a gyökér-ellenőrzés zölden átengedett.

⚠️ **Git Bashben az emulátoros parancsok elé kell a Java PATH exportja.**

## A kimenet kezelése

- Szűrj: `npm run test 2>&1 | tail -25`, `| grep -E "FAIL|✗|Error"`.
- Nagy kimenetet mentsd fájlba, és **abban** keress — ne öntsd a beszélgetésbe.
- Egy zöld futásból egyetlen sor elég („681 zöld"). Csak a bukó teszt
  részletét idézd.

## Mérőeszközök — használd őket magyarázat helyett

A repo tele van mérőeszközzel: `src/game/fixtures.ts`, a Firestore emulátor,
`npm run inspect:world`, `npm run replay:world`, az `/admin/aktivitasok`
auditnézet. **Mérj, mielőtt magyarázol.** Ha mérés nélkül adsz magyarázatot,
mondd ki, hogy az feltételezés (lásd [`lessons.md`](lessons.md)).

## Amit nem tudsz teszttel bizonyítani

Natív viselkedést (háttér-GPS, hang, értesítés, engedély) **teszt nem
bizonyít**. Ha ilyet írtál, a kör végén sorold fel tételesen, mit NEM tudtál
ellenőrizni — ne állítsd késznek. Lásd
[`native-and-release.md`](native-and-release.md).

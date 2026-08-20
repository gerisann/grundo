# AGENTS.md — GRUNDO

Ez a fájl az AI ügynöknek szól. **Olvasd el teljesen, mielőtt bármit írsz.**

## Mi ez a projekt

A GRUNDO közösségi mozgás-app: futás, séta és kerékpározás közben a felhasználók **területet foglalnak el egy hexagon-rácson**. A cél nem elsősorban a versengés, hanem hogy **mozgásra ösztönözze az embereket** — ezért a területfoglalás mellett egy különálló pontrendszer (GP) is fut, ami az aktivitást önmagában jutalmazza.

> Fuss, sétálj vagy bringázz → zárd a kört → urald a területet → védd meg, ami a tiéd.
> És közben minden méter pontot ér — akkor is, ha nem zárul a kör.

## A teljes specifikáció

A `docs/` mappában van, magyarul. **Ez az igazság forrása.** Ha a kód és a spec eltér, a spec nyer — vagy szólj, hogy a spec hibás.

| Fájl | Mit tartalmaz |
|---|---|
| `docs/README.md` | Index, alapkonstansok, a 11 rögzített döntés |
| `docs/01-kepernyoterkep.md` | Képernyők, navigáció, design-nyelv |
| `docs/02-funkcionalis-spec.md` | Képernyőnkénti funkciók, privát zóna, Pro, értesítések |
| `docs/03-jatekszabalyok.md` | **A hexrács, a bezárás, a védelem, a Trust Score** |
| `docs/04-pontrendszer.md` | A GP-képlet számpéldákkal |
| `docs/05-adatmodell.md` | Firestore séma, indexek, biztonsági szabályok |
| `docs/06-architektura-es-admin.md` | Szolgáltatások, jobok, admin, ütemterv |

## A tíz legfontosabb szabály, amit sosem szabad megsérteni

1. **A terület hexagon-cellák halmaza**, nem szabad alakú poligon. H3 res 12, cellánként 307,09 m². Soha ne vezess be poligon-algebrát (turf.js boolean műveletek) a területszámításba.
2. **A bezárás = önmetszés.** Nem kell visszaérni a rajthoz. A belső cellákat flood fill adja meg. Egy aktivitás alatt több bezárás is lehet.
3. **A területszámítás mindig a TELJES nyomvonalból megy**, a privát zóna levágásától függetlenül. A levágás kizárólag megjelenítési művelet.
4. **A `src/game/` modul közös a kliens és a szerver között.** Ugyanaz a kód fut mindkét oldalon, ezért az élő előnézet és a végleges eredmény bitre azonos. Ne ágazz el platform szerint ebben a modulban, és ne használj benne se DOM-ot, se Firebase-t, se Node-specifikus API-t.
5. **A kliens soha nem ír játékadatot.** Terület, GP, szint, jelvény, előfizetés, bizalmi pontszám: kizárólag szerveroldalról (`server/`). A Firestore-szabályok ezt kikényszerítik — ne lazíts rajtuk.
6. **A Trust Score sosem publikus.** Se a szám, se a részjelek nem kerülhetnek kliensre. Csak a verdikt (`trusted` / `pending_review` / `rejected`).
7. **A gyanús aktivitás látszik, de nem módosít birtokviszonyt.** Nem tüntetjük el a felhasználó futását.
8. **A Pro nem ad játékbeli előnyt.** Se több pontot, se erősebb védelmet. Csak kényelmi és közösségi funkciókat.
9. **Terület mértékegysége m²**, 1 000 000 m² fölött km². Használd a `src/lib/format.ts` `formatArea()` függvényét — sehol ne formázz kézzel.
10. **Minden játékkonstans a `src/config/gameplay.ts`-ben van.** Soha ne írj be számot közvetlenül a logikába.
    A **hangolható** konstansokat élesben az `appConfig/gameplay` felülírhatja — a sémájuk a `src/config/tunables.ts`-ben van, magyar leírással, mert ugyanabból él az admin szerkesztő és a felhasználói szabálymagyarázó. A **szerkezeti** konstansok (H3 felbontás, cellaterület, `MAX_DEFENSE`, hurokküszöbök, szintlépcső) NEM hangolhatók: ne vedd fel őket a `TUNABLES` közé.
    A játékmotor a konfigurációt **paraméterként** kapja (`cfg`), nem importként. Egy aktivitás feldolgozása a legelején pillanatképet vesz, és végig azzal számol — egy futás soha ne számoljon félig a régi, félig az új szabállyal.

## Nevek — olvasd el, mielőtt bármit beírsz

A projektben **három, egymáshoz megtévesztően hasonló név** van. Nem elírás, mindegyik szándékos:

| Név | Mi ez | Hol szerepel |
|---|---|---|
| **GRUNDO** | az app / termék neve | felületi szövegek, `metadata.json`, `index.html` |
| **`grundo`** | a Firebase **projekt** azonosítója | `.firebaserc`, `VITE_FIREBASE_PROJECT_ID`, authDomain, storage bucket |
| **`grundo-db`** | a Firestore **adatbázis** neve | `firebase.json`, `getFirestore(…)` hívások |

Ha valahol bizonytalan vagy, **ne találgass** — a `.env.example` fejlécében is ott van mindhárom.

## Firestore: dedikált adatbázis

A GRUNDO **nem** az alapértelmezett Firestore adatbázist használja, hanem egy dedikáltat:

```
grundo-db
```

Ez három helyen van rögzítve, és **mindháromnak egyeznie kell**:

| Fájl | Amit tartalmaznia kell |
|---|---|
| `firebase.json` | `"firestore": [{ "database": "grundo-db", ... }]` — **tömb** alak, ez a többadatbázisos mód |
| `src/lib/firebase.ts` | `getFirestore(app, 'grundo-db')` |
| `server/server.ts` | `getFirestore(adminApp, 'grundo-db')` |

> Ha a második paraméter lemarad, a hívás csendben a `(default)` adatbázisra megy.
> Minden „működni fog", csak rossz helyen keletkeznek az adatok — és ez tipikusan
> hetekkel később, éles adaton derül ki. Soha ne hívj `getFirestore()`-t máshol;
> mindig a `db` példányt importáld.

## Technikai konvenciók

- **Nyelv:** TypeScript, `strict: true`. `any` nem elfogadható.
- **UI nyelve:** magyar. A kód, a változónevek és a kommentek angolul.
- **Stílus:** CSS-változók a `src/styles/tokens.css`-ből. **Két téma: világos (alapértelmezett) és sötét.**
  Ne írj beégetett színt, és **minden képernyőt nézz meg mindkét témában**, mielőtt késznek nyilvánítod.
  A témalogika a `src/lib/theme.ts`-ben van (mód, napnyugta-számítás, DOM-alkalmazás) — ne duplikáld máshol.
- **Térkép:** Mapbox GL. A tokent környezeti változóból vedd.
- **Állapot:** TanStack Query a szerveradatra, `zustand` a helyi UI-állapotra. Ne vezess be Redux-ot.
- **Firestore:** olvasás közvetlenül a kliensről, írás csak a saját, engedélyezett mezőkre. Minden más a `server/` HTTP-végpontjain át.
- **Hibakezelés:** minden szerverhívás hibája felhasználónak érthető magyar üzenetet kapjon. Ne dobj nyers stack trace-t a felületre.

## Mappaszerkezet

```
src/
  config/     játékkonstansok (gameplay.ts) — a spec 04. fejezetéből
  game/       A JÁTÉKMOTOR. Tiszta függvények, közös a szerverrel. Ide ne kerüljön I/O.
  lib/        firebase, mapbox, formázás, segédfüggvények
  screens/    a képernyők (Home, Territory, Tracking, Community, Profile, Settings…)
  components/ újrahasznosítható UI-elemek
  hooks/      React hookok
  store/      zustand store-ok
  types/      közös típusok
  styles/     tokens.css + globális stílus
server/
  server.ts   Cloud Run belépési pont
  src/routes/ HTTP-végpontok (activities, tiles, missions)
  src/trust/  Trust Score számítás
  src/jobs/   ütemezett feladatok (napi forduló, ranglista…)
scripts/      egyszeri és üzemeltetési szkriptek
public/       statikus fájlok, ikonok, manifest
tmp/          átmeneti fájlok — soha ne kerüljön verziókövetésbe
_archive/     leváltott kód, amit még nem törlünk
vendor/       harmadik féltől származó, módosított kód
```

## Hol tartunk

A váz üres. A `src/game/` motor és a konfiguráció **kész és működik** — erre lehet építeni. A képernyők üres helyőrzők.

**A javasolt sorrend** (részletesen: `docs/06-architektura-es-admin.md` ütemterv):

1. **F0** — belépés/regisztráció + OTP, profil, dock-navigáció, designrendszer
2. **F1** — tracking (háttér-GPS!), aktivitás mentése, aktivitás részletek, feed
3. **F2** — a játék: `geo-service`, Terület képernyő, ranglisták, GP, napi jobok
4. **F2.5** — küldetés-ajánló
5. **F3** — közösség · **F4** — Pro és statisztikák · **F5** — konnektorok · **F6** — indulás

**A legkockázatosabb rész a háttér-GPS.** Ezt kell először valós terepen kipróbálni, mert minden más azon áll vagy bukik.

## Amit kérdezz meg, ne találj ki

- Ha egy játékszabály nincs a `docs/` alatt, **ne improvizálj** — kérdezd meg. A játékegyensúly nem tetszőleges.
- Ha egy külső szolgáltatás kulcsa kell (Mapbox, Firebase, konnektorok), kérd el; ne generálj helyőrzőt, ami később élesben marad.
- Ha a spec két helyen ellentmond magának, jelezd, ne válassz magadtól.
- Ha egy név ellentmond annak, amit a felhasználó mondott, **állj meg és kérdezz** — ne „rögzítsd" a másik változatot. Ez egyszer már egy fölösleges, második Firestore adatbázist eredményezett.

---

# Munkamódszer — az ügynöknek magáról

Ez a szakasz nem a GRUNDO-ról szól, hanem arról, **hogyan dolgozz**. Mért
tapasztalatokból készült: minden pont mögött egy konkrét eset áll, ami időbe,
pénzbe vagy éles hibába került. Olvasd el minden munkamenet elején.

Utána, ha van a repo gyökerében `HANDOFF.md`, azt is olvasd el — az adja az
aktuális állapotot (részletek: [6. Átadási protokoll](#6-átadási-protokoll)).

## 0. Minden kör elején: modelljavaslat

**A valós munka megkezdése ELŐTT mondd meg, melyik modell és milyen
gondolkodási mélység elég a feladathoz, és miért.** Ez nem formalitás: a
használati limit tokenben mér, és a legerősebb modell rutinmunkára pazarlás.

| Feladat jellege | Javaslat |
|---|---|
| Felület-építés, tesztírás, rutin átalakítás, dokumentáció | **Sonnet**, normál mélység |
| Meglévő minta kiterjesztése (új végpont a meglévő mintára) | **Sonnet**, normál mélység |
| Spec-ellentmondás feloldása, adatmodell-döntés, algoritmus vagy teljesítmény | **Opus**, emelt mélység |
| Mért anomália hibakeresése (a szám nem stimmel, és nem tudjuk, miért) | **Opus**, emelt mélység |

A javaslat legyen egy mondat, ne fejtegetés. Ha a kör közben tervezési
elágazáshoz érsz, mondd ki, hogy innentől erősebb modell kellene.

## 1. Mérj, ne feltételezz

**Ez a visszatérő hibám.** Eddig legalább négyszer tippeltem mellé olyan
kérdésben, amit meg lehetett volna mérni — és a mérés mindannyiszor mást
mondott, mint a józan ész:

- a sorozat „rejtélyes" viselkedésének oka (valójában egy commit dátuma),
- a res 11 felbontás játékmenetbeli ára,
- a `MIN_INTERIOR_CELLS` 4-re emelésének indoklása (320 futásos zajmodell
  cáfolta),
- az emulátoros suite-ok együttes futása (külön mind zöld, együtt kilenc bukó).

A repo tele van mérőeszközzel: `src/game/fixtures.ts`, a Firestore emulátor,
`npm run inspect:world`, `npm run replay:world`, a `/admin/aktivitasok` audit.
**Mérj, mielőtt magyarázol** — és ha magyarázatot adsz mérés nélkül, mondd ki,
hogy az feltételezés.

## 2. Tesztgazdálkodás — ne futtass feleslegeset

- **Fejlesztés közben célzott futás**: csak az érintett tesztfájl.
- **Commit előtt egyszer** a teljes készlet. Nem kétszer, nem háromszor.
- **Emulátoros készlet** (`npm run test:emulator`) csak akkor, ha Firestore-
  viselkedés változott (tranzakció, lekérdezés, séma, szabály).
- **Production build** csak akkor, ha a csomagméret vagy a chunk-felosztás a
  tét, illetve az átadás előtt egyszer.
- A kimenetet szűrd (`| tail`, `| grep`), ne öntsd be egészben a kontextusba.

*Konkrét eset:* a 3. menetben háromszor futott le a teljes készlet, pedig kettő
elég lett volna — és minden futás teljes kimenete a kontextusba került.

## 3. Kontextus-gazdálkodás

A limit tokent mér, és **minden eszközhívásnál a teljes addigi beszélgetés újra
elmegy**. A századik hívás ugyanazért a munkáért sokszorosába kerül, mint az
első.

- **Egy menet = egy munkamenet.** A menet végén frissítsd a `HANDOFF.md`-t, és
  a következő menet új beszélgetésben induljon.
- **Ne olvass be teljes fájlt**, ha egy tartomány elég (`sed -n`, `offset`).
- Ne ismételd a kontextusban már meglévő tényeket.
- **Jelezd, amikor új beszélgetés indítása hatékonyabb lenne — ne várd meg,
  hogy megkérdezzék.** Egy mondat elég, a folyó munka végén: mi az ok, és mi
  kerül a `HANDOFF.md`-be. Tipikus jelek:
  - egy logikai egység (menet, funkció) lezárult, és a következő lépés
    tervezéssel vagy más témával indulna,
  - a beszélgetés már sok nagy eszközkimenetet hordoz (teljes fájlok, hosszú
    teszt- vagy build-log), és a hátralévő munka ezekre már nem hivatkozik,
  - modellváltás indokolt lenne (0. pont), és az úgyis új menetet jelent.
  Ha egy apró javítás van hátra ugyanabban a témában, ne szakítsd meg csak
  azért, mert „elég sok minden történt" — a szál közepén vágni drágább, mint
  végigvinni.

## 4. Eszközhasználati csapdák

- ⚠️ **Backslash a Bash eszközön át elveszik vagy átfordul.** A `\n` valódi
  sortörésként landol a fájlban, a sorvégi `\` összeránthatja a sorokat — akkor
  is, ha a heredoc határolója idézőjeles. Ez háromszor fogott meg egyetlen
  menetben, és egyszer élesben elvitte a buildet (a `cloudbuild.yaml` egy
  megjegyzése tette érvénytelenné a YAML-t). **Backslash-t tartalmazó tartalmat
  Write/Edit eszközzel írj.**
- **Szerkezetes fájl (YAML/JSON) módosítása után validálj**, ne csak nézz rá.
  A hibás YAML a diffben ártalmatlannak látszott.
- Dokumentációba szánt parancsot **egy sorban** adj meg, sorvégi `\` nélkül.
- **PowerShell**: `npm.cmd`, `firebase.cmd`, `gcloud.cmd`, és nincs `&&`.
  A `gcloud`/`gcloud.ps1` alak a futtatási házirend miatt elhasal.
- **Git Bash**: az emulátoros parancsok elé kell a Java PATH exportja.

## 5. Amikor korlátot vezetsz be, nézd meg a gyakori utat

Egy őrszem, ami a ritka hibát kizárja, könnyen ellehetetleníti a leggyakoribb
műveletet. *Konkrét eset:* a modifierek „múltbeli kezdés tilos" szabálya
helyes volt szerkesztésre, de létrehozásra a leggyakoribb esetet (`induljon
most`) tette volna használhatatlanná, mert az űrlap a megnyitás idejével nyílik.

Új megkötés után mindig kérdezd meg: **mi történik a normál használatnál?**

## 6. Átadási protokoll

**Az átadó szöveg mostantól a `HANDOFF.md`-ben él** (repo gyökér), nem a záró
chat-üzenetben — ez a token-spórolás lényege: a felhasználónak nem kell
átmásolnia egy hosszú szöveget, az új beszélgetés nyitó üzenete elég, ha erre
a fájlra hivatkozik, te pedig egyetlen `Read`-del betöltöd.

- **Menet végén írd/frissítsd felül a `HANDOFF.md`-t**, ne toldd — a fájl
  mindig a JELENLEGI állapotot mutatja, nem a történetet. A történet úgyis ott
  van a git logban és a commit-üzenetekben.
- A `HANDOFF.md` tartalma ugyanaz, ami korábban a chat-átadóban volt: ÁLLAPOT
  (repo, ág, HEAD, tesztek), ÉLESBEN FUT / TELEPÍTETLEN, KÖVETKEZŐ MENET terve,
  NYITOTT KISEBB ügyek, és a 0. pont szerinti MODELLJAVASLAT a következő
  menetre.
- A **záró chat-üzenetben** ezután csak ennyi marad:
  - **fájl-összefoglaló táblázat** — fájlonként ÚJ vagy MÓDOSÍTOTT, a
    hozzáadott/törölt sorok száma `git diff`-ből (soha ne emlékezetből), egy
    mondat arról, mi változott,
  - **teendők sorrendje**: push → adatbázis-lépés → melyik telepítés,
  - egy mondat: „a részletek a `HANDOFF.md`-ben”.
- **A telepítő parancsokat ne írd ki**: elég a szó — **frontend**, **backend**,
  **szabalyok**, **indexek**. ⚠️ Az „indexek" KÜLÖN van, a „szabalyok" nem
  tartalmazza. Cloud Shell-parancsot viszont adj, ha nem rutinszerű.
- **Git-parancsot ne adj a felhasználónak.**
- **A commit az enyém** (2026-08-19-től), a **push és a telepítés az övé**. A
  `HANDOFF.md` frissítése ugyanabba a commitba kerül, mint a menet többi
  változása. A commit-üzenet első sora tömör Summary (max ~50 karakter), utána
  üres sor és felsorolásos Description. Magyarul.
- Hosszú commit-üzenetet fájlba írj és `git commit -F`-fel adj át — a
  PowerShell here-string alak a Bash eszközben nem működik.
- **Minden parancshoz mondd meg, HOL adja ki**: melyik alkalmazásban, melyik
  mappában, lépésenként.

## 7. A beszélgetések neve

A munkamenetek neve **`GRUNDO #1`, `GRUNDO #2`, …** — növekvő sorszámmal, hogy
később hivatkozni lehessen rájuk. Az átadó mindig nevezze meg, melyik számról
melyikre adunk át. A konvenció 2026-08-19-én indult; az azelőtti munkamenetek
számozatlanok.

⚠️ **A sorszám a BESZÉLGETÉSEKÉ, nem a munkameneteké.** Azt kell nézni, hány
chat van a Claude Code-ban, nem azt, hányszor futott le egy menet — Geri
pontosított 2026-08-20-án, amikor a `HANDOFF.md` #8-at írt, miközben az ötödik
beszélgetés folyt. Ha a kettő eltér, a beszélgetés száma az igazság, és a
`HANDOFF.md`-t ahhoz kell igazítani.

## 8. Ismert hibamintáim

- **Túlnyúlok a kérésen.** Commitoltam kérés nélkül, és kiírtam telepítő
  parancsokat, amiket kifejezetten nem kértek. Ha egy lépés a felhasználóé,
  hagyd nála.
- **Hosszú válaszok.** Amire tényleg szükség van: a fájl-táblázat, a mérési
  eredmény és a következő lépés. A többi legyen rövid.
- **Külső szolgáltatót vettem fel magamtól** (Resend), pedig volt saját
  levelezés. Ha a meglévő infrastruktúra megoldja, ne hozz be harmadik felet.
- **A saját korábbi állapotomból indulok ki** a friss HEAD helyett. A repóban
  más forrás is dolgozik; mindig a friss `HEAD`-ből indulj.

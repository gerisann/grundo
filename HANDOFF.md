# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #7.** (A számozás a BESZÉLGETÉSEKÉ, nem a
munkameneteké: azt kell nézni, hány chat van. Lásd [AGENTS.md → 7. A
beszélgetések neve](AGENTS.md).)

## ÁLLAPOT

Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`. HEAD: `2f1050b`.

Tesztek, most mérve: `npm test` → **356 zöld** (25 fájl). `npm run
test:emulator` → **107 zöld** (9 fájl). Typecheck (gyökér ÉS `server/`)
hibamentes. A menet 23 unit és 7 emulátoros tesztet adott hozzá.

## ⚠️ ELSŐ OLVASATRA: MI KELL A TELEPÍTÉSHEZ

Két dolog vár telepítésre: az előző menet KERESÉS funkciója (`e21a49c`) és
ez a menet, az **F2.5 küldetés-ajánló** (`2f1050b`).

1. **⚠️ ELŐSZÖR: `MAPBOX_TOKEN` a szervernek.** Ez az egyetlen ÚJ
   konfiguráció, és nélküle a küldetés-ajánló nem működik (érthető 503-at
   ad, nem omlik össze). Nyisd meg a `cloudbuild.yaml`-t, és a
   `_MAPBOX_TOKEN: ''` sorba írd be UGYANAZT a tokent, ami a frontend
   `.env.local`-jában a `VITE_MAPBOX_TOKEN`. **NEM titok** — ugyanez a
   token benne van minden kiszolgált kliens-bundle-ben, ezért nem Secret
   Manager. Alternatíva a fájl szerkesztése helyett:
   `gcloud builds submit --config cloudbuild.yaml --substitutions=_MAPBOX_TOKEN=pk.xxx`
2. **frontend + backend** telepítés.
3. Szabályok NEM kellenek.
4. Indexek NEM kellenek.
5. Migráció NEM kell.

## EBBEN A MENETBEN ELKÉSZÜLT: F2.5 — KÜLDETÉS-AJÁNLÓ

A docs `06` ütemterve ezt a fázist emeli ki a legkritikusabbnak („az
onboarding és a visszatérés szempontjából kritikus — nem szabad az F4-be
csúsztatni"), és eddig el sem indult. Most kész.

### Miért nem útvonaltervező

A bemenet IDŐ, nem távolság: „van 45 perced?". A célhosszt a szerver
számolja a felhasználó SAJÁT átlagtempójából (a legutóbbi 10 azonos típusú
aktivitásból; ha nincs elég, a típus szerinti alapérték). Így nem kell fejben
átváltania, hogy nála 45 perc hány kilométer.

### A menet

1. **Kör-jelöltek nyolc irányban.** Minden irányhoz egy kör, ami ÁTMEGY a
   kiinduló ponton (a középpont az adott irányban van, sugárnyi távolságra).
   A sugarat a `MISSION_DETOUR_FACTOR` (1,25) korrigálja: a valódi útvonal
   negyedével hosszabb a mértani körnél, mert utcákon megy.
2. **Valódi úthálózat** — Mapbox Directions, irányonként egy hívás,
   párhuzamosan (`server/src/lib/directions.ts`). Egy elhasalt jelölt nem
   viszi el a generálást, csak kimarad.
3. **Tűrés**: a célhossztól ±15 %-nál távolabbi jelölt kiesik (docs/02).
4. **Kiértékelés a VALÓDI motorral** — `processActivity`, ugyanaz a
   függvény, ami a mentésnél a területet adja. ⚠️ **Nincs külön becslő
   algoritmus**, ami elcsúszhatna az élestől: amit a küldetés ígér, azt a
   felhasználó meg is kapja, ha végigmegy rajta.
5. **Válogatás** karakterenként (lásd lent).

### A négy karakter

| Karakter | Mit mér | Kártyaszöveg |
|---|---|---|
| Hódítás | szabad mezők | „…új területet szerezhetsz" |
| Rajtaütés | elvehető mezők | „elvehetsz X-t Y grundjából" |
| Erősítés | saját mezők (védelem nő) | „N mező védelme nő" |
| Felfedezés | ismeretlen körzetek | „N körzet, ahol még egyetlen meződ sincs" |

**A kiosztás SORREND-FÜGGETLEN.** Nem egyszerűen végigmegyünk a
karaktereken (akkor az első mindig előnyt élvezne): minden (jelölt,
karakter) párt a SAJÁT karakterén belül normalizálunk, és a globálisan
legerősebb pár nyer. Unit teszt rögzíti.

**Nem ajánlunk fel ugyanolyat kétszer**: ha két jelölt cellahalmaza
Jaccard > 0,6 arányban fedi egymást, a gyengébbik kiesik — különben a
felhasználó ugyanazt a kört látná két címkével.

### Adatvédelem (docs/02 → Adatvédelmi korlát)

Mindhárom szabály SZERVEROLDALON dől el (`resolveVictimNames`):

- név csak **publikus** fióknál; privát fióknál „egy helyi játékostól";
- a **tiltás mindkét iránya** kizár (`blocks` és `blockedBy`);
- **ugyanaz a személy naponta legfeljebb egyszer** lehet célpont — a napi
  lista a `users/{uid}/private/missionTargets` dokumentumban.

### Kvóta

Ingyenes heti 5 (`FREE_ROUTE_GENERATIONS_PER_WEEK`), Pro korlátlan. A
számláló a `users/{uid}.missionQuota` mezőben, hetente nullázódik.

### Home — „A mai küldetésed"

⚠️ **A Home SOSEM generál küldetést.** A generálás kvótás és API-t fogyaszt;
ha minden Home-betöltés kérne egyet, két nap alatt elégetné a heti keretet
anélkül, hogy a felhasználó bármit kért volna. Ehelyett a Küldetések
képernyőn már legenerált legjobb ajánlatot mutatja (`src/lib/dailyMission.ts`,
localStorage), és **a tegnapit sosem hozza vissza** — egy elavult ajánlat
olyan területet ígérne, ami közben már gazdát cserélt. Ha nincs mai
ajánlat, a kártya odahív.

### Amit egy teszt fogott meg

A **Felfedezés** karakter végig VÉDETT idegen zónára is ajánlatot gyártott.
Ott minden cella áttörés, egyetlen mező sem cserél gazdát — a kártyán „3 új
körzet" állt volna, a Terület rovatban meg nulla. Csapda lett volna.
Javítva: felfedezéshez szerezni is kell valamit (`kindScore` → `explore`).
Emulátoros teszt rögzíti (`missionEvaluate.emulator.test.ts`).

Ugyanez a logika az **Erősítés** kártyán is előjött, de ott a nulla HELYES —
ott nem szerzés történik. A kártya emiatt karakterenként mást mér: erősítésnél
„Megerősített terület", máshol „Új terület".

## ⚠️ AMIT EZ A MENET NEM TUDOTT ÉLŐBEN KIPRÓBÁLNI

**A valódi Mapbox Directions hívást.** Ebben a fejlesztői környezetben
NINCS Mapbox-token (a `.env.local` csak `VITE_API_BASE_URL`-t és VAPID-kulcsot
tartalmaz; a Grund képernyő térképe is emiatt írja, hogy „a térképhez
Mapbox-token kell"). Amit ellenőriztem helyette:

- a lánc drága fele — vonallánc → cellák → hurkok → birtokviszony → GP →
  válogatás — **emulátoron, valódi Firestore ellen**, szintetikus hurokkal
  (7 teszt: szabad terep, védtelen idegen, védett idegen, saját, felfedezés,
  blokk-plafon);
- a geometria és a válogatás **23 unit teszttel**;
- a **503-as ág élőben** (token nélkül tiszta, érthető hibaüzenet);
- a **felület élőben**, mind a négy kártyatípussal, a Home-kártyával, a
  navigációval és a sötét témával.

**Telepítés után ezt kell megnézni**: hogy a Directions valóban ad-e
bezáródó köröket a valódi utcahálózaton, és hogy a `MISSION_DETOUR_FACTOR`
(1,25) eltalálja-e a célhosszt. Ha sok jelölt esik ki a ±15 %-os tűrésen,
ez a szorzó a hangolandó érték.

## NYITOTT, KISEBB

- ⚠️ **`formatArea` mindig km²-t ír**, pedig a spec (docs/README
  alapkonstansok, AGENTS.md 9. szabály) 1 000 000 m² alatt m²-t kér —
  „12 000 m²" helyett „0,012 km²" jelenik meg mindenütt. Nem ebben a
  menetben keletkezett, és app-szintű megjelenítési változás lenne
  (ranglista, pódium, profil, aktivitás, küldetés), ezért nem nyúltam
  hozzá. Külön háttérfeladatként jelezve.
- A küldetés **„Indítás most" gombja a rögzítés képernyőre visz, de az
  útvonalat még nem viszi magával** navigációként a térképre (docs/02 ezt
  is kéri). A `polyline` a kártyán megvan, tehát a rávezetés kis munka.
- **Mentett útvonalak** (docs/02) — a küldetés mentése még nincs meg.
- **Szűrők** (kevés útkereszteződés · zöldterület · lapos terep) — a
  Directions API támogat kizárásokat, de ez még nincs bekötve.
- A követő-lista nem lapoz (max 100, `hasMore` jelzéssel).
- A harang olvasatlan-száma a betöltött ablakból számol (20 elem).
- A `modifier_started` broadcast szűrés nélkül megy mindenkihez.
- Az időjárás csak akkor jelenik meg magától, ha van tárolt pozíció.
- gpLedger-takarítás — előkészítve, futtatásra vár
  (`server/src/scripts/cleanGpLedgerJunk.ts`).
- A követési KÉRÉSEK elbírálására még nincs felület.
- Területi hatókörű hold-modifier nem hat: a `zones` kollekció még nincs meg.
- **Aktív akciók a térképen** — korábbról áthúzódó (`src/game/modifiers.ts`
  → `areaCells`, csak `scope: 'area'`-nál van geometria).
- A push-küldés és a `NotificationPanel` élő ellenőrzése valódi eszközön.

## HOL TARTUNK AZ ÜTEMTERVBEN (docs/06)

| Fázis | Állapot |
|---|---|
| F0 — Alapozás | ✅ kész |
| F1 — Tracking és aktivitás | ✅ kész |
| F2 — A játék | ✅ kész, sőt túlteljesítve (modifierek, időablakos ranglista) |
| **F2.5 — Küldetés-ajánló** | ✅ **ebben a menetben elkészült** |
| F3 — Közösség | 🟡 félkész: követés/tiltás/like/komment/értesítés/jelentés/keresés megvan; **üzenetek, klubok, kihívások, felfedezés, útlevél** nincs |
| F4 — Mélység és bevétel | 🟡 csak a jelvények; statisztikák, útvonalak, edzés, Pro/paywall nincs |
| F5 — Konnektorok | ❌ nincs elkezdve |
| F6 — Éles indulás | 🟡 élesben fut, de a formális checklist (terheléspróba, audit, store) nincs |

**A következő logikus lépés F3**, és azon belül Geri korábbi választása
szerint a közösségi rész folytatása. A legkisebb önálló darab az
**Üzenetek** (1:1 chat, a profil „Üzenet" gombja már odamutat); a legnagyobb
a **Klubok** (tagság, szerepek, meghívókód, klub-feed, klub-ranglista).

## ÉLESBEN FUT

- Napi forduló, admin felület, futásidejű konfiguráció (`appConfig/gameplay`
  v1, „Gazdagrét Rush" akció — ellenőrizd, nem járt-e le), jelvény-katalógus.
- Az előző menet 1–6. pontja (mentés-átirányítás, időjárás, flat ikonok,
  ranglista + pódium + napi/heti/havi bontás), a 8 ranglista-index és
  mindkét migráció (`backfill:blocked-by`, `backfill:area-windows`) —
  mind lefutott, az indexek READY állapotban.

## TELEPÍTETLEN

- `e21a49c` — felhasználónév-keresés (frontend + backend, semmi más)
- `2f1050b` — F2.5 küldetés-ajánló (frontend + backend + `MAPBOX_TOKEN`)

## Fejlesztői előnézet

**Írás nélküli, csak-olvasó ellenőrzéshez** (éles adaton):

1. `.claude/launch.json` a `G:\Saját meghajtó\WORK\CLAUDE` gyökérben —
   `grundo-dev` (éles API) vagy `grundo-emulator` (helyi emulátor).
2. `server/`-ből `GOOGLE_CLOUD_PROJECT=grundo PORT=8080 npx tsx watch server.ts`.
3. `grundo/.env.local`-ban `VITE_API_BASE_URL=http://localhost:8080`.

**ÍRÓ funkcióhoz a helyi emulátor**:

1. `export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"`
   (Git Bash-ben mindig kell, a Java PATH-ja nélküle nem látszik).
2. `firebase emulators:start --only auth,firestore --project demo-grundo`
   (Bash-ben `firebase`, `.cmd` nélkül — a globális npm-bin a PATH-on van).
3. `server/`-ből `npm run seed:emulator`, majd `npm run dev:emulator`.
4. Gyökérből `npm run dev:emulator` (vagy a `grundo-emulator` launch-konfig).
5. Böngészőben: `await __grundoDevSignIn()`.

⚠️ **Port-ütközés**: az `npm run test:emulator` saját `emulators:exec`-et
indít — ha közben kézzel is fut egy példány, a portok ütköznek. Előbb állítsd
le a kézit (`Get-NetTCPConnection -LocalPort 8081,9099 | Stop-Process`).

⚠️ A Browser pane **screenshotja ebben a munkamenetben sem volt elérhető** —
a vizuális ellenőrzés `read_page`, `get_page_text` és `javascript_tool`
(számított stílusok, DOM-tartalom) kombinációjával ment. Ez az út működik:
a `getComputedStyle`-lal a témák is ellenőrizhetők.

💡 **Mapbox-token nélküli felület-ellenőrzés**: a küldetés-kártyák
megjelenítését `window.fetch` kiváltásával néztem meg (szintetikus válasz a
`/api/missions/generate`-re) — így a négy kártyatípus, a szövegek és a
Home-kártya token nélkül is végigkattintható.

## Infrastruktúra: éles, csak olvasó Firestore-hozzáférés

Változatlan. `grundo-reader@grundo.iam.gserviceaccount.com`
(`roles/datastore.viewer`), Geri (`gergely.marthon@gmail.com`) személyesíti
meg. Nincs kulcsfájl. PowerShellben `gcloud.cmd`, nem `gcloud`.

Index-státusz ellenőrzésére is jó:
`gcloud.cmd firestore indexes composite list --project=grundo --database=grundo-db`

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Sonnet, normál mélységgel** — az F3 hátralévő darabjai (üzenetek, klubok,
kihívások) meglévő mintákra épülnek: alkollekció + végpont + képernyő,
ugyanaz a szerkezet, mint a követés/tiltás/komment. Opusra akkor váltsunk,
ha a klubok jogosultsági modellje (tulajdonos > admin > tag, átruházás)
vagy a kihívások automatikus haladás-követése tervezési döntésbe fut.

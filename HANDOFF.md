# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #7.** (A számozás a BESZÉLGETÉSEKÉ, nem a
munkameneteké: azt kell nézni, hány chat van. Lásd [AGENTS.md → 7. A
beszélgetések neve](AGENTS.md).)

## ÁLLAPOT

Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`. HEAD: `526ddb5`.

Tesztek, most mérve: `npm test` → **356 zöld** (25 fájl). `npm run
test:emulator` → **107 zöld** (9 fájl). Typecheck (gyökér ÉS `server/`)
hibamentes.

⚠️ **Két commit KÍVÜLRŐL jött** ebben a menetben (`06f6198`, `5017cfd` —
„Update cloudbuild.yaml", Geritől, a GitHub felületéről). Ezek tették be a
Mapbox-tokent a fájlba; az azt követő `1144f84` vette ki. A friss HEAD-ből
indulj, ne egy korábbi baseline-ból (AGENTS.md → 8. pont).

## ⚠️ ELSŐ OLVASATRA: MI KELL A TELEPÍTÉSHEZ

**frontend + backend.** Index, szabály, migráció NEM kell.

A backend-parancsnak KÖTELEZŐEN tartalmaznia kell a Mapbox-tokent, mert a
`cloudbuild.yaml`-ban szándékosan üres:

```
cd ~/grundo && gcloud builds submit --config cloudbuild.yaml --substitutions=_MAPBOX_TOKEN=<grundo-server-directions>
```

⚠️ **A sima `gcloud builds submit --config cloudbuild.yaml` ÜRES tokennel
telepít**, és onnantól a küldetés-generálás 503-at ad. Ez már megtörtént
egyszer ebben a menetben.

## MAPBOX-TOKENEK — HÁROM VAN, NE KEVEREDJENEK

| Token | Hol él | URL-korlátozás |
|---|---|---|
| `Default public token` | sehol (kiváltva) | nem is lehet ráállítani |
| `grundo-web` | Cloud Shell `~/grundo/.env` → bundle | `https://grundo.web.app` |
| `grundo-server-directions` | csak a deploy `--substitutions`-ben | **nincs, és nem is szabad** |

**Miért nincs a szerverén korlátozás?** Az URL-korlátozás a böngésző
`Referer` fejlécére épül — egy Cloud Run hívásnak nincs olyan. Ha
korlátoznánk, a küldetés-generálás 401-et kapna. Ezért a szerver tokenjének
a védelme az, hogy **sehol nem publikus**: se a repóban, se a bundle-ben.

⚠️ A GitHub secret scanning jogosan blokkolt egy pusht, amikor a token a
`cloudbuild.yaml`-be került. A `pk.` előtag miatt ez publikus token (nem
`sk.`), tehát nem klasszikus kulcsszivárgás volt — de a repóban akkor sincs
helye. A frontend `.env`-je Cloud Shellben él, **nincs verziókövetve**, tehát
`git pull` nem írja felül.

## EBBEN A MENETBEN ELKÉSZÜLT

### 1. Aktivitás-mentés — az ablak most tényleg bezárul

Az előző kör átirányítást adott hozzá, de **takarítást nem**: a `recorder`
állapota `done` maradt, ezért a Rögzítés fülre visszalépve ugyanaz a
mentés-ablak fogadott. Mostantól a mentés `discard()`-ot is hív (az
azonosítót ELŐTTE menti ki, mert utána a `state.id` üres).

### 2–4. Ranglista — iOS-en használhatatlan volt

A dobogó bevezetése után a fejléc + fülsor + dobogó annyit vitt el, hogy a
számozott tabellából semmi nem látszott, és görgetni sem lehetett.

- **Nyitott ranglistánál eltűnik** a rétegváltó, a statisztika-panel és a
  jelmagyarázat; a panel a maradék magasságot kapja, a dokk mögé nem lóg be.
- **A számozott lista külön görget** (`.terr__board-list`), a fejléc, a
  fülsor és a dobogó helyben marad. A `min-height: 0` nem elhagyható: flex
  gyerek nélküle nem megy a tartalmánál kisebbre, tehát a görgetés el sem
  indulna.
- **A pozíció-gomb is elrejtőzik** — új `hideRecenter` prop a `MapView`-n.
- **A szem ikon MÁR NEM rejti el a ranglistát.** Az a térkép RÁTÉTEIRE való;
  a ranglista nem rátét, hanem külön nézet. Saját ágra került, ezért nem
  függ az `overlayVisible`-től.

Mérve mobilban (375×812): panel 581 px, alja 678 px, lista görgethető,
rétegváltó/statisztika/jelmagyarázat/pozíció-gomb mind rejtve.

### 5. Értesítés-swipe — Gmail-mintára

- A kártya **legfeljebb 60 px-ig** mozdul.
- ⚠️ **A küszöböt is át kellett szabni.** Eddig a kártyaszélesség fele volt
  (~160 px) — a 60-as plafon mellett ez SOHA nem teljesülne, tehát húzással
  se törölni, se olvasottra állítani nem lehetne. Fix **42 px** lett
  (gyors pöccintésnél 24).
- A **teljes háttér** színeződik gradienssel, a mozdulat mértékével
  fokozatosan (30 px → `opacity: 0.5`). Piros balról jobbra (törlés), zöld
  jobbról balra (olvasott).
- Az **ikon az alap háttérszín** (`--bg-primary`), mintha ki lenne vágva a
  színes felületből.
- A sorok **összeérnek**: nincs rés, lekerekítés és körbefutó szegély, csak
  vízszintes elválasztó vonal.

### 6. Küldetés-ajánló — hangolás

**A bringa nem adott semmit.** Megmérve NEM a geometria hibás: egy 16 km-es
kör simán átmegy (52 000 cella, 239 ms; 24 km → 116 000 cella). A baj a
hossz-tűrés volt — hosszabb távon a kerülő-szorzó becslése nagyobbat téved,
és mind a nyolc jelölt kiesett.

- **KÉTMENETES ÖNKALIBRÁLÁS**: az első menet megméri a tényleges hosszt, a
  második `cél / tényleges` aránnyal skálázott sugárral kérdez újra. A
  `MISSION_DETOUR_FACTOR` így már csak kiindulópont, nem sorsdöntő.
- **A tűréshatár előny lett, nem kizáró ok**: ha semmi nem fér bele, a
  legközelebbieket ajánljuk fel 45 %-ig. Egy 9 km-es ajánlat a kért 7,5
  helyett többet ér, mint az „itt nincs kör" — a kártya kiírja a valós hosszt.
- **Az üres válasz OKA szétválasztva**: `no_routes` / `no_loops` / `no_fit`.
  Korábban mindhárom ugyanazt írta, ezért nem lehetett megmondani, mi a baj.
  A válasz `diagnostics` mezőt is ad (hány útvonal jött, hányban volt hurok).
- **Admin nem fogyaszt kvótát** (`owner`/`admin`/`moderator`) — a hangoláshoz
  sokszor kell egymás után generálni.
- **Célhossz-plafon 50 km**: a bezárt terület a kerület NÉGYZETÉVEL nő, a
  nyolcórás bringa több millió cellát jelentene jelöltenként.
- **90 perc helyett EGYEDI idő**: szabadon megadható érték perc vagy óra
  mértékegységgel, 5 perc és 8 óra között. A `minutes` a hálózaton továbbra
  is percben megy — az óra/perc váltás tisztán megjelenítési kérdés.

## ⚠️ AMIT MÉG MINDIG NEM TUDTUNK ÉLŐBEN MÉRNI

**A valódi Mapbox Directions hívást.** A fejlesztői környezetben nincs
Mapbox-token, tehát a kétmenetes önkalibrálás hatását CSAK élesben lehet
megnézni. Amit ellenőriztem helyette: a geometria mérve (fenti cellaszámok),
a felület élőben, a hibaágak élőben.

**Telepítés után ezt nézd meg**: működik-e a bringa. Ha még mindig nem, a
válasz `reason` mezője most már megmondja, miért — `no_routes` (a Mapbox nem
ad kerékpáros útvonalat innen), `no_loops` (ad, de nem záródik) vagy
`no_fit` (záródik, de rossz hosszú). Ez a három teljesen más teendőt jelent.

## KÖVETKEZŐ MENET — JAVASLAT

**A küldetés-ajánló jelenleg féllábon áll**, és ezt Geri jogosan szóvá tette:
a kártya ígér egy útvonalat, az „Indítás most" viszont a rögzítésre dob, ahol
az útvonalnak nyoma sincs. Navigáció nélkül a generálás önmagában kevés.

A hiányzó darab kicsi, mert a `polyline` már megvan a kártyán:

1. **Az útvonal átadása a rögzítésnek** — a kiválasztott küldetés vonala
   „szellemvonalként" a térképre, végig látszik rögzítés közben. Ez önmagában
   használhatóvá teszi a funkciót.
2. **2D/3D nézetváltó** (Geri kérése) — bedöntött kamera menetirányba
   forgatva, ahogy a navigációs appok csinálják. A Mapbox GL natívan tudja
   (`pitch`, `bearing`), nem kell külső függőség.
3. **Mentett útvonalak** — a docs/02 kéri, és a küldetés mentése logikusan
   ide tartozik.

**Amit NEM javaslok most**: valódi, kanyaronkénti hangnavigáció. Az a Mapbox
Navigation SDK terepe, webes verzióban korlátos, és jóval nagyobb falat.

## NYITOTT, KISEBB

- ⚠️ **`formatArea` mindig km²-t ír**, pedig a spec (docs/README, AGENTS.md
  9. szabály) 1 000 000 m² alatt m²-t kér. App-szintű megjelenítési változás
  lenne, ezért nem nyúltam hozzá. **Geri külön háttérfeladatként elindította**
  — ellenőrizd, landolt-e, mielőtt hozzáérsz.
- A küldetés **szűrői** (kevés kereszteződés · zöldterület · lapos terep) —
  a Directions támogat kizárásokat, de nincs bekötve.
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
| F2.5 — Küldetés-ajánló | ✅ kész, de **navigáció nélkül féllábon** (lásd fent) |
| F3 — Közösség | 🟡 félkész: követés/tiltás/like/komment/értesítés/jelentés/keresés megvan; **üzenetek, klubok, kihívások, felfedezés, útlevél** nincs |
| F4 — Mélység és bevétel | 🟡 csak a jelvények |
| F5 — Konnektorok | ❌ nincs elkezdve |
| F6 — Éles indulás | 🟡 élesben fut, a formális checklist nincs |

## ÉLESBEN FUT

- Napi forduló, admin felület, futásidejű konfiguráció (`appConfig/gameplay`
  v1, „Gazdagrét Rush" akció — ellenőrizd, nem járt-e le), jelvény-katalógus.
- A korábbi menetek: mentés-átirányítás, időjárás, flat ikonok, ranglista +
  pódium + napi/heti/havi bontás, keresés, F2.5 küldetés-ajánló.
- 8 ranglista-index READY, mindkét migráció lefutott
  (`backfill:blocked-by`, `backfill:area-windows`).

## TELEPÍTETLEN

`526ddb5` — az öt sürgős javítás + a küldetés-hangolás. Frontend + backend.

## Fejlesztői előnézet

**ÍRÓ funkcióhoz a helyi emulátor**:

1. `export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"`
   (Git Bash-ben mindig kell, a Java PATH-ja nélküle nem látszik).
2. `firebase emulators:start --only auth,firestore --project demo-grundo`
   (Bash-ben `firebase`, `.cmd` nélkül).
3. `server/`-ből `npm run seed:emulator`, majd `npm run dev:emulator`.
4. Gyökérből `npm run dev:emulator` (vagy a `grundo-emulator` launch-konfig).
5. Böngészőben: `await __grundoDevSignIn()`.

⚠️ **Port-ütközés**: az `npm run test:emulator` saját `emulators:exec`-et
indít — előbb állítsd le a kézit
(`Get-NetTCPConnection -LocalPort 8081,9099 | Stop-Process`).

💡 **Mérési fogások, amik ebben a menetben beváltak** (a Browser pane
screenshotja továbbra sem érhető el):

- **UI-állapot mérése** `javascript_tool`-lal: `getComputedStyle`,
  `getBoundingClientRect`, `scrollHeight > clientHeight` — ezekkel a
  ranglista magassága, a görgethetőség és a témák is ellenőrizhetők.
- **Swipe szimulálása**: `card.dispatchEvent(new PointerEvent(...))`
  `pointerdown` → `pointermove` → `pointerup` sorrendben. ⚠️ A React
  állapotfrissítés ASZINKRON — a mérés előtt várni kell egy tickre
  (`setTimeout(r, 60)`), különben a régi értéket olvasod.
- **Mapbox-token nélküli felület-ellenőrzés**: `window.fetch` kiváltása
  szintetikus válasszal a `/api/missions/generate`-re.
- **Éles állapot ellenőrzése kívülről**: `gcloud run services describe`
  (env-változók), és a kiszolgált bundle letöltése curl-lel (`curl -s
  https://grundo.web.app/assets/index-*.js | grep -c 'pk\.ey'`) — így
  ellenőrizhető, MI van tényleg élesben, találgatás nélkül.

## Infrastruktúra: éles, csak olvasó Firestore-hozzáférés

Változatlan. `grundo-reader@grundo.iam.gserviceaccount.com`
(`roles/datastore.viewer`), Geri (`gergely.marthon@gmail.com`) személyesíti
meg. Nincs kulcsfájl. PowerShellben `gcloud.cmd`, nem `gcloud`.

Index-státusz: `gcloud.cmd firestore indexes composite list --project=grundo
--database=grundo-db` — a `CREATING`/`READY` oszlop megmondja, felépült-e már.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Sonnet, normál mélységgel** a szellemvonal és a mentett útvonalak
(meglévő minták kiterjesztése). **A 2D/3D nézetváltónál** érdemes megállni:
a Mapbox kamera (`pitch`, `bearing`) és a menetirány-számítás a GPS-zajból
valódi tervezési kérdés — ha ott elakadás van, Opusra váltani.

# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #6.** (A számozási konvenció: [AGENTS.md → 7. A
beszélgetések neve](AGENTS.md).)

## ÁLLAPOT

Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`.
A pontos HEAD-et `git log -1`-gyel ellenőrizd — ez a fájl nem tartalmaz
commit-hash-t, mert az a frissítés pillanatában azonnal elavulna.

Utolsó tartalmi commit: **nyilvános felhasználói profil + követés, jelentés,
tiltás**, plusz a feed két új nézete (`following` és `user`). Ez a #5 menet
teljes hozama; a 7 pontos feladatsorból az 1. és a 3. pont készült el.

Tesztek, most mérve: a gyökérből `npm test` → **303 teszt zöld** (22 fájl, 7
emulátoros fájl kihagyva). Emulátoros: `npm.cmd run test:emulator` → **7 fájl,
92 teszt zöld** (korábban 5 fájl volt; a két új fájl 17 + 6 tesztet hozott).
Typecheck (gyökér ÉS `server/`) és mindkét production build hibamentes. A
Mapbox-chunk méretfigyelmeztetés régi, nem ebből a menetből jött.

⚠️ **Az emulátor NEM kényszeríti ki az összetett indexeket.** A `following` és
a `user` feed-nézet emulátoron zöld, de élesben a
`userId + visibility + startedAt` index NÉLKÜL a lekérdezés hibára fut. Az
**indexek** telepítése tehát nem opcionális ehhez a körhöz.

## AMIT EBBEN A MENETBEN VIZUÁLISAN ELLENŐRIZTEM

A nyilvános profil **éles adaton, böngészőben lefutott** (`zedthecyclist`
profilja `geri`-ként nézve): a fejléc, a hat számcsempe, a szint- és
GP-chipek, a Követés gomb, a ⋯ menü (Jelentés / Letiltás / Mégse) és a
bejelentő lap mind helyesen áll össze, konzolhiba nélkül.

Ehhez egy **eldobható előnézeti szervert** használtam a `server/tmp/` alatt,
ami a routereket rögzített uid-del mountolja az éles, csak olvasható
Firestore fölé — bejelentkezni ugyanis továbbra sem tudok. A fájlt a menet
végén **törörtem**, a `.env.local` vissza van állítva a Cloud Run URL-re.
Ez a recept a jövőben is működik, ha egy hitelesítést igénylő képernyőt kell
látni.

**Amit így sem láttam, és Gerire marad**: a **sötét téma** és a valódi
telefonképernyő arányai. Képernyőképet nem tudtam készíteni (a böngészőpanel
nem jelenik meg ebben a környezetben), csak a DOM-ot olvastam.

## ÉLESBEN FUT

- **Napi forduló**: legutóbb mérve 2026-08-20-án — rendben megy.
- **Admin felület**: `/admin` — játékszabály-szerkesztő, akciók, aktivitás-
  audit, visszajátszó.
- **Futásidejű konfiguráció**: `appConfig/gameplay` a v1-en áll. Fut egy aktív
  akció: „Gazdagrét Rush", globális 2×-es GP-szorzó, 2026-08-20 08:00 –
  2026-08-23 23:59 (Budapest) — ellenőrizd, hátha időközben lejárt.

## TELEPÍTETLEN

Két menet munkája vár telepítésre — a #4-é és a #5-é együtt:

- **#4-ből**: a `metricsDaily` napi aggregátum job ÉS az admin
  `/api/admin/metrics` végpont. Amíg a backend nem frissül, a napi forduló a
  régi kódot futtatja (nem ír `metricsDaily`-t), és az admin Áttekintő a régi,
  számok nélküli felületet mutatja. Adat csak a telepítés UTÁNI első napi
  fordulótól lesz benne.
- **#5-ből**: az egész nyilvános profil és közösségi gráf. Kell hozzá
  **frontend + backend + indexek**.
- Régi, még mindig nyitott kérdés: **az F (szabálymagyarázó felület)** és a
  **`c0a20da`** (CORS-javítás, akció-szerkesztés, trust-panel) éles állapota —
  ezt Geri tudja megmondani.

## AMI A #5 MENETBEN ELKÉSZÜLT

**Szerver** — új `server/src/routes/users.ts`, `/api/users` alatt:
`GET /:username` (nyilvános profil + viszony), `POST|DELETE /:username/follow`,
`POST|DELETE /:username/block`, `POST /:username/report`.

Négy döntés, amit érdemes tudni, mert nem következik a specből:

1. **A követés szerveroldali**, mert három dokumentumot érint együtt (a két él
   és a két számláló). Tranzakcióban megy, és idempotens — kétszer elküldve
   nem duplázza a számlálót, kétszer visszavonva nem visz negatívba. Mindkettő
   emulátoros teszttel bizonyítva.
2. **A kétirányú tiltás két KÜLÖNBÖZŐ választ ad.** Aki engem tiltott le →
   404, mintha nem is létezne (a „le vagy tiltva" maga is információ). Akit én
   tiltottam le → látom a fejlécet és a tiltás tényét, különben nem tudnám
   feloldani.
3. **A tiltás mindkét irányban bontja a követést**, és takarítja a függő
   kéréseket. Enélkül a letiltott fél követő maradna, és a tiltás csak
   látszólag működne.
4. **Egy felhasználóról egyszerre egy nyitott bejelentés lehet.** Enélkül egy
   dühös felhasználó ötven azonos bejelentéssel eltemetné a moderációs sort.

**Feed** — a `following` nézet a stub helyett most tényleg a követési gráfból
dolgozik, és jött egy `user` nézet a profilhoz. A Firestore `in` szűrője 30
értéket enged, ezért a követettek listája darabokra bomlik, és az eredményt a
szerver fésüli össze **újrarendezve** — enélkül a feed darabonként
csoportosítva jönne. A felső korlát 300 követett (10 darab). Ez az egyetlen
hely, ahol a követés skálázódása később szűk lehet.

**Kliens** — `/felhasznalo/:username` képernyő (`PublicProfileScreen`), a
bejelentő lap (`ReportUserSheet`), és a feed-kártyák szerzőneve mostantól a
profilra visz. A kártya fejléce ezért KIKERÜLT a nyitógombból: két gomb
egymásba ágyazva sem HTML-ben, sem képernyőolvasóval nem működik.

## KÖVETKEZŐ: 6. MENET

Geri 7 pontos feladatsorából **kettő kész** (1. profil, 3. követés/jelentés/
tiltás). A maradék öt, és ami mindegyikről most tudni kell:

- **2. Jelvényrendszer + jelvények.** A specben megvan a séma (`badges/{id}`
  katalógus + `users/{uid}/badges/{badgeId}`), de **nincs se katalógus, se
  kiosztó logika**. A profilon már van helye. Ez jól határolt, önálló egység —
  ez a legkézenfekvőbb következő lépés.
- **4. Időjárás widget.** ⚠️ **Geri döntött: OpenWeatherMap, kulccsal** — mert
  a díjmentes szintje kereskedelmi használatra is jó, szemben az Open-Meteóval.
  **A kulcsot Gerinek kell megszereznie és átadnia**, addig ez a pont nem
  indulhat. A widget a „Szia, *név*" sorba, JOBBRA kerül: ikon és hőmérséklet
  EGYMÁS MELLETT (a referenciaképen egymás alatt vannak — ez szándékos
  eltérés), a felirat fehér, kicsit erősebb. Az ikon a tényleges időt jelzi,
  nappali és éjszakai változatban is (napos / részben felhős / felhős / esős /
  havas, illetve hold + felhő, csillagos tiszta ég, stb.). A hívás a saját
  backendünkön menjen át, cache-elve — a kulcs soha ne kerüljön kliensre.
- **5. Keresés + keresési modal.** A referencián „Discover": keresőmező,
  People / Clubs fülek, és javaslatok („friend of a friend", „similar pace").
  Ehhez kell egy kereső végpont; a `usernames` kollekció prefix-kereséssel
  már ma is elég a People fülhöz.
- **6. Értesítések modal + alapvető értesítések.** A séma megvan
  (`notifications/{uid}/items/{id}`) és az index is
  (`read ASC, createdAt DESC`), író logika nincs. A most elkészült követés
  már termel eseményt, amiről értesíteni lehetne („X követni kezdett").
- **7. Rivális rendszer.** ⚠️ Geri megadta a definíciót: **aki elveszi a
  területünket, vagy akitől mi vesszük el, rivális lesz.** A profilon a **TOP
  3** látszik, a teljes lista külön modalban, és a „hányszorosan" szám is (pl.
  `x17`). **Súlyozni kell**: nem csak a cserék száma számít, hanem az elvett
  terület mérete is. A pontos képletet Geri szerint majd ott dolgozzuk ki.
  Adatforrás valószínűleg a meglévő `territoryEvents` (`actorId`/`victimId`
  indexek már vannak), de kell dönteni, hogy futásidőben aggregálunk-e, vagy
  saját kollekcióba írunk.

**Amit még a #4-ből örököltünk**: az admin Áttekintőből hiányzik a
Pro-konverzió, lemorzsolódás, konnektor-hibaarány és a hibás job-futások száma
— ezekhez ma nincs adatforrás. Dönteni kell, kapjanak-e saját számlálót.

## NYITOTT, KISEBB

- **gpLedger-takarítás — elő van készítve, futtatásra vár.**
  `server/src/scripts/cleanGpLedgerJunk.ts` (dry-run alapértelmezett,
  `npm run clean:gp-ledger-junk`). Legutóbb mérve (2026-08-20): 12 sor
  törlésre vár. Az `--apply --allow-production` futtatás Geri saját, író jogú
  hitelesítésével, Cloud Shellben történik.
- **A követési KÉRÉSEK elbírálására még nincs felület.** Privát fióknál a
  kérés létrejön (`followRequests/{cél}/items/{kérő}`), de a célszemély ma
  sehol nem látja és nem tudja elfogadni. A 6. menet értesítés-pontjával
  együtt érdemes megcsinálni.
- **A tiltottak listája sincs sehol.** Feloldani ma csak úgy lehet, hogy
  elnavigálsz a letiltott profiljára. A Beállítások alá kellene egy lista.
- Területi hatókörű hold-modifier nem hat: a `zones` kollekció még nincs
  megírva. Kódban és specben rögzítve.
- `gpWeek`/`gpMonth` ablakzárás él, de éles adaton még nem láttuk működni.

## Fejlesztői előnézet — hogyan látunk éles adatot a böngészőben

1. `.claude/launch.json` a `G:\Saját meghajtó\WORK\CLAUDE` gyökérben — Vite
   dev szerver, port 5173. Már létrehozva.
2. Szerver helyben, csak-olvasó ADC-vel: `server/`-ből
   `GOOGLE_CLOUD_PROJECT=grundo PORT=8080 npx tsx watch server.ts`.
3. `grundo/.env.local`-ban `VITE_API_BASE_URL=http://localhost:8080`, majd a
   Vite dev szervert ÚJRA KELL INDÍTANI (a `.env` csak induláskor olvasódik).
4. ⚠️ Ebben a módban **nincs Firebase-hitelesítés**, tehát minden hitelesítést
   igénylő végpont 401-et ad. Ha egy ilyen képernyőt kell látni, a `server/tmp/`
   alatt egy eldobható szerver mountolja a routereket rögzített uid-del — lásd
   fent, „AMIT EBBEN A MENETBEN VIZUÁLISAN ELLENŐRIZTEM".
5. A `.env.local`-t telepítés előtt vissza kell állítani a valódi Cloud Run
   URL-re (`https://grundo-api-irb5rjve6a-ew.a.run.app`).

## Infrastruktúra: éles, csak olvasó Firestore-hozzáférés

Változatlan. `grundo-reader@grundo.iam.gserviceaccount.com`
(`roles/datastore.viewer`), Geri (`gergely.marthon@gmail.com`)
megszemélyesíti. Nincs kulcsfájl. PowerShellben `gcloud.cmd`, nem `gcloud`.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Sonnet, normál mélységgel**, ha a **jelvényrendszerrel** (2. pont) vagy a
**kereséssel** (5. pont) folytatjuk — mindkettő meglévő mintára épül, nincs
benne spec-ellentmondás. **Opus, emelt mélységgel** a **rivális rendszerhez**
(7. pont), mert ott a súlyozó képlet és az aggregálás helye valódi
adatmodell-döntés.

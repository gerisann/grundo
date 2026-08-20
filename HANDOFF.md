# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #6.** (A számozási konvenció: [AGENTS.md → 7. A
beszélgetések neve](AGENTS.md).)

## ÁLLAPOT

Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`.
A pontos HEAD-et `git log -1`-gyel ellenőrizd — ez a fájl nem tartalmaz
commit-hash-t, mert az a frissítés pillanatában azonnal elavulna.

A #5 menet **két commitot** hagyott maga után:

1. **Nyilvános felhasználói profil + követés, jelentés, tiltás**, plusz a feed
   két új nézete (`following` és `user`).
2. **Időjárás-widget a Home képernyőn** — Geri a menet közben átadta az
   OpenWeatherMap kulcsot, ezért a 4. pont is belefért.

A 7 pontos feladatsorból tehát az **1., a 3. és a 4. pont kész**.

Tesztek, most mérve: a gyökérből `npm test` → **310 teszt zöld** (23 fájl, 7
emulátoros fájl kihagyva). Emulátoros: `npm.cmd run test:emulator` → **7 fájl,
92 teszt zöld**. Az emulátoros készlet az időjárás-kör után NEM futott újra, és
nem is kellett: az a kör Firestore-viselkedéshez nem nyúlt. Typecheck (gyökér
ÉS `server/`) és mindkét production build hibamentes. A Mapbox-chunk
méretfigyelmeztetés régi, nem ebből a menetből jött.

⚠️ **Az emulátor NEM kényszeríti ki az összetett indexeket.** A `following` és
a `user` feed-nézet emulátoron zöld, de élesben a
`userId + visibility + startedAt` index NÉLKÜL a lekérdezés hibára fut. Az
**indexek** telepítése tehát nem opcionális ehhez a körhöz.

⚠️ **AZ ELSŐ BACKEND-TELEPÍTÉS ELHASAL, amíg az `OPENWEATHER_API_KEY` titok
nem létezik.** A `cloudbuild.yaml` mostantól hivatkozik rá a `--set-secrets`
sorban, a `gcloud run deploy` pedig nem létező titokra hibát ad. A titkot
Cloud Shellben kell létrehozni, a telepítés ELŐTT — a parancs a menet záró
üzenetében van, és a `docs/06` jobok fejezetének mintáját követi.

## AMIT EBBEN A MENETBEN VIZUÁLISAN ELLENŐRIZTEM

A nyilvános profil **éles adaton, böngészőben lefutott** (`zedthecyclist`
profilja `geri`-ként nézve): a fejléc, a hat számcsempe, a szint- és
GP-chipek, a Követés gomb, a ⋯ menü (Jelentés / Letiltás / Mégse) és a
bejelentő lap mind helyesen áll össze, konzolhiba nélkül.

Az **időjárás-widget** szintén éles adaton futott, valódi OpenWeatherMap
válasszal. Amit mértem:

- Budapest: `tiszta égbolt, 34 °C`, nappali napikonnal; Sydney ugyanabban a
  pillanatban `borús égbolt, 17 °C`, `night: true`. Ez bizonyítja, hogy az
  éjszakát a MÉRT HELY napkeltéjéből számoljuk, nem a szerver órájából — a
  Cloud Run UTC-ben jár, abból fordítva jött volna ki.
- Gyorsítótár: első hívás 79 ms, ugyanaz másodszor 2,8 ms, és a 300 m-rel
  arrébb lévő pont is ugyanabba a rácscellába esik (2,4 ms) — nem indít új
  külső hívást.
- Elrendezés: a widget pontosan a köszöntő sor jobb szélén (0 px eltérés), az
  ikon balra a szövegtől, egy sorban.
- **Mindkét téma számolva**: a hőmérséklet világosban `#17151c` (majdnem
  fekete), sötétben `#f7f5fa` (majdnem fehér). A „fehér, erősebb font" kérés
  így a sötét témában szó szerint teljesül, a világosban pedig olvasható
  marad — beégetett fehér ott láthatatlan lenne.

Ehhez egy **eldobható előnézeti szervert** használtam a `server/tmp/` alatt,
ami a routereket rögzített uid-del mountolja az éles, csak olvasható
Firestore fölé — bejelentkezni ugyanis továbbra sem tudok. A fájlt a menet
végén **töröltem**, a `.env.local` vissza van állítva a Cloud Run URL-re.
Ez a recept a jövőben is működik, ha egy hitelesítést igénylő képernyőt kell
látni.

**Amit így sem láttam, és Gerire marad:**

- A **sötét téma tényleges látványa** és a valódi telefonképernyő arányai.
  Képernyőképet nem tudtam készíteni (a böngészőpanel nem jelenik meg ebben a
  környezetben), csak a DOM-ot és a számolt stílusokat olvastam.
- ⚠️ Az **éjszakai hold- és csillagikon RAJZA**. A `night` jelzés útját végig
  bizonyítottam, de a hold csak `clear` vagy `partly_cloudy` éjszakán
  látszik, és a próbált tíz városban egyikben sem volt épp tiszta éjszaka.
  A hold és a csillagok tehát kódban helyesek, de rajzban ellenőrizetlenek —
  Geri este ránézve látja először.

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
- **#5-ből**: az egész nyilvános profil és közösségi gráf, valamint az
  időjárás-widget. Kell hozzá **frontend + backend + indexek**, és a backend
  ELŐTT az `OPENWEATHER_API_KEY` titok létrehozása (lásd fent).
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

**Időjárás** — új `server/src/routes/weather.ts` (`GET /api/weather?lat&lon`),
`WeatherWidget` és `WeatherIcon` a kliensen, hét ikonállapot nappali és
éjszakai változatban. Három döntés, ami nem következik a kérésből:

1. **A widget NEM kér helyzetet magától az app indulásakor.** Egy
   engedélykérő ablak egy időjárás-csempéért a legbiztosabb módja annak, hogy
   a felhasználó örökre megtagadja a helyzetét — és akkor a TÉRKÉP sem
   működik, ami viszont a termék lényege. Ezért először a Grund képernyő által
   már felírt `users/{uid}/private/position` dokumentumot olvassuk; ha az
   nincs, a widget helyén egy koppintható jel áll, és az engedélykérés csak
   felhasználói szándékra indul.
2. **A hiányzó időjárás NEM hibaüzenet.** Ha a szolgáltató néma vagy a kulcs
   hiányzik, a widget egyszerűen nincs ott. Egy piros hibasáv a Home tetején
   rosszabb, mint a hiánya — az időjárás dísz, nem funkció.
3. **A végpont hitelesítés MÖGÖTT van**, pedig az időjárás nem személyes
   adat. Nyitva hagyva ingyenes időjárás-proxy lenne bárkinek, a mi
   számlánkra. A gyorsítótár ~1,1 km-es rácsra kerekít, 10 perces élettartammal.

## KÖVETKEZŐ: 6. MENET

Geri 7 pontos feladatsorából **három kész** (1. profil, 3. követés/jelentés/
tiltás, 4. időjárás). A maradék négy, és ami mindegyikről most tudni kell:

- **2. Jelvényrendszer + jelvények.** A specben megvan a séma (`badges/{id}`
  katalógus + `users/{uid}/badges/{badgeId}`), de **nincs se katalógus, se
  kiosztó logika**. A profilon már van helye. Ez jól határolt, önálló egység —
  ez a legkézenfekvőbb következő lépés.
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

- **Az időjárás csak akkor jelenik meg magától, ha van tárolt pozíció.** Friss
  fiókkal a Home-on egy koppintható helyjel áll a widget helyén, amíg a
  felhasználó nem járt a Grund képernyőn (az írja fel a pozíciót). Ez
  szándékos — de ha zavaró, a Grund első megnyitásakor kiírt pozíciót előbbre
  is lehetne hozni az onboardingba.
- **Hőmérséklet-egység: csak °C.** A referenciakép „Hold to switch °F"
  lehetőséget kínál; ezt nem építettem meg, mert nem kérted, és a `docs/05`
  `units` mezője sem tartalmaz hőmérsékletet. Ha kell, oda kell felvenni.
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

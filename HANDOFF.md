# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #7.** (A számozási konvenció: [AGENTS.md → 7. A
beszélgetések neve](AGENTS.md).)

## ÁLLAPOT

Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`.
A pontos HEAD-et `git log -1`-gyel ellenőrizd — ez a fájl nem tartalmaz
commit-hash-t, mert az a frissítés pillanatában azonnal elavulna.

A #6 menet: **jelvényrendszer + jelvények** (Geri 7 pontos listájából a 2.
pont). A 7 pontból most **négy kész** (1. profil, 3. követés/jelentés/tiltás,
4. időjárás, 2. jelvények).

Tesztek, most mérve: a gyökérből `npm test` → **327 teszt zöld** (24 fájl, 7
emulátoros fájl kihagyva; +17 új a `src/game/badges.test.ts`-ből). Emulátoros:
`npm.cmd run test:emulator` → **7 fájl, 92 teszt zöld** (a `dailyRollover` és
`activities` fájlok tesztjei ÚJRA lefutottak és zöldek — lásd lent, miért volt
ez különösen fontos ebben a körben). Typecheck (gyökér ÉS `server/`) és
mindkét production build hibamentes.

⚠️ **Két méréssel talált, javított hiba ebben a körben — mindkettő arról szól,
hogy egy ÚJ GP-forrás (a jelvény-jutalom) hol ér hozzá MEGLÉVŐ, pontos
összeget ellenőrző tesztekhez:**

1. A jelvény-kiértékelést ELŐSZÖR a napi fordulóba (`dailyRollover.ts`) is
   bekötöttem, hogy a heti sorozat- és hűség-jelvények aktivitás nélkül is
   kiértékelődjenek. A `dailyRollover.emulator.test.ts` két tesztje ERRE
   MÉRVE bukott meg (a szeedelt teszt-userek területe simán 100 000 m² fölött
   volt, tehát terület-jelvényt is kaptak volna). **A javítás: a hívás
   KIKERÜLT a napi fordulóból**, csak az aktivitás-mentés útvonalán fut. A
   heti/hűség-jelvények emiatt egy körrel később derülnek ki, mint
   elméletileg lehetne — ez elfogadható késés, nem elveszett jutalom (lásd
   `server/src/lib/badges.ts` fejléce).
2. Az aktivitás-mentésbe eredetileg TŰZZ-ÉS-FELEJTSD módon (`void`) kötöttem
   be — az `auth.ts` regisztrációs e-mailjének mintájára. Végiggondolva ez ITT
   NEM biztonságos: a jelvény-jutalom UGYANAZT a `gpTotal` mezőt írja, amit a
   hívó a válasz után azonnal visszaolvashat, tehát versenyhelyzet a saját
   írásunk és egy azonnali visszaolvasás között. **Nem hagytam feltételezésen
   — átírtam AWAIT-eltre, MIELŐTT bármi elromolhatott volna belőle**, tehát ezt
   a hibát nem méréssel fogtam meg, hanem a kódot olvasva előre kiszűrtem. A
   válasz így csak a jelvény-kiértékelés lezajlása UTÁN megy ki.

Két meglévő teszt-asszerció is módosult emiatt (`activities.emulator.test.ts`
→ „elmenti az aktivitást" és „a duplikált azonosító" tesztek): egy friss
felhasználó ELSŐ aktivitása mindig kivált `first_activity`+`first_loop`
jelvényt (+70 GP), ezt most egy névvel ellátott konstans (`FIRST_ACTIVITY_BADGE_GP`)
adja hozzá az elvárt értékhez — nem a teszt SZÁNDÉKA változott, csak a
valós, immár helyes GP-összeg.

## AMIT EBBEN A MENETBEN VIZUÁLISAN ELLENŐRIZTEM

A jelvényrendszert **valódi Firestore-emulátoron, éles kóddal** futtattam
végig — NEM éles adatbázison, mert ez a funkció ÍR, és az olvasó
szolgáltatásfiók nem tud írni:

- Egy `evaluateAndAwardBadges()` hívás egy megfelelően előkészített
  felhasználón **11 jelvényt osztott ki egyszerre** (első lépések, távolság,
  terület, napi és heti sorozat, hűség), helyes GP-összeggel (+1180 GP,
  5000→6180).
- **Idempotencia mérve**: ugyanaz a hívás újra futtatva `Kiosztva: []`-t adott
  — egyetlen dokumentum sem duplázódott.
- **A `.count()` aggregáció is mérve**: 12 `territoryEvents` dokumentum
  `actorId`-val kiváltotta a `first_steal` és `conqueror_10` jelvényt, a
  `conqueror_50`-et helyesen nem.
- **Böngészőben, a `/felhasznalo/:username` képernyőn**: mind a 13 jelvény
  megjelent helyes magyar névvel, a bronz pötty MÁS árnyalatot kapott világos
  és sötét témában, a tooltip a leírást és a megszerzés dátumát is mutatta.
- **Üres állapot, idegen profilon**: egy jelvény nélküli felhasználónál a
  jelvény-blokk EGYSZERŰEN NEM JELENT MEG (`hideEmpty`) — nem lógott ki egy
  „neked szóló" felszólítás máséin.
- **Üres állapot, saját profilon**: a „Még nincs jelvényed" szöveg a helyén
  jelent meg (bár ezt csak a `ProfileScreen` alapállapotában láttam, mert a
  saját profil valódi Firebase-bejelentkezést igényel, amit ez a környezet
  nem tud kiváltani — a komponens ugyanaz mindkét képernyőn, a logikát a
  populált ág oldalán már bizonyítottam).

## ÉLESBEN FUT

- **Napi forduló**: legutóbb mérve 2026-08-20-án — rendben megy.
- **Admin felület**: `/admin` — játékszabály-szerkesztő, akciók, aktivitás-
  audit, visszajátszó.
- **Futásidejű konfiguráció**: `appConfig/gameplay` a v1-en áll. Fut egy aktív
  akció: „Gazdagrét Rush", globális 2×-es GP-szorzó, 2026-08-20 08:00 –
  2026-08-23 23:59 (Budapest) — ellenőrizd, hátha időközben lejárt.

## TELEPÍTETLEN

Három menet munkája vár telepítésre — a #4-é, #5-é és #6-é együtt:

- **#4-ből**: a `metricsDaily` napi aggregátum job ÉS az admin
  `/api/admin/metrics` végpont. Adat csak a telepítés UTÁNI első napi
  fordulótól lesz benne.
- **#5-ből**: a nyilvános profil, közösségi gráf és időjárás-widget. Kell
  hozzá **frontend + backend + indexek**, és a backend ELŐTT az
  `OPENWEATHER_API_KEY` titok létrehozása.
- **#6-ból (most)**: a jelvényrendszer. Kell hozzá **frontend + backend**.
  Adatbázis-lépés (index) NEM kell — a `.count()` aggregáció és a
  `users/{uid}/badges` alkollekció a meglévő szabályokkal és egyenlőség-
  szűrővel működik. **Viszont a `badges` katalógus-kollekciót Cloud Shellben
  fel kell tölteni** (lásd „TEENDŐK" a záró chat-üzenetben) —
  amíg üres, a jelvények kiosztódnak és jól működnek (a katalógus kódban
  van), de a `challenges.rewardBadgeId`-hivatkozások és egy jövőbeli admin-
  szerkesztő addig nem találnának Firestore-dokumentumot.
- Régi, még mindig nyitott kérdés: **az F (szabálymagyarázó felület)** és a
  **`c0a20da`** (CORS-javítás, akció-szerkesztés, trust-panel) éles állapota —
  ezt Geri tudja megmondani.

## AMI A #6 MENETBEN ELKÉSZÜLT

**A katalógus** — `src/game/badges.ts` (szerverrel közös kód, mint a
`levels.ts`). **45 jelvény, hat kategóriában** — a spec tíz kategóriájából
NÉGY KIMARADT, mert ma nincs mögöttük valódi adat, és kitalálni hazugság lenne
(`AGENTS.md` → „Amit kérdezz meg, ne találj ki"):

- **Védő** — nincs védekezés-eseménynapló (sikeres áttörés-elhárítás sosem
  kerül rögzítésre).
- **Felfedező** — a `users/{uid}/passport/{iso}` a specben megvan, DE a kódban
  sehol nem íródik (ellenőriztem: nulla találat rá).
- **Közösség** — klubok, kihívások, like-összesítő nincs megépítve.
- **Pro** — az előfizetés-életciklus (`subscriptions`) nincs megépítve; a
  `pro.active` mezőt ma semmilyen valós folyamat nem állítja be, tehát erre
  jelvényt építeni kitalált adatra épülne.

Az **„első visszaszerzés"** jelvény is kimaradt az „első lépések"
kategóriából: a `territoryEvents` ma NEM különbözteti meg a lopást a
visszaszerzéstől (mindkettő ugyanaz a `territory_stolen` esemény) — ez
játékegyensúly-kérdés, ugyanabba a körbe tartozik, mint a rivális-rendszer
definíciója.

**A kiértékelés TISZTA FÜGGVÉNY** (`earnedBadgeIds(ctx)`): csak a `ctx`-ből
számol, Firestore-t nem lát, ugyanahhoz a bemenethez mindig ugyanazt adja.
Emiatt biztonságosan újrafuttatható (aktivitás után ÉS elméletben egy
jövőbeli visszamenőleges kiosztásnál is), és emiatt derült ki egyetlen
próbafuttatással a fenti két hiba is — lásd „ÁLLAPOT".

**A szerver oldal** — `server/src/lib/badges.ts` (`evaluateAndAwardBadges`,
Firestore-ral beszél) és `server/src/scripts/seedBadges.ts` (a katalógus
Firestore-ba vetítése, `--apply`/`--allow-production` mintára). Egyetlen
hívási pont: `routes/activities.ts`, aktivitás-mentés után, AWAIT-elve (lásd
fent). A `.count()` aggregációs lekérdezés (`territoryEvents` darabszáma
`actorId` szerint) egyetlen olvasásba kerül, függetlenül a dokumentumok
számától.

**A kliens oldal** — `BadgeList` komponens (pill-chipek, ritkaság szerint
színezve), beágyazva a `ProfileScreen`-be és a `PublicProfileScreen`-be. A
jelvény NÉV NÉLKÜL jön a szerverről (`{id, earnedAt}`), a nevet/leírást a
kliens a közös katalógusból oldja fel — nincs duplikált szöveg a hálózaton.

⚠️ **Mellékes felfedezés, NEM javítottam, mert nem ehhez a körhöz tartozik és
kockázatos módosítani telepített indexet direkt kérés nélkül**: a
`firestore.indexes.json`-ban a `territoryEvents` két indexe a `victimId`/`at`
mezőnevekre hivatkozik, de a tényleges kód `recipientId`/`createdAt`-et ír.
Ez a két index ma HOLTAN áll (semmilyen lekérdezés nem használja őket) — ha
egyszer valaki a doksi elnevezését próbálná lekérdezésben használni, csendben
elhasalna.

## KÖVETKEZŐ: 7. MENET

Geri 7 pontos feladatsorából **négy kész**. A maradék három:

- **5. Keresés + keresési modal.** A referencián „Discover": keresőmező,
  People / Clubs fülek, és javaslatok („friend of a friend", „similar pace").
  Ehhez kell egy kereső végpont; a `usernames` kollekció prefix-kereséssel
  már ma is elég a People fülhöz.
- **6. Értesítések modal + alapvető értesítések.** A séma megvan
  (`notifications/{uid}/items/{id}`) és az index is
  (`read ASC, createdAt DESC`), író logika nincs. Több esemény is termelődik
  már, amiről értesíteni lehetne: követés (#5-ből), és mostantól **jelvény-
  szerzés** (`evaluateAndAwardBadges` visszaadja az újonnan kiosztott
  jelvényeket, csak még senki nem hallgat rá).
- **7. Rivális rendszer.** ⚠️ Geri megadta a definíciót: **aki elveszi a
  területünket, vagy akitől mi vesszük el, rivális lesz.** A profilon a **TOP
  3** látszik, a teljes lista külön modalban, és a „hányszorosan" szám is (pl.
  `x17`). **Súlyozni kell**: nem csak a cserék száma számít, hanem az elvett
  terület mérete is. A pontos képletet Geri szerint majd ott dolgozzuk ki.
  Adatforrás valószínűleg a meglévő `territoryEvents`, de kell dönteni, hogy
  futásidőben aggregálunk-e, vagy saját kollekcióba írunk. Ha ide kerül sor,
  ÉRDEMES EGYÜTT ÁTGONDOLNI az „első visszaszerzés" jelvénnyel (fentebb
  kimaradt) — ugyanaz a hiányzó megkülönböztetés (lopás vs. visszaszerzés)
  mindkettőt érinti.

**Amit még a #4-ből örököltünk**: az admin Áttekintőből hiányzik a
Pro-konverzió, lemorzsolódás, konnektor-hibaarány és a hibás job-futások száma
— ezekhez ma nincs adatforrás. Dönteni kell, kapjanak-e saját számlálót.

## NYITOTT, KISEBB

- **A jelvény-jutalom GP nem frissíti azonnal a `level` mezőt.** Egy jelvény
  jutalma tipikusan kicsi ahhoz, hogy önmagában szintet lépjen; a legközelebbi
  aktivitás úgyis frissíti. Egy körre elmaradó szint-kijelzés ártalmatlanabb,
  mint egy plusz olvasás minden jelvényosztásnál — de ha ez zavaró lenne,
  könnyen javítható (`server/src/lib/badges.ts` → a batch-írás mellé).
- **Nincs értesítés az újonnan kiosztott jelvényről.** A funkció visszaadja,
  mit osztott ki (`BadgeDef[]`), de ma senki nem használja fel — sem toast,
  sem `notifications` bejegyzés. Ez a 6. pont (értesítések) alá tartozik.
- **A `badges` Firestore-katalógus még üres** — a kódbeli katalógus a
  forrás, de a Firestore-vetítést a `seed:badges` szkriptnek kell futtatnia
  (lásd „TELEPÍTETLEN").
- **Az időjárás csak akkor jelenik meg magától, ha van tárolt pozíció.** Friss
  fiókkal a Home-on egy koppintható helyjel áll a widget helyén, amíg a
  felhasználó nem járt a Grund képernyőn (az írja fel a pozíciót).
- **Hőmérséklet-egység: csak °C**, a °F-váltás nincs megépítve.
- **gpLedger-takarítás — elő van készítve, futtatásra vár.**
  `server/src/scripts/cleanGpLedgerJunk.ts` (dry-run alapértelmezett).
  Legutóbb mérve (2026-08-20): 12 sor törlésre vár.
- **A követési KÉRÉSEK elbírálására még nincs felület.** Privát fióknál a
  kérés létrejön, de a célszemély ma sehol nem látja és nem tudja elfogadni.
- **A tiltottak listája sincs sehol.** Feloldani ma csak úgy lehet, hogy
  elnavigálsz a letiltott profiljára.
- Területi hatókörű hold-modifier nem hat: a `zones` kollekció még nincs
  megírva. Kódban és specben rögzítve.
- `gpWeek`/`gpMonth` ablakzárás él, de éles adaton még nem láttuk működni.

## Fejlesztői előnézet — hogyan látunk éles adatot a böngészőben

**⚠️ ÍRÓ FUNKCIÓHOZ (pl. jelvények) NE az éles, csak-olvasó ADC-t használd —
az úgysem tudna írni, a próba hamis biztonságérzetet adna. Helyette a helyi
Firestore-emulátort:**

1. `.claude/launch.json` a `G:\Saját meghajtó\WORK\CLAUDE` gyökérben — Vite
   dev szerver, port 5173. Már létrehozva.
2. Emulátor: a repo gyökeréből
   `export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"`,
   majd `firebase.cmd emulators:start --only firestore --project demo-grundo`
   (Firestore a 8081-es porton).
3. Szerver `server/`-ből, az emulátorhoz kötve:
   `FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 GOOGLE_CLOUD_PROJECT=demo-grundo npx tsx watch server.ts`.
   Csak-olvasó ÉLES adathoz (nem-író képernyőkhöz) a korábbi recept marad:
   `GOOGLE_CLOUD_PROJECT=grundo PORT=8080 npx tsx watch server.ts`.
4. `grundo/.env.local`-ban `VITE_API_BASE_URL=http://localhost:8080`, majd a
   Vite dev szervert ÚJRA KELL INDÍTANI.
5. ⚠️ Ebben a módban **nincs Firebase-hitelesítés**. Ha egy hitelesítést
   igénylő képernyőt kell látni, a `server/tmp/` alatt egy eldobható szerver
   mountolja a routereket rögzített uid-del — a menetben ez volt a recept,
   a fájlt a végén törölni kell (`tmp/` amúgy is `.gitignore`-olt).
6. A `.env.local`-t telepítés előtt vissza kell állítani a valódi Cloud Run
   URL-re (`https://grundo-api-irb5rjve6a-ew.a.run.app`).

## Infrastruktúra: éles, csak olvasó Firestore-hozzáférés

Változatlan. `grundo-reader@grundo.iam.gserviceaccount.com`
(`roles/datastore.viewer`), Geri (`gergely.marthon@gmail.com`)
megszemélyesíti. Nincs kulcsfájl. PowerShellben `gcloud.cmd`, nem `gcloud`.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Sonnet, normál mélységgel**, ha a **kereséssel** (5. pont) vagy az
**értesítésekkel** (6. pont) folytatjuk — mindkettő meglévő mintára épül,
nincs benne spec-ellentmondás. **Opus, emelt mélységgel** a **rivális
rendszerhez** (7. pont), mert ott a súlyozó képlet, az aggregálás helye és a
lopás/visszaszerzés megkülönböztetése valódi adatmodell-döntés.

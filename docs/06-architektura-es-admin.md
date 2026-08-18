# 06 — Architektúra, admin, üzemeltetés

## Rendszerkép

```
┌────────────────────────────────────────────┐
│  MOBIL KLIENS  (React + Capacitor / RN)    │
│  Mapbox · háttér-GPS · offline sor         │
└───────┬───────────────────────┬────────────┘
        │ Firebase SDK          │ HTTPS (App Check + ID token)
        ▼                       ▼
┌───────────────────┐   ┌────────────────────────────────┐
│ Firebase          │   │ Cloud Run szolgáltatások       │
│ · Auth            │◄──┤ · geo-service    (rács, GP)    │
│ · Firestore       │   │ · tile-service   (vektorcsempe)│
│ · Storage         │   │ · mission-service (küldetések) │
│ · FCM             │   │ · connector-svc  (OAuth, sync) │
│ · Hosting (admin) │   │ · trust-service  (anti-cheat)  │
│                   │   │ · admin-api · jobs             │
└───────────────────┘   └────────────────────────────────┘

        Nincs külön geometria-adatbázis. A rács Firestore-ban él.
```

---

## GT: Geometria-modell döntés

**Ez volt a projekt legfontosabb nyitott kérdése, és a hexagon-rács megválaszolta.**

Eredetileg két lehetőséget vázoltam fel (PostGIS vs. Firestore+turf.js) — **mindkettő ugyanazt a hibás előfeltevést hordozta**: hogy a terület szabad alakú sokszög. A hexagon-rács bevezetésével ez az előfeltevés eltűnik, és vele együtt a probléma nehéz része is.

### A három modell

| | **A) PostGIS poligon** | **B) Firestore + turf.js poligon** | **C) Firestore + hexrács** |
|---|---|---|---|
| A terület reprezentációja | szabad alakú sokszög, lebegőpontos koordinátákkal | ugyanaz | **egész számú cella-azonosítók halmaza** |
| Nyomvonal → terület | csomópontosítás + poligonizálás + unió | ugyanaz, gyengébb kernellel | **flood fill a rácson** |
| Önmetsző nyomvonal | a legtörékenyebb pont: érvénytelen geometria, degenerált gyűrűk, orientáció-hibák | még törékenyebb | **magától megoldott** — pont ez a bezárás definíciója |
| Metszés / kivonás / unió | ST_Intersection, ST_Difference | turf.intersect, turf.difference | **halmazművelet egész számokon** |
| Lebegőpontos hibák | vannak, kezelni kell (snap-rounding) | vannak, rosszabbul kezelve | **nincsenek** |
| Kliens és szerver ugyanazt számolja? | nem garantált | nem | **igen, bitre azonosan** |
| „Ki birtokolja ezt a pontot?" | GIST-indexelt lekérdezés | H3-előszűrés + memóriában poligon-teszt | **egy kulcs-kikeresés** |
| Területszámítás | geodéziai integrál | ugyanaz | **cellaszám × 307,09** |
| GPS-hiba hatása | a határvonal folyton más → örök vita | ugyanaz | **elnyelve, a birtoklás stabil** |
| Infrastruktúra | +Cloud SQL (~30–80 €/hó, karbantartás, mentés, verziófrissítés) | nincs plusz | **nincs plusz** |
| Írásköltség | alacsony | alacsony | közepes → blokkosítással alacsony |
| Megjelenítés | poligon-kontúrok | ugyanaz | hexagonok (zoomonként aggregálva) |
| Fő kockázat | üzemeltetési teher, geometriai peremesetek | **helytelen eredmények éles adaton** | a felbontás visszafordíthatatlan |

### Miért nyer a C)

**1. A legnehezebb probléma eltűnik.** Egy valós futás nyomvonala önmetsző (a referencia-képeken is látszik nyolcas és többszörös hurok). Szabad alakú modellben ebből érvényes sokszöget képezni az a művelet, ami a legtöbb élő hibát okozná: gyűrű-orientáció, degenerált él, szinte-érintő szakasz, lebegőpontos metszéspont. Rácson mindez egyetlen szélességi bejárás, ami **mindig helyes eredményt ad**, és nem tud érvénytelen állapotot előállítani.

**2. Determinisztikus, tehát a kliens és a szerver egyetért.** Poligon-modellben a telefonon számolt előnézet és a szerveren számolt végleges terület mindig eltért volna pár százalékkal — és minden ilyen eltérés bizalomvesztés („ott 0,9 km²-t írt, itt meg 0,87-et"). Egész számú cellahalmazokon a két számítás **azonos**. Ez nem apró kényelem: ez az, ami a játékot hitelesnek érezteti.

**3. A GPS-pontatlanság kezelése beépül a modellbe, nem foltként kerül rá.** Ez volt az eredeti felismerésed, és ez a döntő érv. Szabad alakú poligonnál a határvonal minden futásnál 5–15 m-t vándorol, tehát „ugyanaz a kör" sosem ugyanaz — a védelemnövelés (ismételt bezárás) logikája nem is lenne megbízhatóan implementálható. Rácson a második kör **ugyanazokat a cellákat** adja, tehát a „körbe-körbe futás" jutalmazása egzakt.

**4. Nincs plusz infrastruktúra.** A Cloud SQL nem csak pénz: verziófrissítés, mentés, kapcsolat-pool, hálózati konfiguráció, még egy hely, ahol az adat kettéválhat a Firestore-tól. Kis csapatnál ez valós teher.

**5. Vizuálisan is jobb.** A hexagonos térkép **játéknak néz ki**, és egyértelművé teszi, mi kié — nincs „ez most az enyém vagy nem?" bizonytalanság a határon.

### Amit cserébe elfogadunk

| Kompromisszum | Mértéke | Kezelés |
|---|---|---|
| **A felbontás visszafordíthatatlan** | res 12-ről váltani = teljes migráció | A [03](03-jatekszabalyok.md#felbontás-miért-pont-res-12) táblája szerint a res 12 nem szoros döntés — a 10–20 m-es cél és az 1 000 m²-es minimum ugyanoda mutat |
| **Írásmennyiség** | cellánként tárolva kezelhetetlen lenne | Blokkosítás res 9 szinten: 240× kevesebb írás, ~0,25 $/nap 10 000 foglalásnál ([05](05-adatmodell.md#gridh3res9--a-cellatulajdonlás-a-rendszer-szíve)) |
| **Nagy birtok = sok cella** | 55 km² ≈ 179 000 cella | A blokkos tárolás és a zoom-szintenkénti csempe-aggregáció ezt elfedi; a felhasználó sosem tölt le 179 000 cellát |
| **A terület „lépcsős"** | 307 m²-es kvantálás | A megjelenítés úgyis egész m²; a kvantálás finomabb, mint amit bárki észrevesz |
| **H3 pentagonok** | a Földön 12 db van | Res 12-n elhanyagolható méretűek és túlnyomórészt óceánban vannak; a `geo-service` kezeli a peremesetet |

### Verdikt

> **Firestore + H3 res 12 hexagon-rács. Nincs PostGIS, nincs turf.js poligon-algebra.**
>
> A hexagon-döntés nem csak egyszerűsítette a geometriát — **kiiktatta a projekt legnagyobb technikai kockázatát**. Ez volt az eddigi legfontosabb tervezési döntés.

---

## Cloud Run szolgáltatások

### `geo-service` — a játékmotor
- `POST /activities/{id}/process` — nyomvonal → cellalánc → bezárás-felismerés → flood fill → blokkos foglalási tranzakció → GP-könyvelés → értesítések.
- Idempotens: ugyanaz az `activityId` kétszer feldolgozva nem duplázza a pontot.
- **Sorbaállítás:** Cloud Tasks, területi kulcs (H3 res 5) szerint szerializálva, hogy két egyidejű, ugyanoda érkező foglalás determinisztikus sorrendben fusson.
- **A klienssel közös algoritmus-modul** — ugyanaz a kód fut mindkét oldalon, ezért az előnézet és a végleges eredmény azonos.
- Csak `trusted` verdiktnél módosít birtokviszonyt; `pending_review` esetén sorba teszi.

### `tile-service`
- Mapbox vektorcsempe (MVT) generálás a rácsból, zoom-szintenként más aggregációval.
- Cloud CDN cache, a `grid` blokk `version` mezőjének változásakor invalidálva.

### `trust-service`
- A [Trust Score](03-jatekszabalyok.md#trust-score--aktivitás-hitelesség) kiszámítása minden mentett és importált aktivitásra.
- Türelmi automatika (60 perc), eszköz-bizonyíték és ismerős-útvonal alapú auto-jóváhagyás.
- A bejelentések súlyozott becsatornázása, bejelentő-hitelesség karbantartása.

### `mission-service` — küldetés-ajánló
- Kör-jelöltek generálása idő (nem táv) alapján, a felhasználó saját tempájából.
- Minden jelölt kiértékelése a **jelenlegi** birtokviszonyok ellen: új / lopható / áttörendő / erősíthető cellák.
- 3–4 érdemben különböző küldetés visszaadása becsült GP-vel ([02](02-funkcionalis-spec.md#útvonalak-fül--küldetés-ajánló)).
- Adatvédelmi szűrés: privát fiók tulajdonosa nem nevezhető meg; ugyanaz a személy naponta legfeljebb egyszer célpont.
- Kvóta: ingyenes heti 5, Pro korlátlan.

### `connector-svc`
- OAuth2 flow: Wahoo · Polar · Hammerhead (+ Garmin V1.5).
- Webhook-fogadás, aláírás-ellenőrzés, FIT/TCX/GPX feldolgozás.
- Apple Health / Health Connect: **kliensoldali** olvasás, feltöltés a szerverre normalizált formában.
- Duplikáció-szűrés: `externalId` + idő/táv egyezés ±2 %.

### `jobs` (Cloud Scheduler)

| Job | Ütem | Feladat |
|---|---|---|
| `daily-rollover` | **óránként** | azok a felhasználók, akiknél az elmúlt órában fordult **helyi** éjfél: hold-bónusz → védelem 1-re → streak-értékelés |
| `trust-sweep` | 5 percenként | lejárt türelmi idejű `pending_review` aktivitások automatikus érvényesítése |
| `weekly-reset` | hétfő 00:00 | heti GP nullázás, heti sorozat értékelés, mérföldkövek |
| `leaderboards` | 10 percenként | globális + lokális ranglisták újraszámolása |
| `streak-reminder` | óránként | 18:00 helyi idő szerinti emlékeztetők |
| `challenge-lifecycle` | óránként | kihívások indítása/zárása, jutalmak |
| `connector-sync` | 15 percenként | pollozó konnektorok |
| `integrity-sweep` | naponta | anti-cheat mintázatok utólagos keresése |
| `retention` | naponta | soft-delete lejáratok, adatmegőrzés |

---

## Kliens

- **Ajánlás: React + Capacitor** (a meglévő webes tudásra épít, az AI Studio-s munkafolyamathoz illeszkedik). Ahol natív kell:
  - háttér-helymeghatározás (`@capacitor-community/background-geolocation`),
  - HealthKit / Health Connect plugin,
  - élő értesítés (iOS Live Activity, Android foreground service).
- **Alternatíva:** React Native, ha a háttér-GPS és az akkumulátor-viselkedés kritikusabb, mint a fejlesztési sebesség. A tracking a legkockázatosabb natív felület — ezt kell először prototipizálni.
- Térkép: **Mapbox GL** (a referencia is az; sötét stílus, vektorcsempe, offline régió).
- Állapot: TanStack Query + Firestore realtime a feedre.
- **Offline-first tracking:** a nyomvonal helyben (SQLite) rögzül, hálózat nélkül is; feltöltés amint van kapcsolat. Az app bezárása/összeomlása után a folyamatban lévő aktivitás visszaállítható.

### Böngésző vs. natív — a fejlesztés két üzemmódja

Az AI Studio egy **böngészőben futó Vite + React appot** fejleszt. Ott a natív háttér-helymeghatározás **nem működik**: a HTML5 Geolocation API csak előtérben, aktív fülön ad pozíciót, és a képernyő elalvásakor leáll. Ez nem hiba, hanem a platform korlátja.

Ezért a fejlesztés két üzemmódban zajlik:

| Üzemmód | Hol | Mire jó |
|---|---|---|
| **Böngésző** | AI Studio, `npm run dev` | minden felület, a játéklogika, a szerverhívások, a feed, a ranglisták — a funkcionalitás ~90 %-a |
| **Natív** (Capacitor) | valós telefon | a háttér-GPS, az élő értesítés, a HealthKit/Health Connect, az akkumulátor-viselkedés |

Böngészőben a tracking képernyő a HTML5 Geolocation API-t használja, és **világosan jelzi**, hogy ez fejlesztői mód — nem szabad úgy tenni, mintha éles rögzítés lenne.

### Fejlesztői eszköz: GPX-visszajátszó *(kötelező, nem opcionális)*

A `scripts/replay.ts` (és a hozzá tartozó fejlesztői felület) egy **GPX/JSON nyomvonalat játszik vissza** a tracking képernyőnek, mintha valós GPS-adat érkezne — állítható sebességgel, akár azonnal.

Ez nem kényelmi eszköz. **Ez az egyetlen mód, hogy a játékmotort determinisztikusan teszteljük.** A `src/game/` logikáját nem lehet úgy validálni, hogy minden módosítás után kimegyünk futni egy kört.

Kötelező tesztnyomvonalak a `scripts/fixtures/` alatt:

| Fixture | Mit ellenőriz |
|---|---|
| `simple-loop.gpx` | alap bezárás, terület és GP számítás |
| `figure-eight.gpx` | **két** külön bezárás egy aktivitásból |
| `multi-lap.gpx` | ugyanaz a kör 4×: védelem 1→4, a szorzók helyessége |
| `open-route.gpx` | be nem zárt nyom → nincs terület, de van alappont |
| `gps-gap.gpx` | 50 m-es jelkihagyás → a `gridPathCells` hézagkitöltés vízhatlan-e |
| `self-touch.gpx` | GPS-remegésből eredő ál-hurok → NEM adhat területet |
| `steal.gpx` | idegen terület elvétele védelem 1-nél és 3-nál |
| `huge-bbox.gpx` | vonatút → a 150 km²-es védőkorlát elutasítja |

A böngészős előnézet és a szerver eredményének **azonosnak kell lennie** minden fixture-re — ez a rácsos modell egyik fő ígérete, és pont ez az, amit tesztelni kell.

### Fejlesztői eszköz: valós aktivitás-audit

A `/dev/activities` oldal a fixture-visszajátszó kezelési mintáját használja,
de az éles `activities` dokumentumokat és azok teljes privát nyomvonalát játssza
vissza. A felület listázza az aktivitásokat, és a lejátszás mellett mutatja:

- a szabadon elfoglalt és gazdát cserélt mezőket;
- felhasználónként az elvett és meggyengített mezőket;
- az 1–5 közötti védelmi szintváltozásokat;
- a sikeres hurkok méretét, valamint a sikertelen jelölteket;
- a zsákutca/összekötő-folyosó metszésekor levágott mezőket és a GPS-diagnosztikát.

Az audit külön kezeli az **egyedi mezőket** és a **mezőeseményeket**. Egy
többkörös aktivitásban ugyanaz a cella több 1→2→3 vagy 5→5 eseményt adhat;
ezeket nem szabad úgy feliratozni, mintha különálló mezők lennének.

A teljes nyomvonal miatt mindkét API-végpont (`GET /api/dev/activities` és
`GET /api/dev/activities/:id`) szerepkör-védett. A hozzáférés `owner`, `admin`
és `moderator` szerepkörre korlátozott. A mentéskori tulajdonviszonyt az
`activityAudits` rekord őrzi; enélkül régi aktivitásnál csak a geometriai
eredmény rekonstruálható, amit a felület egyértelműen jelez.

### Teljesítmény-célok
| Metrika | Cél |
|---|---|
| Hidegindítás | < 2,5 s |
| Belépő JS-csomag | < 500 kB gzip |
| Feed első kártya | < 1,5 s |
| Akkumulátor 1 óra trackingben | < 10 % |
| Területszámítás (mentés → eredmény) | < 5 s a 95. percentilisen |

> Korábbi projekt tanulsága: a belépő chunk és a precache méretét **az első naptól** mérni kell, nem utólag optimalizálni.

---

## Admin felület

Külön webalkalmazás (Firebase Hosting + `admin-api` Cloud Run), Google-belépéssel, szerepkör-alapú jogosultsággal (`owner` / `admin` / `moderator` / `support` / `readonly`). **Minden művelet naplózva** (`adminAudit`).

### 1. Áttekintő
DAU / WAU / MAU · új regisztrációk · aktivitások és összes táv naponta · elfoglalt km² · aktív streakek · Pro-konverzió és lemorzsolódás · konnektor-hibaarány · hibás job-futások.

### 2. Felhasználók
Keresés (név, e-mail, ID) · profil összes adata · aktivitáslista · GP-főkönyv · szerkesztés (megjelenített név, avatar eltávolítása) · **shadowban** · felfüggesztés · Pro adományozása · GP-korrekció (kötelező indoklással) · adatexport · GDPR-törlés indítása · belépési előzmény.

### 3. Aktivitások és Trust Score

**Ellenőrzési sor** (`pending_review`, legrégebbi elöl, 24 órás SLA). Minden tétel mellett egy **döntéstámogató panel**, hogy a moderátornak ne kelljen nyomozni:

- a nyomvonal térképen, a gyanús szakaszok kiemelve,
- sebesség- és gyorsulásgörbe a küszöbökkel együtt ábrázolva,
- szenzor-konzisztencia mátrix (tempó ↔ lépésfrekvencia ↔ pulzus ↔ magasság),
- a **részjelek pontszámai és súlyai**, hogy látszódjon, *mi* húzta le,
- a felhasználó előzménye: eddigi aktivitások, korábbi döntések, bejelentések,
- bejelentés esetén a kategória és a bejelentők hitelessége.

Döntés: `Jóváhagyás` (terület feldolgozva a jelen állapot ellen, GP jóváírva) · `Elutasítás` (indoklással, a felhasználó értesül és fellebbezhet) · `Típus átsorolása` (pl. futás → bringa, a terület a másik rétegbe kerül) · `Eszkaláció`.

Emellett: keresés/szűrés (verdikt, forrás, felhasználó, dátum) · **terület újraszámolása** · törlés (a terület és a GP visszavonásával).

### 4. Területek
Térképes áttekintés rétegenként, hexagon-rácson · zóna-részletek és előzmény · cella- vagy zónaszintű **manuális visszavonás/átruházás** (csalás utáni helyreállítás) · „területi hőtérkép" (hol aktív a játék, hol üres a rács).

### 5. Moderáció

**Két külön sor**, mert más kompetenciát igényelnek:

| Ág | Kategóriák | Eszközök |
|---|---|---|
| **Technikai** | GPS-manipuláció · autó/jármű · hibás mérés | a Trust Score döntéstámogató panel (fent), terület-visszavonás, típus-átsorolás |
| **Tartalmi** | sértő tartalom · adatvédelem · egyéb | tartalom eltávolítása, kép elrejtése, figyelmeztetés, shadowban, felfüggesztés |

Az **adatvédelmi** bejelentések priorizált sorba kerülnek, rövidebb SLA-val. Minden döntéshez: válasz-sablonok, a bejelentő értesítése, a bejelentő hitelességének frissítése, SLA-mérés.

### 6. Klubok és kihívások
Klub-lista, tagság, tulajdonos-váltás, publikálás visszavonása.
**Kihívás-szerkesztő:** típus, cél, időszak, hatókör (globális/városi/klub), jutalom (GP + jelvény), előnézet, ütemezés, kézi lezárás.

### 7. Játékkonfiguráció
Az `appConfig/gameplay` szerkesztése **verziózva**, előnézettel és visszavonással. Változás után a hatás azonnal él, de a korábbi tranzakciók változatlanok.
Feature flag-ek: fokozatos bevezetés (%-os kitettség), kill switch.

### 8. Jelvény- és szintkatalógus
Jelvények CRUD (ikon, feltétel, ritkaság, jutalom), szintküszöbök szerkesztése, visszamenőleges kiosztás futtatása.

### 9. Push-kampányok
Célzás (szegmens: inaktív 7 napja, Pro, város, szint), ütemezés, A/B, kézbesítési statisztika. **Kötelező:** leiratkozási állapot tiszteletben tartása, napi push-plafon felhasználónként.

### 10. Előfizetések
Store-tranzakciók, visszatérítések, próbaidőszakok, eltérés-riport (store vs. saját állapot).

### 11. Konnektorok
Szolgáltatásonkénti státusz, hibaarány, token-lejáratok, újraszinkron indítása.

### 12. Rendszer
Job-futások és hibák · Cloud Tasks sorok · hibanapló (Sentry/Error Reporting) · nyers Firestore-lekérdező (readonly).

---

## Analitika

**Termékanalitika:** Firebase Analytics + BigQuery export. Kulcs-események:
`sign_up`, `email_verified`, `activity_start`, `activity_save`, `loop_closed`, `territory_claimed`, `territory_stolen`, `territory_lost`, `gp_awarded`, `level_up`, `streak_broken`, `paywall_view`, `trial_start`, `subscribe`, `club_join`, `challenge_join`, `connector_link`.

**Kulcsmutatók:**
| Mutató | Miért |
|---|---|
| Aktivitás/aktív felhasználó/hét | a fő cél: mozgásra ösztönzés |
| D1 / D7 / D30 megtartás | általános egészség |
| Kör-bezárási arány | érti-e a felhasználó a játékot |
| Első kör bezárásáig eltelt idő | onboarding minősége |
| Streak-túlélés (7/30 nap) | a jutalmazás működik-e |
| Elvett zónák / nap | mozgásban van-e a játék |
| „Elvették és visszaszerezte" arány | a lopás motivál vagy elriaszt? |
| Pro-konverzió, próbaidő → fizetés | üzleti |

**Riasztások:** GP-infláció (napi átlag GP hirtelen ugrása), területszámítási hibaarány, job-késés, konnektor-hibák, push-kézbesítési arány.

---

## Biztonság és megfelelés

- App Check minden végponton · ID-token ellenőrzés · szerepkörök custom claim-ben.
- Titkok Secret Managerben, rotációval.
- Helyadat: érzékeny kategória — GDPR-tájékoztatás, célhoz kötöttség, export és törlés joga.
- Kiskorúak: 16 év alatt nem regisztrálható (életkori kapu), a szülői hozzájárulás kezelése kívül esik a V1 scope-on.
- App Store / Play: háttér-helymeghatározás indoklása, HealthKit adatvédelmi nyilatkozat, előfizetés-visszaállítás gomb (kötelező).
- Térképadat: Mapbox licenc, OSM attribúció megjelenítése (a képeken is látszik).

---

## Ütemterv

### F0 — Alapozás (2–3 hét)
Repo, CI/CD, Firebase projekt, designrendszer-tokenek, **auth: e-mail+jelszó + OTP + Google belépés + fiókösszevonás**, profil, navigáció/dock, üres képernyők, **GPX-visszajátszó a fixture-ökkel**.

*Nem igényel Mapbox tokent, natív buildet és külső konnektort — ez a fázis teljes egészében elkészíthető a böngészőben.*

### F1 — Tracking és aktivitás (3–4 hét)
Háttér-GPS, indítás előtti/aktív/szünet/mentés folyamat, offline sor, aktivitás-részletek grafikonokkal és részidőkkel, térkép-előnézet generálás, feed alapok.
**Ez a legkockázatosabb fázis — itt kell először natívot prototipizálni.**

### F2 — A játék (3–4 hét)
`geo-service` (cellalánc, bezárás-felismerés, flood fill, blokkos foglalás), védelem, rétegek, `tile-service`, Terület képernyő hexrács-megjelenítéssel, ranglisták, GP-motor és főkönyv, napi jobok, `trust-service` v1.
**F2 végén játszható a játék — itt érdemes zárt bétát indítani.**

### F2.5 — Küldetés-ajánló (1–2 hét)
`mission-service`, a Home napi küldetés-kártyája. Külön fázis, mert az F2 rács-logikájára épül, de az onboarding és a visszatérés szempontjából kritikus — nem szabad az F4-be csúsztatni.

### F3 — Közösség (3 hét)
Követés/kérések/tiltás/némítás, like, komment, üzenetek, klubok, felfedezés, jelentés + moderációs sor, értesítések (in-app + push).

### F4 — Mélység és bevétel (3 hét)
Statisztikák, analitika, útvonalgenerálás, edzéstervek, felszerelés, útlevél, jelvények, kihívások, Pro + paywall + store-integráció.

### F5 — Konnektorok (2–3 hét)
Apple Health / Health Connect, Wahoo, Polar, Hammerhead. (Garmin partner-jóváhagyással később.)

### F6 — Éles indulás (2 hét)
Admin felület befejezése, terheléspróba, biztonsági audit, store-beadás, jogi dokumentumok, támogatási folyamat, monitorozás és riasztások.

**Összesen ~18–22 hét** egy fókuszált csapatnak. A kritikus út: háttér-GPS megbízhatóság → geometria helyessége → store-jóváhagyás.

---

## Kockázatok

| Kockázat | Hatás | Kezelés |
|---|---|---|
| Háttér-GPS megbízhatatlansága iOS-en | a rögzítés kihagy → elveszett terület → bizalomvesztés | korai natív prototípus, valós terepteszt, „nyomvonal-javítás" funkció |
| ~~Önmetsző nyomvonalak rossz poligonizálása~~ | — | **Megszűnt** a hexrács-döntéssel: a bezárás flood fill, nem poligon-algebra |
| A hexfelbontás rossz megválasztása | teljes migráció élő adaton | res 12 rögzítve; a döntés a 03. fejezetben számokkal alátámasztva; unit-teszt sorozat valós GPX-ekkel |
| Csalás (autó, hamis GPS) | a ranglista értelmét veszti | Trust Score 7 jelforrásból, konnektor-adat mint bizonyíték, 24 órás moderációs SLA |
| Túl szigorú Trust Score | ártatlan felhasználók területet vesztenek → dühös lemorzsolódás | küszöbök `appConfig`-ban hangolhatók, türelmi automatika, fellebbezés, a `pending` aktivitás **látszik** a profilban |
| Üres városok („nincs kivel játszani") | üres élmény | lokális ranglista kis körzetre, botok NEM, helyette klub- és kihívás-alapú belépés |
| Akkumulátor-fogyasztás | negatív értékelések | adaptív mintavétel, mozgásérzékelő, mérhető cél (10 %/óra) |
| Geometria-költség növekedése | infrastruktúra-számla | H3-előszűrés, csempe-cache, PostGIS-index |
| Store-elutasítás (háttér-hely, egészségadat) | csúszás | indoklások és adatvédelmi szövegek előre, tesztfiók a review-nak |

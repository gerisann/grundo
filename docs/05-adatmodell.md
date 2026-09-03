# 05 — Adatmodell

## Tárolási stratégia

| Adat | Hol | Miért |
|---|---|---|
| Profil, közösségi gráf, feed-metaadat, beállítások | **Firestore** | valós idejű, offline-cache, egyszerű szabályok |
| Aktivitás összegzés (számok, splits, poliline) | **Firestore** | a feedhez és a részletekhez kell |
| Nyers idősor (GPS + pulzus + teljesítmény, több ezer pont) | **Cloud Storage** (gzip JSON / FIT), **aláírt URL-lel, csak a tulajdonosnak** | Firestore dokumentum-limit (1 MB) és költség; a nyers idősor tartalmazza a privát zónába eső pontokat is |
| **Cellatulajdonlás (a rács)** | **Firestore, blokkokba (chunk) tömörítve** | a hexrács miatt nem kell térbeli adatbázis — lásd lent |
| Térkép-csempék (vektor) | **Cloud Run generálja → Cloud CDN** | a rács megjelenítése zoom-szintenként |
| Térkép-előnézeti képek | **Cloud Storage** + CDN | statikus, cache-elhető |
| Konnektor tokenek | **Secret Manager** | soha nem kerülhet kliens közelébe |

> **Nincs PostGIS.** A hexagon-rács döntés után a geometria halmazműveletté vált, térbeli adatbázis nélkül. Az indoklás: [06 — Geometria-modell](06-architektura-es-admin.md#gt-geometria-modell-döntés).

---

## Firestore kollekciók

### `users/{uid}`
```ts
{
  username: string            // ahogy beírta — „Geri". Ez látszik mindenhol.
  usernameLower: string       // „geri" — egyediségi kulcs; ez a usernames/{id} is.
                              // Kereséshez, névfeloldáshoz MINDIG ezt használd.
  displayName: string         // alapból = username; a valódi nevet a felhasználó
                              // adhatja meg, magától SOHA nem vesszük át
  email: string
  emailVerified: boolean
  photoURL?: string
  bio?: string
  city?: string               // lokális ranglistához
  countryCode?: string
  h3Home?: string             // res 6 cella, lokális feedhez

  pro: { active: boolean, plan: 'monthly'|'annual'|null,
         renewsAt?: Timestamp, source: 'ios'|'android'|'promo' }

  level: number
  gpTotal: number
  gpWeek: number              // hétfőn nullázva
  gpMonth: number

  territoryM2:  { foot: number, bike: number }   // tárolás m², megjelenítés mindig km² (formatArea)
  cellCount:    { foot: number, bike: number }   // a tárolt igazság
  zoneCount:    { foot: number, bike: number }   // összefüggő foltok száma

  // Időablakos SZERZÉS (bruttó, a gpWeek/gpMonth mintájára) — a napi/heti/
  // havi ranglistához, NEM a jelenlegi állományt mutatja. A dailyRollover
  // nullázza (nap: minden fordulónál; hét/hónap: csak zárásnál).
  areaDay:      { foot: number, bike: number }   // helyi éjfélkor nullázva
  areaWeek:     { foot: number, bike: number }   // hétfőn nullázva
  areaMonth:    { foot: number, bike: number }

  trust: { level: 'new'|'established'|'trusted'|'watched',
           cleanActivities: number, upheldReports: number, watchedUntil?: Timestamp }

  streak: { current: number, longest: number,
            lastActiveDay: number | null,   // NAPSZÁM a felhasználó helyi ideje szerint
            freezesLeftThisWeek: number,
            weeks: number,                  // heti sorozat
            weekActiveDays: number,         // a folyó hét aktív napjai
            milestonesAwarded: number[] }   // már kiosztott heti mérföldkövek

  rollover: { lastDay: number,              // meddig jutott a napi forduló
              nextDueAt: Timestamp,         // a következő helyi éjfél — erre megy a job lekérdezése
              lastRunAt?: Timestamp }

  counters: { activities: number, followers: number, following: number,
              distanceKm: { run: number, walk: number, ride: number } }

  privacy: { account: 'public'|'private',
             defaultVisibility: 'everyone'|'followers'|'only_me',
             allowComments: boolean,
             hideStart: boolean, startRadiusM: 50|100|200,   // alap: true / 200
             hideEnd: boolean,   endRadiusM: 50|100|200,     // alap: true / 200
             routeRevision: number,                          // retroaktív újravágás verziója
             privacyZoneSetAt: Timestamp }                   // az onboarding kötelező lépése

  units: { distance: 'km'|'mi', weight: 'kg'|'lbs', height: 'cm'|'ftin' }
  body: { weightKg?: number, heightCm?: number, dob?: string }

  status: 'active'|'shadowbanned'|'suspended'|'pending_deletion'
  createdAt, updatedAt: Timestamp
}
```
- A fő `users/{uid}` dokumentum **nem publikus profilrekord**: e-mailt,
  testadatot, trust- és fiókstátuszt is tartalmaz, ezért közvetlenül csak a
  tulajdonos és az admin olvashatja. Az idegen profil, keresés, követőlista,
  jelvény és útlevél kizárólag a mezőket fehérlistázó backend API-n át jön.
- `users/{uid}/private/settings` — csak a tulajdonos olvashatja (értesítés-kapcsolók, e-mail preferenciák).
- `users/{uid}/private/tracking` — a felhasználó eszközei között megosztott,
  **utolsó rögzítési pillanatkép**: `{ activityId, deviceId, status, type,
  route, distanceM, movingMs, speedMps, startedAt, updatedAt }`. A `route`
  legfeljebb 400 pontra ritkított; írás legfeljebb 15 másodpercenként és
  állapotváltáskor. Csak a tulajdonos olvashatja és írhatja, játékadatnak nem
  forrása. Ez egyetlen, felülírt kijelzési slot, nem félbehagyott utak listája:
  csak `recording`/`paused` állapotban és az `updatedAt` után legfeljebb 1 óráig
  jelenik meg. `finished` nem jeleníthető meg. A későbbi Pro, eszközök között
  folytatható út külön, teljes pontosságú sémát igényel.
- `usernames/{lowercase}` → `{ uid, username, createdAt }` — egyediség tranzakcióval. A dokumentum azonosítója a kisbetűs kulcs, a `username` mező a megjelenítési alak.

### `activities/{activityId}`
```ts
{
  userId: string
  type: 'run'|'walk'|'ride'
  layer: 'foot'|'bike'
  title: string
  description?: string

  startedAt, endedAt: Timestamp
  timezone: string

  distanceM: number
  durationS: number
  movingS: number
  avgPaceSPerKm?: number      // foot
  avgSpeedKmh?: number        // bike
  elevGainM: number
  elevLossM: number
  maxElevM: number
  calories?: number
  avgHr?, maxHr?: number
  avgCadence?: number
  avgPowerW?, maxPowerW?, totalWorkKj?: number

  route: string               // LEVÁGOTT, kódolt nyomvonal — ez a publikus
  routeHidden: boolean        // üres, mert a privát zóna mindent lefedett
  routeVersion: number        // a privátzóna-vágó algoritmus verziója
  routePrivacyRevision: number // melyik users.privacy.routeRevision alapján készült
  routePending: boolean       // félbeszakadt újravágásnál true; addig biztonságosan rejtett
  streamsPath?: string        // gs:// az idősorhoz
  splits: Array<{ km: number, timeS: number, paceSPerKm: number, elevM: number }>
  bounds: { north, south, east, west: number }

  loops: number                        // hány bezárás történt az aktivitás alatt
  claim: { cells: number, areaM2: number,
           freeCells: number, reclaimedCells: number,
           stolenCells: number, breakthroughCells: number,
           stolenFrom: string[] }
  gp: { base, claim, steal, breakthrough, streakMult, total: number,
        status: 'awarded'|'pending'|'void' }

  source: 'app'|'apple_health'|'health_connect'|'wahoo'|'polar'|'hammerhead'|'garmin'
  deviceName?: string
  externalId?: string         // duplikáció-szűréshez
  equipmentId?: string
  weather?: { tempC: number, icon: string }

  photos: Array<{ path: string }> // legfeljebb 5; nincs tartós letöltési token
  // A feed térképképét a kliens a `route` mezőből kéri a Static Images API-tól.
  // Régi, route nélküli aktivitás feed- vagy adatlaplekérésekor a szerver
  // visszatölti ezt a privát nyomból, a privát zóna alkalmazása után.

  visibility: 'everyone'|'followers'|'only_me'
  likeCount: number
  commentCount: number

  trustVerdict: 'trusted'|'pending_review'|'rejected'   // a pontszám maga NEM itt van
  // trust diagnosztika nincs ezen a publikus dokumentumon

  createdAt, updatedAt: Timestamp

  // Tulajdonosi törléskor 30 napos soft-delete:
  deletedAt?: Timestamp
  purgeAt?: Timestamp
  deletedBy?: 'owner'|'admin'
}
```
- `activities/{id}/private/track` → `{ points, bounds }` — **a teljes, levágatlan nyomvonal és befoglaló téglalapja**. Külön dokumentumban, mert a Firestore szabályai nem tudnak mezőszinten szűrni. A publikus `route` és `bounds` kizárólag a privát zónával levágott pontokból készül. Olvasás: **csak a tulajdonos és az admin.**
- Az aktivitásfotó közvetlen Storage-olvasása csak a tulajdonosnak engedett.
  Más néző a hitelesített `GET /api/activities/{id}/photos/{fileName}`
  végponton kapja meg, miután a backend a `grundo-db` adatbázisban ellenőrizte
  a láthatóságot, a követést és mindkét tiltási irányt. A válasz privát,
  rövid böngészőcache-t használ; letöltési token nem kerül a Firestore-ba.
- A már telepített natív kliensek átmenetileg továbbra is kapnak `photo.url`
  mezőt az API-válaszban. Ez nem Firebase download token, hanem 15 percig
  érvényes V4 aláírt URL, amely kizárólag az adott objektum olvasására jogosít.
  Az új kliens ezt figyelmen kívül hagyja és a hitelesített végpontot használja.
- Saját feed- és profilválasznál a backend kizárólag a hitelesített tulajdonos
  válaszában, mentés nélkül felülírja a publikus route-ot a teljes privát
  nyomvonallal. Így a „saját nézet mindig teljes” szabály minden képernyőn
  érvényes, miközben más felhasználó továbbra sem fér hozzá a teljes nyomhoz.
- `activities/{id}/likes/{uid}` → `{ createdAt }`
- `activities/{id}/comments/{cid}` → `{ userId, text, createdAt, editedAt?, deleted? }`

Tulajdonosi törléskor az aktivitás azonnal kikerül minden feedből és adatlapról,
de 30 napig visszaállíthatóan megmarad. Ez a tartalom törlése: a már kiosztott GP
és a konkurens területállapot nem tekerhető vissza. A moderátori törlés külön,
auditált művelet, amely a GP/terület korrekcióját is elvégezheti.

### `activityUploads/{activityId}` — átmeneti feldolgozási életjel

```ts
{
  userId: string
  status: 'processing'|'failed'
  startedAt: number
  updatedAt: number
  leaseUntil: number
  token: string                // feldolgozási kísérlet azonosítója
  message?: string
  retryable?: boolean
}
```

Kizárólag a szerver írja és olvassa. Nem játékadat és nem részleges foglalás:
az aktivitás geometriája és a birtokviszony továbbra is a végleges mentéskor
kerül elszámolásra. Arra szolgál, hogy megszakadt HTTP-kapcsolat után a kliens
meg tudja különböztetni a még futó szerverfeldolgozást az el sem indult
kéréstől. Sikeres mentéskor törlődik; a lejárt lease újrapróbálhatóvá teszi a
konténerleállás miatt félbemaradt feldolgozást. Kliensoldali Firestore-hozzáférés
nincs hozzá, az állapot csak a hitelesített API-végponton kérdezhető le.

### `grid/{h3res9}` — a cellatulajdonlás (a rendszer szíve)

A birtoklás **cellánként** él, de nem cellánként *tárolódik* — az egyedi dokumentum cellánként kezelhetetlen írásszámot adna. A tárolás **blokkokban** történik: egy `grid` dokumentum egy **H3 res 9** szülőcella (≈105 000 m²), és tartalmazza a benne lévő **343 db res 12 cella** tulajdonviszonyát.

```ts
// dokumentum-azonosító: "{layer}_{h3res9index}"   pl. "foot_8944c1a1b3fffff"
{
  layer: 'foot'|'bike'
  parent: string                  // h3 res 9 index
  cells: {
    // kulcs: res 12 h3 index utolsó 6 karaktere (a szülőből visszaállítható)
    "a1b3c4": { o: string, d: 1|2|3|4|5 }   // o = tulajdonos uid, d = védelem
  }
  ownerCounts: { [uid: string]: number }    // gyors összegzéshez
  version: number                            // optimista zároláshoz
  updatedAt: Timestamp
}
```

**Miért ez a méret:**

| | res 12 cellánként | **res 9 blokk** | res 8 blokk |
|---|---|---|---|
| Írás egy 1 000 000 m²-es foglalásnál | ~3 257 dokumentum | **~10–15 dokumentum** | ~2–4 dokumentum |
| Dokumentum mérete | pici | ~20 KB (343 cella) | ~140 KB (2 401 cella) |
| Ütközés két játékos között | nincs | ritka | gyakori |
| Firestore-költség (10 000 foglalás/nap) | ~59 $/nap | **~0,25 $/nap** | ~0,07 $/nap |

A res 9 a jó kompromisszum: **240×-es írásmegtakarítás** a cellánkénti tároláshoz képest, miközben a dokumentum kicsi marad és az ütközés ritka. (Res 8-cal még olcsóbb lenne, de egy sűrűn játszott városrészben a nagy blokkok folyamatos tranzakció-ütközést okoznának.)

**Írás:** kizárólag a `geo-service`, tranzakcióban, blokkonként. A tranzakció a teljes candidate cellahalmaz blokkjait olvassa, majd az aktuális ownership alapján újrafuttatja a játékmotort. Konkurens módosításkor a Firestore retry új ownershipből számol; az első sikeres commit nyer. Az aktivitásazonosító, a GP-ledger és a területesemények determinisztikus azonosítói biztosítják az idempotenciát.

Az egycellás izolált maradványok felismeréséhez a tranzakció a candidate
halmaz **kétgyűrűs H3-környezetét** is beolvassa. A változatlan 5→5
mezőérintések az auditban és a pontozásban események maradnak, de nem írják
vissza feleslegesen ugyanazt az állapotot a grid dokumentumaiba.

#### Nagy foglalások

Egy Firestore-tranzakció **legfeljebb 500 írást** tartalmazhat. Ez platformkorlát,
nem hangolható. Egy aktivitás írásigénye:

```
8 + blokkok + károsultak × 2
```

A nyolcas tag állandó (aktivitás, teljes nyomvonal, trust, audit, GP-főkönyv,
napi GP, profil, blokk-index), a blokkok pedig **egy írást** jelentenek fejenként.
Ebből a gyakorlati plafon **~492 blokk**, ami egy nagyjából 26 km kerületű,
területet ténylegesen bezáró körnek felel meg. Mért értékek: 10 km → 80 blokk
(88 írás), 20 km → 270 blokk (278 írás), 26 km → 465 blokk (473 írás),
28 km → 536 blokk (544 írás, elutasítva).

> Blokkonként korábban **két** írás volt: a rács-dokumentum és egy külön
> mutató-dokumentum a felhasználónál. A mutató 2026-08-19 óta rétegenként
> egyetlen, `arrayUnion`-nel bővített dokumentum (`users/{uid}/blockIndex/{layer}`),
> ezért a menthető kör ~18 km-ről ~26 km-re nőtt.

#### Egységes (uniform) blokk

Egy 343 cellás blokk JSON-ben **~23 kB**, amiből **~9 kB puszta uid-ismétlés**
(343-szor ugyanaz a 28 karakteres azonosító). Ha a blokk MINDEN cellája
ugyanabban az állapotban van — ugyanaz a tulajdonos, ugyanaz a védelmi szint,
ugyanaz a szerzési nap —, akkor egyetlen rekord elég:

```jsonc
{ "layer": "foot", "parent": "…", "uniform": { "o": "…", "d": 1, "u": 20684 } }
```

Ez **~0,15 kB**, azaz **152-szer kisebb**. A két alak sosem él együtt: ha
`uniform` van, a `cells` üres.

**Miért éri meg?** Egy nagy foglalás belseje jellemzően pontosan ilyen: egyben
szerzett, homogén terület. Mért példa a Balaton-körre (~600 km², ~5 700 blokk):

| | Kifejtve | Uniform blokkal |
|---|---|---|
| Firestore-tárhely | ~133 MB | **~15 MB** |
| Tömörített blokkok | 0 | ~5 100 |
| Kifejtve maradó (határ menti) | 5 700 | ~600 |

**Mikor tömörít és mikor bont vissza?** Mindkettő az ÍRÁS TRANZAKCIÓJÁBAN,
nem külön jobban. Így nincs második írófél a rácson, nincs ütemezés, ami
elhasalhat, és nincs félig tömörített állapot. A vizsgálat ingyen van: a
cellatérkép már a kezünkben van, amikor a blokkot írjuk.

⚠️ **Az olvasók sosem nyúlnak közvetlenül a `cells`-hez.** Az `expandBlock` és
a `cellFromBlock` kezeli mindkét alakot — enélkül egy tömörített blokk üres
térképszakaszként jelenne meg, és a felhasználó azt hinné, eltűnt a területe.

**Migráció nem kell.** A `uniform` mező elhagyható, tehát a régi, kifejtett
blokkok változatlanul olvashatók. Amelyik blokkot legközelebb írjuk, az magától
felveszi a tömörebb alakot, ha egységes.

#### `users/{uid}/blockIndex/{layer}` — mely blokkokban van cellám

A Firestore nem tud térkép-KULCSOKRA keresni, tehát a „mely blokkokban van
cellája ennek a felhasználónak" kérdés magából a rácsból nem válaszolható meg.
Ezért vezetünk mutatót: rétegenként egy dokumentum, benne a blokkazonosítók
tömbje. Írja a `geo-service` a foglalás tranzakciójában, olvassa a saját
terület képernyője.

⚠️ **Szándékosan NEM `users/{uid}/blocks/`**: azt a nevet a felhasználó-tiltás
foglalja, és azt az alkollekciót a felhasználó maga írhatja. Amíg a rács-mutató
is ott volt, a felhasználó letörölhette a saját mutatóit — amitől a területe
eltűnt volna a saját térképéről.

A mutató **elavulhat**: a felhasználó elveszítheti az összes celláját egy
blokkban, az azonosító viszont bent marad. Ezt olvasáskor szűrjük, nem
törléssel — a törlés minden károsultnál további írásokat jelentene.

A `blocks` tömb **nincs indexelve** (`fieldOverrides` a `firestore.indexes.json`-ban):
a Firestore alapból minden tömbelemre külön indexbejegyzést készít,
dokumentumonként 40 000-es plafonnal. Lekérdezni sosem kell rá, mindig a teljes
listát olvassuk. A dokumentum 1 MB-os korlátja így ~40 000 blokknál (≈4 200 km²)
jelentene határt.

Efölött a mentés **nem áll meg**: átvált a darabolt útra.

##### Darabolt mentés

Ami nem fér egyetlen tranzakcióba, az három fázisban megy:

1. **Foglalás** — az aktivitás, a nyomvonal, a trust és az audit. Fix méretű,
   mindig belefér. Az aktivitás `claimStatus: 'pending'` állapotban jön létre,
   tehát a felhasználó azonnal látja a mozgását.
2. **Csoportok** — blokkcsoportonként (400 blokk) egy tranzakció. Minden
   csoport a saját eredményét `activities/{id}/claimParts/{groupId}` alá írja,
   determinisztikus azonosítóval — ezért újrafuttatható, és kétszer nem
   könyvelhet.
3. **Könyvzárás** — a részek összegzéséből GP, profil, károsultak, események.
   `claimStatus: done`.

**Miért helyes a darabolás?** Mert a birtoklási döntés cellánkénti és blokkok
között független: a `resolveClaim` minden mezőt kizárólag a saját aktuális
tulajdonviszonyából ítél meg. Egy csoport tranzakciója tehát önmagában is
helyes, ha a saját blokkjait frissen beolvassa. Ami nem független — a GP
összesítése és az árva mező kétgyűrűs környezete —, azt külön kezeljük: az
előbbit a záró fázis, az utóbbit az olvasásban túlnyúló csoport.

**Az ára** az atomicitás egy része: a nagy foglalás néhány másodperc alatt
terül szét, és eközben egy konkurens játékos félig alkalmazott állapotot
láthat. A cellánként első sikeres commit szabálya viszont nem sérül.

**Nincs sor (Cloud Tasks).** Egy 200 km-es kör ~15 tranzakció, néhány
másodperc — a Cloud Run időkorlátja alatt nagyságrenddel. A sort akkor
vezetjük be, ha a kérések tényleg időtúllépésbe futnak.

Egy kérésben legfeljebb 40 csoport indul, azaz **16 000 blokk (≈1 680 km²)**.
Efölött stabil `activity_too_large` hibakód jön — ott lesz a helye a valódi
sorbaállításnak.

Az egyenértékűséget emulátoros teszt őrzi: ugyanaz a bemenet a két úton
**bitre azonos rácsot** kell adjon.

**FONTOS: az írásszám a TERÜLETTŐL függ, nem a cellafelbontástól.** Egy blokk
egy res 9 hatszög (~0,105 km²) — hogy 343 db res 12 vagy 49 db res 11 cella van
benne, az a dokumentum méretét változtatja, az érintett blokkok SZÁMÁT nem.

**A foglalás oldaláról ez megoldva.** Ami a 200 km-es körből még hiányzik, az
a motor befoglaló-doboz plafonja (`MAX_LOOP_BBOX_CELLS`, ~143 km²).

### `zones/{zoneId}` — származtatott, megjelenítéshez

A „zóna" (összefüggő birtokfolt) nem tárolt igazság, hanem a rácsból számolt **összefüggő komponens**. A `daily-rollover` és minden foglalás után frissül; ebből jön a ranglista „36 terület" száma és a térkép határvonala.

```ts
{
  ownerId: string
  layer: 'foot'|'bike'
  cellCount: number
  areaM2: number                  // cellCount × 307.09
  boundary: GeoJSON.Polygon       // a komponens külső kontúrja, megjelenítéshez
  centroid: GeoPoint
  bounds: { north, south, east, west }
  minDefense: 1|2|3|4|5           // a leggyengébb pont — a támadó ezt keresi
  claimedAt: Timestamp
  updatedAt: Timestamp
}
```

### `territoryEvents/{activityId}_{recipientId}`
```ts
{ type: 'territory_stolen',
  actorId: string, recipientId: string,
  layer: 'foot'|'bike',
  cells: number, areaM2: number,
  areaName?: string,              // fordított geokódolás: "Gazdagrét"
  centroid: GeoPoint,
  activityId: string, status: 'pending'|'delivered'|'failed',
  read: boolean, createdAt: Timestamp }
```
**Egy támadás = egy esemény**, nem cellánként — ez az alapja az értesítésnek („Maya átvágta a területed — –21 400 m², Gazdagrét") és az „Élő lopási riasztások" felületnek.

### `gpLedger/{entryId}`
```ts
{ userId, amount: number,
  source: 'activity'|'hold'|'streak_milestone'|
          'challenge'|'badge'|'admin_adjust',
  activityId?, challengeId?, badgeId?: string,
  gp?: { base, claim, steal, breakthrough, streakMult, modifierMult,
         softCapReduction, total },
  multiplier?: number,            // az időszakos szorzók eredője
  modifiers?: AppliedModifier[],  // melyik akció, mekkora részesedéssel
  configVersion?: number,         // melyik appConfig-verzióval számoltunk
  localDay?: number,              // a felhasználó helyi napja (napi jóváírásnál)
  note?: string, at: Timestamp, day: number }
```
Az egyetlen igazságforrás a pontokra; a `users.gpTotal` ennek az aggregátuma.

**Determinisztikus azonosítók.** A napi jóváírás `hold_{uid}_{localDay}`, a heti mérföldkő `milestone_{uid}_{hetek}` néven íródik. Így egy megismételt job-futás ugyanazt a dokumentumot írja felül, nem keletkezik második jóváírás — az idempotencia az azonosítóból jön, nem egy külön ellenőrzésből, amit el lehet felejteni.

### `dailyGp/{uid}_{gameDay}`
```ts
{ userId: string, day: number, total: number, updatedAt: Timestamp }
```
A napi lágy plafon tranzakciós állapota. Kliensről nem olvasható és nem írható; ugyanabban a tranzakcióban változik, mint a determinisztikus `gpLedger/activity_{activityId}` rekord.

### `activityTrust/{activityId}`
Az aktivitás belső trust pontszáma, részjelei/indokai, `measuredVerdict` értéke és az `appliedGameplayDecision` rollout-döntés. Csak admin olvashatja. A publikus aktivitásdokumentumba kizárólag a ténylegesen alkalmazott felhasználói státusz kerül; observe-only módban ez `trusted`, miközben a mért verdikt az admin rekordban megmarad.

### `activityAudits/{activityId}`

A mentéskori, tranzakcióban látott birtokállapotból készülő belső játékmenet-audit.
Tartalmazza a szabad foglalások, gazdaváltások, erősítések és gyengítések
darabszámát, az 1–5 közötti védelmi átmeneteket, az érintett tulajdonosonkénti
összesítést, valamint a sikeres és sikertelen hurkok diagnosztikáját. Nyers
cellaazonosítókat nem duplikál; a hiteles aktuális állapot továbbra is a `grid`.

A dokumentumot kizárólag a szerver írja. Közvetlen kliensolvasása tiltott; a
`GET /api/dev/activities/:id` csak `owner`, `admin` vagy `moderator` szerepkörrel
adja vissza. Az audit bevezetése előtt készült aktivitásoknál a nyomvonal és a
hurokgeometria rekonstruálható, a korabeli birtokviszony és gazdaváltás nem.

### Régi aktivitások adatvédelmi migrációja

Dry-run: `cd server && npm run migrate:activity-privacy`. Íráshoz `-- --apply`; a `grundo` projekten ezen felül `--allow-production` is kötelező. A futtatás előtt a `GOOGLE_CLOUD_PROJECT` változóval explicit meg kell adni a célt. A script eltávolítja a publikus trust diagnosztikát, admin-only rekordba menti, és a publikus route-ból újraszámolja a bounds értéket.

Az aktivitásfotók tokenmentesítésének dry-runja:
`cd server && npm run migrate:activity-media-privacy`. Íráshoz ugyanúgy
`-- --apply`, élesben pedig `--allow-production` is kell. A script a Firestore
fotóelemeit `{ path }` alakra normalizálja, és visszavonja az `activities/`
Storage-objektumok meglévő Firebase letöltési tokenjeit.

### Közösségi gráf
- `users/{uid}/following/{targetUid}` → `{ createdAt }`
- `users/{uid}/followers/{sourceUid}` → `{ createdAt }`
- `followRequests/{targetUid}/items/{requesterUid}` → `{ createdAt }`
- `users/{uid}/blocks/{targetUid}` · `users/{uid}/mutes/{targetUid}`

### `users/{uid}/rivals/{otherUid}` *(döntés: 2026-08-22)*
```ts
{ gainedCells: number, lostCells: number, exchangedCells: number,
  gainedEvents: number, lostEvents: number, lastAt: Timestamp }
```
Tükör-alkollekció, mint a `blocks`/`blockedBy`: lopásonként két dokumentum keletkezik (`users/{támadó}/rivals/{áldozat}` és fordítva), tükrözött számokkal. Nincs index-igény, a `rivals` lekérdezés egyetlen mezőn (`exchangedCells`) rendez. Csak a tulajdonos olvashatja, írás kizárólag szerveroldalról. Lásd [server/src/lib/rivals.ts](../server/src/lib/rivals.ts).

A funkció bevezetése előtti kapcsolatokat a `territoryEvents` teljes történetéből a `server/src/scripts/backfillRivals.ts` számolja újra. A szkript alapértelmezésben csak jelentést készít; az érintett tükördokumentumokat teljes aggregátummal írja felül, ezért ismételten is biztonságosan futtatható.

### `bandas/{bandaId}` *(GRUNDO #29 — Klub → Banda átnevezés, kibővítve)*
```ts
{ name: string, nameLower: string,    // kereséshez, a usernameLower mintájára
  description: string|null, photoURL: string|null, city: string|null, countryCode: string|null,
  visibility: 'public'|'private',
  inviteCode?: string,                // 8 karakter, csak private esetén
  ownerId: string, memberCount: number,
  settings: {
    whoCanInvite: 'everyone'|'moderators'|'owner',
    inviteCodeVisibleTo: 'everyone'|'moderators'|'owner',
    postPermission: 'everyone'|'moderators'|'owner',   // Phase 2: hírfolyam
  },
  totals: {
    areaM2: { foot, bike },                              // mindenkori
    areaDayM2: { foot, bike }, areaWeekM2: { foot, bike }, areaMonthM2: { foot, bike },
    gpTotal: number, gpWeek: number, gpMonth: number,
    updatedAt: Timestamp,                                 // a rollup job írja
  },
  createdAt }
```
- `bandas/{id}/members/{uid}` → `{ role: 'owner'|'moderator'|'member', joinedAt }`
- `users/{uid}/bandas/{bandaId}` → `{ role, joinedAt }` — TÜKÖR a `members`
  felől, a `following`/`followers` mintájára: a „saját bandáim" lista ebből
  megy, collectionGroup-lekérdezés nélkül. Lásd `server/src/routes/bandas.ts`.
- `inviteCodes/{code}` → `{ bandaId }`
- Nincs `joinRequests`: publikus bandánál a csatlakozás azonnali, privátnál
  kizárólag meghívókóddal vagy appon belüli meghívással. A `totals`-t egy
  külön, óránként futó rollup job (`jobs/bandaRollover.ts`) számolja a tagok
  jelenlegi `territoryM2`/`areaDay`/`areaWeek`/`areaMonth`/`gpTotal`/
  `gpWeek`/`gpMonth` mezőiből — nem élő olvasáskor.
- `bandas/{id}/invites/{uid}` → `{ invitedBy, invitedByUsername, createdAt }`
  *(GRUNDO #30)* — appon belüli meghívás, tükrözve
  `users/{uid}/bandaInvites/{bandaId}` alá (`{ bandaName, invitedBy,
  invitedByUsername, createdAt }`), a tagság-tükör mintájára: a „rám váró
  meghívók" lista ebből megy, collectionGroup-lekérdezés nélkül. Elfogadás/
  elutasítás mindkét oldalról törli. Lásd `server/src/routes/bandas.ts`.
- `bandas/{id}/feed/{postId}` és `bandas/{id}/wall/{msgId}` *(GRUNDO #30)* →
  mindkettő `{ authorUid, authorUsername, text, createdAt }`. Csak tagoknak
  olvasható. A hírfolyamra a `settings.postPermission` szerint posztolhat
  (`everyone`/`moderators`/`owner`, a `meetsRolePermission` dönti el), a
  chat falra bárki tag írhat, arra nincs külön beállítás. Nincs
  szerkesztés/törlés/lájk/válasz Phase 2-ben — sima, időrendi lista.
- Phase 3 tagkezelés *(GRUNDO #30)*: a szerver tranzakcióban tartja egyezőn
  a `bandas/{id}/members/{uid}` és `users/{uid}/bandas/{id}` szerepköröket.
  Az alapító moderátort nevezhet ki vagy minősíthet vissza, tagot/moderátort
  rúghat ki, és meglévő tagnak adhatja át a tulajdonjogot; ekkor ő maga
  moderátor marad. A moderátor sima tagot rúghat ki, de moderátort vagy
  alapítót nem. A share-link mélylink-parsolása külön folytatás.

### `challenges/{challengeId}`
```ts
{ title, description, icon, type: 'distance'|'area'|'steal'|'streak'|'explore',
  target: number, layer?: 'foot'|'bike',
  startAt, endAt: Timestamp, scope: 'global'|'city'|'club', scopeRef?: string,
  rewardGp: number, rewardBadgeId?: string,
  participantCount: number, status: 'draft'|'scheduled'|'active'|'ended' }
```
- `challenges/{id}/participants/{uid}` → `{ progress, joinedAt, completedAt? }`

### Egyéb
| Kollekció | Tartalom |
|---|---|
| `equipment/{id}` | `userId, name, type: 'shoe'\|'other', targetKm, distanceKm, active, retiredAt?` |
| `routes/{id}` | `userId, name, distanceKm, elevGainM, geometry, params, savedAt` |
| `trainingPlans/{id}` | katalógus: `name, weeks, sessionsPerWeek, level, sessions[]` |
| `users/{uid}/planEnrollment/{id}` | `planId, startedAt, completedSessions[], progress` |
| `users/{uid}/passport/{iso}` | `firstActivityId, unlockedAt, activityCount` |
| `users/{uid}/badges/{badgeId}` | `earnedAt, tier` |
| `badges/{id}` | katalógus: `name, description, icon, tier, criteria, rewardGp` |
| `notifications/{uid}/items/{id}` | `type, title, body, data, read, createdAt` |
| `conversations/{cid}` | `participants[], lastMessage, updatedAt` |
| `conversations/{cid}/messages/{mid}` | `senderId, text, createdAt, readBy[]` |
| `reports/{id}` | `targetType, targetId, reporterId, category: 'gps_spoof'\|'vehicle'\|'wrong_type'\|'offensive'\|'privacy'\|'other', note, branch: 'technical'\|'content', status, resolvedBy?, resolution?` |
| `reporterCredibility/{uid}` | `submitted, upheld, dismissed, weight` — a bejelentő szavának súlya |
| `subscriptions/{uid}` | `store, productId, status, expiresAt, originalTransactionId` |
| `devices/{uid}/tokens/{token}` | `platform, updatedAt` |
| `connectors/{uid}/{provider}` | `status, connectedAt, lastSyncAt, scopes, secretRef` |
| `leaderboards/{scope}_{period}_{layer}/entries/{rank}` | előre számolt top 100 |
| `appConfig/{doc}` | gameplay-konstansok, feature flag-ek — lásd lent |
| `appConfig/gameplay/versions/{n}` | a konfiguráció verziótörténete, visszavonáshoz |
| `modifiers/{id}` | időszakos szorzók — lásd lent |
| `metricsDaily/{day}` | napi használati aggregátum az admin áttekintőhöz |
| `adminAudit/{id}` | `adminUid, action, targetType, targetId, before, after, at` |
| `activityAudits/{activityId}` | szerveroldali foglalás-, szint-, tulajdonos- és hurokdiagnosztika |
| `rateLimits/{hmac}` | szerveroldali, tranzakciós visszaélés-megelőző számláló; kliens nem olvashatja |

---

### `appConfig/gameplay` — a futásidejű játékkonfiguráció
```ts
{ version: number,                     // monoton nő, minden mentésnél +1
  overrides: Record<string, unknown>,  // CSAK az alapértéktől eltérő kulcsok,
                                       // pontozott útvonallal: 'BASE_GP_PER_KM.run'
  updatedAt: Timestamp, updatedBy: string, note?: string }
```
Az alapértékek forrása a `src/config/gameplay.ts` marad — ez a dokumentum **csak a különbséget** tárolja. Így egy alapérték-változás a kódban automatikusan érvényre jut mindenhol, ahol az admin nem tért el tőle, és a dokumentumból ránézésre látszik, mihez nyúltunk hozzá.

Csak a **hangolható** kulcsok írhatók felül (lásd `docs/06` → Játékkonfiguráció). Ismeretlen kulcs, rossz típus vagy tartományon kívüli érték: **eldobva és naplózva** — a játékmotor sosem áll meg egy elrontott konfiguráció miatt, hanem az alapértékkel megy tovább.

Minden mentés egy változatlan másolatot ír az `appConfig/gameplay/versions/{version}` alá, `adminAudit` bejegyzéssel. Visszavonás = egy korábbi verzió `overrides` mezejének visszaírása új verzióként; a történet nem íródik felül.

### `modifiers/{id}` — időszakos szorzók
```ts
{ kind: 'gp_multiplier' | 'claim_multiplier' | 'hold_multiplier',
  scope: 'global' | 'area' | 'segment',
  areaCells?: string[],          // H3 cellák MODIFIER_AREA_RES felbontáson
  segment?: { inactiveDays?: number },
  value: number,                 // szorzó, pl. 2.0
  from: Timestamp, to: Timestamp,   // KÖTELEZŐ mindkettő — véges élettartam
  reason: string,                // a felhasználónak is megmutatható indok
  source: 'manual' | 'auto',
  createdBy: string, createdAt: Timestamp,
  cancelledAt?: Timestamp, cancelledBy?: string }
```
Klienről **olvasható** (a felhasználónak látnia kell, hol és meddig érvényes a bónusz), írni kizárólag szerverről lehet. A `to` mező nem hiányozhat és nem lehet a `from` előtt: az élettartam végessége nem konvenció, hanem kikényszerített szabály — erre épül az automatikus generálás biztonsága.

Területi modifier **arányosan** hat: az érintett cellák aránya szerint (lásd `docs/06` → Modifierek).

### `metricsDaily/{day}` — napi használati aggregátum
```ts
{ day: number,                   // gameDay, Europe/Budapest
  dau: number, wau: number, mau: number,
  signups: number,
  activities: number, distanceKm: number,
  claimedCellsNet: number,
  activeStreaks: number,
  computedAt: Timestamp }
```
Az admin áttekintő ebből olvas, hogy azonnali választ adjon — a Firebase Analytics / BigQuery a hosszabb távú terméki elemzés helye marad. A napi forduló job írja, `Europe/Budapest` szerinti 00:05-kor.

### `activityTrust/{activityId}` — a bizalmi pontszám naplója

```ts
{
  userId: string
  score: number                   // 0–100, SOHA nem kerül kliensre
  signals: {
    speed: number, acceleration: number, gpsPrecision: number,
    teleport: number, sensorConsistency: number,
    history: number, reports: number
  }
  weights: Record<string, number> // az akkor érvényes súlyok — a fellebbezéshez kell
  verdict: 'trusted'|'pending_review'|'rejected'
  autoApprovedAt?: Timestamp
  autoApproveReason?: 'device_evidence'|'known_route'|'grace_period'
  reviewedBy?: string
  reviewedAt?: Timestamp
  reviewNote?: string
  appealedAt?: Timestamp
  createdAt: Timestamp
}
```

A `users.trust` mező tartja a hosszú távú szintet: `{ level: 'new'|'established'|'trusted'|'watched', cleanActivities: number, upheldReports: number, watchedUntil?: Timestamp }`.

### `rateLimits/{hmac}` — szerveroldali kéréskorlát

```ts
{
  policy: string
  count: number
  windowStartedAtMs: number
  updatedAt: Timestamp
  expiresAt: Timestamp
}
```

A dokumentumazonosító HMAC a szabály nevéből és a felhasználó vagy bejelentkezési
azonosító belső kulcsából. Nyers e-mail, felhasználónév, UID vagy IP-cím nem
kerül a kollekcióba. A fix ablak számlálása Firestore-tranzakcióban történik,
ezért több Cloud Run-példány és párhuzamos kérés sem tudja megkerülni. Az
`expiresAt` mezőre Firestore TTL állítható; ez karbantartás, nem helyességi
feltétel, mert ugyanaz az alany/szabály mindig ugyanazt a dokumentumot írja.

### Térkép-megjelenítés

A rács megjelenítése **nem** közvetlen Firestore-olvasásból megy — az egy városnyi nézetnél több száz blokkot jelentene. Helyette a `tile-service` **Mapbox vektorcsempéket** (MVT) generál:

| Zoom | Mit rajzol | Forrás |
|---|---|---|
| ≥ 15 (utca) | egyedi res 12 hexagonok, tulajdonos színe, védelem jelölés | `grid` blokkok |
| 12–14 (kerület) | res 9/10 szintre aggregálva, domináns tulajdonos | előszámolt aggregátum |
| ≤ 11 (város, ország) | `zones` kontúrok, hőtérkép | `zones` |

A csempék Cloud CDN-ben cache-elődnek, és a blokk `version` mezőjének változásakor invalidálódnak.

---

## Kompozit indexek (Firestore)

| Kollekció | Mezők |
|---|---|
| `activities` | `userId ASC, startedAt DESC` |
| `activities` | `visibility ASC, startedAt DESC` |
| `activities` | `userId ASC, type ASC, startedAt DESC` |
| `zones` | `ownerId ASC, layer ASC, areaM2 DESC` |
| `zones` | `layer ASC, ownerId ASC, minDefense ASC` |
| `territoryEvents` | `victimId ASC, at DESC` · `actorId ASC, at DESC` |
| `activityTrust` | `verdict ASC, createdAt ASC` (moderációs sor) |
| `reports` | `branch ASC, status ASC, createdAt ASC` |
| `gpLedger` | `userId ASC, at DESC` · `userId ASC, day ASC` |
| `notifications/{uid}/items` | `read ASC, createdAt DESC` |
| `reports` | `status ASC, createdAt DESC` |

> Tanulság korábbi projektből: **minden `orderBy` + `where` kombinációhoz kompozit index kell** — ezeket előre telepítsük, ne éles hibából derüljön ki.

---

## Firestore biztonsági szabályok — elvek

1. **Írás alapból tiltva.** Az aktivitás, terület, GP, ranglista, jelvény, előfizetés **kizárólag Cloud Run / Functions** által írható (admin SDK). A kliens ezeket csak olvassa.
2. A kliens közvetlenül csak ezt írhatja: saját profil egyszerű szerkeszthető mezői,
   saját privát beállítások és rögzítési pillanatkép, komment, like, üzenet,
   követés, klub-csatlakozási kérés, jelentés.
   Az aktivitás-privacy szerveren át módosul, mert ugyanabban a folyamatban az
   összes korábbi publikus útvonalat is újra kell vágni.
3. **Olvasás láthatóság szerint:**
   - `visibility == 'everyone'` → bárki (kivéve ha tiltás van),
   - `'followers'` → csak követő,
   - `'only_me'` → csak a tulajdonos,
   - privát fiók → csak elfogadott követő.
   A szabály a közösségi tartalomra vonatkozik; a vegyesen érzékeny
   `users/{uid}` fődokumentumból nyilvános mezőket csak a backend ad ki.
4. **Tiltás kétirányú:** a tiltott fél semmit nem lát a tiltótól, és fordítva.
4b. **Privát zóna:** a teljes nyomvonal (`activities/{id}/private/track`) és a nyers idősor **kizárólag a tulajdonosnak** olvasható — a láthatósági beállítástól függetlenül, akkor is, ha az aktivitás publikus. A `mapImagePath` képet a szerver mindig a levágott nyomvonalból generálja. Az export két különböző fájlt ad: a sajátod teljes, a másoké levágott.
5. **Rate limit** a költséges és visszaélésre érzékeny végpontokra (App Check + szerveroldali, tranzakciós számláló).
6. **App Check** kötelező minden klienshívásra (Play Integrity / App Attest / reCAPTCHA Enterprise); a Scheduler `/api/jobs` ága külön szolgáltatáshitelesítést használ.
7. A `pro`, `level`, `gpTotal`, `territoryM2`, `cellCount`, `trust`, `counters`, `status` mezők **klienstől soha nem írhatók**. A `grid`, `zones`, `gpLedger`, `activityTrust`, `activityAudits` kollekciók **klienstől egyáltalán nem írhatók**, a `activityTrust.score` pedig nem is olvasható.

---

## Adatmegőrzés és GDPR

| Adat | Megőrzés |
|---|---|
| Nyers GPS idősor | 3 év, utána csak az összegzés + egyszerűsített nyomvonal |
| Törölt aktivitás | 30 nap soft-delete, utána végleges |
| Törölt fiók | 30 nap visszavonható, utána: profil anonimizálva, aktivitások törölve, területek felszabadítva, `gpLedger` anonim aggregátumként megmarad |
| Moderációs napló | 2 év |
| Analitika | pszeudonimizált, 14 hónap |

**Adatexport**: a felhasználó kérheti a teljes adatcsomagját (JSON + GPX) — a job e-mailben küld egy 7 napig élő letöltési linket.

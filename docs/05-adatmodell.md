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

  territoryM2:  { foot: number, bike: number }   // megjelenítés: m² < 1e6, felette km²
  cellCount:    { foot: number, bike: number }   // a tárolt igazság
  zoneCount:    { foot: number, bike: number }   // összefüggő foltok száma

  trust: { level: 'new'|'established'|'trusted'|'watched',
           cleanActivities: number, upheldReports: number, watchedUntil?: Timestamp }

  streak: { current: number, longest: number, lastActiveDate: string,
            freezesLeftThisWeek: number, weeks: number }

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
- `users/{uid}/private/settings` — csak a tulajdonos olvashatja (értesítés-kapcsolók, e-mail preferenciák).
- `users/{uid}/private/tracking` — a felhasználó eszközei között megosztott,
  **utolsó rögzítési pillanatkép**: `{ activityId, deviceId, status, type,
  route, distanceM, movingMs, speedMps, startedAt, updatedAt }`. A `route`
  legfeljebb 400 pontra ritkított; írás legfeljebb 15 másodpercenként és
  állapotváltáskor. Csak a tulajdonos olvashatja és írhatja, játékadatnak nem
  forrása.
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

  photos: Array<{ path: string, url: string }> // legfeljebb 5
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
- `activities/{id}/likes/{uid}` → `{ createdAt }`
- `activities/{id}/comments/{cid}` → `{ userId, text, createdAt, editedAt?, deleted? }`

Tulajdonosi törléskor az aktivitás azonnal kikerül minden feedből és adatlapról,
de 30 napig visszaállíthatóan megmarad. Ez a tartalom törlése: a már kiosztott GP
és a konkurens területállapot nem tekerhető vissza. A moderátori törlés külön,
auditált művelet, amely a GP/terület korrekcióját is elvégezheti.

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
  gp?: { base, claim, steal, breakthrough, streakMult, softCapReduction, total },
  multiplier?: number, note?: string, at: Timestamp, day: number }
```
Az egyetlen igazságforrás a pontokra; a `users.gpTotal` ennek az aggregátuma.

### `dailyGp/{uid}_{gameDay}`
```ts
{ userId: string, day: number, total: number, updatedAt: Timestamp }
```
A napi lágy plafon tranzakciós állapota. Kliensről nem olvasható és nem írható; ugyanabban a tranzakcióban változik, mint a determinisztikus `gpLedger/activity_{activityId}` rekord.

### `activityTrust/{activityId}`
Az aktivitás belső trust pontszáma, részjelei/indokai, `measuredVerdict` értéke és az `appliedGameplayDecision` rollout-döntés. Csak admin olvashatja. A publikus aktivitásdokumentumba kizárólag a ténylegesen alkalmazott felhasználói státusz kerül; observe-only módban ez `trusted`, miközben a mért verdikt az admin rekordban megmarad.

### Régi aktivitások adatvédelmi migrációja

Dry-run: `cd server && npm run migrate:activity-privacy`. Íráshoz `-- --apply`; a `grundo` projekten ezen felül `--allow-production` is kötelező. A futtatás előtt a `GOOGLE_CLOUD_PROJECT` változóval explicit meg kell adni a célt. A script eltávolítja a publikus trust diagnosztikát, admin-only rekordba menti, és a publikus route-ból újraszámolja a bounds értéket.

### Közösségi gráf
- `users/{uid}/following/{targetUid}` → `{ createdAt }`
- `users/{uid}/followers/{sourceUid}` → `{ createdAt }`
- `followRequests/{targetUid}/items/{requesterUid}` → `{ createdAt }`
- `users/{uid}/blocks/{targetUid}` · `users/{uid}/mutes/{targetUid}`

### `clubs/{clubId}`
```ts
{ name, description, photoURL, city, countryCode,
  visibility: 'public'|'private', inviteCode: string,   // 8 karakter
  ownerId: string, memberCount: number,
  totalKm2: { foot, bike }, totalGp: number,
  createdAt }
```
- `clubs/{id}/members/{uid}` → `{ role: 'owner'|'admin'|'member', joinedAt }`
- `clubs/{id}/joinRequests/{uid}` → `{ createdAt, message? }`
- `inviteCodes/{code}` → `{ clubId }`

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
| `appConfig/{doc}` | gameplay-konstansok, feature flag-ek |
| `adminAudit/{id}` | `adminUid, action, targetType, targetId, before, after, at` |

---

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
4. **Tiltás kétirányú:** a tiltott fél semmit nem lát a tiltótól, és fordítva.
4b. **Privát zóna:** a teljes nyomvonal (`activities/{id}/private/track`) és a nyers idősor **kizárólag a tulajdonosnak** olvasható — a láthatósági beállítástól függetlenül, akkor is, ha az aktivitás publikus. A `mapImagePath` képet a szerver mindig a levágott nyomvonalból generálja. Az export két különböző fájlt ad: a sajátod teljes, a másoké levágott.
5. **Rate limit** a kommentre, jelentésre, követésre (App Check + szerveroldali számláló).
6. **App Check** kötelező minden hívásra (Play Integrity / DeviceCheck).
7. A `pro`, `level`, `gpTotal`, `territoryM2`, `cellCount`, `trust`, `counters`, `status` mezők **klienstől soha nem írhatók**. A `grid`, `zones`, `gpLedger`, `activityTrust` kollekciók **klienstől egyáltalán nem írhatók**, a `activityTrust.score` pedig nem is olvasható.

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

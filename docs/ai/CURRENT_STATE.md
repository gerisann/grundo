# Jelenlegi állapot

> Frissítve: **2026-09-03** · átadás a **GRUNDO #27** menetből a következőre
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo` ·
> ág: **`main`**

**Ez a fájl mindig a JELENLEGI állapotot mutatja, nem a történetet.** A menet
végén felül kell írni, nem hozzátoldani — a történet a git logban van. Ami
tartósan korlátoz, az a [`DECISIONS.md`](DECISIONS.md)-be megy.

## Jelenlegi cél

A #26 menet nyitott ügyeinek hátraléka. **Az adatlap válaszmérete (Nyitott
ügyek 1.) ELKÉSZÜLT** — a mérés két meglepetést hozott, lásd az 5–7. pontot.
A következő tétel a `loopDetection.ts` jelöltértékelésének mérésvezérelt
gyorsítása — **profil először** (`node --cpu-prof` a `resumeStuckActivities.ts`
`planActivity` hívására), mert e nélkül a célpont bizonytalan.

## A menet MÁSODIK fele — a válaszméret, és amit a mérés talált

5. **A szerver EDDIG SEMMIT NEM TÖMÖRÍTETT — bekapcsolva** (`server/server.ts`,
   `compression` middleware). Mérve: az `/api/rules` `Accept-Encoding: gzip,
   deflate, br` kéréssel is `Content-Encoding` NÉLKÜL jött vissza. A Cloud Run
   nem tömörít a konténer helyett, a Firebase Hosting gzipje pedig nem
   érvényes ide, mert a kliens KÖZVETLENÜL a Cloud Run URL-t hívja. Éles
   adaton **757,1 kB → 123,6 kB (83,7 %)**, és ez MINDEN végpontra hat, nem
   csak az adatlapra. Új mérőeszköz: `npm run inspect:payload` (csak olvas).
   ⚠️ A `Vary`-sorrend csapdáját teszt őrzi (`responseCompression.test.ts`): a
   CORS-ág `Vary: Origin`-nal FELÜLÍR, és csak azért nem vész el az
   `Accept-Encoding`, mert a `compression` az `on-headers`-ben fűzi hozzá.
6. **ÉLES CSONKOLÁSI HIBA JAVÍTVA** (`server/src/routes/activities.ts`,
   új `activityCellPayload()`). Mérve (`ebb3c240…`, 143 km): a dokumentum
   42 666 cellát tárol, a válasz 20 000-nél vágta el — **22 666 cella (53 %)
   sosem jutott el a klienshez**, a kör térképének több mint fele hiányzott.
   Ugyanez 2026-08-29-én már megtörtént 5 000-es plafonnal: **a plafon emelése
   csak eltolja a határt.** A megoldás a H3-compact (42 666 cella → 5 274
   index), a `parents` mezőbe téve, mert a kliens CSAK azt bontja fel
   felbontás szerint. A `cells` marad plafonolt res12 lista, hogy egy régi
   kliens se romoljon. Bizonyíték: a teszt a VALÓDI kliens-kibontót futtatja.
7. **A geometria kétszer futott, és a második egy ÚJRAPRÓBÁLHATÓ TRANZAKCIÓN
   BELÜL** (`server/src/lib/activityCommit.ts`). A `planActivity` és a
   `commitActivity` is lefuttatta ugyanarra a nyomvonalra a hurokfelismerést;
   a Firestore ütközéskor magától újrapróbál, tehát a legdrágább számítás
   annyiszor futott, ahányszor a commit újraindult. Mérve: 20 km-es körnél a
   `processActivity` 337 ms-ából 289 ms (86 %) a geometria, egy éles 143 km-es
   körnél a teljes hívás 68 másodperc. Most az `ActivityPlan.geometry` hordozza,
   egyszer számolva. Az újrahasználhatóságot teszt bizonyítja
   (`activityGeometryReuse.test.ts`) — és a darabolt út ugyanezt a mintát már
   ma is használja élesben.

⚠️ **AZ EMULÁTOROS TESZTEKRŐL, hogy a következő menet ne ijedjen meg:** a két
aktivitás-teszt EGYÜTT futtatva 8–11 hibát ad, KÜLÖN-KÜLÖN viszont mindkettő
zöld (25/25 és 9/9). Osztoznak ugyanazon az emulátoron, és a párhuzamos
futtatás összeakasztja őket — **meglévő teszt-izolációs hiba, nem regresszió**.
Alapállapoton (stash-elt munkafával) is bukik. Aki emulátort futtat, futtassa
fájlonként: `firebase emulators:exec --only firestore --project demo-grundo
"npx vitest run <egy fájl> --testTimeout=45000"`.

⚠️ **A „szerveroldali inkrementális geometria" tétel ELVETVE**, mérés alapján:
a hurokfelismerés MÁR inkrementális (a `detectLoopsDetailed()` ugyanazt az
`IncrementalLoopDetector` állapotgépet eteti), tehát a rögzítés közbeni
adagolás a teljes CPU-t nem csökkentené, csak szétkenné. Ráadásul a
sorrenden kívüli GPS-minta csapdáját a kliens ma maradéktalanul elnyeli
(`recorder.ts` időrendbe szúr) — a streaming HOZNÁ BE a problémát, nem
szenved tőle. A részletes indoklás a [`DECISIONS.md`](DECISIONS.md)-be való.

## Amit a legutóbbi menet elvégzett

1. **`cellCount: 0` a darabolt úton — javítva**
   (`server/src/lib/activityChunked.ts`, `closeBooks`). A könyvzárás eddig
   sosem írta felül a nyitó tranzakció `cellCount: 0` kezdőértékét, ezért
   minden darabolt (nagy) körnél az adatlap „útvonalmező: 0"-t mutatott. A
   gyors úttal (`activityCommit.ts:453`) azonos mezőnévvel most a csoportok
   összesített `total.cells` értéke kerül rá.
2. **A darabolt út auditnaplója — pótolva** (`server/src/lib/activityAudit.ts`:
   új `buildChunkedActivityAudit()`, hívása a `closeBooks` végén). Korábban az
   admin `/admin/aktivitasok` minden nagy aktivitásra tévesen azt írta, hogy
   „az auditnapló bevezetése előtt készült".
   ⚠️ **Nem teljes parity a gyors úttal.** A darabolt mentés csoportonként
   dolgozik, sosem tart egyben konzisztens `before`/`after` birtoktérképet —
   ezért az összesített `claim` mezők pontosak, de cellaszintű `transitions`,
   `weakened`/`unchangedAtMax` bontás és hurkonkénti birtoklás **nincs** (üres
   placeholderek a `loops.successful[].claim`-ben). A hurok-geometria valódi,
   mert a `plan.loops`-ból közvetlenül számolható.
3. **Kliensoldali védőháló** (`src/screens/TrackingScreen.tsx`, az
   `upload.status === 'done'` ág). Ha a `summary` hiányzik, csendes „Mentve — az
   összegzés még nem érkezett meg." üzenet jön a teljes eredményképernyő
   eltűnése helyett. ⚠️ Csak az objektum hiányát fogja meg, az egyes mezők
   érvénytelen értékét nem.
4. **Halott fájlok törölve:** `android/app/src/main/res/drawable*/splash.png`
   (11 db, a Capacitor gyári kék X-e). Az Android 12+ indítóképernyő a
   `grundo_app_icon`-t használja (`styles.xml`).

## Módosított fájlok (a menet lezárásakor commitolatlan)

`server/src/lib/activityChunked.ts` · `server/src/lib/activityAudit.ts` ·
`src/screens/TrackingScreen.tsx` · `android/.../splash.png` (11 törölt)

⚠️ **A munkamásolatban azóta más is dolgozik** (`server/server.ts`,
`server/src/routes/activities.ts`, új tömörítés-tesztek). Menet elején mindig
nézd meg a `git status`-t, és **ne indulj a saját korábbi állapotodból**.

## Élesben fut / telepítetlen

- **Semmi nem lett telepítve** ebben a menetben.
- A backend-változás **csak a darabolt (nagy, több tranzakciós) mentési útra**
  hat; a mindennapi kis körök gyors útját nem érinti.
- Nincs szabály- vagy indexváltozás; adatbázis-lépés nincs.
- A #26-ból változatlanul nyitva: **iOS és Android build MÉG NEM készült** az
  akkori hangnémítás-javításból és ikoncseréből.

## Elvégzett ellenőrzések

- Teljes Vitest: **681 zöld**, új teszt nincs. Gyökér és `server/` typecheck
  tiszta (`npx tsc --noEmit`, mindkettő 0 hiba).
- ⚠️ **Emulátoros készlet NEM futott — ez a menet egyetlen mérési
  hiányossága.** Az 1–2. pont a `commitChunkedActivity` könyvzárását
  módosítja, amit csak egy ténylegesen darabolt aktivitás emulátoros mentése
  bizonyítana végponttól végpontig. A kód statikusan ellenőrizve, **valódi
  darabolt mentés az új kóddal még nem futott le.**

## Amit készüléken kell ellenőrizni

A következő iOS/Android build után (a #26 öröksége):

1. **Szólnak-e egyáltalán a hangok iOS-en** (rögzítés közben ÉS a Hangok
   képernyő kézi lejátszásával) — a `9fd05ad` regressziójának próbája.
2. Az indítás utáni **első Play-koppintás** — mennyi maradt a hangzavarból.
3. A **befejezés gomb**: a hang a sávval együtt ér a végére, és újranyomásnál a
   sáv állásáról folytat.
4. Az új app ikon és indítóképernyő mindkét platformon.
5. A #25-ből nyitva: hat aktivitáshang, Mapbox-mozgás finomításai
   (marker/kamera interpoláció, iránytű **mindkét témában**), hosszú mentés a
   javított szerverrel, a stat panel új tördelése.
6. **Egy valódi darabolt mentés** emulátorban vagy élesben — helyes
   `cellCount`, és az admin auditnézet megjelenik a „bevezetés előtti" üzenet
   helyett.

## Nyitott ügyek

1. **Az adatlap válasza 767 kB** egy nagy körön (42 666 cellaazonosító) —
   érdemes lehet az `activityCells`-t is compactolva küldeni. **MÉG NEM MÉRVE**,
   mennyit érne.
2. ⚠️ **iOS-en a hangerő-csúszka HATÁSTALAN.** A `playSound()` az
   `element.volume`-on át állít, amit iOS nem enged írni — a fő hangerő ÉS a
   hangonkénti keverés is inert. Nem mostani regresszió. A rendes javítás Web
   Audiót igényelne, amit a `sound.ts` annak idején tudatosan elvetett —
   **termékdöntés, nem hibajavítás.**
3. **A hangzár 51 elemet indít** (`unlockSounds()`). A `muted = true` kísértő,
   de veszélyes: a WebKit a némított lejátszást eleve engedi, tehát vélhetően
   NEM „szentelné fel" az elemet a későbbi hangos lejátszáshoz. Csak
   készüléken, dedikált buildben szabad kipróbálni.
4. **Simulation Lab scenario valós aktivitásból** — Geri elhalasztotta.
5. **Szerveroldali inkrementális geometria** — nagy tétel, érintetlen. Csapda:
   a sorrenden kívül érkező natív GPS-minta.
6. **A darabolt út auditja nem teljes parity** (lásd fent 2.). Nem sürgős: az
   admin lista csak az `appliedToGameplay` jelzőt és a `hasAudit` állapotot
   használja, a hurokbontást csak a részletnézet egy panelje.

## Modelljavaslat a következő menetre

**Sonnet, normál mélység** az 1. nyitott ügyre (mérés + kis javítás meglévő
mintára). A 2. és 3. **termékdöntés + készüléken mérés** — ott a modellnél
többet számít a valódi eszközös visszajelzés. Az 5. (inkrementális geometria)
és a 6. (audit parity) **Opus, emelt mélység** — architektúra-szintű döntés.

## Olvasási sorrend a következő menetnek

1. `CLAUDE.md` (automatikusan betöltődik)
2. ez a fájl
3. `.claude/rules/lessons.md` — különösen a „mérj, ne feltételezz" és a natív
   mérésről szóló pont
4. a feladathoz tartozó forrásfájlok, célzottan:
   - `server/src/lib/activityChunked.ts` (`closeBooks`)
   - `server/src/lib/activityAudit.ts` (`buildChunkedActivityAudit` fejléce)
   - `src/screens/TrackingScreen.tsx` (`upload.status === 'done'` ág)
   - `src/lib/sound.ts` (`unlockSounds()`, `holdPlaybackFor()`) — a hangügyekhez

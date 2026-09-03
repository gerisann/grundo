# GRUNDO handoff

> Frissítve: **2026-09-03** · átadás a **GRUNDO #26** menetből a következőre
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`** · HEAD: ennek az átadónak a commitja · munkamásolat tiszta

## ⚠️ HALADÁSJELZÉS — EZ MINDEN MENETRE ÉRVÉNYES

**Minden munka közbeni üzenet VÉGÉN írd ki, hol tart a feladat**: százalékban,
és több tételnél `x/y` alakban is. Példa:

> **Haladás: 4/7 kész (≈60%)** — most a mentés-szimuláción dolgozom.

Geri kifejezetten kérte (2026-09-03), egy hosszú menet közepén, mert a
válaszaimból nem derült ki, mennyi van hátra. A becslés legyen őszinte: ha egy
tétel nagyobbnak bizonyul, a százalék mehet vissza. A ZÁRÓ üzenetre nem
vonatkozik — ott a fájl-táblázat és a teendők sorrendje a dolga.

A szabály tartós helye az `AGENTS.md` **0.5** pontja; itt csak azért áll, hogy
a következő menet biztosan találkozzon vele. **Ezt a szakaszt a következő
átadó is vigye tovább.**

## ÁLLAPOT

Felületi és visszajelzés-javítások menete: térképgombok szétválasztása, a
hangrendszer két hibája, egy betöltési hiba, és az új arculati ikon
átvezetése minden platformra.

⚠️ **A menet közepén ELNÉMÍTOTTAM AZ APPOT iOS-en, és ez a legfontosabb
tanulság.** A `9fd05ad` commitban natívban kihagytam a hangzár feloldását,
mert a szállított Capacitor forrása szerint ott nincs gesztus-követelmény
(`mediaTypesRequiringUserActionForPlayback = []`). A készüléken MINDEN hang
elnémult, a Hangok képernyő kézi lejátszásával együtt. A WebKit kapuja ugyanis
nem az egyetlen feltétel: a rendszer hangútvonalát (AVAudioSession) csak egy
valódi, gesztusból indított lejátszás nyitja meg. Az `ac1ea9e` visszaállította.
A hibaminta bekerült az `AGENTS.md` 8. pontjába — **egy kapcsoló elolvasása nem
mérés.**

**Amit a menet elvégzett:**

1. **Térképgombok szétválasztva** (`927a477`). A 2D/3D váltó és az irány-mód
   (észak fent / menetirány fent) eddig EGY gombon osztozott, ezért egymást
   váltották ki. Most három önálló gomb van a jobb oldali oszlopban, lentről
   felfelé: 2D/3D → iránytű/navigáció → pozícióra ugrás. Két külön állapot
   (`tilted`, `headingUp`), külön localStorage-kulccsal.
2. **Hangzavar az app indítása után** — MÉRVE: a Dock Play gombjára a feloldás
   **51 `<audio>` elemet** indít el egyetlen szinkron ciklusban (ebből 32
   cellahang négyféle hangból). iOS-en mind hallhatóan, mert ott a
   `volume = 0` írása hatástalan. Enyhítve: a `pause()` mostantól SZINKRON fut
   a `play()` után, nem a promise beérkezésekor. ⚠️ **Ez rövidít, nem szüntet
   meg — készüléken ellenőrizendő.**
3. **Befejezés gomb hang-szinkronja** — MÉRVE: a `pressing-finish-activity.mp3`
   **2,04 mp**, a gomb viszont **1000 ms** alatt telik meg (a gomb eredetileg
   2000 ms volt, 2026-08-26-án felezték, a hangot nem igazította hozzá senki).
   A hang mostantól mindig oda ugrik, ahol a sáv tart, és a lejátszási sebesség
   a teljes hangot a gomb ablakába préseli.
4. **`/profil` betöltési hiba** — „Failed to fetch dynamically imported module".
   Telepítés közben nyitva hagyott app kéri a RÉGI chunk-hash-t; a `**` rewrite
   miatt nem 404 jön, hanem az `index.html` 200-zal, amit a böngésző MIME miatt
   utasít el. Egyetlen csendes újratöltés kezeli, munkamenetenként egyszer.
5. **Új, átlátszó logó** minden négyzetes ikonhelyen, 26 kép újragenerálva.

## ÉLESBEN FUT / TELEPÍTETLEN

- **Frontend telepítve és ELLENŐRIZVE** (2026-09-03): az élő
  `grundo.web.app/icons/favicon-32.png` bájtra egyezik a repóbelivel, az
  `index` chunk is az új build. Kimeneti tartalom: chunk-javítás, új favicon,
  térképgombok, befejezés gomb hang-szinkronja.
- ⚠️ **iOS build MÉG NEM készült ebből a HEAD-ből — és ez a kritikus tétel.**
  A hangok némulása CSAK natív buildben szűnik meg; a webes telepítés ezen nem
  segít. Ez hozza az új app ikont és az új indítóképernyőt is.
- ⚠️ **Android build sem készült.** Ott a hangok végig jók voltak, csak az ikon
  változik.
- Nincs backend-, szabály- vagy indexváltozás; adatbázis-lépés nincs.

## ELLENŐRZÉSEK

- Teljes normál Vitest: **681 zöld** (667 → 681, 14 új teszt). Gyökér és
  `server/` typecheck tiszta.
- Emulátoros készlet NEM futott, és nem is indokolt: Firestore-viselkedés
  (tranzakció, lekérdezés, séma, szabály) nem változott.
- Az ikonok ellenőrizve: az iOS AppIcon és az apple-touch-icon **alfa nélküli**
  (az App Store elutasítaná), a favicon és a web ikonok átlátszóak.
- A hangzár tesztje MINDKÉT irányt őrzi (natívban IS felold, és szinkron áll
  meg) — pont azért, mert az egyik irányba már elrontottam egyszer.

## AMIT KÉSZÜLÉKEN KELL ELLENŐRIZNI

Ez a lista a következő iOS/Android build után futtatandó:

1. **Szólnak-e egyáltalán a hangok iOS-en** (rögzítés közben ÉS a Hangok
   képernyő kézi lejátszásával). Ez a `9fd05ad` regressziójának a próbája.
2. **Az indítás utáni első Play-koppintás** — mennyi maradt a hangzavarból.
3. **A befejezés gomb**: a hang a sávval együtt ér a végére, és egy elengedés
   utáni újranyomásnál a sáv állásáról folytatja.
4. Az új app ikon és indítóképernyő mindkét platformon.
5. A HANDOFF #25-ből még mindig nyitva: a hat aktivitáshang, a Mapbox-mozgás
   finomításai (marker/kamera interpoláció, iránytű világos ÉS sötét témában),
   a hosszú mentés a javított szerverrel, a stat panel új tördelése.

## NYITOTT ÜGYEK

1. **`cellCount: 0` a darabolt úton.** A könyvzárás nem írja felül az első
   fázis nulláját, ezért az adatlap „útvonalmező: 0"-t mutat MINDEN nagy
   körnél (`ActivityScreen.tsx:392`). A gyors út `result.cellPath.length`-t ír.
2. **A darabolt út NEM ír auditnaplót.** A `buildActivityAudit` csak az
   egytranzakciós úton fut, ezért az admin felület minden nagy aktivitásra azt
   írja, hogy „az auditnapló bevezetése előtt készült" — tévesen.
3. **Kliensoldali védőháló hiánya.** A `TrackingScreen` továbbra is védtelenül
   olvassa a `summary.distanceM`-et (`:1747`).
4. **Az adatlap válasza 767 kB** egy nagy körön (42 666 cellaazonosító) —
   érdemes lehet az `activityCells`-t is compactolva küldeni. MÉG NEM MÉRVE,
   mennyit érne.
5. ⚠️ **iOS-en a hangerő-csúszka HATÁSTALAN.** A `playSound()` az
   `element.volume`-on át állít, amit iOS nem enged írni — így a Hangok
   képernyő fő hangereje ÉS a hangonkénti keverés (a fanfár 0,85-ös szorzója)
   is inert. Nem mostani regresszió. A rendes javítás Web Audio-t igényelne,
   amit a `sound.ts` fejléce annak idején tudatosan elvetett — **ez termékdöntés,
   nem hibajavítás.**
6. **A hangzár 51 elemet indít** (`unlockSounds()`). A szinkron `pause()` csak
   rövidíti a farkat. A `muted = true` kísértő, de veszélyes: a WebKit a némított
   lejátszást eleve engedi, tehát vélhetően NEM „szentelné fel" az elemet a
   későbbi hangos lejátszáshoz — ugyanabba a néma hibába futnánk. Csak
   készüléken, dedikált buildben szabad kipróbálni.
7. **Halott fájlok**: az `android/app/src/main/res/drawable*/splash.png`
   készlet (11 fájl) a Capacitor gyári kék X-ét tartalmazza, és SEMMI nem
   hivatkozik rá — az Android 12+ indítóképernyő a `grundo_app_icon`-t
   használja (`styles.xml`, `windowSplashScreenAnimatedIcon`). Törölhetők.
8. **Simulation Lab scenario valós aktivitásból** — Geri egyelőre elhalasztotta.
9. **Szerveroldali inkrementális geometria** — a korábbi menet nagy tétele,
   érintetlen. Csapda: a sorrenden kívül érkező natív GPS-minta.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Sonnet, normál mélység** az 1–3. és a 7. nyitott ügyre (kicsi, jól
körülhatárolt javítások meglévő mintára). A 4. méréssel kezdődik, az is Sonnet.
Az 5. és 6. pont **termékdöntés + készüléken mérés** — ott a modellnél többet
számít, hogy legyen valódi eszközös visszajelzés. A 9. (inkrementális
geometria) továbbra is **Opus, emelt mélység**.

## FORRÁSOK SORRENDJE

1. `AGENTS.md` — különösen a 8. pont új hibamintája
2. `HANDOFF.md` (ez a fájl)
3. `src/lib/sound.ts` (`unlockSounds()` fejléce: a némulás esete;
   `holdPlaybackFor()`: a gomb-szinkron)
4. `src/lib/chunkReload.ts` (elavult chunk kezelése)
5. `src/components/MapView.tsx` (a három térképgomb, `tilted` vs `headingUp`)
6. `scripts/generate-icons.mjs` (ikon + iOS indítóképernyő egy forrásból)
7. `server/src/lib/activityChunked.ts` (az 1–2. nyitott ügyhöz)

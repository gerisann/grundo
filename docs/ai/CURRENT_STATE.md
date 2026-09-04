# Jelenlegi állapot

> Frissítve: **2026-09-04** · GRUNDO **#36**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**
> Állapot: minden commitolva és pusholva (`8d8ff77`).
> Utoljára dolgozott: **Claude (Opus, High)** · Átadva: **Claude — GRUNDO #37**

## Jelenlegi cél

A #35 handoff 1. pontja (telepítés + utókövetés) lezárult, a 2–3. pont
(főszálas költség, cache-hiány) **nem indult el**: Geri terepi mérésre ment
két készülékkel, és a döntés az ő adatára vár. Helyette négy, menet közben
érkezett feladat készült el.

## Elkészült

1. **Főszál-mérések szinkronja a szerverre.** A `PerfOverlay` „Mentés" gombja
   a helyi mentés után feltölti a mérést (`POST /api/admin/perf-snapshots`);
   a `/admin/teljesitmeny` a szerver és a helyi előzmény uniója, és
   megnyitáskor pótolja az elmaradt feltöltéseket. Megadható rövid **jelölés**
   („háttér" / „előtér"), mert két készülék adata különben csak időbélyegben
   térne el. ⚠️ Emulátoros teszt fogott egy éles hibát: a Firestore nem tárol
   beágyazott tömböt, a mérő `[[kulcs, érték], …]` kísérőszámai 500-zal
   buktak volna — objektumként mennek be, olvasáskor állnak vissza párokká.
2. **Banda-ranglista visszaszámolása.** A `backfill:banda-stats` eddig csak
   NULLÁKKAL hozta létre a `bandaStats` mezőt — ezért mutatott a ranglista
   minden tagnál 0 km²-t és 0 GP-t. A bontás megvan az aktivitás-
   dokumentumokban (`type`, `areaGainedM2`, `gp`); az új
   `aggregateBandaStatsFromActivities` ebből számol. **A szkript még nem
   futott élesben.**
3. **iOS-hangok.** A `ac1ea9e` szinkron `pause()`-a megszakítja a `play()`-t,
   mielőtt elindulna — iOS-en emiatt az `AVAudioSession` nem aktiválódik, és
   minden hang néma marad. A `pause()` visszakerült a promise-ba; a hangzavart
   a `currentTime` ugratása kerüli el (a hang utolsó 50 ms-e szólal meg).
4. **Bandák — Geri 12 pontos listája, mind.** A tartalmi újdonságok: meghívókód
   MINDEN bandának (a régiek első megnyitáskor pótolják); publikus bandához a
   banda oldaláról is lehet csatlakozni; a meghívó-értesítés a
   `/kozosseg/bandak`-ra visz (ott fogadható el); és a **csengő** bandánkénti
   némítással, három új értesítéssel (új poszt, fal-reakció, napi mérleg). A
   többi megjelenés: profilkép a listákban, fedésmentes fejléc, szűrő-
   megjegyzés, üzenőfal-sorrend, arany alapító, profil KLÁNOK → BANDÁK.

## Módosított fájlok (öt commit: `b8791cb`…`8d8ff77`)

35 fájl, +1391/−134. A tételes bontás a git logban; ami a folytatáshoz kell:

| Fájl | Állapot | Tartalom |
|---|---|---|
| `src/lib/sound.ts` (+41/−15) | MÓDOSÍTOTT | A feloldás valódi lejátszással, a hang legvégén. |
| `src/screens/BandaScreen.tsx` (+135/−24) | MÓDOSÍTOTT | Csengő, csatlakozás, szűrő-megjegyzés, kód. |
| `server/src/routes/bandas.ts` (+125/−13) | MÓDOSÍTOTT | Kód minden bandának, csengő, 3 értesítés, fal-sorrend. |
| `server/src/lib/bandas.ts` (+79) | MÓDOSÍTOTT | `aggregateBandaStatsFromActivities`. |
| `server/src/scripts/backfillBandaStats.ts` (+113/−12) | MÓDOSÍTOTT | Számol, nem nulláz; idempotens. |
| `server/src/jobs/bandaDailyDigest.ts` (+99) | ÚJ | Napi banda-mérleg értesítés. |
| `server/src/routes/admin.ts` (+117) | MÓDOSÍTOTT | `POST`/`GET /api/admin/perf-snapshots`. |
| `src/admin/PerfHistoryScreen.tsx` (+102/−18) | MÓDOSÍTOTT | Szerver + helyi uniója, feltöltés pótlása. |

## Élesben fut / telepítetlen

- **TELEPÍTETLEN, backend ÉS frontend kell**: a `b2e0c98`, `39d821a` és
  `8d8ff77` commit (banda-backfill logika, hangjavítás, teljes bandás kör,
  értesítések). A `b8791cb`/`d57fade` perf-szinkron már kiment
  (`grundo-api-00137-k8f` + Hosting).
- **A hangjavítás és a bandás kör csak ÚJ MOBILBUILDDEL jut el a
  készülékekre** — a Capacitor a beépített felületet futtatja. iOS és Android
  build egyaránt kell.
- **`backfill:banda-stats --apply --allow-production`**: még nem futott. Utána
  a banda-rollover (admin gomb vagy Scheduler) számolja újra a `totals`-t.
- **`grundo-banda-daily` Scheduler-job**: nincs bejegyezve; a parancs a
  `docs/06-architektura-es-admin.md`-ben. Ütem 21:00 UTC — ⚠️ szándékosan a
  napi forduló ELŐTT, különben minden bandáról nullát jelentene.

## Ellenőrzések

- Kliens `tsc` és szerver `tsc` tiszta. Kliens **769/769**, szerver **229/229**
  zöld, `npm run build` hibátlan.
- **Emulátoron, két felhasználóval végigpróbálva**: publikus banda kap
  meghívókódot; a fejléc borítóképpel sem kerül fedésbe; csatlakozás a banda
  oldaláról; szűrő-megjegyzés újratöltés után; legújabb üzenet elöl, írás
  fölötte; a csengő állapota megmarad; poszt-, válasz- és szív-értesítés
  megérkezik a másik fiókhoz; a napi mérleg 1,234 km²/420 GP-vel kiment.
- **NEM ellenőrizve**: (a) **a hangok készüléken** — teszt ezt nem bizonyítja,
  és ez a hiba már kétszer csúszott át; (b) a moderátor-lila (a tesztben nem
  volt moderátor); (c) a meghívó-értesítés koppintása élesben.
- ⚠️ **Ismert, NEM ehhez a körhöz tartozó bukás**: az emulátoros
  `activityMedia.emulator.test.ts` „a látható képet binárisan adja vissza"
  esete elhasal (`body.activity` undefined a fotófeltöltés után). Külön
  fájlban futtatva is bukik; a kör diffje ezt az útvonalat nem érinti.

## Nyitott ügyek — #37-nek

1. **A terepi mérés kiértékelése** (Samsung háttérben + iPhone előtérben, két
   fiókkal). Az adat a `/admin/teljesitmeny` oldalon lesz, jelöléssel. Ehhez
   képest az asztali mérőpad: 9 hurok / 16 898 belső cella → **22,8 ms**,
   ebből elszámolás 17,8 ms, azon belül **körüljárás 10,3 ms**
   (`tmp/measure-claim-phases.test.ts`). A körüljárás bontása:
   vetítés 2,0 + régiók 4,4 + szögösszeg 1,1 + fal-öröklés 4,5 ms
   (`tmp/measure-winding-phases.test.ts`).
2. **Főszálas költség csökkentése** — **Opus, High**. A mérés alapján dől el,
   hogy olcsóbbá tesszük (inkrementális vetítés és régió-újrahasználat) vagy
   levesszük a főszálról (Web Worker; a `src/game/` platformfüggetlen, tehát
   worker-biztos). A kettő nem zárja ki egymást, de a sorrend a telefonos
   számokon múlik.
3. **Körbe-körbe futásnál a cache sosem talál** — dokumentált korlát. Ha a
   2. pont a workerre fut ki, ez magától súlytalanná válik.
4. A hangok és a bandás kör **készülékes ellenőrzése** az új buildekben.

## Modelljavaslat

**Sonnet, Medium** a mérés beolvasásához és a telepítés-utókövetéshez.
**Opus, High** a 2–3. ponthoz: mért anomáliára épülő architektúra-döntés.

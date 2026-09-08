# Jelenlegi állapot

> Frissítve: **2026-09-08** · Menetszám: **#43, folyamatban**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **main** · HEAD: **af55601**
> Utoljára dolgozott: **Claude (Opus 5)**
> Átadva: **Claude vagy Codex** — a készülékes visszaigazolás van hátra

## Jelenlegi cél

Három iPhone-os hiba javítása **készüléken mérve**, majd Geri
funkció-listájának nekiállni (lásd „Következő lépések").

## Elkészült ebben a menetben

### 1. „Összevissza hangok" a Play gombnál — GYÖKÉROK MEGTALÁLVA ÉS MÉRVE

Nem a térkép cellái okozták (azok szigorúan `running`-ra vannak kapuzva),
hanem maga a hangzár feloldása. Az `unlockSounds()` **51 `<audio>` elemet**
szólaltatott meg; iOS-en a `volume` írása hatástalan, a hallható zavart csak a
hang legvégére ugrás kerülné el — az viszont **csendben kimarad, ha a
`duration` még `NaN`**. A `primeSounds()` addig csak a `TrackingScreen`
mount-effektjében futott, tehát a Kezdőlapról indítva az elemek épp akkor
jöttek létre, és mind teljes hosszban megszólalt.

**A TELJES MÉRÉSI SOR (mind készüléken, Geri):**

| # | Mit oldottunk fel | Hogyan szólalt meg | Eredmény |
|---|---|---|---|
| 1 | semmit (09-03) | — | **NÉMA app** |
| 2 | mindent, szinkron `pause()`-zal (09-04) | el sem indult | **NÉMA app** |
| 3 | 51 elemet | teljes hosszban (`duration` `NaN`) | szól, de **hangzavar** |
| 4 | 1 elemet (build 48) | teljes hosszban (`NaN`) | **szól, zavar nélkül** |
| 5 | 2 elemet (build 49) | a hang **végére ugorva** | **NÉMA app** |

Az aktiváló tényező tehát **nem az elemek száma**, hanem hogy történik-e
**valódi, végigfutó lejátszás**. Egy elem elég, és azon keresztül a fel **nem**
oldott elemek is megszólalnak (a nyomva tartás hangja is szólt a 48-asban,
pedig nem kapott feloldást).

⚠️ Az `UNLOCK_TAIL_S` iOS-en **sosem működött, csak sosem derült ki**: a
`primeSounds()` addig egyedül a `TrackingScreen`-en futott, tehát a Kezdőlapról
indítva a `duration` mindig `NaN` volt, és az ugratás csendben kimaradt. Amint
a `primeSounds()` előrébb került, az ugratás életbe lépett — és **harmadszor is
elnémította az appot**. A védelem, ami sosem futott le, nem védelem.

Beégetve: **natív iOS → pontosan 1 elem, a hang elejétől, teljes hosszban**
(rövid koppanás a Play gombnál). **Web és Android → változatlan**: weben nincs
Capacitor, ott a gesztus-kapu él és elemenkénti, a szűkítés elnémítaná a webes
appot (iPhone Safari is ide tartozik).

### 2. A Play gomb beragadása a Kezdőlapon

A Home-ról Play-t nyomva a kép nem váltott át, a gomb sárga ↑-re állt,
mozgásforma-választó sehol, a dokk használhatatlan.

Az ok **nem a lassúság, hanem a kiút hiánya**: a `TrackingScreen` `lazy()`, a
react-router v7 pedig `startTransition`-be csomagolja a navigációt — amíg a
chunk töltődik, React szándékosan a Home-ot hagyja kint. Közben a `picking`
igazzá vált, a gomb `disabled` lett, a `wasOnTrackingScreen` mentőeffekt pedig
csak a *kilépést* figyeli. A tiltás ezért a rögzítés képernyőjére szűkült.

### 3. A befejezés gomb „random" megszakadása

⚠️ **Az első diagnózisom téves volt.** A gomb négy eseményre hívott
`cancel()`-t (`pointerup`, `pointerleave`, `pointercancel`, `blur`), és ebből
három tévesen is elsülhet — de **Geri tünetét nem ez okozta**: a hiba a
hangbeállítás szűkítésétől múlt el, build 48-on, ahol a mutató-javítás még
nincs is benne.

A legvalószínűbb kapocs: 51 élő `<audio>` elem terhelése alatt a WebKit nem
tudta időben feldolgozni az érintést, és `pointercancel`-t küldött. **Ez
magyarázat, nem mérés.**

A mutató-elfogás (`setPointerCapture`) ettől függetlenül bekerült — a
`SwipeFinishButton` ugyanabban a fájlban már így csinálja —, és mellette egy
**ideiglenes diagnosztika**, ami kiírja az előző megszakítás okát.

## Commitok (`f168f4f..e65093b`)

| Commit | Mit |
|---|---|
| `c63768e` | Dock: a Play gomb beragadása a Home-on |
| `35152f3` | ideiglenes mérőkapcsoló a feloldás hatóköréhez (azóta kivéve) |
| `55afed6` | befejezés gomb: mutató-elfogás + ideiglenes diagnosztika |
| `e65093b` | a mért minimum beégetve (51 → 2), mérőállás eltávolítva — **ez némította el a 49-es buildet** |
| `bf76480` | #43 állapotfrissítés |
| `af55601` | a harmadik némulás javítva: iOS-en 1 elem, a hang **elejétől** |

## Élesben fut / telepítetlen

- A kód a `main`-en van és **fel van pusholva**.
- **iOS build 48** = `35152f3` (mérőállás) · **build 49** = `e65093b`
  (**néma app** — lásd az 5. mérési sort). Új build kell **`af55601`**-ből.
- A webes frontend telepítése ebben a menetben megtörtént (`bf76480`
  tartalmával). Az `af55601` **csak a natív iOS ágat érinti**, a webes
  viselkedés bitre azonos — újratelepítés emiatt nem szükséges.

## Ellenőrzések

- `tsc --noEmit` kliens **és** szerver: zöld.
- `npm run test`: 847 zöld, 181 skip.
- Készüléken mérve: a hangzár hatóköre (build 48). A beégetett változat
  visszaigazolása hátravan.

## Nyitott ügyek

- **Készülékes visszaigazolás `af55601`-ből**: a Play gombnál egyetlen rövid
  koppanás szól (nem hangzavar, nem is némaság); a 3-2-1 síp, a cellahangok, az
  aktivitás-hangok és a **nyomva tartás hangja** is megszólal.
- ⚠️ **A befejezés gomb oka MÉG NINCS ELDÖNTVE.** A 49-es buildben működött, de
  ott *egyetlen hang sem szólt* — tehát nem lehet szétválasztani, hogy a
  mutató-elfogás (`55afed6`) javította-e, vagy csak a hangterhelés hiánya. A
  következő build az első, ahol hangok VANNAK és a mutató-javítás is bent van:
  ha ott is stabil, az a mutató-elfogás mellett szól.
- Ha a befejezés gomb rendben, a **diagnosztikai kiírás kivehető**
  (`finish-overlay__diag`, `lastHoldCancel()`).
- ⚠️ **Nyitott adatkérdés:** a `8b29f3f0-4785-4116-b4a1-293ab3ecd8bb`
  aktivitás `startedAt`/`endedAt` mezői nyers számként íródtak vissza
  (Timestamp helyett), amitől kieshet az idő-alapú lekérdezésekből. A javító
  szkript a `tmp/fixTimestampFields8b29.ts`-ben van (száraz futás
  alapértelmezés). **Nem tudjuk, lefutott-e már.**
- A térképrajzolás (Mapbox `setData`/GPU) önálló mérőszáma továbbra is hiányzik
  a `perfMeter`-ből.
- 2. teljesítmény-cél: valódi, nem szimulált hosszú terepi validálás hiányzik.

## Következő lépések — Geri funkció-listája (#43-ban kérve)

Sorrend nincs rögzítve; a hibajavítások mentek előre.

1. **Üres felületek kitöltése:** Közösség → kihívások, útlevél; Profil →
   statisztika
2. **Sehova nem vezető menüpontok:** Mértékegységek, Csatlakoztatott appok,
   Előfizetés
3. **Adatkezelési tájékoztató és ÁSZF**
4. **Aktivitás jelentése** — ugyanúgy, mint a felhasználó-jelentés
5. **Ügyfélszolgálat menü** a Beállításokba: ticket-rendszer, adminban
   kezelhető, e-mailes állapotfrissítéssel
6. **Banda törlése** — az alapító törölheti, ha egyedül van benne

⚠️ Egy **teljes kód-audit** is kérésben volt a menet elején; félbeszakadt az
állapotfelmérés után, amikor a hibajavítások előre kerültek.

## Modelljavaslat

A funkció-listához **Sonnet, normál mélység** elég (képernyők, űrlapok, CRUD).
A ticket-rendszer adatmodellje és jogosultságai, illetve a kód-audit
**Opus, emelt** szintet kíván.

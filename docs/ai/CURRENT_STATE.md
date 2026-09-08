# Jelenlegi állapot

> Frissítve: **2026-09-08** · Menetszám: **#43, folyamatban**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **main** · HEAD: **e65093b**
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

**MÉRVE (Geri, iPhone, iOS build 48):** egyetlen elem feloldása után a **többi
hang is hibátlanul szólt**. A Capacitor tehát tényleg kikapcsolja a WebKit
elemenkénti gesztus-kapuját, és a 2026-09-03-i némulás oka kizárólag az volt,
hogy **nulla** lejátszás történt (az AVAudioSession attól aktiválódik, hogy
valami ténylegesen megszólal). Az „51 elem" végig fölösleges volt.

Beégetve: **natív iOS → 2 elem** (a pool első eleme + a nyomva tartás külön
eleme), **web és Android → változatlan**. Weben nincs Capacitor, ott a
gesztus-kapu él és elemenkénti — a szűkítés elnémítaná a webes appot (iPhone
Safari is ide tartozik). A `primeSounds()` mostantól már a `Dock`
megjelenésekor lefut.

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
| `e65093b` | a mért minimum beégetve (natív iOS 51 → 2), mérőállás eltávolítva |

## Élesben fut / telepítetlen

- A kód a `main`-en van és **fel van pusholva**.
- **iOS build 48** = `35152f3` (a mérőállással). A javítások **készüléken még
  nincsenek visszaigazolva** — új Codemagic build kell `e65093b`-ből.
- A webes frontend telepítése ebben a menetben történt meg.

## Ellenőrzések

- `tsc --noEmit` kliens **és** szerver: zöld.
- `npm run test`: 847 zöld, 181 skip.
- Készüléken mérve: a hangzár hatóköre (build 48). A beégetett változat
  visszaigazolása hátravan.

## Nyitott ügyek

- **Készülékes visszaigazolás** az új buildből: nincs hangzavar a Play-nél; a
  3-2-1 síp, a cellahangok és az aktivitás-hangok szólnak; **szól-e a nyomva
  tartás hangja** (ez a 2. feloldott elem, erről nincs korábbi adat); a
  befejezés gomb jó-e.
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

# Jelenlegi állapot

> Frissítve: **2026-09-09** · Menetszám: **#43, lezárva**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **main** · HEAD: **fbe73fb**
> Utoljára dolgozott: **Claude (Opus 5)**
> Átadva: **Claude vagy Codex** — a következő téma a **bugreport rendszer** (lásd lent)

## Jelenlegi cél

A #43 iPhone-os hibái javítva és felpusholva. **Készülékes visszaigazolás
hátravan** (`fbe73fb`-ből épített build). Utána a tesztelői **bugreport
rendszer** következik — az saját menetet kíván.

## Elkészült ebben a menetben

### A hangzár — négy némulás után megvan a gyökérok

iOS-en a `HTMLMediaElement.volume` írása **csak addig hatástalan, amíg az elem
nincs betöltve**. Erre támaszkodott akaratlanul az egész feloldás.

| # | Mit oldottunk fel | Az elem állapota | `volume = 0` hatott? | Eredmény |
|---|---|---|---|---|
| 1 | semmit (09-03) | — | — | **néma app** |
| 2 | mindent, szinkron `pause()` (09-04) | — | — | **néma app** |
| 3 | 51 elemet | frissen létrehozva | nem | szól, de **hangzavar** |
| 4 | 1 elemet (build 48) | frissen létrehozva | nem | **szól, jó** |
| 5 | 2 elemet (build 49) | előtöltve | igen | **néma app** |
| 6 | 1 elemet (build 50) | előtöltve | igen | **néma app** |

**A szabály:** a feloldáshoz **valódi, hallható, végigfutó** lejátszás kell.
Egy elem elég, és azon keresztül a fel **nem** oldott elemek is megszólalnak.
Ugyanez magyarázza a `muted = true` régi figyelmeztetését és azt is, hogy az
`UNLOCK_TAIL_S` iOS-en sosem működött.

Beégetve: **natív iOS → 1 saját elem** (`cell-captured`), a hang elejétől,
némítás nélkül. **Web és Android → változatlan** (ott a `volume = 0` hat, a
gesztus-kapu viszont elemenkénti). A `primeSounds()` **nem** futhat a `Dock`
mountjában — ez némította el a 49–50-es buildet.

### A többi javítás

| Hiba | Ok | Commit |
|---|---|---|
| Play gomb beragadt a Home-on | `lazy()` + router `startTransition` alatt a `picking` `disabled`-et adott, és nem volt kiút | `c63768e` |
| Befejezés gomb „random" megszakadt | *az ok a hangterhelés volt*; a mutató-elfogás (`setPointerCapture`) hardening maradt | `55afed6` |
| Hangos beep a Play-nél | a feloldás a `count-down-beep` **pooljának** elemét vette el a `playSound` elől | `5aa8bd2` |
| 3-2-1 nem követte a számokat | az effekt függött a `begin`-től, ami nyolc értéktől kap új azonosságot → extra síp + újraindított időzítő | `5aa8bd2` |
| Popup nyíl helyett téglalap | mind a négy szegély ki volt színezve; a Mapbox átlátszó szegélyekből rajzol háromszöget | `5aa8bd2` |
| Bluetooth-on nem szólt semmi | **nem volt AVAudioSession-konfiguráció** → `.playback` + `.mixWithOthers` | `fbe73fb` |
| Fekete pötty a kártya helyett | a `TrackingScreen` nem adott át `cellPopup`-ot → közös `useCellOwnerCard` | `fbe73fb` |
| Jeff: 3× engedélykérés | az „Always"-t **két helyen**, korlátlanul kértük → `requestAlwaysOnce()` + magyarázó képernyő | `fbe73fb` |

⚠️ **A `.playback` szándékosan figyelmen kívül hagyja a némító kapcsolót** —
ezért került a rögzítés felületére külön némító gomb (`.track__mute`), ami a
Beállítások → Hangok főkapcsolójával azonos értéket állít.

## Élesben fut / telepítetlen

- A kód a `main`-en van és **fel van pusholva**.
- **iOS build 48** = `35152f3` · **49** = `e65093b` (néma) · **50** = `ee3d788`
  (néma). Új build kell **`fbe73fb`**-ből.
- A webes frontend `bf76480` tartalmával van telepítve. Azóta a hangváltozások
  **csak a natív iOS ágat** érintik, de a `5aa8bd2` (popup-nyíl, visszaszámlálás)
  és a `fbe73fb` (tulajdonos-kártya) **a webet is javítja** — érdemes
  újratelepíteni.

## Ellenőrzések

- `tsc --noEmit` kliens **és** szerver: zöld.
- `npm run test`: 848 zöld, 181 skip.
- `npm run build`: zöld.
- A `8b29f3f0` aktivitás Timestamp-kérdése **ellenőrizve és lezárva**: a száraz
  futás szerint a `startedAt`/`endedAt` már `Timestamp` típusú, a javítás tehát
  korábban megtörtént. A `tmp/fixTimestampFields8b29.ts` elvégezte a dolgát,
  törölhető.
- ⚠️ A natív változások (AVAudioSession, `requestAlwaysOnce`) **készüléken
  nincsenek igazolva** — teszt ezt nem is bizonyíthatja.

## Szerver-szkriptek futtatása (mérve, 2026-09-09)

A `server/src/scripts/` alatti egyszeri szkriptek **csak a `server` mappából**
futnak — kívülről nem látják a `firebase-admin`-t —, és **kell melléjük a
projektazonosító**, mert a fejlesztői gépen nincs beállítva:

```
cd server && GOOGLE_CLOUD_PROJECT=grundo npx tsx src/scripts/<nev>.ts
```

Enélkül a hiba félrevezető: „Unable to detect a Project Id in the current
environment". A `FIRESTORE_DATABASE_ID` alapértelmezése helyesen `grundo-db`
(`server/src/lib/firebase.ts`), azt nem kell megadni.

## Nyitott ügyek

- **Készülékes visszaigazolás `fbe73fb`-ből**: Play-nél egyetlen rövid
  koppanás · 3-2-1 a számokkal együtt · cellahangok · **Bluetooth-fülhallgatón
  is szól** · némító gomb működik · tulajdonos-kártya a rögzítés oldalon is ·
  a kártya nyila háromszög · új telepítésnél **csak két** engedélykérdés, a
  magyarázó képernyő után.
- A térképrajzolás (Mapbox `setData`/GPU) önálló mérőszáma hiányzik a
  `perfMeter`-ből.
- 2. teljesítmény-cél: valódi, nem szimulált hosszú terepi validálás hiányzik.

## Következő téma — BUGREPORT RENDSZER (Geri kérése, #43)

**Ez a következő menet fő feladata**, és önálló funkció, nem hibajavítás.

- App indításakor **üzemmód-választó**: „Normál" / „Debug"
- Debug módban egy **húzható, mindig előtérben lévő lebegő gomb** (bogár ikon),
  amit a felhasználó bárhová tehet, és ott marad
- A menü tartalma:
  - **Képernyőkép küldése** — a debug gombot és a menüt előtte el kell rejteni;
    utána kérdezze meg, akar-e megjegyzést írni, vagy csak beküldi
  - **Videó készítése** — max 30 mp, tömörítve feltöltve a szerverre
  - **Report küldése** — használati adatok
  - **Crash report** — összeomlás után a **következő indításkor** ajánljuk fel
- **Admin felület**: új „bugreport" fül a beküldések kezelésére

⚠️ A videórögzítés és a crash-elkapás natív munkát is jelent mindkét
platformon. Érdemes a felépítést végigbeszélni, mielőtt kód készül.

## További funkció-lista (#43-ban kérve, sorrend nincs)

1. **Üres felületek:** Közösség → kihívások, útlevél; Profil → statisztika
2. **Sehova nem vezető menüpontok:** Mértékegységek, Csatlakoztatott appok,
   Előfizetés
3. **Adatkezelési tájékoztató és ÁSZF**
4. **Aktivitás jelentése** — ugyanúgy, mint a felhasználó-jelentés
5. **Banda törlése** — az alapító törölheti, ha egyedül van benne

⚠️ Egy **teljes kód-audit** is kérésben volt a menet elején; félbeszakadt az
állapotfelmérés után.

## Modelljavaslat

A bugreport rendszer felépítéséhez és az admin jogosultságokhoz **Opus,
emelt**. A funkció-lista többi pontjához (képernyők, űrlapok, CRUD) **Sonnet,
normál** elég.

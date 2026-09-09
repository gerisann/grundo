# Jelenlegi állapot

> Frissítve: **2026-09-09** · Menetszám: **#43, lezárva**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **main** · HEAD: **6d9e46f**
> Utoljára dolgozott: **Claude (Opus, Medium)**
> Átadva: **Claude vagy Codex** — a következő téma a **bugreport rendszer**

## Jelenlegi cél

Nyolc iPhone-os hiba javítva, a web és a backend telepítve. **Készülékes
visszaigazolás hátravan** — ehhez új iOS build kell. Utána a tesztelői
**bugreport rendszer** következik, ami saját menetet kíván.

## Elkészült

Nyolc hiba, mind készüléken jelentve, mind javítva és felpusholva:

| Hiba | Ok |
|---|---|
| „Összevissza hangok" a Play-nél | a feloldás 51 `<audio>` elemet szólaltatott meg |
| Play gomb beragadt a Home-on | `lazy()` + router-`startTransition` alatt `disabled` lett, és nem volt kiút |
| Befejezés gomb megszakadt | a hangterhelés okozta; a mutató-elfogás hardeningként maradt |
| Hangos beep a Play-nél | a feloldás a `count-down-beep` pooljának elemét vette el a `playSound` elől |
| 3-2-1 nem követte a számokat | az effekt a `begin`-től függött, ami nyolc értéktől kap új azonosságot |
| Popup nyíl helyett téglalap | mind a négy szegély ki volt színezve |
| Bluetooth-on nem szólt semmi | **nem volt AVAudioSession-konfiguráció** |
| Jeff: 3× engedélykérés | az „Always"-t két helyen, korlátlanul kértük |

⚠️ A hangzár gyökéroka és a belőle következő tiltások a **`DECISIONS.md`**-ben
vannak („iOS hangzár", „iOS helyzet-engedély") — azokat nem szabad
visszacsinálni. Két új hibaminta a `grundo-lessons` skillben (15., 16.).

## Módosított fájlok (`f168f4f..6d9e46f`, 13 commit)

| Fájl | | +/− | Mit |
|---|---|---|---|
| `src/lib/sound.ts` | M | +161/−12 | iOS-en 1 saját elem, hallhatóan, a hang elejétől |
| `src/lib/soundUnlock.test.ts` | M | +80/−5 | a négy némulás regressziós tesztjei |
| `src/components/Dock.tsx` | M | +73/−9 | Play-gomb kiút, visszaszámlálás refekből |
| `src/components/FinishGestureButtons.tsx` | M | +87/−7 | mutató-elfogás, `pointerleave` kivéve |
| `src/components/finishGesture.test.ts` | ÚJ | +55 | `endsHold`, `cancelsOnBlur` |
| `src/components/CellOwnerCard.tsx` + `.css` | ÚJ | +184 | közös tulajdonos-kártya |
| `src/components/LocationPrimer.tsx` + `.css` | ÚJ | +180 | magyarázat a rendszerkérdés elé |
| `src/components/mapview.css` | M | +30/−7 | a popup nyila horgony szerint |
| `src/screens/TrackingScreen.tsx` | M | +84 | némító gomb, kártya, primer bekötése |
| `src/screens/tracking.css` | M | +29 | `.track__mute` |
| `src/screens/TerritoryScreen.tsx` + `territory.css` | M | −159 | átállva a közös kártyára |
| `ios/App/App/AppDelegate.swift` | M | +42/−1 | `.playback` + `.mixWithOthers` |
| `ios/App/App/BackgroundLocationPlugin.swift` | M | +29/−4 | `requestAlwaysOnce()` |

## Élesben fut / telepítetlen

- **Frontend és backend telepítve** a `6d9e46f` tartalmával. A backend
  egészséges: `/healthz/` → `{"ok":true,"database":"grundo-db"}`.
- **iOS build 48** = `35152f3` · **49** = `e65093b` (néma) · **50** = `ee3d788`
  (néma). **Új iOS build kell** a mostani HEAD-ből.
- Android build ebben a menetben nem készült.

## Ellenőrzések

- `tsc --noEmit` kliens **és** szerver: zöld.
- `npm run test`: 848 zöld, 181 skip. `npm run build`: zöld.
- Az éles web betölt, konzolhiba nincs.
- A `8b29f3f0` aktivitás Timestamp-kérdése **lezárva**: száraz futás szerint a
  mezők már `Timestamp` típusúak, a javítás korábban megtörtént.
- ⚠️ **NEM ellenőrzött:** a két natív változás (AVAudioSession,
  `requestAlwaysOnce`) — készülék nélkül nem is bizonyítható. Emulátoros
  tesztkészlet nem futott (Firestore-viselkedés nem változott).

## Nyitott ügyek

- **Készülékes visszaigazolás** az új iOS buildből: Play-nél egyetlen rövid
  koppanás · 3-2-1 a számokkal együtt · **Bluetooth-fülhallgatón is szól** ·
  némító gomb · tulajdonos-kártya a rögzítés oldalon · a popup nyila háromszög ·
  új telepítésnél **csak két** engedélykérdés a magyarázó képernyő után.
- A térképrajzolás (Mapbox `setData`/GPU) önálló mérőszáma hiányzik.
- 2. teljesítmény-cél: valódi, hosszú terepi validálás hiányzik.
- Egy **teljes kód-audit** kérésben volt; félbeszakadt az állapotfelmérés után.

## Következő téma — BUGREPORT RENDSZER

Indításkor **üzemmód-választó** („Normál" / „Debug"). Debug módban **húzható,
mindig előtérben lévő lebegő gomb** (bogár ikon), ami ott marad, ahová teszik.
Menüpontjai: **képernyőkép** (a debug gombot előtte elrejtve, utána megjegyzés
vagy azonnali beküldés) · **videó** (max 30 mp, tömörítve feltöltve) ·
**report** (használati adatok) · **crash report** összeomlás után a következő
indításkor felajánlva. Az adminba új **„bugreport" fül** kell a beküldések
kezelésére.

⚠️ A videórögzítés és a crash-elkapás **natív munkát is jelent** mindkét
platformon — érdemes a felépítést végigbeszélni, mielőtt kód készül.

## További funkció-lista (#43-ban kérve, sorrend nincs)

Üres felületek (Közösség → kihívások, útlevél; Profil → statisztika) · sehova
nem vezető menüpontok (Mértékegységek, Csatlakoztatott appok, Előfizetés) ·
adatkezelési tájékoztató és ÁSZF · aktivitás jelentése · banda törlése (az
alapító, ha egyedül van benne).

## Modelljavaslat

A bugreport rendszer felépítéséhez és az admin jogosultságokhoz **Opus, emelt**.
A funkció-lista többi pontjához (képernyők, űrlapok, CRUD) **Sonnet, normál**.

# GRUNDO handoff

> Frissítve: **2026-08-31** · a **#23** menet vége, átadás **#24**-re
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`**. A háttér-GPS javítás commitja: **`6da0288`**.

## ÁLLAPOT

Egy valódi iOS terepteszt 1:32:44 alatt csak 1,91 km-t és egy hosszú egyenes
szakaszt mutatott, miközben a tesztelő legalább 25 km-t bringázott, lezárt
képernyővel és `Always` helyengedéllyel. A hiba két, egymást erősítő oka
igazolva és a kódban javítva.

### Igazolt okok

1. **Ébredéskori verseny:** egy friss Capacitor `location` esemény megelőzhette
   a tartós natív sor `drain` válaszát. A `NativePositionSource` ekkor a friss
   időbélyeget megjegyezte, majd az összes korábbi köztes pontot eldobta.
   Célzott tesztben a régi kód `[300]` értéket adott a helyes
   `[100, 200, 300]` helyett. Ez közvetlenül magyarázza a képen látható
   kezdő–végpont egyenest és az alulmért távot.
2. **Túl kicsi iOS sor:** az iOS natív sor csak 500 pontot tartott meg. A
   bringás 12 m-es Core Location szűrő mellett 25 km-hez legalább kb. 2085
   pont kell; 500 pont elméleti felső lefedése kb. 6 km, 1 Hz-nél csak 8:20
   perc. Androidon már korábban is 25 000 pontos SQLite-sor volt.

A verseny és az 500-as limit már a `85802da` (2026-08-23) háttér-GPS
bevezetésében benne volt. A `b167a51` energiaoptimalizálás (2026-08-30) a
natív képernyőzár-tiltás kikapcsolásával a háttérutat tette normál működéssé,
így a korábban rövid tesztekkel rejtve maradt hiba sokkal könnyebben előjött.
A `687fc1d` Swift soroptimalizálása megtartotta az 500-as limitet, és a
handoff szerint készüléken még nem volt ellenőrizve.

### Javítás

- A közös TypeScript natív forrás a start/visibility/stop drainjeit
  sorosítja, a közben érkező élő pontokat puffereli, az egész köteget
  időrendbe rendezi, és időbélyeg szerint deduplikálja.
- A stop bevárja a már futó draint, ezért befejezéskor sem válhat le túl korán
  a recorder.
- Az iOS sor 25 000 pontra nőtt, Androiddal azonos kapacitással.
- iOS-en a háttérpontok 10 másodperces bináris plist kötegekben, az
  Application Support mappában élnek; nem a teljes `UserDefaults` tömb íródik
  újra. A fájlok ki vannak zárva az iCloud backupból.
- A régi v1 UserDefaults-sor frissítés után egyszer még beolvasódik, így
  upgrade közben sem vész el aktív pont.
- Előtéri pont nem kerül a natív sorba, mert azt a JS és az IndexedDB már
  megkapja; a natív sor kizárólag a felfüggesztett WebView szakaszáé.

### Ellenőrzések

- célzott regressziós teszt: a régi kódon **bukott** (`[300]`), javítás után
  **3/3 zöld**;
- teljes normál teszt: **580 sikeres, 129 emulátoros kihagyva**;
- kliens `typecheck`: zöld;
- szerver `typecheck`: zöld;
- frontend production build: zöld, 309 modul;
- `git diff --check`: tiszta.
- Codemagic `GRUNDO iOS TestFlight #27`: sikeres, pontos forrás
  `6da02885f2f339c050d87108ccf99e4e9ffc8518`, az IPA és a dSYM artifactok
  elkészültek;
- App Store distribution utófeldolgozás: sikeresen befejeződött.

## ÉLESBEN FUT / TELEPÍTETLEN

- Az előző adatvédelmi kiadás változatlanul éles: backend/frontend kód
  `605736f`, Cloud Run `grundo-api-00110-94c`, szabályok és fotómigráció kész.
- A háttér-GPS javítás a **TestFlight #27** buildben van. A Codemagic
  sikeresen átadta az App Store Connectnek; az Apple feldolgozása után jelenik
  meg a tesztelőknek. Webes vagy backend telepítés nem szükséges.
- A közös TypeScript versenyjavítás az Androidot is védi; Android buildet a
  következő natív mérföldkőnél kell kiadni. Az iOS 500 pontos kapacitáshiba
  Androidon nem állt fenn.
- Helyi Windowson a `cap sync ios` symlink létrehozása EPERM-et adott, de a
  Codemagic macOS-környezetében a Capacitor sync, a Swift/Xcode fordítás, az
  aláírás és az IPA-készítés is sikeres volt.

## KÖVETKEZŐ MENET

1. Az Apple feldolgozása után a **TestFlight #27** buildet kell telepíteni;
   az app Beállítások → Alkalmazás részében ellenőrizni kell a `6da0288`
   rövid commitot.
2. Valódi készüléken először 3 perc / 100 m lezárt képernyős smoke teszt,
   utána legalább 90 perc / 20 km bringás regressziós teszt. Ellenőrizni kell
   a folytonos nyomvonalat, a referencia-táv eltérését, a Live Activityt,
   valamint szünet/befejezés után a teljes mentést.
3. A hosszú tesztig a javítás nem tekinthető készüléken igazoltnak. Windowsról
   Core Location és lezárt képernyős iOS életciklus nem reprodukálható.
4. A GPS-javítás lezárása után folytatható az audit következő biztonsági
   prioritása: dependency-audit, App Check és szerveroldali rate limit.

## NYITOTT KISEBB ÜGYEK

- A frontend `npm install` továbbra is 10 auditjelzést mutatott (8 közepes,
  1 magas, 1 kritikus); automatikus breaking `--force` javítás nem történt.
- A production build meglévő Mapbox chunkja 1,865 MB.
- Kiadás előtt törlendő az ideiglenes
  `android.webContentsDebuggingEnabled: true` kapcsoló.
- `emulator-5562 offline` továbbra is látszik Geri gépén.

## 0. MODELLJAVASLAT a folytatáshoz

A készülékes regresszió kiértékeléséhez **GPT-5.6 Sol, erős
gondolkodási mélység** indokolt; ha mindkét tereppróba zöld, a
dokumentációs lezáráshoz elég gyorsabb modell normál mélységen.

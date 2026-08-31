# GRUNDO handoff

> Frissítve: **2026-08-31** · a **#24** menet vége, átadás **#25**-re
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`**. Az Android háttér-GPS javításának commitja: **`57f4d5a`**.

## ÁLLAPOT

Az iOS háttér-GPS hibája után az Android natív útvonal is teljes auditot
kapott. Az Android architektúrája alapvetően helyes: a rögzítés
`location` típusú foreground service-ben fut, `START_STICKY`, a szolgáltatás
nem áll le az Activity bezárásakor, és a pontokat a felfüggesztett WebView
helyett tartós SQLite-sor fogadja. A rögzítést látható Activityből indítjuk,
ezért a jelenlegi Android-szabályok mellett nem kell
`ACCESS_BACKGROUND_LOCATION` engedély.

### Igazolt Android-kockázatok és javításuk

1. **Közös ébredéskori verseny:** az Androidot is érintette az a
   `NativePositionSource` hiba, amelyben egy friss élő pont megelőzhette a
   natív sor `drain` válaszát, majd az összes régebbi köztes pont kiesett.
   Ezt a `6da0288` commit már sorosítással, puffereléssel, rendezéssel és
   deduplikálással javította; Android build eddig még nem készült belőle.
2. **Minden aktivitásra 5 m-es szűrő:** a bringázás is a futáshoz használt
   sűrű GPS-profilt kapta. Most futás/séta/bringázás rendre **5/8/12 méter**,
   az iOS-szel azonosan. Ez bringán csökkenti a fölösleges ébresztést,
   adatbázisírást és akkumulátorterhelést anélkül, hogy az útvonal érdemben
   ritkulna.
3. **Pontonkénti teljes sorvizsgálat:** az SQLite-sor minden egyes beszúrás után
   `OFFSET 25000` lekérdezéssel ellenőrizte a limitet, akkor is, amikor a sor
   még messze volt tőle. Azonos séma és 10 000 beszúrás mellett ez mérve
   **0,774 s**, számlálós megoldással **0,029 s** volt (26,8×); 25 000 pontnál
   **4,540 s vs. 0,083 s** (54,9×). Most folyamatonként egyszer számolunk,
   utána zárolt, tranzakciós számláló tartja pontosan a **25 000** soros
   maximumot, és csak valódi túlcsorduláskor töröl.
4. **Release-biztonság:** az ideiglenes
   `android.webContentsDebuggingEnabled: true` kapcsoló kikerült. A release
   WebView ismét a Capacitor biztonságos alapértékét használja.

### Platformkorlát

Az Android 15 hatórás foreground-service korlátja nem a `location` típusra,
hanem a `dataSync` és `mediaProcessing` típusokra vonatkozik. Az app saját
logikája ezért nem tesz időkorlátot a rögzítésre: többórás használat is
támogatott. A gyártói akkumulátorkezelés, a felhasználói kényszerleállítás,
a helymeghatározás kikapcsolása és az engedély visszavonása továbbra is
külső megszakítás lehet; ezt valódi készüléken kell ellenőrizni.

### Ellenőrzések

- Android release unit teszt: **5/5 zöld**;
- teljes normál teszt: **580 sikeres, 129 emulátoros kihagyva**;
- kliens typecheck + production build: zöld, 309 modul;
- szerver typecheck: zöld;
- `npx cap sync android`: sikeres;
- Android `lintRelease`: **0 hiba**, 32 meglévő figyelmeztetés, az érintett
  GPS-fájlokra nincs új jelzés;
- helyi `assembleRelease` + `bundleRelease`: sikeres;
- `git diff --check`: tiszta;
- Codemagic `GRUNDO Android Release #14`: sikeres, pontos forrás
  `57f4d5afa0fb69781b6262d0e1adcc3f17fe8a51`, aláírt APK és AAB elkészült;
- Google Play belső tesztsáv: **completed**, aktív verziókód **14**.

## ÉLESBEN FUT / TELEPÍTETLEN

- Az előző adatvédelmi kiadás változatlanul éles: backend/frontend kód
  `605736f`, Cloud Run `grundo-api-00110-94c`, szabályok és fotómigráció kész.
- Az iOS háttér-GPS javítás a **TestFlight #27** buildben van, forrása
  `6da0288`; a hosszú készülékes regresszió még hátravan.
- Az Android-javítás a **GRUNDO Android Release #14** buildben van, forrása
  `57f4d5a`. Az aláírt AAB sikeresen felkerült a Google Play belső
  tesztelési sávjára, ahol a kiadás `completed` állapotú.
- Backend, frontend, Firestore-szabály vagy index telepítése ehhez nem kell.

## KÖVETKEZŐ MENET

1. A Google Play belső tesztcsatornáról telepített Android buildben a
   Beállítások → Alkalmazás részen ellenőrizni kell a kiadott rövid commitot.
2. Androidon először 3 perc / 100 m lezárt képernyős smoke teszt, utána
   legalább 90 perc / 20 km bringás regresszió kell. Ellenőrizendő a folytonos
   nyomvonal, a referencia-táv eltérése, a foreground értesítés, a
   szünet/folytatás és a teljes mentés.
3. Ugyanezt az iOS TestFlight #27-en is végig kell mérni. A javítás csak a két
   platform hosszú készülékes próbája után tekinthető lezártnak.
4. Ezután folytatható az audit következő biztonsági prioritása:
   dependency-audit, App Check és szerveroldali rate limit.

## NYITOTT KISEBB ÜGYEK

- A frontend `npm install` továbbra is 10 auditjelzést mutatott (8 közepes,
  1 magas, 1 kritikus); automatikus breaking `--force` javítás nem történt.
- A production build meglévő Mapbox chunkja 1,865 MB.
- Az Android lint 32 meglévő figyelmeztetést jelez: főként ikon- és nem
  használt erőforrás-karbantartás; nem blokkolják ezt a kiadást.
- A Codemagic Google Play ellenőrző parancsa jelzi, hogy a régi
  `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` környezetinév később megszűnik; egy
  külön üzemeltetési menetben át kell nevezni
  `GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS`-re a Codemagic változóval együtt.
- `emulator-5562 offline` továbbra is látszik Geri gépén, ezért helyi valódi
  készülékes vagy emulátoros Android életciklusteszt nem futott.

## 0. MODELLJAVASLAT a folytatáshoz

A két platform hosszú, mért tereppróbájának kiértékeléséhez **GPT-5.6 Sol,
erős gondolkodási mélység** indokolt; ha mindkettő zöld, a dokumentációs
lezáráshoz elég gyorsabb modell normál mélységen.

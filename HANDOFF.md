# GRUNDO handoff

> Frissítve: **2026-08-31** · a **#22** menet vége, átadás **#23**-ra
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`**. A #22 biztonsági commitja pusholva; a pontos hash a menet
> záróüzenetében van. A menet alapja `c5cc06c` (funkcionális előd: `9518aff`).

## ÁLLAPOT

A teljes projekt-audit utáni javítási sorrend első, legsürgősebb egysége
elkészült: a teljes felhasználói dokumentum és az aktivitásfotók adatvédelmi
rése bezárva a kódban, szabályokban, tesztekben és dokumentációban.

Ellenőrzések:

- kliens `typecheck`: zöld;
- szerver `typecheck` és production build: zöld;
- teljes normál teszt: **577 sikeres, 129 emulátoros kihagyva**;
- teljes emulátorkészlet: **129/129 sikeres** (Firestore + Auth + Storage);
- frontend production build: zöld, 309 modul;
- migráció emulátoros dry-run: zöld;
- `git diff --check`: tiszta.

## MI KÉSZÜLT EL A #22-BEN

### 1. Felhasználói dokumentumok

- A `users/{uid}` fődokumentum közvetlenül csak a tulajdonosnak és adminnak
  olvasható. Idegen profil továbbra is a mezőket fehérlistázó backend API-ból
  jön, ezért e-mail, testadat, trust és fiókstátusz nem szivárog ki.
- Az idegen `following`, `followers`, `badges` és `passport` alkollekciók
  közvetlen olvasása is megszűnt; a saját és admin-hozzáférés megmaradt.
- Valódi Firestore-emulátoros teszt bizonyítja a saját/idegen elválasztást.

### 2. Aktivitásfotók

- A Firestore most csak `{ path }` értéket tárol; tartós Firebase letöltési
  URL nem kerül új aktivitásba vagy API-válaszba.
- Új, hitelesített backend-végpont szolgálja ki a képet. Ellenőrzi az
  aktivitás létezését, soft-delete állapotát, `everyone`/`followers`/
  `only_me` láthatóságát, a követést és a tiltást mindkét irányban.
- A kért Storage-útvonalnak pontosan egyeznie kell az aktivitáson tárolt
  hivatkozással. A válasz `private, max-age=300` cache-t és `nosniff` fejlécet
  kap.
- A webes és a Capacitorban közös React-kliens Authorization fejléccel tölti
  a képet blobba. A feed csak a viewport 400 px-es közelében kezd tölteni, és
  felszabadítja az objektum-URL-t.
- A Storage közvetlen aktivitásfotó-olvasása csak a tulajdonosnak engedett;
  generált `maps/` objektum kliensről egyáltalán nem olvasható.
- A részlet-, kedvelés- és kommentvégpontok közös jogosultsági kaput kaptak.
  Ezzel a korábbi követői láthatóság-eltérés és az ismert azonosítóval történő
  like-megkerülés is megszűnt.

### 3. Migráció és tesztüzem

- Új, alapból dry-run `migrate:activity-media-privacy` script normalizálja a
  régi fotómezőket és visszavonja az `activities/` Storage-objektumok meglévő
  `firebaseStorageDownloadTokens` metaadatait.
- Éles írás csak `--apply --allow-production` együttessel lehetséges.
- Új backend- és szabálytesztek fedik a publikus, követői, privát, tiltott,
  tulajdonosi és idegen Storage-eseteket.
- Az emulátoros parancs most Auth + Firestore + Storage emulátort indít. A
  mért 5,3–5,5 másodperces compact tesztek miatt a plafon 15 másodperc, a
  suite-indításé 20 másodperc; így a teljes készlet együtt is stabilan zöld.

## ÉLESBEN FUT / TELEPÍTETLEN

- **Éles frontend:** továbbra is `9518aff` a korábbi #21 menetből.
- **Backend, szabályok, migráció:** a #22 változásai **nincsenek telepítve**.
- A régi aktivitásfotó-letöltési tokenek ezért **még érvényesek**. A Storage
  rules telepítése önmagában nem vonja vissza őket; ehhez kell a migráció.
- Firestore-index nem változott.
- iOS- és Android-platformkód nem változott, de a közös webes bundle igen;
  ezért új natív build kell. Készülékes ellenőrzés még nem történt.

### Kiadási sorrend — fontos kompatibilitási korlát

A régi telepített web/iOS/Android kliens `photo.url` mezőt vár, az új backend
viszont biztonsági okból már nem ad ilyet. Ezért **ne telepítsd külön, vakon**
a backendet vagy a frontendet. A projekt jelenleg tesztcsatornás, így a helyes
menet: új Android/iOS build előkészítése → összehangolt backend + frontend
kiadás → szabályok → migráció dry-run → migráció apply → natív készülékes
ellenőrzés. A migráció csak akkor fusson, amikor az új kliensek elérhetők.

## KÖVETKEZŐ MENET

1. Az audit következő biztonsági prioritása: App Check és szerveroldali
   visszaélés-/sebességkorlát a nyilvános és költséges végpontokon. Előbb a
   meglévő auth- és proxyútvonalak mérhető fenyegetési térképét kell elkészíteni.
2. Utána az audit teljesítménylistája: a production build továbbra is jelzi a
   **1,865 MB-os Mapbox chunkot**. Ez meglévő, nem a #22 regressziója; csak
   mérés alapján érdemes további bontást vagy betöltési stratégiát választani.
3. Kiadás előtt törlendő a korábbi mérésből maradt
   `android.webContentsDebuggingEnabled: true` kapcsoló.

## NYITOTT KISEBB ÜGYEK

- `emulator-5562 offline` továbbra is megjelenik Geri gépén az `adb devices`
  kimenetében; nem zavarta ezt a munkát.
- Az aktivitásfotó-kiszolgálás képenként egy jogosultsági Firestore-ellenőrzést
  végez. Ez a biztonságos alap; később valós olvasásszám és késleltetés alapján
  rövid szerveroldali engedélycache mérlegelhető, de tiltás/privacy változásnál
  a stale ablakot külön kezelni kell.

## 0. MODELLJAVASLAT a folytatáshoz

Az App Check + rate-limit menethez **GPT-5.6 Sol, erős gondolkodási mélység**
indokolt: auth-, költség- és platformközi döntések vannak benne. A későbbi,
mechanikus UI-/tesztmunkákhoz elég lesz egy gyorsabb modell normál mélységen.

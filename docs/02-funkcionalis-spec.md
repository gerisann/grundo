# 02 — Funkcionális specifikáció

Minden képernyő: mit tartalmaz, mit csinál, milyen állapotai vannak. A `[Pro]` jelölés fizetős korlátot jelent.

---

## Regisztráció és hitelesítés

### Onboarding (nincs a képek között — új)

1. **Splash / értékajánlat** — 3 lapos swipe: „Zárd a kört" · „Urald a területet" · „Minden méter pontot ér", Kihagyás gombbal.
2. **Regisztráció**: felhasználónév · e-mail · jelszó (mind kötelező).
   - Felhasználónév: 3–20 karakter, `a-z0-9._`, **kis-nagybetűre érzéketlen, de a beírt alakot megőrizzük** (a „Geri" így marad Geri, és a „geri" nem foglalható le külön). Egyediség tranzakcióval, a kisbetűs kulcson (`usernames/{lowercase}`), foglalt szavak tiltólistán (admin, grund, support…).
   - A megjelenített név alapból a felhasználónév. A Google-fiók valódi nevét **nem** vesszük át magától: a polgári név a ranglistán jelenne meg anélkül, hogy a felhasználó valaha döntött volna róla.
   - Jelszó: min. 8 karakter, erősségjelző.
   - Kötelező pipa: ÁSZF + Adatvédelem elfogadása (verzióval együtt mentve).
3. **E-mail hitelesítés**: 6 jegyű OTP e-mailben (kép #44).
   - Kód: 6 számjegy, **15 perc** lejárat, Firestore-ban csak hash tárolva.
   - Újraküldés: **60 s** visszaszámláló.
   - Max 5 hibás próbálkozás → 15 perc zárolás.
   - **Az app hitelesítés nélkül is használható** — de a Home tetején végig ott a „Hitelesítsd az e-mail-címed" banner (kép #37).
4. **Alapadatok** (átugorható): testsúly, magasság, születési dátum, mértékegységek.
5. **Privát zóna beállítása** *(döntés: 2026-08-15)* — **kötelező, átugorhatatlan lépés**, még az első aktivitás előtt. Részletek: [Privát zóna](#privát-zóna) alább.
6. **Engedélykérések** kontextusban, nem előre: helyadat (kép #11) az első indításnál, kamera (kép #47) az első fotónál, push az első aktivitás mentése után.
7. **Első követések**: „friend of a friend" javaslatok + kontakt-import (opcionális).

**Türelmi idő** *(döntés: 2026-08-15)*: **7 nap**. Utána a közösségi írás-műveletek (publikus poszt-láthatóság, komment, like, klub létrehozás, üzenet) zárolódnak, amíg a hitelesítés meg nem történik. A **tracking és a területfoglalás soha nem zárolódik** — a felhasználó nem veszíthet területet azért, mert nem nyitott meg egy e-mailt.

### Belépés
- E-mail + jelszó, „Elfelejtett jelszó" (e-mailes reset link).

**Google belépés** *(élesítve: 2026-08-15)* — a Firebase projektben be van kapcsolva, tehát az F0 hatókörébe kerül, nem V1.5-be.

Két következménye van, amit együtt kell kezelni:

**1. Fiókösszevonás.** Ha valaki előbb e-mail+jelszóval regisztrál, majd ugyanazzal a címmel Google-lel lép be (vagy fordítva), a Firebase alapbeállítása („one account per email address") hibával elutasítja a másodikat. Ez lesz a leggyakoribb támogatási kérdés, ha nyersen hagyjuk.

Kezelés: a `auth/account-exists-with-different-credential` hibát **érthető magyar üzenetre** kell fordítani, és fel kell ajánlani a helyes utat:

> „Ezzel az e-mail-címmel már van fiókod, jelszóval. Lépj be jelszóval, és a profilodban összekapcsolhatod a Google-fiókoddal."

Belépés után a Beállításokban legyen egy **„Bejelentkezési módok"** szakasz, ahol a Google-fiók hozzákapcsolható (`linkWithCredential`) és leválasztható — de legalább egy módszernek mindig maradnia kell.

**2. Sign in with Apple kötelezővé válik iOS-en.** Az App Store megköveteli, ha az app kínál más harmadik féltől származó belépést. Amint iOS build készül, az Apple belépés is kell — ez **nem opcionális** és nem halasztható a beadás utánra. Tervezd be az F0-ba, ne az F6-ba.

---

## Privát zóna

*(döntés: 2026-08-15)* Az aktivitás elejének és végének elrejtése. **Nem beállítás a beállítások mélyén, hanem az onboarding kötelező lépése** — mert aki egyszer nyilvánosságra hozta a lakcímét, azt nem lehet visszavonni. Az első aktivitás soha nem indulhat el úgy, hogy a felhasználó ne látta volna ezt a képernyőt.

### A képernyő

Térkép a felhasználó aktuális pozíciójával, rajta a védőkör vizuálisan, hogy **lássa, mekkora területről beszélünk** — ne absztrakt métereket kelljen elképzelnie.

```
┌─────────────────────────────────────┐
│  Védd a kiindulópontod               │
│  Az aktivitásaid eleje és vége       │
│  rejtve marad mások elől.            │
│                                      │
│      [ térkép a védőkörrel ]         │
│                                      │
│  KEZDET ELREJTÉSE          [ BE ]    │
│    ( 50 m ) ( 100 m ) (■200 m■)      │
│                                      │
│  VÉG ELREJTÉSE             [ BE ]    │
│    ( 50 m ) ( 100 m ) (■200 m■)      │
│                                      │
│           [ Rendben ]                │
└─────────────────────────────────────┘
```

- **Két, egymástól független kapcsoló**: kezdet és vég külön ki-be kapcsolható, külön sugárral.
- **Sugarak: 50 / 100 / 200 m.** *(A referencia-appban volt egy 500 m-es opció is — kihagytam, mert egy 500 m-es levágás egy 3 km-es futásból már a lényeget viszi el. Egy sorral bármikor visszatehető.)*
- **Alapértelmezés: mindkettő BE, 200 m.** Adatvédelem alapból bekapcsolva; aki nyitottabb akar lenni, az tudatosan kapcsolja ki.
- **Kikapcsolható**, mindkettő külön-külön.
- A beállítás később bármikor módosítható a Beállítások → Aktivitás-adatvédelem alatt, **és visszamenőleg érvényes az összes korábbi aktivitásra is** — se a szigorítás, se az enyhítés nem csak az újakra vonatkozik.

### Mit takar el, és mit nem

**Amire kihat** (minden nézőnél, a követőket is beleértve):
- a feed-kártya térképe,
- az aktivitás-részletek térképe és a teljes képernyős nézet,
- az automatikusan generált térkép-előnézeti kép,
- a megosztott/publikus link és a webes megjelenés,
- a GPX/adatexport, amit *más* kap meg,
- az aktivitásból mentett útvonal.

**Amire nem hat ki:**
- a **saját** nézeted — te mindig a teljes nyomvonalat látod, jelöléssel: „ez a szakasz mások elől rejtve",
- a **metrikák**: a távolság, idő, tempó, szintemelkedés **teljes marad**. A levágás csak a térképi geometriát érinti; senki ne veszítsen kilométert az adatvédelemért,
- a **területszámítás**: a foglalás mindig a **teljes** nyomvonalból történik, különben a privát zóna csalási felületté válna (bekapcsolom, és a levágott szakaszon „átugrom" a szabályokat).

### Hogyan vágunk

```
kezdet: a nyomvonal elejéről addig dobjuk a pontokat,
        amíg tartósan el nem hagyják az első pont körüli R sugarú kört
vég:    ugyanez a végponttól visszafelé
```

Körfutásnál a kezdő- és végpont egybeesik, tehát a két levágás ugyanoda esik — a hurok „nyitva marad" a megjelenítésen. **Ez így helyes**: pont ezért nem azonosítható, hogy a kör melyik pontján van a lakás.

**Peremeset:** ha az egész aktivitás a védőkörön belül zajlott (pl. 300 m séta a ház körül), nincs mit mutatni — térkép helyett `Az útvonal rejtve` felirat jelenik meg. A metrikák ilyenkor is látszanak.

### Amit őszintén ki kell mondani

A privát zóna a **nyomvonal végpontjait** védi, nem azt, hogy melyik környéken játszol. A megszerzett terület természeténél fogva látható a térképen — ez minden területfoglalós játék velejárója. Amit a levágás valóban megakadályoz: hogy egy idegen lássa, **melyik ponton, melyik kapualjnál kezdődik és végződik** a futásod. A birtokolt folt egy egész kör; azon belül a rajtpont nem azonosítható.

Ezt az onboarding szövegében is így kell megfogalmazni — nem szabad olyat ígérni, amit a játék működése nem tud tartani.

### Kiegészítő védelmek

- **Fotók EXIF-adatai** feltöltéskor törlődnek (GPS-koordináta, eszközazonosító, pontos időbélyeg).
- **A profil nem mutat lakóhelyet**, csak várost — és az is elrejthető.
- **Nincs élő pozíciómegosztás** V1-ben, tehát nincs valós idejű követhetőség.
- **V1.5 javaslat:** rögzített privát zónák mentett címek köré (otthon, munkahely). Erősebb védelem, mert akkor is véd, ha *átfutsz* a helyen, nem csak ott indulsz. A mostani, végpont-alapú megoldás ezt nem fedi le.

---

## Home

**Fejléc:** GRUNDO logó · keresés · üzenetek · értesítések (számláló pötty).

**Sávok fentről lefelé** (képek #31, #37, #09):
1. **Hitelesítés-banner** (ha nincs verifikálva) — bezárható, de a Beállításokból visszahozható.
2. **Köszöntő sor**: „Szia, {felhasználónév}" egy sorban.
3. **Összegző sáv**: terület · összes GP · aktuális sorozat. A feed vezérlőitől
   külön blokk, világoslila–narancs színátmenettel.
4. **Napi küldetés-kártya** — a [küldetés-ajánló](#küldetések-fül--küldetés-ajánló) legjobb aktuális ajánlata, egy koppintással indítható.
5. **Feed-váltó**: `MINDENKI` / `KÖVETED`. A Mindenki nézeten belül
   `GLOBÁLIS` / `HELYI` földrajzi szűrő és `MA` / `HÉT` / `HÓNAP` /
   `MINDIG` / `EGYEDI` dátumszűrő van. A dátumválasztó az app saját lekerekített
   lenyíló paneljét használja, nem az operációs rendszer alapértelmezett listáját.
   Az egyedi időszak kezdő- és végdátumot kér.
6. **Aktivitás-feed** (végtelen görgetés, oldalanként 15).

### Feed-kártya (képek #09, #14, #15)
- Fejléc: avatar (PRO jelvénnyel) · név · aktivitás-típus ikon · relatív idő · `⋯` menü.
- Cím (pl. „Reggeli futás" — szerkeszthető).
- **Alapértelmezett média**: mindig az útvonalból generált térképkép. Ha saját
  fotók is tartoznak hozzá, a térképkép jobb alsó sarkában kamera-jelvény mutatja
  a számukat (`+1`…`+5`); a képek az aktivitás részletein nyithatók meg.
- **Metrika-sáv**: TÁV · TEMPÓ · IDŐ · SZINT (bringánál tempó helyett átlagsebesség).
- **GRUNDO-sáv** (ez az újdonság a referenciához képest): `+840 000 m² elfoglalva` · `+1 456 GP` · védelmi szint jelölés, ha ismételt kör.
- PR-chipek (400 m, 1 km, 5 km…).
- Lábléc: like (szív + like-olók avatarjai) · komment (szám) · megosztás.
- `⋯` menü idegen posztnál: Némítás · Követés vége · Tiltás · Jelentés (kép #22). Saját posztnál: Szerkesztés · Láthatóság · Törlés.

**Üres feed:** „Még nincs mit mutatni — kövess pár sportolót, vagy nézd a lokális feedet."

---

## Terület

A GRUNDO szíve (képek #49, #21).

- Teljes képernyős Mapbox térkép, sötét stílus.
- Bal felül **`0 m² — A TE TERÜLETED`** chip.
- Középen fent **réteg-váltó**: 🏃 Gyalogos ⇄ 🚴 Kerékpáros. A két réteg teljesen külön világ (külön poligonok, külön ranglista).
- Jobb felül: **ranglista** gomb, alatta **helyzet-központosítás** és **info**.
- **Hexagon-rács** ([lásd 03](03-jatekszabalyok.md)): saját cellák = lila, másé = piros. A szabad cellák hálója csak nagyon halvány tájékozódási réteg, nem fedheti el az utcatérképet. A **védelmi szint** kitöltése: 1× csak körvonal, 2× 15 %, 3× 50 %, 4× 90 %, 5× tömör sötét árnyalat. A 2–5 közötti szám a cella közepén csak olyan közeli zoomszinten jelenik meg, ahol olvasható és nem ér össze a szomszédaival.
- Zoom-függő megjelenítés: utcaszinten egyedi hexagonok, kerületszinten aggregált foltok, városszinten zóna-kontúrok és hőtérkép.
- Zónára koppintva **terület-lap**: tulajdonos · méret (km²) · védelem · leggyengébb pontja · mikor szerezte · hányszor cserélt gazdát · **„Foglald vissza"** gomb → közvetlenül a [küldetés-ajánlóba](#küldetések-fül--küldetés-ajánló), ami útvonalat javasol erre a zónára.
- Üres állapot: „Még nincs területed — zárj be egy kört" + Indítás gomb.

### Ranglista (kép #21)
- **Globális / Lokális** váltó. Lokális = alapból a felhasználó városa; választható: kerület · város · ország.
- **Két fül**: `TERÜLET` és `PONT (GP)` — a heti/havi/össz GP külön szűrővel.
- Sor: helyezés · avatar · név · „N terület" · érték. A saját sor mindig kiemelve és odaugorható.
- Réteg-függő (gyalogos/kerékpáros külön lista).

---

## Aktivitás rögzítése (Tracking)

### Indítás előtt (kép #27)
- Térkép a jelenlegi pozícióval.
- Nagy `0.00 KILOMÉTER` / `00:00` kijelző.
- Metrika-dobozok: tempó · átlagtempó · szint · lépésfrekvencia (bringánál: sebesség · átlagsebesség · szint · pedálfordulat).
- **GPS-jelerősség**: „Erős jel ±10 m" (zöld/sárga/piros). Gyenge jelnél figyelmeztetés indítás előtt.
- **Típusválasztó**: FUTÁS · SÉTA · BRINGA (a futás és séta ugyanabba a `foot`
  rétegbe megy). Indítás előtt a váltás az aktuális térképkivágás celláit is
  azonnal újratölti: Bringa = `bike`, Futás/Séta = `foot`.
- Nagy play gomb + **Mentett útvonalak** gomb.

### Aktív rögzítés (kép #48)
- Élő: távolság, idő, aktuális és átlag tempó/sebesség, szintemelkedés, lépésfrekvencia/pedálfordulat, pulzus (ha van szenzor), teljesítmény (becsült vagy mért).
- **Élő területjelzés**: a nyom hexagonjai világítanak a térképen; amint bezárul egy hurok, a belső cellák azonnal kitöltődnek és megjelenik a szerzett m² + GP. Bezárás előtt: „Zárd be: még 120 m".
- A rögzítés térképe ugyanazt a saját/rivális/szabad mezőképet és ugyanazokat a védettségi szinteket mutatja, mint a Grund oldal. A nézet frissítése alatt a legutóbbi pillanatkép marad látható; a mezők nem villoghatnak ki.
- A teljes mezőréteget egy fekete, üres hatszög ikonos gomb kapcsolja ki és be. A gomb a jobb alsó térképvezérlő-oszlopban, a 2D/3D váltóval azonos 40×40 px méretben jelenik meg. A megjegyzett 3D nézet már a térkép első betöltésekor érvényesül; az ikon és a tényleges kameradőlés nem térhet el. A kiválasztott küldetés vezetővonala szaggatott `#FA5F73`.
- Az élő előnézetben a szabadon megszerzett és megerősített mező lila, az idegentől elrabolt mező `#FA5F73`. Mindkettő az 1–5 védelmi szint szerinti telítettséget és közeli zoomnál a várható szint számát mutatja.
- Gombok: szünet · **stop** · kamera.
- Automatikus szünet (opcionális, sebességküszöb alatt).
- Hangos/rezgő visszajelzés: kilométerenként, kör bezárásakor, területlopáskor.
- **Háttérben futás**: „Allow all the time" helyengedély kell (kép #11) — ha nincs, figyelmeztetés, de a rögzítés folytatható képernyő-ébren.
- **Élő rendszerértesítés** a lezárt képernyőn is (kép #03) — kikapcsolható a Beállításokban („Live Stats in Notification").

### Szüneteltetve (kép #03)
- Folytatás · stop · fotó. Az értesítés is jelzi: „Szüneteltetve — koppints a visszatéréshez".

### Leállítás és mentés
- **100 m alatt nem menthető** (kép #45): „Az aktivitás 100 m alatti — nem mentjük". Elvethető vagy folytatható.
- Mentés képernyő (nincs a képek közt, meg kell tervezni):
  - automatikus cím („Reggeli futás") — szerkeszthető,
  - leírás, fotók hozzáadása,
  - **eredmény-panel**: bezárult-e a kör, mennyi terület, kitől vettél el, hány GP, streak-állapot,
  - láthatóság (Mindenki / Követők / Csak én),
  - felszerelés hozzárendelése (cipő/bringa),
  - „Ez egy verseny/edzés volt" jelölés (opcionális).
- **Offline mentés**: nyomvonal helyben tárolva, feltöltés amint van net. A területszámítás mindig szerveroldalon fut.
- **A rögzítés közbeni térkép pillanatkép.** Nem frissítjük valós időben a birtokviszonyokat. A végleges foglalás a mentéskor aktuális térképállapotból számolódik; konkurens foglalásnál az első sikeres adatbázis-commit nyer.
- **Eszközök közötti utolsó állapot.** Aktív rögzítéskor a kliens 15
  másodpercenként tömör, privát pillanatképet ír. Egy másik eszköz (például a
  PC) a saját helyi rögzítés hiányában ezt az utoljára látott mobilos nyomot,
  távolságot és állapotot mutatja, a frissítés idejével együtt. Ez megjelenítési
  szinkron, nem távoli vezérlés és nem módosít területet.

---

## Aktivitás részletek

A legrészletesebben dokumentált felület (képek #10, #20, #26, #28, #42, #39).

- **Térkép** a nyomvonallal, tempó szerinti színátmenettel; teljes képernyős
  módban a térkép és a Mapbox-vászon is a teljes viewportot tölti ki (kép #39).
- Az adatlap megnyitásakor az alsó Dock teljesen eltűnik; a vissza gomb az
  adatlap saját navigációja.
- Fejléc: avatar · dátum · időjárás (☀️ 18°C).
- Cím + leírás.
- Saját aktivitásnál **Szerkesztés**: cím és leírás módosítása, legfeljebb öt
  fotó hozzáadása vagy eltávolítása, szaggatott `+` képkártyával. Ha egy régi
  aktivitásnak még nincs nyilvános térképes útvonala, az első szerkesztéskor a
  backend a privát nyomból, a privát zóna alkalmazása után létrehozza.
- A feltöltött fotók beépített, lapozható lightboxban nyílnak meg. Balra/jobbra
  húzással vagy nyílgombbal lapozhatók, lefelé húzással, `X`-szel vagy Escape
  billentyűvel bezárhatók; nem nyitnak új böngészőlapot. A kép kétujjas
  csippentéssel, egérgörgővel vagy a beépített `− / +` vezérlőkkel 1–4× között
  nagyítható, nagyított állapotban húzással mozgatható. A bal felső képszámláló
  felirata és száma függőlegesen középre igazított.
- **STATS rács**: km · átlagtempó · idő · szintemelkedés · kalória · átlagpulzus.
- **GRUNDO panel** (új): elfoglalt terület · elvett terület kitől · védelmi szint · szerzett GP bontásban.
- Rögzítő eszköz neve („iPhone 13 Pro", „Garmin Forerunner 265").
- Like / komment sáv.
- A hozzászólások beszélgetésszerű alsó panelen jelennek meg. A saját komment
  profilképe jobb oldalon, a buborék tőle balra van; a törlés `X` gombja a
  buborékon belül marad. Az elküldött komment optimista sora rögtön a valódi
  profilnevet és profilképet mutatja, újranyitás nélkül.
- **Grafikonok** (mind koppintásra scrub-olható):
  - TEMPÓ + átlagtempó, időtartam, leggyorsabb kör, átlag lépésfrekvencia,
  - TELJESÍTMÉNY (becsült vagy mért): átlag W, max W, összmunka kJ,
  - LÉPÉSFREKVENCIA / PEDÁLFORDULAT,
  - SZINTPROFIL: emelkedés, csökkenés, max magasság,
  - PULZUS (ha van),
  - **TEMPÓZÓNÁK**: Könnyű / Maraton / Küszöb / Intervall / Ismétlés, idővel és sávdiagrammal.
- **RÉSZIDŐK (km-enként)**: sorszám · idő · tempó · szintkülönbség; a leggyorsabb kör kiemelve.
- `⋯`: Megosztás · Jelentés (idegen) / Szerkesztés · Törlés (saját).
- A saját törlés 30 napos soft-delete: a tartalom azonnal eltűnik, de a már
  kiosztott GP és a globális területállapot nem fordul vissza. Játékadat-
  korrekciót csak az auditált admin/moderációs folyamat végezhet.

> A tempó, teljesítmény, pedálfordulat, pulzus **csak akkor valós**, ha csatlakoztatott eszköz szolgáltatja. Telefonból: távolság, idő, tempó, szint (barométer), lépésfrekvencia (gyorsulásmérő), becsült teljesítmény (súly + tempó + emelkedés modellből), becsült kalória.

---

## Közösség

### Felfedezés (képek #07, #35)
- Aktivitás-feed nem követett felhasználóktól (lokális + népszerű).
- Kereső: emberek / klubok szűrővel, javaslatok („közös ismerős").
- Követés gomb inline. Privát fióknál „Kérés küldése".

### Klubok (kép #30)
- Publikus klubok keresése.
- **Saját klubjaim** lista (szerep-jelvénnyel: ADMIN/TAG).
- **Csatlakozás meghívókóddal** (8 karakteres kód, privát klubokhoz).
- `+ Létrehozás` **[Pro]**: név · leírás · borítókép · publikus/privát · város.
- Klub-részletek (új képernyő): tagok · klub-feed · klub-ranglista (terület és GP) · beállítások (admin) · csatlakozási kérések kezelése · meghívó kód újragenerálása.
- Szerepek: tulajdonos > admin > tag. Tulajdonos átruházható.

### Kihívások (kép #36)
- Időszakos, admin által létrehozott feladatok. Típusok:
  - **Távolság** (pl. „Fuss 100 km ebben a hónapban"),
  - **Terület** (pl. „Foglalj el 2 000 000 m²-t"),
  - **Lopás** (pl. „Vegyél el 5 zónát"),
  - **Sorozat** (pl. „14 aktív nap"),
  - **Felfedezés** (pl. „3 új kerületben zárj kört").
- Kártya: ikon · név · időszak · haladásjelző · résztvevők száma · jutalom (GP + jelvény).
- Csatlakozás egy koppintással; a haladás automatikus.
- Üres állapot: „Jelenleg nincs aktív kihívás."

### Útlevél (kép #17)
- `0 / 242 ország`, százalék, zászlórács.
- Egy ország akkor oldódik fel, ha ott **elmentett aktivitás** van (fordított geokódolás a nyomvonal első pontjára).
- Ország-lap: mikor, hány aktivitás, mennyi terület ott.

---

## Profil

### Profil fül (kép #04)
- Avatar (PRO jelvénnyel), név, `@felhasznalonev`, `Szerkesztés`.
- **Szint-chip** (pl. ROOKIE III.) + **terület-chip** (km²) + **GP-chip**.
- **Két haladásjelző**: felül a GP-szint, alatta a távolság-jelvény (`38,4 / 50 km`).
- Számlálók: Aktivitások · Követők · Követettek (kattintható listák).
- **Streak-kártya** (napi + heti sorozat) és **szint-kártya**.
- **EZ A HÉT**: napi oszlopdiagram (H–V) + heti összeg.
- Összes távolság · átlagtempó.
- Idegen profilnál: Követés / Kérés · Üzenet · `⋯` (némítás, tiltás, jelentés). Privát fióknál csak a fejléc látszik.

### Profil-navigáció *(döntés: 2026-08-23)*

A saját profil felső fülei ebben a rögzített sorrendben: **Profil · Statisztika · Küldetések · Riválisok · Klánok · Badgek**. A Küldetések, Riválisok és Badgek már működő tartalom; a Statisztika és Klánok fül a navigáció stabil helyét most megkapja, a részletes funkció későbbi fázisban készül el. A „Profilom” fejléc, a beállítások gomb és a fülsor görgetés közben a képernyő tetején marad. A fülsor háttér nélküli, halvány alsó elválasztót és az aktív fül alatt gradiens jelölést használ. Kis kijelzőn vízszintesen görgethető: érintéssel swipe, asztali gépen egérrel fogd‑és‑húzd gesztus működik; a feliratok nem törnek több sorba.

### Riválisok *(döntés: 2026-08-22)*

Ha valaki elvesz területet valakitől, a kettejük kapcsolata **rivális** lesz — ez nem kérés/elfogadás kérdése, mint a követés, hanem MEGTÖRTÉNIK, a lopás pillanatában. A rangsor alapja a **kicserélt mezők száma** (szerzett + vesztett): „ha valaki 1×10 cellát lopott, az ugyanannyit ér, mint 10×1". Az áttörés (megvédett támadás) nem hoz létre rivalitást, mert egy mező sem cserélt gazdát.

- **Profil fülön** egy szekció mutatja a TOP 3 riválist (eltűnik, ha nincs egy sem); az **önálló Riválisok fülön** van a teljes, kliensoldalon kereshető lista (max 200 elem betöltve). Mindkét lista soronként mutatja az összecsapások számát (`N×`), az összes gazdát cserélt területet km²-ben, valamint a szerzett és vesztett mezők bontását.
- A név mellett **mindenhol** (feed, hozzászólás, aktivitás-részletek, keresés, követő-lista, terület-tulajdonos kártya, ranglista, nyilvános profil) egy **„RIVÁLIS" címke** jelenik meg (`#FC5F71` háttér, fekete szöveg), témafüggetlen.
- Ha egy rivális támad, az értesítés külön hangot kap: „Egy riválisod megtámadta a grundod!", km²-ben és mezőben is mutatva a veszteséget. Az első összecsapás még semleges hangot kap.
- Más felhasználó rivális-listája **nem publikus** — megmutatná, kitől szokott veszíteni.
- A tiltás elrejti, nem törli a rivális-rekordot (feloldás után visszaáll).

Adatmodell: `users/{uid}/rivals/{otherUid}`, két tükör-dokumentum lopásonként. Lásd [server/src/lib/rivals.ts](../server/src/lib/rivals.ts) fejlécét a részletes indoklásért (miért nincs `firstAt` mező, miért olvasáskor szűr a tiltás).

### Statisztikák fül (képek #05, #06)
- Aktivitástípus-váltó (futás / séta / bringa).
- **Legjobb eredmények**: 400 m, 800 m, 1 km, 1 mérföld, 5 km, 10 km, félmaraton, maraton.
- **Mindenkori**: távolság · aktivitások · idő · szint · átlagsebesség/tempó · leghosszabb.
- **Tempózónák** megoszlás.
- **Versenyidő-becslés** (Riegel-képlet, csak futásra).
- **Minden aktivitás / Regeneráció**: „Jól regenerálódtál — mehet a kemény edzés", aktív napok, heti táv, egymást követő napok.
- **GRUNDO-blokk** (új): összes elfoglalt terület, összes elvett/elvesztett zóna, leghosszabb birtoklás, összes GP forrásonként.

### Küldetések fül — **Küldetés-ajánló** (képek #33, #18) `[Pro: korlátlan · Ingyenes: heti 5]`

*(döntés: 2026-08-15)* — Ez nem útvonaltervező, hanem **terület-ajánló motor**. A referencia-app „fuss 8 km-t" logikája bármelyik futóappban megvan; a GRUNDO-ban az útvonalnak **játékbeli tétje** van, és ezt kell kimondani.

**A bemenet idő vagy távolság:**

> „Mennyi időd van?" — 15 / 30 / 45 / 60 perc vagy egyedi perc/óra; **vagy** közvetlen célhossz km-ben. Mindkettőhöz típusválasztó (futás / séta / bringa) tartozik.

Időalapú tervezésnél a távot a rendszer a felhasználó **saját átlagtempójából** számolja (új felhasználónál típus szerinti alapérték). A felhasználó ezt az adott küldetéshez felülírhatja perc/km, bringánál km/h értékkel. Távolságalapú tervezésnél a km a célhossz, az idő csak becslés.

Opcionális finomhangolás: elsődleges cél (`legjobb ajánlat` · `új terület` · `rablás` · `grund erősítése` · `felfedezés`) és égtáj. A cél a találatok sorrendjét, az égtáj a körjelöltek vizsgálati sorrendjét adja; egyik sem ígér eredményt, ha a valós úthálózat vagy birtokviszony nem ad megfelelő kört.

**A kimenet normál esetben 3–4 küldetés-kártya**, mind más karakterrel. Fölösleges oda-vissza mellékutcai kitérőt tartalmazó jelölt nem ajánlható; ha emiatt kevesebb tiszta kör marad, a minőség elsőbbséget élvez a darabszámmal szemben.

| Típus | Példa szöveg |
|---|---|
| 🟠 **Hódítás** | „Van 45 perced? Mutatok egy útvonalat, amivel megszerezhetsz **64 000 m²** új területet." |
| 🔴 **Rajtaütés** | „Ha erre mész, **elvehetsz 18 000 m²-t Geritől.**" |
| 🔵 **Erősítés** | „30 perc, és a gazdagréti zónád védelme **1× → 3×** lesz." |
| 🟢 **Felfedezés** | „8 km, 3 új kerület, amiben még sosem jártál. **+2 800 GP.**" |

Minden kártyán: térkép-előnézet a javasolt körrel és a megszerezhető cellák kiemelésével · idő · táv · szintemelkedés · **becsült GP** · a megcélzott terület mérete m²-ben.

Gombok: `Indítás most` (egyenesen a trackingbe, az útvonal navigációként a térképen) · `Mentés` · `Újragenerálás`.
Szűrők megmaradnak: kevés útkereszteződés · zöldterület · lapos terep.

**Hogyan számol:**

```
1. Kör-jelöltek generálása a jelenlegi pozíció körül (út-gráf, célhossz ±15 %, 8 irányban)
2. Minden jelöltre: a bezáruló cellahalmaz kiszámítása (ugyanaz a flood fill, mint élesben)
3. Értékelés a JELENLEGI birtokviszonyok ellen:
     szabad cellák          → új terület
     idegen, védelem 1      → lopható
     idegen, védelem ≥2     → áttörés kell
     saját cellák           → védelemnövelés
4. Becsült GP a 04. fejezet képletével
5. Kiválasztás: típusonként a legjobb, hogy 3 ÉRDEMBEN KÜLÖNBÖZŐ ajánlat legyen
```

**Adatvédelmi korlát:** a *„…-tól/-től"* megnevezés csak akkor jelenik meg névvel, ha a célszemély fiókja **publikus**. Privát fióknál a szöveg: „elvehetsz 18 000 m²-t egy helyi játékostól". A terület tulajdonosa amúgy is látszik a térképen, de a küldetés nem lehet célzott zaklatási eszköz — ezért nincs „kövesd X-et" jellegű ajánlat, és ugyanaz a személy naponta legfeljebb egyszer jelenik meg célpontként.

**Home-integráció:** a legjobb ajánlat **napi küldetés-kártyaként** megjelenik a Home tetején is („A mai küldetésed"), egy koppintással indítható. Ez a legerősebb visszahívó elem az egész appban — nem általános biztatás, hanem konkrét, helyi, mérhető tét.

**Mentett küldetések** listája a Profil › Küldetések fülön él, és indítás előtt közvetlenül a Trackingből is megnyitható (kép #27 „Mentett útvonalak" gomb). A mentett számok generáláskori pillanatképek; indításkor a szerver a friss birtokviszonyból számol.

### Edzés fül (képek #16, #40) `[Pro]`
- Regeneráció-kártya.
- **Terveim / Böngészés**.
- Katalógus: Couch to 5K (6 hét, 3×/hét, kezdő) · 10K haladó (8 hét) · 15K kihívás (10 hét) · Félmaraton (12 hét) · Maraton (18 hét) · 50K ultra (20 hét).
- Aktív terv: „1. hét / 6", `0/15 edzés`, `0% kész`, napi bontás, edzés kipipálása automatikusan a rögzített aktivitásból.

### Jelvények fül (kép #12)
Lásd [04 — Pontrendszer](04-pontrendszer.md#jelvények). Üres állapot: „Még nincs jelvényed."

---

## Üzenetek és értesítések

- **Üzenetek** (kép #19): beszélgetéslista, új üzenet, üres állapot. 1:1 chat V1-ben; csoportchat V1.5.
  - Csak követett/kölcsönösen követő felhasználó írhat alapból (beállításban lazítható).
- **Értesítések** (kép #32): in-app lista típus-ikonnal, olvasott/olvasatlan, koppintásra a célképernyőre.

### Értesítések

**Push-események** (kép #34, #23) — mind külön kapcsolható:

| Esemény | Alap | Megjegyzés |
|---|---|---|
| **Területedet elvették** | BE | *(döntés: 2026-08-15)* **Minden támadásról megy push**, nincs napi plafon. Az esemény egysége a **támadás**, nem a cella: ha valaki egyetlen futással 400 celládat viszi el, az **egy** értesítés („Maya átvágta a területed — –21 400 m², Gazdagrét"). |
| **Területet szereztél vissza** | BE | |
| **Megvédted a területed** | BE | Ha a védelem áttörés nélkül tartott: „Sikertelen támadás — a védelmed 3× → 2×" |
| Egyéni rekord (PR) | BE | |
| Like az aktivitásodon | BE | 30 percenként összevonva |
| Komment az aktivitásodon | BE | |
| Említés (@) | BE | |
| Új követő | BE | |
| Követési kérés | BE | |
| Új üzenet | BE | |
| **Streak-emlékeztető** | BE | Este 18:00 helyi idő, ha aznap nincs aktivitás és él a sorozat |
| Megosztott útvonal | BE | |
| Cipő futásteljesítmény elérve | BE | |
| Klub: csatlakozási kérés / jóváhagyás / admin-kinevezés / meghívó | BE | |
| Kihívás indul / véget ér / helyezés-változás | BE | |
| **Napi pont-összegzés** | BE | Este: megszerzett GP, tartott terület bónusz |

**Tracking:** „Élő adatok az értesítésben" kapcsoló.

> **Miért nincs plafon a területvesztésen:** ez a játék legfontosabb visszahívó jelzése — a bosszú a motiváció. A spam-kockázatot nem plafonnal kezeljük, hanem azzal, hogy **egy támadás = egy értesítés**, és a kapcsoló egyetlen koppintással kikapcsolható. Ha az adat mégis azt mutatja, hogy ez lemorzsolódást okoz, a plafon utólag bevezethető az `appConfig`-ból.
**E-mailek:** hitelesítés visszajelzés + marketing e-mailek (alapból KI).

---

## Beállítások

### Megjelenés *(döntés: 2026-08-15)*

A GRUNDO-nak **világos és sötét témája** is van, és az **alapértelmezett a világos**. Ez tudatos eltérés a referencia-apptól: az napszaktól függetlenül sötét volt, ami nappal, tűző napon a leggyakoribb használati helyzetben rosszul olvasható.

**Négy mód, a felhasználó választ:**

| Mód | Viselkedés |
|---|---|
| **Automatikus** *(alapértelmezett)* | Nappal világos, este sötét |
| Világos | Mindig világos |
| Sötét | Mindig sötét |
| Rendszer szerint | A telefon beállítását követi |

> A kifejezett választás (Világos / Sötét) **mindig felülírja** az automatikát. A telefon beállítását csak a „Rendszer szerint" mód követi — az „Automatikus" a napszakot nézi, nem az OS-t.

**Az automatikus váltás beállítható:**

- **Napnyugta szerint** *(alapértelmezett)* — a valódi napkelte/napnyugta a pozíciód alapján. Ezt helyben számoljuk, külső szolgáltatás nélkül; a nyáron 21 óráig világos este így nem vált idő előtt sötétre.
- **Fix időpontok** — pl. 20:00-tól 06:30-ig sötét, mindkét érték állítható. Ez a tartalék, ha nincs helyengedély, és ez fut a sarkkörön túl is, ahol nincs minden nap napkelte.

**Két viselkedési szabály, ami nem beállítás, hanem tervezési döntés:**

1. **Rögzítés közben nem váltunk témát.** Ha futás közben lemegy a nap, a téma csak a mentés után vált. A térképstílus cseréje félbeszakítaná a megjelenítést és újratöltené a Mapbox stílust — futás közben ez elfogadhatatlan.
2. **Nincs villanás induláskor.** A téma az első kirajzolás előtt eldől (az `index.html` inline szkriptje), tehát sötét módban sem villan fel egy pillanatra a világos felület.

### Preferenciák (kép #38):
- Kommentek engedélyezése a saját aktivitásokon.
- Mértékegységek: KM/MI · KG/LBS · CM/FT+IN.
- **Fiók-adatvédelem**: Publikus / Privát.
- **Alapértelmezett aktivitás-láthatóság**: Mindenki / Követők / Csak én.

**Aktivitás-adatvédelem** (kép #02) — a [Privát zóna](#privát-zóna) teljes vezérlője, ugyanaz a felület, mint az onboardingban.

**Közösségi** (kép #43): Követési kérések · Tiltott felhasználók · Némított felhasználók.

**Test és fitnesz** (kép #43): testsúly · magasság · születési dátum (+kor) · testsúly automatikus szinkron · „Frissítés Apple Health-ből" (pulzus, VO2max, testsúly).

**Fiók** (kép #08): Értesítés-beállítások · Analitika · Felszerelés · Csatlakoztatott appok · Előfizetés kezelése · Kijelentkezés.

**Jogi:** ÁSZF · Adatvédelmi tájékoztató · **Fiók törlése** (30 napos visszavonható türelmi idő, utána teljes anonimizálás; a területek felszabadulnak).

---

## Felszerelés (kép #46)

- `+ Hozzáadás`: név · típus (CIPŐ / EGYÉB) · cél-távolság (km).
- Automatikus km-gyűjtés a hozzárendelt aktivitásokból; értesítés a cél elérésekor; nyugdíjazás.
- **Ingyenes: 3 aktív · [Pro]: korlátlan.**

## Csatlakoztatott appok (képek #13, #01)

| Szolgáltatás | V1 | Irány |
|---|---|---|
| **Apple Health** | ✅ | oda-vissza: import (háttérben is) + export, korábbi aktivitások importja |
| **Health Connect** (Android) | ✅ | ugyanaz Androidon |
| **Garmin** | „Hamarosan" | Garmin Connect Health API (partner-jóváhagyás kell — hosszú átfutás, ezért V1.5) |
| **Wahoo** | ✅ | OAuth2 + webhook, import |
| **Polar** | ✅ | AccessLink, **csak a csatlakozás utáni** aktivitások |
| **Hammerhead** | ✅ | Karoo, import |

- Kártyánként: állapot (CSATLAKOZTATVA / KI / HAMAROSAN), import/export kapcsolók, „Korábbi aktivitások importálása", Leválasztás.
- **Importált aktivitás is foglalhat területet** — de kötelezően átmegy az anti-cheat ellenőrzésen ([03](03-jatekszabalyok.md#anti-cheat)), és jelölve van a forrás.
- Token-tárolás: **Secret Manager**, soha nem Firestore-ban.

## Előfizetés (kép #25)

**Ingyenes:** tracking · területfoglalás · versengés · ranglisták · feed · **lokális hírfolyam** · klub-tagság · alapstatisztikák.

> A **lokális feed tudatosan ingyenes** *(döntés: 2026-08-15)*. Ez az a felület, ahol az új felhasználó megérti, hogy a szomszédjában is játszanak — ha ezt fizetőfal mögé tesszük, pont a hálózati hatást fojtjuk el ott, ahol a legtörékenyebb.

**Pro:**
- ✓ Korlátlan útvonalgenerálás *(Ingyenes: heti 5)*
- ✓ Klubok létrehozása
- ✓ Edzéstervek
- ✓ Szegmensek létrehozása
- ✓ Korlátlan felszereléskövetés *(Ingyenes: 3 aktív)*
- ✓ Mások teljes aktivitás-előzménye *(Ingyenes: utolsó 30)*
- ✓ Korai hozzáférés az új funkciókhoz
- ✓ PRO profil-jelvény

**Árak:** 4,99 €/hó (7 napos ingyenes próba) · 39,99 €/év (–33%).
**Kezelés:** aktív csomag, váltás havi ⇄ éves, lemondás. A tényleges számlázás App Store / Play Billing; szerveroldalon a store-értesítéseket (S2S notification) dolgozzuk fel, a `subscriptions/{uid}` dokumentum a hiteles állapot.

> **Fontos elv:** a Pro **nem ad játékbeli előnyt** — se több pontot, se erősebb védelmet. Csak kényelmi és közösségi funkciókat. Ez tartja tisztán a ranglistát.

---

## Moderáció és biztonság

### Jelentés

Jelenthető: aktivitás (kép #24), felhasználó, komment, klub. Kategória + szabad szöveges megjegyzés.

**Kategóriák** *(döntés: 2026-08-15)*:

| Kategória | Ág | Mi történik |
|---|---|---|
| 🛰️ **GPS-manipuláció** | technikai | A [Trust Score](03-jatekszabalyok.md#trust-score--aktivitás-hitelesség) 7. jelébe folyik be. Több független bejelentésnél az aktivitás `pending_review`-ra vált, és a birtokviszony-változás **visszavonásra kerül** a döntésig. |
| 🚗 **Autó / jármű használata** | technikai | Ugyanaz az ág; a moderátor felületén automatikusan megjelenik a sebesség-, gyorsulás- és szenzor-konzisztencia elemzés, hogy egy pillantással dönthessen. |
| 📏 **Hibás mérés / rossz típus** | technikai | Pl. kerékpárral rögzített „futás". Enyhébb eset: nem csalás, hanem hiba. Első körben **a felhasználó kap egy javítási lehetőséget** („Ez bringa volt? Átsorolod?"); csak elutasítás után megy moderátorhoz. Az átsorolás a másik rétegbe helyezi a területet. |
| 🚫 **Sértő tartalom** | tartalmi | Cím, leírás, fotó, komment, felhasználónév, klubnév. |
| 🔒 **Adatvédelem** | tartalmi | Más személy azonosítható megjelenítése hozzájárulás nélkül, lakcím felfedése, más nevében fellépés. **Priorizált sor**, rövidebb SLA. |
| ❓ **Egyéb** | vegyes | Szabad szöveg kötelező. |

A **technikai** kategóriák a Trust Score rendszerbe és az aktivitás-moderációba futnak; a **tartalmi** kategóriák a tartalom-moderációs sorba. A moderátori felület a kategóriától függően más eszközkészletet mutat ([06](06-architektura-es-admin.md#5-moderáció)).

**Visszaélés-védelem:** a bejelentő hitelessége súlyozott (aki sorozatosan megalapozatlanul jelent, annak a szava egyre kevesebbet ér); ugyanaz a felhasználó ugyanazt a célpontot naponta egyszer jelentheti; a bejelentő mindig kap visszajelzést a döntésről.

### Egyéb eszközök
- **Tiltás**: kölcsönös láthatatlanság, meglévő követések bontása.
- **Némítás**: a feedből eltűnik, de követés marad.
- Jelentések az admin moderációs sorába kerülnek ([06](06-architektura-es-admin.md#moderáció)).
- Automatikus tartalomszűrés a kommentekre (szólista + rate limit).

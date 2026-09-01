# GRUNDO handoff

> Frissítve: **2026-09-01** · a **#23** beszélgetés vége, átadás **#24**-re
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · GitHub: `gerisann/grundo`
>
> Ág: **`main`**. A menet induló HEAD-je **`1d57d61`** volt.

## ÁLLAPOT

A menet a délutáni terepteszt felkészítése volt: **hang- és látványvisszajelzés
rögzítés közben**, **saját cellaszínek a rögzítés képernyőn**, **teljes
szélességű admin**, **LAB E2E paritás**, plusz a rögzítés-modell átnézéséből
származó öt önálló javítás.

Minden élőben, a helyi emulátoros környezetben ellenőrizve
(`localhost:5173` + Firestore/Auth emulátor + backend), a LAB E2E-ben 1×,
100× és MAX sebességen is.

### 1. Hangeffektek (ÚJ)

Hét MP3 a `public/sounds/` alatt. A lejátszó `lib/sound.ts`: `<audio>`-elem
poolok, hangonkénti alaperősítés, felhasználói gesztusból feloldott hangzár.

| Esemény | Hang | Mikor |
|---|---|---|
| Visszaszámlálás | `count-down-beep` | a 3, a 2 és az 1 MEGJELENÉSEKOR |
| Rajt | `count-down-start` | a „RAJT!" felirattal egyszerre |
| Új mezőre lépés — szabad | `cell-captured` | valós időben, minden új H3 cellánál |
| Új mezőre lépés — saját | `cell-defend` | ha a védelem még emelhető |
| Új mezőre lépés — saját, maxon | `cell-max` | ha már az 5-ös szinten áll |
| Új mezőre lépés — riválisé | `cell-stolen` | bármilyen védelmi szinten |
| Hurokbezárás | `loop-closed` | a felugró üzenettel egyszerre |

⚠️ **A cellahangok VALÓS IDEJŰEK, nem a bezáráshoz tartoznak.** Ez a menet
közben derült ki (Geri kétszer is pontosított): a hang akkor szól, amikor a
futó ténylegesen rálép egy új mezőre, és azt mondja meg, MIRE lépett rá —
nem azt, hogy a bezárás végül mit írt jóvá. Mérve, 1×-es LAB-futáson:
15 koppanás 35 másodperc alatt, átlagosan 2,5 másodpercenként. Ez a valós
cellaváltás üteme; a burst-korlát (`CELL_STEP_BURST_CAP = 5`) csak a natív
ébredés / visszaállítás okozta kötegeket fogja meg.

A `cell-max.mp3`-at Geri mellékelte, de az esemény-listában nem nevezte meg.
**Feltételezéssel kötöttem be**: a saját, MÁR maximumon (5) álló mezőre lépés
hangja — ez az egyetlen eset, ami a felsoroltakból kimaradt. Egy sorban
átállítható (`lib/cellStepSound.ts`).

Beállítás: **Beállítások → Hangok** (ÚJ oldal). Fő kapcsoló, hangerő-csúszka,
három csatorna (Indítás / Területszerzés / Mezők) külön kapcsolóval, és
minden hanghoz **meghallgatás-gomb** — ez egyben a böngésző hangzárját is
feloldja. A beállítás `localStorage`-ban, eszközhöz kötve él, mint a
befejezés-gesztus.

### 2. Területszerzés-üzenet konfettivel (ÚJ)

Hurokbezáráskor felugró kártya a térkép fölött:

- **„Grund megszerezve!"** — ha csak szabad mező került be
- **„Grund elfoglalva!"** — ha bármit elvettél valakitől (a lopás az erősebb hír)
- **„Grund megerősítve!"** — harmadik eset, amit a kérés nem nevesített, de a
  játék előállítja: a bezárás ugyanazt a saját területet kerítette be újra
- Alatta: `0,102 km² · 333 cella` (a `formatArea()`-n át, a 9. szabály szerint)
- Öt másodperc, utána magától eltűnik; ✕-szel bármikor bezárható
- Mögötte konfetti + két tűzijáték-robbanás, tiszta CSS-ből (`transform` és
  `opacity` — kompozitor, nem a fő szál). A felhasználó választott
  cellaszíne is bekerül a konfetti palettájába.
- `prefers-reduced-motion` mellett a darabkák létre sem jönnek

Kapcsoló: **Beállítások → Megjelenés → Rögzítés közben → Területszerzés-üzenet**.

⚠️ **A hamis riasztás elleni védelem a lényeg** (`lib/captureEvents.ts`): az
élő előnézet nem csak új GPS-pontra fut le újra, hanem minden `/api/tiles`
válaszra is, és olyankor egy cella sorsa visszamenőleg megváltozhat. Ezért az
esemény kapuja a BEZÁRÁSOK SZÁMA, nem az állapotkülönbség — enélkül egy
hálózati válasz hangot és konfettit szórna a semmiért. Tesztekkel rögzítve.

### 3. Saját cellaszínek a rögzítés képernyőn

Az élő előnézet mezői (`preview.own`, `preview.stolen`) mostantól viszik az
`owner` mezőt, és az `ownerColors` táblába bekerül a saját profil színe is —
a `/api/tiles` ugyanis csak azokat a felhasználókat adja vissza, akiknek a
látott szakaszon már VAN cellájuk, a frissen foglalt előnézeti mezők tehát
sehol nem szerepeltek. Élőben ellenőrizve: a Megjelenés alatt olívazöldre
váltva a rögzítés térképe azonnal olívazölden rajzolta a megszerzett
területet (előtte az általános szerep-lila volt).

### 4. `/admin` teljes szélesség

Az `app-shell` 480 pixeles mobil oszlopa `/admin` alatt megszűnik
(`app-shell--wide`). A rögzítés képernyője ez alól KIVÉTEL marad (`position:
fixed` + saját `max-width`), tehát a LAB E2E továbbra is telefonos
elrendezésben mutatja azt, amit a felhasználó lát.

### 5. LAB E2E paritás

- A sandbox `/api/tiles` válasza mostantól ad **`ownerColors`-t**: a saját
  szín a valódi profilból, a többi játékosé a szabad palettából,
  determinisztikusan. Enélkül a LAB minden játékost az alapértelmezett
  palettaszínnel rajzolt, és a színekre vonatkozó változtatásokat nem
  lehetett volna itt tesztelni.
- ⚠️ **Talált hiba, javítva:** a tile-bridge csak az `api.tiles`-t
  irányította át, az `api.territoryBlobs`-ot nem — a LAB térképére így az
  ÉLES világ birtokviszonya rajzolódott a sandbox cellái alá, valódi
  felhasználók adatával. A bridge mostantól mindkét olvasást átveszi, a
  foltokat a sandbox a saját nézetbeli celláiból számolja.
- A hangok és a felugró üzenet automatikusan megjelennek a LAB-ban, mert az
  a production `TrackingScreen`-t és `Dock`-ot futtatja.

### 6. Dokk-gombok egyforma szélessége (Geri jelezte menet közben)

Az „Új kör" és a „Befejezés" nem volt egyforma széles. **Mérve: 177,5 vs
153,5 px.** Ok: a `flex: 1` `flex-basis: 0%`-ot jelent, ami `box-sizing:
border-box` mellett a KERETDOBOZT nullázza — a böngésző ezt a bélésre +
keretre kerekíti fel. Az „Új kör" gombnak `padding: 0 12px` van, a húzásos
„Befejezés" sávnak nulla (a tartalma abszolút pozicionált), tehát a két
alap 26 és 2 pixel volt, és a maradék helyet EHHEZ adta hozzá a flex — a
különbség pontosan a 24 pixeles béléskülönbség.

Javítás: a vezérlősáv `grid`-re váltott, `1fr auto 1fr` oszlopokkal és
KIFEJTETT `justify-items: stretch`-csel (a `normal` alapérték `<button>`-nél
`start`-ként viselkedik — e nélkül a bal gomb 63,7 px lett egy 165,5 px-es
oszlopban). Mérve utána: **165,5 = 165,5 px**, mindkét befejezés-gesztussal.

### 7. A rögzítés-modell átnézése — öt javítás

Ezek a „hol lehet még benne hiba / GPS / erőforrás" kérdésre születtek:

1. **`browserSource.ts` — őrkutya a néma `watchPosition`-re.** iOS Safariban
   (és energiatakarékos Androidon) a figyelés előtérbe visszatérés után némán
   halott maradhat: se minta, se hibaesemény. A rögzítés a felületen „fut", a
   nyomvonal viszont nem nő, és ez csak a mentésnél derül ki. Mostantól ha 45
   másodpercig SEMMI nem jön (a hiba is életjel!), a figyelés újraindul;
   előtérbe visszatéréskor azonnal ellenőrzünk. Rejtett lapon sosem indítunk
   újra. Tiszta függvény + hat teszt.
2. **`wakeLock.ts` + `useRecorder.ts` — a képernyőzár állapota élővé vált.**
   Eddig a React-állapot EGYSZER, a megszerzés pillanatában íródott be, holott
   a böngésző háttérbe kerüléskor magától elengedi a zárat. A rögzítés
   képernyője tehát a futás végéig az első másodperc állapotát mutatta — „a
   képernyőt ébren tartjuk" akkor is, amikor már nem. Visszahívás + a sentinel
   `release` eseményének figyelése.
3. **`nativeSource.ts` — korlátos duplikátumszűrő.** Egyetlen, sosem ürülő
   halmaz gyűjtötte az aktivitás MINDEN időbélyegét (kétórás bringázás után
   több tízezer bejegyzés), miközben a duplikátum csak a drain és az élő
   esemény másodperces átfedéséből keletkezhet. Mostantól kétgenerációs,
   600-as ablakkal — állandó memóriahasználat.
4. **`TrackingScreen.tsx` — a csempe-gyorsítótár felső korlátja.** A kulcs a
   lekért doboz koordinátája volt, tehát mozgás közben MINDEN új nézetdoboz új
   bejegyzést hozott létre, több ezer cellával, a rögzítés végéig megtartva.
   Pont a hosszú aktivitásokon nőtt a memóriahasználat, ahol a WebView a
   legszűkösebb. Most 20 bejegyzéses LRU.
5. **`TrackingScreen.tsx` — hálózati hiba után újra lehet próbálni.** A
   `requestedBox` jelző a kérés INDÍTÁSAKOR állt be (helyesen, a dupla kérés
   ellen), de hibánál bent ragadt: amíg a kamera ki nem mozdult a padded
   dobozból, soha nem próbáltuk újra. Egy alagútban elvesztett kérés után a
   birtokviszony a képernyőn befagyott.
6. **`useRecorder.ts` — a natív állapot-szinkron ütemezése.** A
   `syncActivity` (Capacitor-hídhívás, JSON-sorosítással) MINDEN elfogadott
   GPS-mintára lefutott — egy órás futáson több ezerszer —, holott az egyetlen
   fogyasztója az értesítés/Live Activity felirata, ami másodpercenként
   frissül. Most legfeljebb másodpercenként, DE a státuszváltás (szünet,
   folytatás) továbbra is azonnal megy.
7. **`.gitattributes` — `*.mp3|m4a|wav|ogg binary`.** A fájl `* text=auto
   eol=lf`-et állít, és a többi bináris típust kifejezetten felsorolja: a
   hangfájloknál sem hagyatkozunk a felismerésre, mert egyetlen LF-csere
   lejátszhatatlanná tenné őket.

## ÉLESBEN FUT / TELEPÍTETLEN

- **Ez a menet NINCS telepítve** — a kérés kifejezetten a helyi repóra és a
  `localhost:5173` környezetre szólt.
- Az előző kiadás változatlanul éles: frontend `41eccea`, backend/frontend kód
  `605736f`, Cloud Run `grundo-api-00110-94c`.
- **Az App Check/rate limit csomag (`d8de34f`) továbbra sincs telepítve** — a
  #26-ban leírt teendők változatlanul nyitottak (lásd lent).
- Nincs adatmigráció, nincs új index. A hangfájlok statikus eszközök, a
  frontend-telepítéssel automatikusan kimennek.
- ⚠️ **Natív oldal**: a hangok és a felugró üzenet tisztán webes megoldás,
  tehát `npx cap sync` után az Android/iOS WebView-ban is működnie kell — de
  **KÉSZÜLÉKEN NEM PRÓBÁLTAM KI**. Két dolgot kell ott ellenőrizni: (1) a
  némító kapcsoló / csengőhang-mód hatását iOS-en, (2) hogy a hangzár
  feloldása (`unlockSounds`) a WKWebView-ban is megtörténik az indítógomb
  koppintására.

## KÖVETKEZŐ MENET

**A) A délutáni terepteszt visszajelzései.** A hangok üteme, hangereje és a
felugró üzenet hossza olyasmi, amit csak valódi futás közben lehet megítélni.
Konkrét hangolópontok, ha kell:
`lib/cellStepSound.ts` (`CELL_STEP_GAP_MS`, `CELL_STEP_BURST_CAP`),
`lib/sound.ts` (`SOUND_GAIN`), `hooks/useCaptureFeedback.ts`
(`TERRITORY_TOAST_MS`), `components/territoryToast.css` (konfetti mennyisége,
a kártya függőleges helye).

**B) App Check éles bevezetése — változatlanul nyitott a #26 óta:**

1. **Cloud Shell:** `RATE_LIMIT_HMAC_KEY` titok, Cloud Run SA Secret Manager
   hozzáférés + `roles/firebaseappcheck.tokenVerifier`. Parancsok:
   `docs/06-architektura-es-admin.md` App Check rollout része.
2. **Console:** webes reCAPTCHA Enterprise, Android Play Integrity, iOS App
   Attest providerek; utána a webes Key ID a `VITE_RECAPTCHA_SITE_KEY`-be.
3. Sorrend: **szabályok** → **backend** (`observe`) → **frontend** → Android →
   iOS. Csak igazolt lefedettség után `enforce`.

**C) Kód-jelöltek, változatlanul nyitva a #22 óta:**

4. A gameplay-config runtime snapshot bekötése a tényleges aktivitás-
   feldolgozásba (`activityCommit.ts`, `activityChunked.ts`, `trust/score.ts`,
   16 hívási hely). Ez élesíti a Trust Score observe-only kikapcsolhatóságát és
   az admin GP-modifiereket egyszerre.
5. `mailer.ts:122-129` fail-closed tétele hiányzó `SMTP_HOST`-ra production
   módban.

## NYITOTT KISEBB ÜGYEK

- A rögzítés `applySample`-je minden mintánál ÚJ pontok-tömböt másol
  (`[...state.points, point]`). Egy 3000 pontos aktivitáson ez négyzetes
  jellegű munka és GC-nyomás. **Feltérképezve, nem javítva** — a tiszta
  reducer-szerződés és a React változásfelismerés is ezen áll, tehát mérés
  nélkül nem szabad hozzányúlni. Jó jelölt egy önálló menetre, `performance`
  jelöléssel mért előtte-utána számokkal.
- A frontend production Mapbox chunk **1,824 MB**, a Firebase chunk **630 kB**.
- A hat backend auditjelzés tranzitív `firebase-admin` függőség.
- A Codemagic Google Play ellenőrző parancsában a régi
  `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` név később megszűnik.
- A 90 perces / 20 km-es iOS és Android háttér-GPS terepteszt továbbra is
  nyitott.

## 0. MODELLJAVASLAT a folytatáshoz

Ha a #24 a terepteszt visszajelzéseinek átvezetése (A szakasz): **Sonnet,
normál mélység** — ezek számhangolások és apró UI-igazítások ismert helyeken.
Ha az App Check bevezetése (B) vagy a gameplay-config bekötés (C4): **Opus,
emelt mélység** — az elsőnél a hibás sorrend kizárhatja a régi klienseket, a
másodiknál 16 hívási helyet kell következetesen átvezetni anélkül, hogy a
GP-gazdaság vagy a Trust Score csendben elromlana.

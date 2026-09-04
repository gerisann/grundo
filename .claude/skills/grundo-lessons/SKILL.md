---
name: grundo-lessons
description: A GRUNDO-n mért tanulságok és az ügynök ismert hibamintái — mérés vs. feltételezés, korlátbevezetés, túlnyúlás a kérésen. Használd, ha magyarázatot adnál mérés nélkül, új megkötést vezetnél be, vagy ha a felhasználó a korábbi hibákra kérdez.
---

# Mért tanulságok

Minden pont mögött konkrét eset áll, ami időbe, pénzbe vagy éles hibába került.

## 1. Mérj, ne feltételezz

**Visszatérő hiba.** Legalább négyszer tippeltem mellé olyan kérdésben, amit
meg lehetett volna mérni — és a mérés mindannyiszor mást mondott:

- a sorozat „rejtélyes" viselkedésének oka (valójában egy commit dátuma),
- a res 11 felbontás játékmenetbeli ára,
- a `MIN_INTERIOR_CELLS` 4-re emelésének indoklása (320 futásos zajmodell
  cáfolta),
- az emulátoros suite-ok együttes futása (külön mind zöld, együtt kilenc bukó).

Mérőeszközök: `src/game/fixtures.ts`, Firestore emulátor,
`npm run inspect:world`, `npm run replay:world`, `npm run inspect:payload`, az
`/admin/aktivitasok` auditnézet. **Ha magyarázatot adsz mérés nélkül, mondd ki,
hogy az feltételezés.**

## 2. Egy kapcsoló elolvasása NEM mérés

A hangzár feloldását (`sound.ts`, `unlockSounds()`) natívban kihagytam, mert a
Capacitor forrásában feketén-fehéren ott állt, hogy nincs gesztus-követelmény
(`mediaTypesRequiringUserActionForPlayback = []` iOS-en,
`setMediaPlaybackRequiresUserGesture(false)` Androidon). A következő iOS
buildben **minden hang elnémult**: a WebKit gesztus-kapuja nem az egyetlen
feltétel — a rendszer hangútvonalát (AVAudioSession) csak egy valódi,
gesztusból indított lejátszás nyitja meg. Egy build-ciklusba került.

Platform-viselkedésre **csak készüléken mért bizonyíték** számít. Ha nincs mód
mérésre, mondd ki, hogy a javítás feltételezésen áll — és azt a változatot
válaszd, ami **hibás feltevés mellett is működik**.

Ez az 1. pont fordítottja: ott találgattam mérés helyett, itt egy MÁS kérdésre
adott mérést fogadtam el válasznak arra, amit nem mértem.

⚠️ **UGYANEZ MÁSODSZOR, egy nappal később** (2026-09-04). A hangzavar ellen a
`pause()` szinkron, a promise bevárása nélkül futott le a `play()` után — abban
a hitben, hogy a feloldás már magában a `play()` HÍVÁSÁBAN megtörténik. A
készülék megint mást mondott: iOS-en újra minden hang elnémult, mert a
megszakított `play()` el sem indítja a lejátszást, az AVAudioSession pedig épp
a tényleges lejátszástól aktiválódik. A javítás mellé írt regressziós teszt
ráadásul EZT a hibás viselkedést rögzítette kötelezőként.

Két tanulság: (1) ha egy platform-viselkedésről már egyszer kiderült, hogy az
API-olvasat nem elég, a második, „most már értem" magyarázat sem az;
(2) **készüléken nem ellenőrzött javításhoz ne írj olyan tesztet, ami a
feltevést szentesíti** — a teszt ilyenkor nem véd, hanem bebetonoz.

## 3. Amikor korlátot vezetsz be, nézd meg a gyakori utat

Egy őrszem, ami a ritka hibát kizárja, könnyen ellehetetleníti a leggyakoribb
műveletet. *Eset:* a modifierek „múltbeli kezdés tilos" szabálya helyes volt
szerkesztésre, de létrehozásra a leggyakoribb esetet (`induljon most`) tette
volna használhatatlanná, mert az űrlap a megnyitás idejével nyílik.

Új megkötés után mindig kérdezd meg: **mi történik a normál használatnál?**

## 4. A plafon emelése csak eltolja a határt

Az adatlap 20 000 cellánál vágta el a választ, és 22 666 cella (53 %) sosem
jutott el a klienshez. Ugyanez 2026-08-29-én már megtörtént 5 000-es plafonnal.
A megoldás nem a nagyobb szám volt, hanem a H3-compact. **Ha egy limit másodszor
üt meg, a limit a rossz eszköz.**

## 5. Túlnyúlok a kérésen

Commitoltam kérés nélkül, és kiírtam telepítő parancsokat, amiket kifejezetten
nem kértek. **Ha egy lépés a felhasználóé, hagyd nála.**

## 6. Hosszú válaszok

Amire tényleg szükség van: a fájl-táblázat, a mérési eredmény és a következő
lépés.

## 7. Külső szolgáltatót vettem fel magamtól

Resendet hoztam be, pedig volt saját levelezés. **Ha a meglévő infrastruktúra
megoldja, ne hozz be harmadik felet.**

## 8. A saját korábbi állapotomból indulok ki

A friss `HEAD` helyett. A repóban más forrás is dolgozik — mindig a friss
`HEAD`-ből indulj.

## 9. Egy javított hibaminta más rétegben visszatérhet

A GRUNDO #21 energiaelemzés megoldotta, hogy élő rögzítésnél a cellalánc-
építés (`traceToCellPath`) minden GPS-mintánál a TELJES nyomvonalat
újraszámolta (`IncrementalCellPath`, `src/game/cells.ts`). A `game/index.ts`-beli
`IncrementalActivityGeometry` — egy réteggel feljebb, a GP/claim preview-nál —
ugyanezt a hibát ismételte meg: a saját doksi-kommentje azt állította, „csak az
ÚJ pontokat dolgozza fel", miközben a kódja minden hívásnál újraszámolt.
2026-09-04-ig senki nem vetette össze a kommentet a tényleges implementációval
— 10 km-es városi Android-rögzítésnél ez okozta a teljes app lassulását.
**Ha egy ismert, drága primitívet (itt: `traceToCellPath`) egyszer kijavítasz,
keress rá MINDEN hívási helyére** (`grep`), ne csak arra, ahol a tünetet
észlelted — és ne higgy egy „inkrementális"-nak nevezett osztály kommentjének
a kód elolvasása nélkül.

## 10. Az átadót is ellenőrizni kell, mielőtt a listája alapján dolgozol

A #31 átadója három teljesítmény-gyanúsítottat sorolt fel. Mérve (#32) kettő
ártatlan volt, az egyik leírás pedig egyszerűen TÉVES: „a `useRecorder.ts`
minden mintánál ír az IndexedDB-be" — közben a `createRunPersister` 2000 ms-os
`minIntervalMs`-szel összevonja az írásokat, ez a saját fejléc-kommentjében is
ott áll. Ha a listát végigjavítom, két felesleges átalakítást írtam volna a
kockázatos rétegbe, a valódi ok mellett (`processActivityGeometry`) pedig
elmegyek. **Az átadó nyitott ügyei hipotézisek, nem tények — mérd le őket,
mielőtt bármelyiket javítod.**

## 11. Feltételezést tényként közöltem a saját mérésem mellett

Ugyanabban a menetben, a mért számok mellé odaírtam, hogy az élő preview
„minden elfogadott GPS-mintánál újrafut" — anélkül, hogy megnéztem volna a
`useMemo` függőségeit. Valójában `cellRevision` (új H3 cella) és
`distanceBucket` (25 m) vezérli, tehát ritkábban fut. A hiba a mérés
HITELÉT rontja: a helyes számok mellett egy ellenőrizetlen állítás úgy hat,
mintha az is mérés lenne. **Egy React-hurok gyakoriságát a függőséglistából
kell kiolvasni, nem a hívási helyből következtetni** — és amit nem mértél,
azt mondd ki feltételezésnek.


## 12. A diagnosztikai címke nem a valódi ok

A hurokdetektor mind a 499 elutasított jelöltre `interior_too_small`-t írt, és
ebből azt olvastam ki, hogy „vékony folyosók, üres belsővel" — ezt le is írtam
a mérési dokumentumba. A kód viszont **két különböző helyen** írja ezt a
címkét, és a két eset ellentétes: 8 jelöltnek tényleg üres a belseje, 491-nek
viszont **valódi belseje van** (medián 214 cella), csak minden cellája már
bekerített. Egy egész optimalizálási irányt (terület-küszöb) erre a téves
olvasatra terveztem, és a mérés cáfolta.

**Ha egy diagnosztikai mező alapján következtetsz, keresd meg, HÁNY helyen
írják.** Egy `reason` enum értéke annyit ér, ahány külön ág nem osztozik rajta.

## 13. Az őrző teszt, ami nem tud bukni

Írtam egy tesztet arra, hogy a gyorsítótárazott halmazt másolat nélkül
továbbadni hibás. A teszt zöld volt — aztán kipróbáltam a hibát is
BEVEZETNI, és **továbbra is zöld maradt**: a védett kódág (visszaterjesztés)
csak ritka alakzatra fut le egyáltalán, a teszt fixture-jei sosem érték el.

**Egy garanciateszt értéktelen, amíg nem láttad bukni.** Vezesd be szándékosan
a hibát, amit megfogni hivatott; ha nem bukik, a teszt nem azt méri, amit
hiszel. (Ott a megoldás típusszintű lett: a mező `ReadonlySet`, tehát a
másolat elhagyása fordítási hiba — ez a fordító garanciája, nem a fixture
szerencséjéé.)

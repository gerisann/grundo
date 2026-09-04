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

# Mért tanulságok — az ügynök ismert hibamintái

Minden pont mögött egy konkrét eset áll, ami időbe, pénzbe vagy éles hibába
került.

## 1. Mérj, ne feltételezz

**Ez a visszatérő hibám.** Legalább négyszer tippeltem mellé olyan kérdésben,
amit meg lehetett volna mérni — és a mérés mindannyiszor mást mondott, mint a
józan ész:

- a sorozat „rejtélyes" viselkedésének oka (valójában egy commit dátuma),
- a res 11 felbontás játékmenetbeli ára,
- a `MIN_INTERIOR_CELLS` 4-re emelésének indoklása (320 futásos zajmodell
  cáfolta),
- az emulátoros suite-ok együttes futása (külön mind zöld, együtt kilenc bukó).

A mérőeszközök felsorolása: [`testing.md`](testing.md). **Ha magyarázatot adsz
mérés nélkül, mondd ki, hogy az feltételezés.**

## 2. Egy kapcsoló elolvasása NEM mérés

A hangzár feloldását (`sound.ts`, `unlockSounds()`) natívban kihagytam, mert a
Capacitor forrásában feketén-fehéren ott állt, hogy nincs gesztus-követelmény
(`mediaTypesRequiringUserActionForPlayback = []` iOS-en,
`setMediaPlaybackRequiresUserGesture(false)` Androidon). A következő iOS
buildben **minden hang elnémult**: a WebKit gesztus-kapuja nem az egyetlen
feltétel — a rendszer hangútvonalát (AVAudioSession) csak egy valódi,
gesztusból indított lejátszás nyitja meg. Egy build-ciklusba került.

Platform-viselkedésre **csak készüléken mért bizonyíték** számít; forrásból
legfeljebb hipotézis lesz. Ha nincs mód a mérésre, mondd ki, hogy a javítás
feltételezésen áll — és inkább azt a változatot válaszd, ami **hibás feltevés
mellett is működik**.

Ez az 1. pont fordítottja: ott találgattam mérés helyett, itt egy MÁS kérdésre
adott mérést fogadtam el válasznak arra, amit nem mértem.

## 3. Amikor korlátot vezetsz be, nézd meg a gyakori utat

Egy őrszem, ami a ritka hibát kizárja, könnyen ellehetetleníti a leggyakoribb
műveletet.

*Eset:* a modifierek „múltbeli kezdés tilos" szabálya helyes volt
szerkesztésre, de létrehozásra a leggyakoribb esetet (`induljon most`) tette
volna használhatatlanná, mert az űrlap a megnyitás idejével nyílik.

Új megkötés után mindig kérdezd meg: **mi történik a normál használatnál?**

## 4. Túlnyúlok a kérésen

Commitoltam kérés nélkül, és kiírtam telepítő parancsokat, amiket kifejezetten
nem kértek. **Ha egy lépés a felhasználóé, hagyd nála.** A jelenlegi
hatáskörök: [`git-and-deploy.md`](git-and-deploy.md).

## 5. Hosszú válaszok

Amire tényleg szükség van: a fájl-táblázat, a mérési eredmény és a következő
lépés. A többi legyen rövid.

## 6. Külső szolgáltatót vettem fel magamtól

Resendet hoztam be, pedig volt saját levelezés. **Ha a meglévő infrastruktúra
megoldja, ne hozz be harmadik felet.**

## 7. A saját korábbi állapotomból indulok ki

A friss `HEAD` helyett. A repóban más forrás is dolgozik — mindig a friss
`HEAD`-ből indulj.

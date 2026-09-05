# Jelenlegi állapot

> Frissítve: **2026-09-05** · GRUNDO **#41**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**
> Állapot: a #40 hibái javítva, **élesben fut és ellenőrizve**.
> Utoljára dolgozott: **Claude Opus 5** · Átadva: **Claude**

## Jelenlegi cél

A #40 (aktivitás-feed lapozás és sorrend) hibáinak helyrehozása, majd
telepítés. Kész és éles.

## ⚠️ Ami ma élesben elromlott, és hogyan állt helyre

A #40 backendje **07:53 UTC-kor telepítve lett a hozzá tartozó Firestore
indexek nélkül** — az átadó azt írta, hogy nincs telepítve, a Cloud Run
revíziólistája szerint volt. Ettől a `/api/activities` **minden felhasználónak
500-at adott** (`9 FAILED_PRECONDITION: The query requires an index`), tehát
az éles feed kb. 45 percig halott volt, webes és natív kliensen egyaránt.

A hiba a kliens „Nem sikerült betölteni az aktivitásokat" üzeneteként
jelentkezett — a valódi ok kizárólag a Cloud Run **stderr** naplójából derült
ki, a kérésnaplóból nem.

Helyreállítás sorrendben:

1. Forgalom visszaterelése az előző revízióra
   (`gcloud run services update-traffic … --to-revisions grundo-api-00143-sqm=100`)
   — a feed percek alatt újra 200-at adott.
2. `endedAt` indexek telepítése, majd **megvárva mind a három `READY`-t**.
3. Backend, majd frontend telepítése.
4. ⚠️ **A rollback után a forgalom a régi revízión RAGAD.** Az új build
   magától nem kap forgalmat; `update-traffic --to-latest` kell hozzá.
   Enélkül a telepítés némán hatástalan.

## Elkészült

1. **A feed a BEFEJEZÉS ideje (`endedAt`) szerint rendez, szűr és lapoz.**
   A #40 ehelyett a `createdAt`-ot, vagyis a szerveroldali mentés idejét
   használta; offline vagy késve feltöltött körnél ez érdemben eltér. Érinti
   a rendezést, a dátumszűrőt, a lapozókurzort, a kártya dátumát, az
   aktivitás-részletezőt és az értesítések címét.
2. **Nyolc óránál hosszabb aktivitás címe a befejezés napjának neve**
   („Szombati bringázás"). A napnév fix magyar táblából jön; a #40 az `Intl`
   hu-HU kimenetéhez ragasztott „i" végződést, ami ICU-verziófüggő.
3. **A banda üzenőfala tízesével lapoz**, „Továbbiak betöltése" gombbal. A
   #40 ezt kihagyta: a fal fix százas listát adott vissza, gomb nélkül.
4. A „Továbbiak" gomb csak a következő lap töltésekor pörög
   (`isFetchingNextPage`), nem minden háttérfrissítéskor.
5. A három feedindex `endedAt DESC` alakra váltott.
6. Visszakerültek a #40 által kitörölt magyar magyarázó kommentek.

**Migráció nem kellett:** az `endedAt` mezőt a legelső mentési implementáció
(2026-08-17) óta minden aktivitás-dokumentum tartalmazza, ezért a rendezés
visszamenőleg is teljes.

## Módosított fájlok

- Backend: `server/src/routes/activities.ts` (feed, cím, értesítés),
  `server/src/routes/bandas.ts` (üzenőfal-lapozás).
- Indexek: `firestore.indexes.json` — három index `createdAt` → `endedAt`.
- Kliens: `src/lib/format.ts`, `src/lib/api.ts`, `src/hooks/useActivities.ts`,
  `src/components/Feed.tsx`, `ActivityCard.tsx`, `BandaFeedWall.tsx`,
  `src/screens/ActivityScreen.tsx`.
- Tesztek: `format.test.ts`, `feedScopes.emulator.test.ts`,
  `bandas.emulator.test.ts` (új üzenőfal-lapozás teszt).
- Dokumentáció: `docs/02-funkcionalis-spec.md`, `docs/05-adatmodell.md`,
  `docs/ai/DECISIONS.md`, ez az átadó.

## Élesben fut

- Backend: `grundo-api-00145-d2x`, 100% forgalom.
- Frontend: telepítve (`grundo.web.app`).
- Indexek: mindhárom `endedAt` index `READY`.
- Szabályok és adatbázis-migráció nem kellett.

## Ellenőrzések

- Kliens teljes készlet: **803 zöld**, 181 kihagyva.
- Feed emulátoros teszt: **13/13 zöld** az `endedAt` mezővel.
- Banda emulátoros teszt: **28 zöld** (benne az új üzenőfal-lapozás).
- Kliens és szerver típusellenőrzés külön-külön zöld.
- **Bejelentkezett böngészős ellenőrzés élesen**: a feed 200-at ad; a
  „Továbbiak betöltése" gomb 10 → 20 kártyát tölt; a 12:58:46 hosszú
  aktivitás címe „Szombati bringázás".

## UI-kör (2026-09-05 délután)

A #41 telepítése után egy felületi kör következett, **nincs telepítve**:

- A Home „mai küldetésed" kártyája háttérképet kapott (fekete fátyol +
  márkaszínű átmenet), sarokba illesztett „Útvonalak" gombbal.
- Új `OptionSwitch` (2–3 állású csúszkás választó) váltja a korábbi
  szegmensvezérlőket a Home, Felfedezés, Bandák, Banda, Küldetések és a
  rögzítés képernyőn; a rögzítésnél a mozgásforma-szín a csúszkára került.
- A Profil és Közösség fülsávja pirula alapot kapott. ⚠️ Ott NINCS egyenlő
  osztás: hat fül mobilon olvashatatlan lenne.
- A Felfedezés bandás módja valódi tartalmat kapott, és üresre szűrt lap
  esetén legfeljebb négy további lapot magától bekér.
- Belépés előtti képernyők: valódi logó, új szövegek, forgó mozgásforma-szó.

⚠️ **Amit teszt nem bizonyít, és élőben sem néztem meg**: az intro és a
belépés képernyő bejelentkezve átirányít, ezért a logót és a forgó szót csak
injektált próbaelemen mértem, a valódi képernyőn nem.

## Nyitott ügyek

1. Android/iOS készülékes smoke teszt — a natív kliensek a régi frontendet
   futtatják, amíg nincs új store-kiadás. A backend visszafelé kompatibilis,
   de a lapozás és a befejezés szerinti sorrend csak új klienssel látszik.
2. A banda üzenőfal lapozása egy kérésben legfeljebb 100 nyers sort néz át;
   nagyon sok rejtett üzenetnél ez később kurzoros lapozást igényelhet.

## Modelljavaslat

**Sonnet, közepes** a natív smoke teszthez; **Opus** csak akkor, ha megint
éles hibakeresés jön.

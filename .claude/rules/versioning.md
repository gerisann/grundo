# Verziókezelés

Két, egymástól független tengely fut párhuzamosan:

- **Szemantikus verzió** (`package.json` → `version`, `MAJOR.MINOR.PATCH`) —
  a fejlesztés szándékos mérföldköveit jelöli. Ezt EMBERI döntés emeli,
  minden lépésnél indoklással.
- **Build-szám** (zárójeles, Codemagic `BUILD_NUMBER` → iOS
  `CURRENT_PROJECT_VERSION`, Android `versionCode`) — ez marad, ahogy eddig:
  minden CI-futásnál automatikusan nő, kisebb módosításoknál elég csak ez.

## Mikor kell verziót emelni

⚠️ **Minden érdemi commit előtt** (nem elgépelés-javítás, nem formázás, nem
dokumentáció) fel kell ajánlani egy verzióemelést, indoklással:

- **patch** (`1.0.0 → 1.0.1`) — hibajavítás, nincs viselkedésváltozás.
- **minor** (`1.0.0 → 1.1.0`) — új funkció, képernyő, játékelem; visszafelé
  kompatibilis.
- **major** (`1.0.0 → 2.0.0`) — törő változás: adatmodell, API-szerződés,
  vagy a natív kliensekkel való kompatibilitás megszakadása.

Ha a commit triviális (typo, komment, lint), NEM kell verziót javasolni —
ekkor elég a build-szám további növekedése a következő CI-futásnál.

A javaslatot **fel kell ajánlani, jóváhagyás után** végrehajtani — soha nem
automatikusan eldönteni és lefuttatni.

## Végrehajtás jóváhagyás után

```bash
node scripts/bump-version.mjs <patch|minor|major> "változás 1" ["változás 2" ...]
```

Ez egy lépésben frissíti:
- `package.json` → `version` (Android `versionName` innen olvas buildkor,
  lásd `android/app/build.gradle:5` — nincs külön teendő)
- `ios/App/App.xcodeproj/project.pbxproj` → mind a 4 `MARKETING_VERSION` sor
- `CHANGELOG.md` → új szakasz a lista tetején

Utána: commit (a bump a funkciócommit RÉSZE, nem külön commit, hacsak a
felhasználó másképp nem kéri).

## Changelog — két hely, egy forrás

- **`CHANGELOG.md`** a repo gyökerében — git-történettel követhető,
  ember-olvasásra szánt eredeti. Ez az igazság forrása.
- **Firestore `changelog` gyűjtemény** (`grundo-db`) — az admin felület
  (`/admin/verziotortenet`) ezt olvassa élesben, mert nem éri el a repót.
  Szinkron: `node server/scripts/sync-changelog.mjs` (doc id = verziószám,
  ezért az újrafuttatás nem duplikál). Deploy után futtatandó — lásd
  `/grundo-deploy`.

Az admin API (`server/src/routes/admin.ts` → `GET/POST /api/admin/changelog`)
ugyanazt a mintát követi, mint a `gameplay` végpontok: szerepkör-kapu
(`owner`/`admin` írhat), minden írás naplózva (`audit()`).

## Amit ez a szabály NEM ír felül

A build-szám továbbra is minden Codemagic-futásnál nő, függetlenül attól,
történt-e verzióemelés — lásd `docs/07-ios-testflight-codemagic.md` és
`docs/08-android-codemagic.md`. TestFlight belső teszteléshez a
verziószám-váltás nem indít külön Apple-validálást (csak build-feldolgozás,
percek); ez csak külső tesztelői csoportnál (Beta App Review) lenne más.

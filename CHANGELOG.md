# Changelog

A GRUNDO verziótörténete. Formátum: [Keep a Changelog](https://keepachangelog.com/hu/1.0.0/)
elve, magyarul, mert ez admin-felületen (`/admin/verziotortenet`) is megjelenik.

**Hogyan kerül ide bejegyzés?** `.claude/rules/versioning.md` szerint minden
érdemi commit előtt eldöntjük, kell-e verzióemelés (patch/minor/major), majd:

```
node scripts/bump-version.mjs <patch|minor|major> "változás 1" ["változás 2" ...]
```

Ez frissíti a `package.json`-t, az iOS `MARKETING_VERSION`-t és ezt a fájlt.
Deploy után a Firestore-tükröt (admin felület) a
`node server/scripts/sync-changelog.mjs` frissíti.

A zárójeles build-szám (Codemagic `BUILD_NUMBER`, iOS `CURRENT_PROJECT_VERSION`,
Android `versionCode`) ettől függetlenül, minden CI-futásnál tovább nő — apró
módosításoknál nem kell hozzá verzióemelés.

⚠️ **Minden `- ` felsorolás EGY sorba kerüljön, ne törd tördelve** — a
`server/scripts/sync-changelog.mjs` soronként olvassa a tételeket, a
folytatósorokat elveszítené.

<!-- ÚJ BEJEGYZÉS IDE -->
## [1.1.0] - 2026-09-12 (Új funkció)

- A→B útvonaltervező motor: pont-pont útvonal, kétoldali oda-vissza kör, köztes megállók
- Új alakmértékek a közös motorban: irányfüggetlen közös szakasz és önmagába visszatérés
- A kerülő mérete játékkonstans (±500 m / ±1 km / ±2 km), a közvetlen táv 45%-ára vágva
- Kézi útvonal-labor próbapad: címkereső, terep- és kerékpárút-preferencia, geometria és birtokviszony

## [1.0.0] - 2026-09-09 (Nagy verzió)

- Verziókövetési rendszer bevezetése: szemantikus verziószám (`MAJOR.MINOR.PATCH`) a korábbi, kizárólag zárójeles build-számos követés mellé.
- Ez a bejegyzés az indulási alapállapotot jelöli — a korábbi build-előzmény (build 1–54) nem lett visszamenőleg feldolgozva.

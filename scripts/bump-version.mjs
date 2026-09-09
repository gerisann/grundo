#!/usr/bin/env node
/**
 * Verzióemelés: package.json "version" mezeje az egyetlen igazságforrás,
 * ez a script szinkronizálja az iOS pbxproj MARKETING_VERSION mezőit is
 * (az Android versionName már buildkor közvetlenül a package.json-t olvassa,
 * lásd android/app/build.gradle:5 — ott nincs mit szinkronizálni).
 *
 * A build-szám (Codemagic BUILD_NUMBER, iOS CURRENT_PROJECT_VERSION / Android
 * versionCode) ettől függetlenül, továbbra is minden CI-futásnál nő — ezt a
 * script nem érinti.
 *
 * Használat:
 *   node scripts/bump-version.mjs patch "Rövid leírás az első változásról" "Második változás"
 *   node scripts/bump-version.mjs minor "Új funkció leírása"
 *   node scripts/bump-version.mjs major "Törő változás leírása"
 *
 * Előírt lépések a szabály szerint (.claude/rules/versioning.md):
 *   1. ez a script frissíti a package.json-t, a pbxproj-t és a CHANGELOG.md-t
 *   2. commit
 *   3. deploy/build után: node scripts/sync-changelog.mjs (Firestore-tükör az admin felülethez)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const [, , bumpType, ...changes] = process.argv;

if (!['patch', 'minor', 'major'].includes(bumpType ?? '')) {
  console.error('Használat: node scripts/bump-version.mjs <patch|minor|major> "változás 1" ["változás 2" ...]');
  process.exit(1);
}
if (changes.length === 0) {
  console.error('Legalább egy változás-leírás kötelező (ez kerül a CHANGELOG.md-be).');
  process.exit(1);
}

const packageJsonPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);

let nextVersion;
if (bumpType === 'major') nextVersion = `${major + 1}.0.0`;
else if (bumpType === 'minor') nextVersion = `${major}.${minor + 1}.0`;
else nextVersion = `${major}.${minor}.${patch + 1}`;

// 1) package.json
pkg.version = nextVersion;
writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');

// 2) iOS pbxproj — mind a 4 buildkonfigurációt (App Debug/Release, LiveActivity Debug/Release) egyben tartjuk.
const pbxprojPath = path.join(rootDir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
const pbxproj = readFileSync(pbxprojPath, 'utf8');
const updatedPbxproj = pbxproj.replace(
  /MARKETING_VERSION = \d+\.\d+\.\d+;/g,
  `MARKETING_VERSION = ${nextVersion};`,
);
writeFileSync(pbxprojPath, updatedPbxproj);

// 3) CHANGELOG.md — új szakasz a lista tetejére, Keep a Changelog stílusban.
const changelogPath = path.join(rootDir, 'CHANGELOG.md');
const changelog = readFileSync(changelogPath, 'utf8');
const today = new Date().toISOString().slice(0, 10);
const typeLabel = { patch: 'Javítás', minor: 'Új funkció', major: 'Nagy verzió' }[bumpType];
const entry = `## [${nextVersion}] - ${today} (${typeLabel})\n\n${changes.map((c) => `- ${c}`).join('\n')}\n\n`;
const marker = '<!-- ÚJ BEJEGYZÉS IDE -->\n';
const updatedChangelog = changelog.includes(marker)
  ? changelog.replace(marker, marker + entry)
  : changelog + '\n' + entry;
writeFileSync(changelogPath, updatedChangelog);

console.log(`Verzió: ${pkg.version === nextVersion ? pkg.version : '?'} (előző: ${major}.${minor}.${patch} → ${nextVersion})`);
console.log('Frissítve: package.json, ios/App/App.xcodeproj/project.pbxproj, CHANGELOG.md');
console.log('Következő lépés: commit, majd deploy/build után `node scripts/sync-changelog.mjs`.');

/**
 * A backend indítása az EMULÁTOR ellen.
 *
 * MIÉRT SZKRIPT, ÉS NEM EGYSZERŰ npm-parancs? Mert a környezeti változó
 * előtag (`FOO=bar parancs`) a PowerShellben nem működik, a repo pedig
 * Windowson él. Így egyetlen parancs mindkét héjból ugyanazt csinálja.
 *
 * FUTTATÁS (a `server/` mappából):  npm run dev:emulator
 */
import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8081',
  // Enélkül a firebase-admin az ÉLES Google kulcsaival próbálná ellenőrizni az
  // emulátor által kiadott tokent, és minden kérés 401-gyel esne el.
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099',
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-grundo',
  PORT: process.env.PORT ?? '8080',
  // A kliens a Vite dev szerverről jön; enélkül a CORS visszautasítaná.
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173',
};

if (!env.GOOGLE_CLOUD_PROJECT.startsWith('demo-')) {
  throw new Error(
    `Ez a parancs emulátorhoz való. A GOOGLE_CLOUD_PROJECT (${env.GOOGLE_CLOUD_PROJECT}) nem \`demo-\` előtagú.`,
  );
}

console.log('[GRUNDO] Backend emulátoros módban:');
console.log(`  Firestore: ${env.FIRESTORE_EMULATOR_HOST}`);
console.log(`  Auth:      ${env.FIREBASE_AUTH_EMULATOR_HOST}`);
console.log(`  Projekt:   ${env.GOOGLE_CLOUD_PROJECT}`);
console.log(`  Port:      ${env.PORT}`);

const child = spawn('npx', ['tsx', 'watch', 'server.ts'], {
  env,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 0));

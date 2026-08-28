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
import { networkInterfaces } from 'node:os';

/**
 * A gép HELYI HÁLÓZATI címei — hogy a felület TELEFONRÓL is használható legyen.
 *
 * A CORS allowlist pontos egyezést vár, a telefon viszont a gép IP-jén éri el
 * a Vite-ot (`http://192.168.1.79:5173`), nem `localhost`-on. Enélkül az oldal
 * betöltődik, de minden API-hívás CORS-hibával némán elhal.
 *
 * Csak a MAGÁNHÁLÓZATI (RFC 1918) IPv4 címeket vesszük fel, és csak itt, az
 * emulátoros indítóban — élesben továbbra is az `ALLOWED_ORIGINS` változó dönt,
 * ezt a listát oda soha nem visszük át.
 */
function localNetworkOrigins() {
  const origins = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address)) continue;
      origins.push(`http://${address.address}:5173`);
    }
  }
  return origins;
}

const lanOrigins = localNetworkOrigins();

const env = {
  ...process.env,
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8081',
  // Enélkül a firebase-admin az ÉLES Google kulcsaival próbálná ellenőrizni az
  // emulátor által kiadott tokent, és minden kérés 401-gyel esne el.
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099',
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-grundo',
  PORT: process.env.PORT ?? '8080',
  // A kliens a Vite dev szerverről jön; enélkül a CORS visszautasítaná.
  ALLOWED_ORIGINS:
    process.env.ALLOWED_ORIGINS ??
    ['http://localhost:5173', 'http://127.0.0.1:5173', ...lanOrigins].join(','),
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
if (lanOrigins.length > 0) {
  console.log(`  Telefonról: ${lanOrigins.join('  ')}`);
}

const child = spawn('npx', ['tsx', 'watch', 'server.ts'], {
  env,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 0));

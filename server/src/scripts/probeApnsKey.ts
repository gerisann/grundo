/**
 * APNs kulcs-szonda — a Firebase KIHAGYÁSÁVAL kérdezi meg az Apple-t.
 *
 * MIÉRT KELL? Mert az FCM `InvalidProviderToken` hibája három bemenet közül
 * bármelyikre vonatkozhat: a `.p8` fájlra, a Key ID-re és a Team ID-re. A
 * Firebase mindhármat együtt tárolja, tehát onnan nem lehet szétválasztani.
 *
 * Ez a szkript maga építi fel a JWT provider-tokent, és közvetlenül az APNs-nek
 * küld. Az APNs a HITELESÍTÉST a device token ELŐTT ellenőrzi, ezért
 * szándékosan hamis device tokennel is eldől a kérdés:
 *
 *   400 BadDeviceToken     → a kulcs + Key ID + Team ID hármas HELYES.
 *                            Ilyenkor a hiba az, amit a Firebase tárol:
 *                            töröld a sorokat és töltsd fel újra.
 *   403 InvalidProviderToken → a hármas valamelyike rossz. Mivel a kulcs a
 *                            portálon él és APNs-re engedélyezett, elsőként a
 *                            TEAM ID a gyanús.
 *   403 ExpiredProviderToken → a gép órája jár nagyon félre.
 *
 * A kulcs tartalma SOSEM kerül kimenetre. A fájlt csak aláírásra olvassuk.
 *
 * FUTTATÁS (PowerShell, a `server` mappából):
 *
 *   $env:APNS_KEY_PATH = "C:\Users\Geri\Downloads\AuthKey_9BGTAPANR8.p8"
 *   $env:APNS_KEY_ID   = "9BGTAPANR8"
 *   $env:APNS_TEAM_ID  = "HFS68TZMCH"
 *   npx tsx src/scripts/probeApnsKey.ts
 *
 * Több Team ID-t is meg lehet adni vesszővel, ha nem biztos, melyik a kulcsé:
 *   $env:APNS_TEAM_ID = "HFS68TZMCH,MASIKTEAM1"
 */

import { readFileSync } from 'node:fs';
import { sign as cryptoSign } from 'node:crypto';
import http2 from 'node:http2';

const KEY_PATH = (process.env.APNS_KEY_PATH ?? '').trim();
const KEY_ID = (process.env.APNS_KEY_ID ?? '').trim();
const TEAM_IDS = (process.env.APNS_TEAM_ID ?? '').split(',').map((item) => item.trim()).filter(Boolean);
const TOPIC = (process.env.APNS_TOPIC ?? 'app.grundo.ios').trim();

/** 64 hexa nulla: szándékosan érvénytelen device token. Csak a hitelesítést mérjük. */
const DUMMY_DEVICE_TOKEN = '0'.repeat(64);

const HOSTS = [
  { name: 'production', url: 'https://api.push.apple.com' },
  { name: 'sandbox', url: 'https://api.sandbox.push.apple.com' },
];

if (!KEY_PATH || !KEY_ID || TEAM_IDS.length === 0) {
  console.error('Hiányzó bemenet. Kell: APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID.');
  console.error('A fájl tartalmát a szkript nem írja ki és nem küldi sehová az Apple-en kívül.');
  process.exit(1);
}

const privateKey = readFileSync(KEY_PATH, 'utf8');
if (!privateKey.includes('BEGIN PRIVATE KEY')) {
  console.error('A megadott fájl nem PKCS#8 privát kulcsnak látszik (.p8 fájlt vár).');
  process.exit(1);
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** APNs provider token: ES256 JWT, `kid` a Key ID, `iss` a Team ID. */
function providerToken(teamId: string): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID }));
  const payload = base64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
  const signingInput = `${header}.${payload}`;
  // Az APNs a nyers (r||s) aláírást várja, nem DER-t — ezért `ieee-p1363`.
  const signature = cryptoSign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${base64url(signature)}`;
}

async function probe(host: { name: string; url: string }, teamId: string, jwt: string): Promise<void> {
  const client = http2.connect(host.url);
  try {
    await new Promise<void>((resolve) => {
      const request = client.request({
        ':method': 'POST',
        ':path': `/3/device/${DUMMY_DEVICE_TOKEN}`,
        authorization: `bearer ${jwt}`,
        'apns-topic': TOPIC,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });

      let status = 0;
      let body = '';
      request.on('response', (headers) => {
        status = Number(headers[':status'] ?? 0);
      });
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        const reason = (() => {
          try {
            return String((JSON.parse(body || '{}') as { reason?: unknown }).reason ?? '(nincs)');
          } catch {
            return body.slice(0, 120) || '(üres)';
          }
        })();
        console.log(`   ${host.name.padEnd(11)} HTTP ${status}  reason: ${reason}  ${verdict(status, reason)}`);
        resolve();
      });
      request.on('error', (error: Error) => {
        console.log(`   ${host.name.padEnd(11)} hálózati hiba: ${error.message}`);
        resolve();
      });

      request.end(JSON.stringify({ aps: { alert: { title: 'GRUNDO', body: 'kulcs-szonda' } } }));
    });
  } finally {
    client.close();
  }
}

function verdict(status: number, reason: string): string {
  if (status === 400 && reason === 'BadDeviceToken') return '→ A KULCS + KEY ID + TEAM ID HELYES.';
  if (reason === 'InvalidProviderToken') return '→ a hármas valamelyike rossz (elsőként a Team ID gyanús).';
  if (reason === 'ExpiredProviderToken') return '→ a gép órája jár félre.';
  if (reason === 'TopicDisallowed') return '→ a kulcs nem jogosult erre a bundle ID-re.';
  if (status === 200) return '→ az APNs elfogadta (ez hamis tokennel nem várt).';
  return '';
}

console.log(`Key ID: ${KEY_ID} · topic: ${TOPIC}`);
for (const teamId of TEAM_IDS) {
  console.log('');
  console.log(`Team ID: ${teamId}`);
  const jwt = providerToken(teamId);
  for (const host of HOSTS) {
    await probe(host, teamId, jwt);
  }
}

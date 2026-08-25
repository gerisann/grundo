/**
 * IDEIGLENES DIAGNÓZIS — egyetlen valódi FCM küldés, a TELJES hibaválaszért.
 *
 * A Firebase Admin SDK csak a kódot és a rövid üzenetet adja vissza
 * (`messaging/third-party-auth-error — Invalid APNs credential.`). Az FCM v1
 * HTTP API viszont a `details` tömbben egy `ApnsError`-t is visszaad, benne az
 * APNs SAJÁT `reason` mezőjével — az mondja meg, hogy visszavont kulcsról,
 * rossz Key ID-ről, rossz környezetről vagy rossz bundle ID-ről van-e szó.
 *
 * A tokent SOHA nem írja ki.
 *
 * FUTTATÁS (PowerShell, a `server` mappából):
 *   $env:GOOGLE_CLOUD_PROJECT="grundo"
 *   $env:FCM_ACCESS_TOKEN = (gcloud.cmd auth print-access-token)
 *   npx tsx src/scripts/probeApns.ts
 */

import { COLLECTIONS, db } from '../lib/firebase';

const PROJECT = 'grundo';

function mask(token: string): string {
  return `${token.slice(0, 8)}…${token.slice(-6)}`;
}

function accessToken(): string {
  const token = (process.env.FCM_ACCESS_TOKEN ?? '').trim();
  if (!token) {
    throw new Error(
      'Hiányzik a FCM_ACCESS_TOKEN. PowerShellben: '
      + '$env:FCM_ACCESS_TOKEN = (gcloud.cmd auth print-access-token)',
    );
  }
  return token;
}

const deviceDocs = await db.collection(COLLECTIONS.devices).listDocuments();
const iosTokens: { uid: string; token: string; updatedAt: Date | null }[] = [];

for (const deviceDoc of deviceDocs) {
  const snap = await deviceDoc.collection('tokens').get();
  for (const doc of snap.docs) {
    const data = doc.data() as { platform?: unknown; updatedAt?: { toDate?: () => Date } };
    if (String(data.platform ?? '') !== 'ios') continue;
    iosTokens.push({
      uid: deviceDoc.id,
      token: doc.id,
      updatedAt: data.updatedAt?.toDate?.() ?? null,
    });
  }
}

if (iosTokens.length === 0) {
  console.log('Nincs iOS token — nincs mit próbálni.');
  process.exit(0);
}

iosTokens.sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
const bearer = accessToken();

for (const entry of iosTokens) {
  console.log('');
  console.log(`${entry.uid} · ${mask(entry.token)} · frissítve ${entry.updatedAt?.toISOString() ?? '(nincs)'}`);

  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token: entry.token,
        notification: { title: 'GRUNDO APNs próba', body: 'Diagnosztikai küldés.' },
        apns: { payload: { aps: { sound: 'default' } } },
      },
    }),
  });

  const body = await response.text();
  console.log(`   HTTP ${response.status}`);
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    console.log(`   ${JSON.stringify(parsed, null, 2).split('\n').join('\n   ')}`);
  } catch {
    console.log(`   ${body.slice(0, 800)}`);
  }
}

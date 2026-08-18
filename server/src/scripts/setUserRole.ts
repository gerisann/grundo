/**
 * Firebase Auth szerepkör biztonságos beállítása.
 *
 * Alapértelmezésben csak megmutatja a jelenlegi és a kért szerepkört.
 * Íráshoz `--apply`, az éles projekthez `--allow-production` is kötelező.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { adminApp, auth, COLLECTIONS, db, FIRESTORE_DATABASE_ID } from '../lib/firebase';

const ALLOWED_ROLES = ['owner', 'admin', 'moderator', 'support', 'readonly'] as const;
type AdminRole = typeof ALLOWED_ROLES[number];

const args = process.argv.slice(2);
const email = valueAfter('--email').trim().toLowerCase();
const requestedRole = valueAfter('--role') as AdminRole;
const apply = args.includes('--apply');
const allowProduction = args.includes('--allow-production');
const configuredProject = adminApp.options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? '';

if (!email || !email.includes('@')) {
  throw new Error('Add meg a fiókot: --email valaki@example.com');
}
if (!ALLOWED_ROLES.includes(requestedRole)) {
  throw new Error(`A --role értéke ezek egyike lehet: ${ALLOWED_ROLES.join(', ')}.`);
}
if (!configuredProject) {
  throw new Error('Állítsd be a GOOGLE_CLOUD_PROJECT környezeti változót a futtatás előtt.');
}
if (configuredProject === 'grundo' && apply && !allowProduction) {
  throw new Error('Éles íráshoz az --apply mellett az --allow-production kapcsoló is kötelező.');
}

const user = await auth.getUserByEmail(email);
const previousClaims = user.customClaims ?? {};
const previousRole = typeof previousClaims.role === 'string' ? previousClaims.role : null;

console.log({
  mode: apply ? 'apply' : 'dry-run',
  project: configuredProject,
  database: FIRESTORE_DATABASE_ID,
  uid: user.uid,
  email: user.email,
  previousRole,
  requestedRole,
});

if (!apply) {
  console.log('Nem történt módosítás. Íráshoz add meg: --apply --allow-production');
  process.exit(0);
}

if (previousRole === requestedRole) {
  console.log('A fiók már rendelkezik a kért szerepkörrel; nincs teendő.');
  process.exit(0);
}

const auditRef = db.collection(COLLECTIONS.adminAudit).doc();
await auditRef.create({
  adminUid: 'bootstrap-cli',
  action: 'auth_role_set',
  targetType: 'user',
  targetId: user.uid,
  before: { role: previousRole },
  after: { role: requestedRole },
  status: 'pending',
  source: 'setUserRole.ts',
  shellUser: process.env.USER ?? process.env.USERNAME ?? 'unknown',
  at: FieldValue.serverTimestamp(),
});

try {
  await auth.setCustomUserClaims(user.uid, { ...previousClaims, role: requestedRole });
  await auditRef.update({ status: 'applied', completedAt: FieldValue.serverTimestamp() });
  console.log('A szerepkör beállítva. Jelentkezz ki, majd vissza az új tokenhez.');
} catch (error) {
  await auditRef.update({
    status: 'failed',
    failedAt: FieldValue.serverTimestamp(),
    error: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
  }).catch(() => undefined);
  throw error;
}

function valueAfter(flag: string): string {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] ?? '') : '';
}

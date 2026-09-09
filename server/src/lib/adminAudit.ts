import { FieldValue } from 'firebase-admin/firestore';
import type { AuthedRequest } from '../../server';
import { COLLECTIONS, db } from './firebase';

/**
 * Naplóbejegyzés minden admin íráshoz. A napló nélküli admin művelet nem
 * létezik (`docs/06` → Admin felület).
 *
 * Azért él külön modulban, mert nem csak a `routes/admin.ts` ír admin
 * műveletet: a bugreportok triázsa is az, és két külön napló-implementációból
 * előbb-utóbb az egyik lemarad valamiről.
 */
export async function audit(
  req: AuthedRequest,
  action: string,
  targetType: string,
  targetId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await db.collection(COLLECTIONS.adminAudit).add({
    adminUid: req.uid ?? null,
    adminRole: req.role ?? null,
    action,
    targetType,
    targetId,
    before: before ?? null,
    after: after ?? null,
    at: FieldValue.serverTimestamp(),
  });
}

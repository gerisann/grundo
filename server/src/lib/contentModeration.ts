import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, db } from './firebase';

export type ContentHideReason = 'member_removed' | 'member_left' | 'user_banned';

interface HiddenContentCounts {
  bandaPosts: number;
  bandaWallMessages: number;
  bandaComments: number;
  activities: number;
  activityComments: number;
}

const emptyCounts = (): HiddenContentCounts => ({
  bandaPosts: 0,
  bandaWallMessages: 0,
  bandaComments: 0,
  activities: 0,
  activityComments: 0,
});

async function hideDocuments(
  docs: readonly FirebaseFirestore.QueryDocumentSnapshot[],
  reason: ContentHideReason,
  hiddenBy: string,
): Promise<number> {
  const visible = docs.filter((doc) => doc.get('hiddenAt') == null);
  if (visible.length === 0) return 0;

  const writer = db.bulkWriter();
  for (const doc of visible) {
    writer.update(doc.ref, {
      hiddenAt: FieldValue.serverTimestamp(),
      hiddenReason: reason,
      hiddenBy,
    });
  }
  await writer.close();
  return visible.length;
}

/**
 * Egy volt tag banda-tartalmának láthatóságát szünteti meg, fizikai törlés
 * nélkül. A komment dokumentuma megmarad, ezért a rá adott válaszok szála sem
 * szakad el; az API helyőrzőt ad vissza a személyes tartalom helyett.
 */
export async function hideBandaMemberContent(
  bandaId: string,
  uid: string,
  reason: Extract<ContentHideReason, 'member_removed' | 'member_left'>,
  hiddenBy: string,
): Promise<HiddenContentCounts> {
  const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
  const [feed, wall, allComments] = await Promise.all([
    bandaRef.collection('feed').where('authorUid', '==', uid).get(),
    bandaRef.collection('wall').where('authorUid', '==', uid).get(),
    db.collectionGroup('comments').where('authorUid', '==', uid).get(),
  ]);
  const prefix = `${bandaRef.path}/feed/`;
  const comments = allComments.docs.filter((doc) => doc.ref.path.startsWith(prefix));

  const [bandaPosts, bandaWallMessages, bandaComments] = await Promise.all([
    hideDocuments(feed.docs, reason, hiddenBy),
    hideDocuments(wall.docs, reason, hiddenBy),
    hideDocuments(comments, reason, hiddenBy),
  ]);
  return { ...emptyCounts(), bandaPosts, bandaWallMessages, bandaComments };
}

/**
 * Auditálható app-bannolás tartalomoldali része. Minden dokumentum megmarad;
 * a publikus aktivitások a már bevált soft-delete mezőket kapják, purgeAt
 * nélkül, a kommentek és banda-tartalmak pedig helyőrzőként/elhagyva jelennek
 * meg. Így csak a végleges fióktörlés végezhet fizikai törlést.
 */
export async function hideUserContentForBan(uid: string, hiddenBy: string): Promise<HiddenContentCounts> {
  const [feed, wall, bandaComments, activities, activityComments] = await Promise.all([
    db.collectionGroup('feed').where('authorUid', '==', uid).get(),
    db.collectionGroup('wall').where('authorUid', '==', uid).get(),
    db.collectionGroup('comments').where('authorUid', '==', uid).get(),
    db.collection(COLLECTIONS.activities).where('userId', '==', uid).get(),
    db.collectionGroup('comments').where('userId', '==', uid).get(),
  ]);

  const [bandaPosts, bandaWallMessages, bandaCommentCount, activityCommentCount] = await Promise.all([
    hideDocuments(feed.docs, 'user_banned', hiddenBy),
    hideDocuments(wall.docs, 'user_banned', hiddenBy),
    hideDocuments(bandaComments.docs, 'user_banned', hiddenBy),
    hideDocuments(activityComments.docs, 'user_banned', hiddenBy),
  ]);

  const visibleActivities = activities.docs.filter((doc) => doc.get('deletedAt') == null);
  if (activities.docs.length > 0) {
    const writer = db.bulkWriter();
    for (const doc of activities.docs) {
      const retentionUpdate = {
        purgeAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (doc.get('deletedAt') != null) {
        writer.update(doc.ref, retentionUpdate);
        continue;
      }
      writer.update(doc.ref, {
        ...retentionUpdate,
        previousVisibility: doc.get('visibility') ?? 'everyone',
        visibility: 'only_me',
        deletedAt: FieldValue.serverTimestamp(),
        deletedBy: 'admin_ban',
      });
    }
    await writer.close();
  }

  return {
    bandaPosts,
    bandaWallMessages,
    bandaComments: bandaCommentCount,
    activities: visibleActivities.length,
    activityComments: activityCommentCount,
  };
}

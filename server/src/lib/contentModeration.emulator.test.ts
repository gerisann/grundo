import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!EMULATOR)('Tartalom soft-hide — valódi Firestore ellen', () => {
  let db: FirebaseFirestore.Firestore;
  const uid = 'content-ban-user';
  const adminUid = 'content-ban-admin';
  const bandaId = 'content-ban-banda';
  const activityId = 'content-ban-activity';
  const deletedActivityId = 'content-ban-deleted-activity';

  beforeAll(async () => {
    db = (await import('./firebase')).db;
  });

  afterAll(async () => {
    await Promise.all([
      db.recursiveDelete(db.collection('bandas').doc(bandaId)),
      db.recursiveDelete(db.collection('activities').doc(activityId)),
      db.recursiveDelete(db.collection('activities').doc(deletedActivityId)),
    ]);
  });

  it('bannoláskor a dokumentumok megmaradnak, de minden felületi tartalom rejtett lesz', async () => {
    const bandaRef = db.collection('bandas').doc(bandaId);
    const postRef = bandaRef.collection('feed').doc('post');
    const wallRef = bandaRef.collection('wall').doc('wall');
    const bandaCommentRef = postRef.collection('comments').doc('comment');
    const activityRef = db.collection('activities').doc(activityId);
    const deletedActivityRef = db.collection('activities').doc(deletedActivityId);
    const activityCommentRef = activityRef.collection('comments').doc('comment');
    await Promise.all([
      bandaRef.set({ name: 'Teszt Banda' }),
      postRef.set({ authorUid: uid, text: 'poszt' }),
      wallRef.set({ authorUid: uid, text: 'üzenet' }),
      bandaCommentRef.set({ authorUid: uid, text: 'banda komment' }),
      activityRef.set({ userId: uid, visibility: 'everyone', title: 'aktivitás' }),
      deletedActivityRef.set({
        userId: uid,
        visibility: 'only_me',
        title: 'korábban törölt aktivitás',
        deletedAt: new Date(),
        deletedBy: uid,
        purgeAt: new Date(Date.now() + 86_400_000),
      }),
      activityCommentRef.set({ userId: uid, text: 'aktivitás komment' }),
    ]);

    const { hideUserContentForBan } = await import('./contentModeration');
    const counts = await hideUserContentForBan(uid, adminUid);
    expect(counts).toEqual({
      bandaPosts: 1,
      bandaWallMessages: 1,
      bandaComments: 1,
      activities: 1,
      activityComments: 1,
    });

    expect((await postRef.get()).data()).toMatchObject({ text: 'poszt', hiddenReason: 'user_banned' });
    expect((await wallRef.get()).data()).toMatchObject({ text: 'üzenet', hiddenReason: 'user_banned' });
    expect((await bandaCommentRef.get()).data()).toMatchObject({ text: 'banda komment', hiddenReason: 'user_banned' });
    expect((await activityCommentRef.get()).data()).toMatchObject({ text: 'aktivitás komment', hiddenReason: 'user_banned' });
    expect((await activityRef.get()).data()).toMatchObject({
      title: 'aktivitás',
      visibility: 'only_me',
      deletedBy: 'admin_ban',
    });
    expect((await activityRef.get()).get('purgeAt')).toBeUndefined();
    expect((await deletedActivityRef.get()).data()).toMatchObject({
      title: 'korábban törölt aktivitás',
      deletedBy: uid,
    });
    expect((await deletedActivityRef.get()).get('purgeAt')).toBeUndefined();
  });
});

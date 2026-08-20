/**
 * Értesítések — alkalmazáson belüli lista ÉS push, egy helyről.
 *
 * docs/05-adatmodell.md → `notifications/{uid}/items/{id}`
 * docs/02-funkcionalis-spec.md → Üzenetek és értesítések
 *
 * MINDEN értesítés ezen az EGY függvényen (`createNotification`) megy
 * keresztül — ez a KAPU, ahol a felhasználó kapcsolóit ellenőrizzük. Ez
 * szándékos válasz egy megfigyelt hibamintára: egy másik projektben
 * (KNOWS Community) az alkalmazáson belüli írás a klienskód egyik
 * segédjében nézte a kapcsolókat, a push-küldő szerver-végpont viszont NEM —
 * ott bárki, aki elérte a végpontot, push-t küldhetett a kikapcsolt
 * felhasználóknak is. Itt EGYETLEN kaput építünk, szerveroldalon, amin mind
 * az alkalmazáson belüli írás, mind a push átmegy — nem lehet csak az egyiket
 * véletlenül kihagyni.
 *
 * SOSE DOB — az `evaluateAndAwardBadges` mintájára. Egy elmaradt értesítés
 * kellemetlen, egy emiatt elhasalt aktivitás-mentés vagy kommentírás
 * elfogadhatatlan.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { COLLECTIONS, adminApp, db } from './firebase';

export type NotificationType =
  | 'gp_activity'
  | 'gp_daily'
  | 'activity_liked'
  | 'activity_commented'
  | 'comment_replied'
  | 'modifier_started'
  | 'badge_awarded'
  | 'followed_activity'
  | 'new_follower'
  | 'territory_stolen'
  | 'territory_defended';

/**
 * A katalógus — Geri 9 pontos listájából 10 kapcsoló lett, mert a „GP-vel
 * kapcsolatos értesítés" két, egymástól függetlenül kikapcsolható eseményre
 * bomlik (aktivitás utáni ÉS napi összegzés), ahogy a docs/02 spec-táblázata
 * is külön sorban tartja őket.
 *
 * Mind BE alapból — ugyanaz a döntés, mint a docs/02 „Push-események"
 * táblázatában: minden érintő esemény alapból megy, a felhasználó kapcsolja
 * ki, amelyik zavarja, ne fordítva (egy alapból néma appban senki nem találja
 * meg a bekapcsolót).
 */
export const NOTIFICATION_TYPES: Record<NotificationType, { label: string; defaultOn: true }> = {
  gp_activity: { label: 'Pontok egy aktivitás után', defaultOn: true },
  gp_daily: { label: 'Napi pont-összegzés', defaultOn: true },
  activity_liked: { label: 'Kedvelés az aktivitásodon', defaultOn: true },
  activity_commented: { label: 'Hozzászólás az aktivitásodon', defaultOn: true },
  comment_replied: { label: 'Válasz a hozzászólásodra', defaultOn: true },
  modifier_started: { label: 'Aktív akció indul', defaultOn: true },
  badge_awarded: { label: 'Új jelvény', defaultOn: true },
  followed_activity: { label: 'Követett felhasználó aktivitása', defaultOn: true },
  new_follower: { label: 'Új követő', defaultOn: true },
  territory_stolen: { label: 'Elvették a grundod', defaultOn: true },
  territory_defended: { label: 'Sikeresen megvédted a grundod', defaultOn: true },
};

export interface CreateNotificationInput {
  uid: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Kiegészítő adat a kliensnek — pl. hova navigáljon koppintásra. */
  data?: Record<string, string>;
}

/**
 * A kapcsolók helye: `users/{uid}/private/settings.notifications.{type}`.
 *
 * UGYANAZ a dokumentum, amit a docs/05 már kijelölt erre a célra
 * („értesítés-kapcsolók, e-mail preferenciák") — nem új helyet nyitunk.
 * Hiányzó mező = alapértelmezett (BE), tehát egy még nem érintett fiók sem
 * marad néma.
 */
async function readToggle(uid: string, type: NotificationType): Promise<boolean> {
  const doc = await db.collection(COLLECTIONS.users).doc(uid).collection('private').doc('settings').get();
  const notifications = (doc.data()?.notifications ?? {}) as Record<string, boolean>;
  return notifications[type] ?? NOTIFICATION_TYPES[type].defaultOn;
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    const enabled = await readToggle(input.uid, input.type);
    if (!enabled) return;

    await db
      .collection(COLLECTIONS.notifications)
      .doc(input.uid)
      .collection('items')
      .add({
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? {},
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

    await sendPush(input.uid, { title: input.title, body: input.body, data: input.data });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[notifications] ${input.type} -> ${input.uid} elhasalt`, error);
  }
}

/** Egy csoportnak (pl. minden követőnek) — ugyanaz a kapu, csak sok címzettre. */
export async function createNotificationForMany(
  uids: readonly string[],
  rest: Omit<CreateNotificationInput, 'uid'>,
): Promise<void> {
  // Egyenként megy a `createNotification`-ön át, hogy MINDENKI saját
  // kapcsolóját nézze — nem egy közös, csoportos döntést.
  await Promise.all(uids.map((uid) => createNotification({ uid, ...rest })));
}

/* ══════════════════════════════════════════════════════════════════
   Push (FCM)
   ══════════════════════════════════════════════════════════════════ */

const messaging = getMessaging(adminApp);

/** Egy `sendEachForMulticast` hívás egyszerre ennyi tokent fogad. */
const PUSH_CHUNK = 500;

/**
 * A regisztrált eszközök: `devices/{uid}/tokens/{token}`.
 *
 * A TOKEN MAGA az azonosító — nem hash-elt kulcs, mint néhány más
 * projektben. Ez a docs/05 sémája (`{ platform, updatedAt }`), és mivel a
 * kliens ide ír közvetlenül (`firestore.rules` → `allow write: if
 * isSelf(uid)`), a szervernek csak olvasnia kell.
 */
async function sendPush(
  uid: string,
  payload: { title: string; body: string; data?: Record<string, string> },
): Promise<void> {
  const tokensSnap = await db.collection(COLLECTIONS.devices).doc(uid).collection('tokens').get();
  if (tokensSnap.empty) return;
  const tokens = tokensSnap.docs.map((doc) => doc.id);

  const invalid: string[] = [];
  for (let index = 0; index < tokens.length; index += PUSH_CHUNK) {
    const chunk = tokens.slice(index, index + PUSH_CHUNK);
    const response = await messaging.sendEachForMulticast({
      notification: { title: payload.title, body: payload.body },
      data: payload.data ?? {},
      tokens: chunk,
    });
    response.responses.forEach((result, i) => {
      if (result.success) return;
      const code = result.error?.code ?? '';
      // Csak a VÉGLEGESEN érvénytelen tokent töröljük — egy átmeneti hálózati
      // hiba (pl. `messaging/internal-error`) nem ok a leiratkozásra.
      if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
        invalid.push(chunk[i]!);
      }
    });
  }

  if (invalid.length > 0) {
    const batch = db.batch();
    for (const token of invalid) {
      batch.delete(db.collection(COLLECTIONS.devices).doc(uid).collection('tokens').doc(token));
    }
    await batch.commit();
  }
}

/* ══════════════════════════════════════════════════════════════════
   Esemény-csomagolók — egy-egy hívóhely olvashatóságáért
   ══════════════════════════════════════════════════════════════════ */

/** Broadcast mindenkinek, amikor egy globális akció (modifier) élesedik. */
export function notifyModifierStarted(uids: readonly string[], reason: string): void {
  void createNotificationForMany(uids, {
    type: 'modifier_started',
    title: 'Aktív akció indult',
    body: reason,
    data: { screen: 'rules' },
  });
}

export function notifyBadgesAwarded(
  uid: string,
  badges: readonly { name: string; rewardGp: number }[],
): void {
  for (const badge of badges) {
    void createNotification({
      uid,
      type: 'badge_awarded',
      title: 'Új jelvény!',
      body: `${badge.name} — +${badge.rewardGp} GP`,
      data: { screen: 'profile' },
    });
  }
}

export function notifyTerritoryStolen(
  victimId: string,
  actorUsername: string,
  cellCount: number,
  areaM2: number,
): void {
  void createNotification({
    uid: victimId,
    type: 'territory_stolen',
    title: 'Elvették a grundod',
    body: `${actorUsername} ${Math.round(areaM2).toLocaleString('hu-HU')} m²-t vett el tőled.`,
    data: { screen: 'territory' },
  });
}

/**
 * Egy hozzászólás UTÁN — legfeljebb KÉT külön értesítés, két külön embernek.
 *
 * Az aktivitás szerzője ("kommenteltek nálad") és a válasz címzettje
 * ("válaszoltak neked") két KÜLÖNBÖZŐ ember is lehet, ezért nem elég egy
 * hívás. A kommentelő saját magát sosem értesíti (sem szerzőként, sem
 * válasz-címzettként — ez utóbbit a hívó már kiszűrte, lásd
 * `routes/activities.ts`).
 */
export async function notifyCommentPosted(input: {
  activityId: string;
  actorId: string;
  activityOwnerId: string;
  replyTo: { userId: string; username: string; commentId: string } | null;
  text: string;
}): Promise<void> {
  const { activityId, actorId, activityOwnerId, replyTo, text } = input;
  const actorDoc = await db.collection(COLLECTIONS.users).doc(actorId).get();
  const actorUsername = String((actorDoc.data() as { username?: string })?.username ?? 'Valaki');
  const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;

  /**
   * ⚠️ A VÁLASZ ELNYELI a szerzői értesítést, ha UGYANARRÓL AZ EMBERRŐL van szó.
   *
   * Mérve, éles használatban: a saját aktivitásodon a saját hozzászólásodra
   * érkezett válasz KÉT értesítést adott ugyanannak a személynek („X
   * hozzászólt az aktivitásodhoz" + „X válaszolt a hozzászólásodra"). A kettő
   * közül a VÁLASZ a pontosabb — az mondja meg, mire kattintva találod meg a
   * beszélgetést —, ezért az marad, a másik elmarad.
   *
   * Két KÜLÖNBÖZŐ embernél viszont továbbra is MINDKETTŐ megy: ha Anna
   * aktivitásán Béla ír, és Cili Béla kommentjére válaszol, Anna és Béla is
   * külön értesül, más-más szöveggel.
   */
  const replyCoversOwner = replyTo !== null && replyTo.userId === activityOwnerId;

  if (activityOwnerId && activityOwnerId !== actorId && !replyCoversOwner) {
    void createNotification({
      uid: activityOwnerId,
      type: 'activity_commented',
      title: `${actorUsername} hozzászólt az aktivitásodhoz`,
      body: preview,
      data: { screen: 'activity', activityId },
    });
  }
  if (replyTo) {
    void createNotification({
      uid: replyTo.userId,
      type: 'comment_replied',
      title: `${actorUsername} válaszolt a hozzászólásodra`,
      body: preview,
      /**
       * A `commentId` a MÉLYHIVATKOZÁSHOZ kell: a kliens ebből tudja, hogy a
       * hozzászólás-lapot is ki kell nyitnia, és melyik sort emelje ki.
       */
      data: { screen: 'activity', activityId, commentId: replyTo.commentId },
    });
  }
}

/**
 * Aktivitás utáni összefoglaló — Geri 1. és 2. pontja EGYBEN: mennyivel nőtt
 * a grund, mennyi GP jött. Csak akkor küldjük, ha VALÓBAN történt valami
 * (GP vagy terület) — egy nulla-eredményű aktivitásról (pl. teljesen a saját,
 * már maxolt területén futott) nincs mit összegezni.
 */
export function notifyGpActivity(
  uid: string,
  activityId: string,
  gpTotal: number,
  areaGainedM2: number,
): void {
  if (gpTotal <= 0 && areaGainedM2 <= 0) return;
  const parts: string[] = [];
  if (areaGainedM2 > 0) parts.push(`+${(areaGainedM2 / 1_000_000).toFixed(3)} km² grund`);
  if (gpTotal > 0) parts.push(`+${Math.round(gpTotal)} GP`);
  void createNotification({
    uid,
    type: 'gp_activity',
    title: 'Aktivitás összegzés',
    body: parts.join(' · '),
    data: { screen: 'activity', activityId },
  });
}

/** Napi összegzés — a tartás-bónuszból. A napi forduló hívja, felhasználónként. */
export function notifyGpDaily(uid: string, holdGp: number): void {
  if (holdGp <= 0) return;
  void createNotification({
    uid,
    type: 'gp_daily',
    title: 'Napi pont-összegzés',
    body: `+${Math.round(holdGp)} GP a tartott grundodért.`,
    data: { screen: 'profile' },
  });
}

export function notifyActivityLiked(activityOwnerId: string, actorUsername: string, activityId: string): void {
  void createNotification({
    uid: activityOwnerId,
    type: 'activity_liked',
    title: `${actorUsername} kedvelte az aktivitásodat`,
    body: '',
    data: { screen: 'activity', activityId },
  });
}

/**
 * A KÖVETŐK értesülnek, amikor akit követnek, felad egy aktivitást.
 *
 * NEM új követő értesítés — az nem szerepelt Geri kérésében (7. pont:
 * „Követett user aktivitást rakott ki"), ez azt fedi le.
 */
export function notifyFollowedActivity(
  followerIds: readonly string[],
  actorUsername: string,
  activityId: string,
): void {
  if (followerIds.length === 0) return;
  void createNotificationForMany(followerIds, {
    type: 'followed_activity',
    title: `${actorUsername} új aktivitást rögzített`,
    body: '',
    data: { screen: 'activity', activityId },
  });
}

/**
 * Új követő — NEM ugyanaz, mint a `followed_activity`.
 *
 * Ez akkor szól, ha valaki BEKÖVET téged; a másik akkor, ha valaki, AKIT
 * KÖVETSZ, feltesz egy aktivitást. A kettő két külön kapcsoló, mert két
 * teljesen más gyakoriságú esemény.
 */
export function notifyNewFollower(
  targetUid: string,
  actorUsername: string,
  actorUsernameLower: string,
): void {
  void createNotification({
    uid: targetUid,
    type: 'new_follower',
    title: 'Új követő',
    body: `${actorUsername} követni kezdett téged.`,
    data: { screen: 'profile', username: actorUsernameLower },
  });
}

export function notifyTerritoryDefended(victimId: string, cellCount: number): void {
  void createNotification({
    uid: victimId,
    type: 'territory_defended',
    title: 'Sikertelen támadás ellened',
    body:
      cellCount === 1
        ? '1 cellád védelme 1-gyel csökkent, de megtartottad a grundod.'
        : `${cellCount} cellád védelme 1-gyel csökkent, de megtartottad a grundod.`,
    data: { screen: 'territory' },
  });
}

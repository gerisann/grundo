/**
 * Értesítés-típusok — kliensoldali megjelenítési adatok.
 *
 * A típuskulcsok EGYEZNEK a szerverrel (`server/src/lib/notifications.ts` →
 * `NotificationType`) — ha egy típus itt vagy ott változik, a másikat is
 * frissíteni kell. Nem közös modulban élnek, mert ez a lista tisztán
 * megjelenítési adat (ikon, magyar felirat), a szervernek pedig csak a
 * kulcsra és az alapértelmezett BE/KI állapotra van szüksége — a duplikáció
 * kisebb kockázat, mint egy platform-független modult ráerőltetni egy
 * tisztán UI-célú listára.
 */

export type NotificationType =
  | 'gp_activity'
  | 'gp_daily'
  | 'activity_liked'
  | 'activity_commented'
  | 'comment_replied'
  | 'modifier_started'
  | 'badge_awarded'
  | 'followed_activity'
  | 'territory_stolen'
  | 'territory_defended';

export interface NotificationTypeInfo {
  label: string;
  /** Melyik képernyőre navigáljon a lista-elem koppintásra, ha a szerver nem ad konkrét célt. */
  fallbackScreen: string;
}

export const NOTIFICATION_TYPES: Record<NotificationType, NotificationTypeInfo> = {
  gp_activity: { label: 'Pontok egy aktivitás után', fallbackScreen: '/profil' },
  gp_daily: { label: 'Napi pont-összegzés', fallbackScreen: '/profil' },
  activity_liked: { label: 'Kedvelés az aktivitásodon', fallbackScreen: '/profil' },
  activity_commented: { label: 'Hozzászólás az aktivitásodon', fallbackScreen: '/profil' },
  comment_replied: { label: 'Válasz a hozzászólásodra', fallbackScreen: '/profil' },
  modifier_started: { label: 'Aktív akció indul', fallbackScreen: '/beallitasok/szabalyok' },
  badge_awarded: { label: 'Új jelvény', fallbackScreen: '/profil' },
  followed_activity: { label: 'Követett felhasználó aktivitása', fallbackScreen: '/kozosseg' },
  territory_stolen: { label: 'Elvették a területed', fallbackScreen: '/grund' },
  territory_defended: { label: 'Sikeresen megvédted a területed', fallbackScreen: '/grund' },
} as const;

/** A sorrend, ahogy a Beállítások képernyőn a kapcsolók megjelennek. */
export const NOTIFICATION_TYPE_ORDER: readonly NotificationType[] = [
  'territory_stolen',
  'territory_defended',
  'gp_activity',
  'gp_daily',
  'badge_awarded',
  'activity_liked',
  'activity_commented',
  'comment_replied',
  'followed_activity',
  'modifier_started',
];

export interface StoredNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  read: boolean;
  /** Unix ms. */
  createdAt: number;
}

function typeIcon(type: NotificationType): string {
  switch (type) {
    case 'territory_stolen':
      return '⚔️';
    case 'territory_defended':
      return '🛡️';
    case 'gp_activity':
    case 'gp_daily':
      return '⚡';
    case 'badge_awarded':
      return '🏅';
    case 'activity_liked':
      return '❤️';
    case 'activity_commented':
    case 'comment_replied':
      return '💬';
    case 'followed_activity':
      return '🏃';
    case 'modifier_started':
      return '📣';
  }
}

export function iconFor(type: NotificationType): string {
  return typeIcon(type);
}

export function screenFor(notification: StoredNotification): string {
  const info = NOTIFICATION_TYPES[notification.type];
  const activityId = notification.data?.activityId;
  if (activityId) return `/aktivitas/${activityId}`;
  return info.fallbackScreen;
}

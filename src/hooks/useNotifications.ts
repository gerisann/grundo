/**
 * Élő értesítés-lista — a saját `notifications/{uid}/items` alkollekcióra
 * feliratkozva.
 *
 * VALÓS IDEJŰ (`onSnapshot`), nem lekérdezéses: a harang-számláló és a lista
 * magától frissül, amikor a szerver ír. Ugyanaz a minta, mint a
 * `useSharedPosition`-nél.
 */

import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, updateDoc, doc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from './AuthProvider';
import type { StoredNotification } from '@/lib/notificationTypes';

/** Ennyi legutóbbi értesítést tartunk élőben — a régebbieket a lap „több" gombja tölti majd, ha valaha kell. */
const LIST_LIMIT = 50;

export interface NotificationsState {
  items: StoredNotification[];
  unreadCount: number;
  loading: boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

export function useNotifications(): NotificationsState {
  const { user } = useAuth();
  const [items, setItems] = useState<StoredNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !db) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, 'notifications', user.uid, 'items'),
      orderBy('createdAt', 'desc'),
      limit(LIST_LIMIT),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setItems(
          snapshot.docs.map((item) => {
            const data = item.data() as Omit<StoredNotification, 'id' | 'createdAt'> & {
              createdAt?: { toMillis(): number };
            };
            return {
              id: item.id,
              type: data.type,
              title: data.title,
              body: data.body,
              data: data.data,
              read: data.read,
              createdAt: data.createdAt?.toMillis() ?? 0,
            };
          }),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsubscribe;
  }, [user]);

  const unreadCount = items.filter((item) => !item.read).length;

  function markRead(id: string) {
    if (!user || !db) return;
    // Optimista: a felület azonnal olvasottként mutatja, a Firestore-írás
    // hibáját nem várjuk meg — egy elmaradt „olvasott" jelölés ártalmatlan.
    setItems((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)));
    void updateDoc(doc(db, 'notifications', user.uid, 'items', id), { read: true }).catch(() => {});
  }

  function markAllRead() {
    if (!user || !db) return;
    const unread = items.filter((item) => !item.read);
    if (unread.length === 0) return;
    setItems((current) => current.map((item) => ({ ...item, read: true })));
    const batch = writeBatch(db);
    for (const item of unread) {
      batch.update(doc(db, 'notifications', user.uid, 'items', item.id), { read: true });
    }
    void batch.commit().catch(() => {});
  }

  return { items, unreadCount, loading, markRead, markAllRead };
}

/**
 * Élő értesítés-lista — a saját `notifications/{uid}/items` alkollekcióra
 * feliratkozva.
 *
 * VALÓS IDEJŰ (`onSnapshot`), nem lekérdezéses: a harang-számláló és a lista
 * magától frissül, amikor a szerver ír. Ugyanaz a minta, mint a
 * `useSharedPosition`-nél.
 *
 * LAPOZÁS: a feliratkozás ablaka NŐ (`limit(size)`), nem új lekérdezés indul.
 * Így a „továbbiak betöltése" után is EGY élő feliratkozás marad, és az
 * újonnan érkező értesítés továbbra is magától jelenik meg a lista tetején.
 * Ára: bővítéskor a teljes ablak újra beolvasódik — húsz-negyven dokumentumnál
 * ez olcsóbb, mint két feliratkozást összefésülni.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from './AuthProvider';
import type { StoredNotification } from '@/lib/notificationTypes';

/** Egy lapnyi értesítés. A panel ennyivel indul, és ennyivel bővít. */
export const NOTIFICATION_PAGE_SIZE = 20;

/**
 * Egy törlő kötegbe ennyi művelet kerül.
 *
 * A Firestore kötegek felső határa 500 — a 400 azért van, hogy maradjon
 * mozgástér, ha a törlés mellé valaha más művelet is kerül.
 */
const DELETE_CHUNK = 400;

export interface NotificationsState {
  items: StoredNotification[];
  unreadCount: number;
  loading: boolean;
  /** Van-e még a betöltött ablakon túl — a „továbbiak" gomb ettől látszik. */
  hasMore: boolean;
  loadMore: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  /** MINDET törli, nem csak a betöltött ablakot. */
  removeAll: () => Promise<void>;
}

export function useNotifications(): NotificationsState {
  const { user } = useAuth();
  const [items, setItems] = useState<StoredNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [size, setSize] = useState(NOTIFICATION_PAGE_SIZE);
  /** Tele jött-e vissza az ablak — csak ekkor lehet még hátra bármi. */
  const [full, setFull] = useState(false);

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
      limit(size),
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
        setFull(snapshot.docs.length >= size);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsubscribe;
  }, [user, size]);

  const unreadCount = items.filter((item) => !item.read).length;

  const loadMore = useCallback(() => {
    setSize((current) => current + NOTIFICATION_PAGE_SIZE);
  }, []);

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

  function remove(id: string) {
    if (!user || !db) return;
    /*
      Szintén optimista: a sor azonnal eltűnik. Ha a törlés mégis elbukna
      (például mert a `firestore.rules` frissítése nem ment ki), a következő
      pillanatkép visszahozza a sort — ez a helyes viselkedés, mert a lista
      így soha nem hazudik arról, mi van a szerveren.
    */
    setItems((current) => current.filter((item) => item.id !== id));
    void deleteDoc(doc(db, 'notifications', user.uid, 'items', id)).catch(() => {});
  }

  async function removeAll(): Promise<void> {
    if (!user || !db) return;
    setItems([]);
    /*
      A TELJES kollekciót kérjük le, nem a betöltött ablakot: a „mindet
      törlöm" azt jelenti, hogy mindet — akkor is, ha a felhasználó csak az
      első húszat látta.
    */
    const all = await getDocs(collection(db, 'notifications', user.uid, 'items'));
    for (let from = 0; from < all.docs.length; from += DELETE_CHUNK) {
      const batch = writeBatch(db);
      for (const item of all.docs.slice(from, from + DELETE_CHUNK)) {
        batch.delete(item.ref);
      }
      await batch.commit();
    }
  }

  return {
    items,
    unreadCount,
    loading,
    hasMore: full,
    loadMore,
    markRead,
    markAllRead,
    remove,
    removeAll,
  };
}

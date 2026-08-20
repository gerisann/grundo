import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { ScreenHeader, Switch } from '@/components/ui';
import { useAuth } from '@/hooks/AuthProvider';
import { db } from '@/lib/firebase';
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_ORDER, type NotificationType } from '@/lib/notificationTypes';
import { currentPushPermission, requestPermissionAndSubscribe, unsubscribe } from '@/lib/push';
import './notifications.css';

/**
 * Értesítések — típusonkénti be/ki kapcsolók.
 *
 * A KAPCSOLÓK a `users/{uid}/private/settings` dokumentumon élnek —
 * UGYANOTT, ahova a docs/05 már kijelölte őket („értesítés-kapcsolók, e-mail
 * preferenciák"). A kliens KÖZVETLENÜL írja (`firestore.rules` →
 * `private/{docId}: allow read, write: if isSelf(uid)`), nincs hozzá
 * szerver-végpont — ugyanaz a minta, mint a megjelenés-beállításnál.
 *
 * A tényleges KIOSZTÁS és PUSH-KÜLDÉS szerveroldalon dönt a kapcsoló
 * alapján (`server/src/lib/notifications.ts` → `createNotification`), tehát
 * egy itt kikapcsolt típus a szerveren se ír, se küld — nem csak a
 * felületen tűnik el.
 */
export function NotificationsScreen() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Partial<Record<NotificationType, boolean>>>({});
  const [loaded, setLoaded] = useState(false);
  const [pushPermission, setPushPermission] = useState(currentPushPermission());
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');

  useEffect(() => {
    if (!user || !db) return;
    return onSnapshot(doc(db, 'users', user.uid, 'private', 'settings'), (snapshot) => {
      const notifications = (snapshot.data()?.notifications ?? {}) as Partial<
        Record<NotificationType, boolean>
      >;
      setSettings(notifications);
      setLoaded(true);
    });
  }, [user]);

  function setType(type: NotificationType, value: boolean) {
    if (!user || !db) return;
    // Optimista — a Firestore-feliratkozás úgyis visszaigazolja.
    setSettings((current) => ({ ...current, [type]: value }));
    void setDoc(
      doc(db, 'users', user.uid, 'private', 'settings'),
      { notifications: { [type]: value } },
      { merge: true },
    );
  }

  async function togglePush(value: boolean) {
    if (!user) return;
    setPushBusy(true);
    setPushError('');
    try {
      if (value) {
        const ok = await requestPermissionAndSubscribe(user.uid);
        if (!ok) {
          setPushError(
            currentPushPermission() === 'denied'
              ? 'A böngésző letiltotta az értesítést. A böngésző beállításaiban engedélyezheted újra.'
              : 'Nem sikerült bekapcsolni a push-értesítést ezen az eszközön.',
          );
        }
      } else {
        await unsubscribe(user.uid);
      }
    } finally {
      setPushPermission(currentPushPermission());
      setPushBusy(false);
    }
  }

  return (
    <>
      <ScreenHeader title="Értesítések" backTo="/beallitasok" />
      <div className="screen-body stack">
        <section className="card">
          <Switch
            checked={pushPermission === 'granted'}
            onChange={(value) => void togglePush(value)}
            disabled={pushBusy || pushPermission === 'unsupported'}
            label="Push-értesítés ezen az eszközön"
            description={
              pushPermission === 'unsupported'
                ? 'Ez a böngésző nem támogatja a push-értesítést.'
                : 'A lenti kapcsolók az alkalmazáson belüli listát ÉS a push-t is vezérlik — ez csak azt dönti el, kapjon-e ez az eszköz rendszerértesítést is.'
            }
          />
          {pushError ? <p className="field__error" role="alert">{pushError}</p> : null}
        </section>

        <section>
          <div className="label list__group-label">Miről szóljunk</div>
          <div className="card notif-settings">
            {NOTIFICATION_TYPE_ORDER.map((type) => (
              <Switch
                key={type}
                checked={settings[type] ?? true}
                onChange={(value) => setType(type, value)}
                disabled={!loaded}
                label={NOTIFICATION_TYPES[type].label}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

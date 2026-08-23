import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { ScreenHeader, Switch } from '@/components/ui';
import { useAuth } from '@/hooks/AuthProvider';
import { db } from '@/lib/firebase';
import { isNativeIos } from '@/lib/platform';
import { liveActivityEnabled, setLiveActivityEnabled } from '@/tracking/liveActivity';
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_ORDER, type NotificationType } from '@/lib/notificationTypes';
import {
  currentPushPermission,
  readPushPermission,
  requestPermissionAndSubscribe,
  unsubscribe,
  type PushFailure,
} from '@/lib/push';
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
/**
 * A push-hiba MEGNEVEZETT okhoz tartozó, ÉRTHETŐ magyar üzenete.
 *
 * A `no_vapid_key` szándékosan üzemeltetési nyelven szól: az a build
 * konfigurációjának hibája, nem a felhasználóé — ha ezt kapja, nem az ő
 * böngészőjével van baj, és a szöveg ezt ki is mondja.
 */
const PUSH_ERROR: Record<PushFailure, string> = {
  no_vapid_key:
    'A push-értesítés nincs beállítva ebben a webes buildben (hiányzó VAPID-kulcs). Ez a mi hibánk, nem a tiéd — szólj nekünk.',
  unsupported: 'Ez a böngésző vagy eszköz nem támogatja a push-értesítést.',
  permission_denied:
    'Az értesítési engedély le van tiltva. Az eszköz vagy a böngésző értesítési beállításaiban engedélyezheted újra.',
  sw_failed:
    'Nem sikerült elindítani a háttérszolgáltatást. Próbáld újratölteni az oldalt — privát böngészés közben ez nem működik.',
  token_failed:
    'Nem sikerült eszközazonosítót kérni az értesítéshez. A részletek a böngésző konzoljában láthatók.',
};

export function NotificationsScreen() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Partial<Record<NotificationType, boolean>>>({});
  const [loaded, setLoaded] = useState(false);
  const [pushPermission, setPushPermission] = useState(currentPushPermission());
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');
  const [liveStats, setLiveStats] = useState(liveActivityEnabled);

  useEffect(() => {
    let active = true;
    void readPushPermission().then((permission) => {
      if (active) setPushPermission(permission);
    });
    return () => {
      active = false;
    };
  }, []);

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
        const result = await requestPermissionAndSubscribe(user.uid);
        if (!result.ok) setPushError(PUSH_ERROR[result.reason]);
      } else {
        await unsubscribe(user.uid);
      }
    } finally {
      setPushPermission(await readPushPermission());
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
                ? 'Ez az eszköz vagy környezet nem támogatja a push-értesítést.'
                : 'A lenti kapcsolók az alkalmazáson belüli listát ÉS a push-t is vezérlik — ez csak azt dönti el, kapjon-e ez az eszköz rendszerértesítést is.'
            }
          />
          {pushError ? <p className="field__error" role="alert">{pushError}</p> : null}
        </section>

        {isNativeIos() ? (
          <section className="card">
            <Switch
              checked={liveStats}
              onChange={(value) => {
                setLiveStats(value);
                setLiveActivityEnabled(value);
              }}
              label="Élő mérés a zárolt képernyőn"
              description="A következő rögzítéstől az idő, táv és sebesség megjelenik a Live Activityben és a Dynamic Islanden."
            />
          </section>
        ) : null}

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

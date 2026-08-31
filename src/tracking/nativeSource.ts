/**
 * Pozíció a GRUNDO saját, Capacitoron át elérhető natív helyforrásából.
 *
 * A Capacitor WebView `navigator.geolocation` API-ja nem alkalmas megbízható
 * háttérmérésre. A plugin ezzel szemben a tényleges GRUNDO alkalmazás natív
 * jogosultságát kéri. iOS-en Core Location, Androidon egy location típusú
 * foreground service teszi tartós sorba a pontokat, amelyeket az ébredő
 * JavaScript átvesz.
 */

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { ActivityType } from '@/types';
import { liveActivityEnabled } from './liveActivity';
import {
  TrackingError,
  type PositionActivityState,
  type PositionHandlers,
  type PositionSource,
} from './types';

interface NativeLocation {
  lat: number;
  lng: number;
  t: number;
  accuracy: number;
  elevation?: number;
  speed?: number;
}

interface BackgroundLocationPlugin {
  start(options: {
    activityType: ActivityType;
    activityState?: PositionActivityState;
    liveActivityEnabled: boolean;
  }): Promise<{
    permission: 'granted' | 'prompt';
    backgroundPermission?: 'granted' | 'not_granted';
    notificationPermission?: 'granted' | 'not_granted';
  }>;
  stop(): Promise<void>;
  syncActivity(options: PositionActivityState): Promise<void>;
  drain(): Promise<{ locations: NativeLocation[] }>;
  addListener(eventName: 'location', listenerFunc: (location: NativeLocation) => void): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'error',
    listenerFunc: (error: { code?: string; message?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const BackgroundLocation = registerPlugin<BackgroundLocationPlugin>('BackgroundLocation');

export class NativePositionSource implements PositionSource {
  readonly name = 'native';
  private backgroundPermissionGranted = false;
  get supportsBackground(): boolean {
    return this.backgroundPermissionGranted;
  }
  readonly ordered = false;

  private locationListener: PluginListenerHandle | null = null;
  private errorListener: PluginListenerHandle | null = null;
  private visibilityListener: (() => void) | null = null;
  private handlers: PositionHandlers | null = null;
  /**
   * A natív esemény és a tartós sor drainje ébredéskor versenyezhet.
   * Amíg a drain fut, az élő eseményeket itt tartjuk, majd a teljes köteget
   * időrendben adjuk át. Enélkül egy friss esemény előreszaladhatott, és a
   * korábbi háttérpontokat a régi monotónia-őr mind eldobta.
   */
  private drainPromise: Promise<void> | null = null;
  private awaitingForegroundDrain = false;
  private bufferedLocations: NativeLocation[] = [];
  private deliveredTimestamps = new Set<number>();

  async start(
    handlers: PositionHandlers,
    activityType: ActivityType = 'run',
    activityState?: PositionActivityState,
  ): Promise<void> {
    // Egy új WebView ugyanahhoz a már futó natív helyméréshez
    // kapcsolódik vissza. Itt TILOS a natív szolgáltatást leállítani: az
    // átmeneti WebView-újraindulás különben valódi GPS-lyukat okozna.
    await this.detach();
    this.handlers = handlers;
    this.locationListener = await BackgroundLocation.addListener('location', (location) => {
      if (
        this.drainPromise !== null ||
        this.awaitingForegroundDrain ||
        document.visibilityState !== 'visible'
      ) this.bufferedLocations.push(location);
      else this.deliver(location);
    });
    this.errorListener = await BackgroundLocation.addListener('error', (error) => {
      handlers.onError(toTrackingError(error));
    });
    this.visibilityListener = () => {
      if (document.visibilityState !== 'visible') {
        this.awaitingForegroundDrain = true;
        return;
      }
      void this.drain();
    };
    document.addEventListener('visibilitychange', this.visibilityListener);

    try {
      const status = await BackgroundLocation.start({
        activityType,
        activityState,
        liveActivityEnabled: liveActivityEnabled(),
      });
      this.backgroundPermissionGranted = status.backgroundPermission === 'granted';
      await this.drain();
    } catch (error) {
      await this.stop();
      throw toTrackingError(error);
    }
  }

  async syncActivity(state: PositionActivityState): Promise<void> {
    await BackgroundLocation.syncActivity(state);
  }

  async stop(): Promise<void> {
    if (this.handlers !== null) await this.drain();
    await this.detach();
    this.backgroundPermissionGranted = false;
    await BackgroundLocation.stop().catch(() => undefined);
    this.awaitingForegroundDrain = false;
    this.bufferedLocations = [];
    this.deliveredTimestamps.clear();
  }

  async detach(): Promise<void> {
    await this.locationListener?.remove();
    await this.errorListener?.remove();
    if (this.visibilityListener !== null) {
      document.removeEventListener('visibilitychange', this.visibilityListener);
    }
    this.locationListener = null;
    this.errorListener = null;
    this.visibilityListener = null;
    this.handlers = null;
  }

  private drain(): Promise<void> {
    // A visibility, a start és a stop ugyanarra a folyamatban lévő drainre
    // vár. Ha a stop csak azonnal visszatérne, leválasztaná a handlert,
    // mielőtt a már kiolvasott háttérpontok eljutnak a recorderhez.
    if (this.drainPromise !== null) return this.drainPromise;

    this.drainPromise = (async () => {
      try {
        const queued = await BackgroundLocation.drain().catch(() => null);
        const locations = [
          ...(queued?.locations ?? []),
          ...this.bufferedLocations.splice(0),
        ].sort((a, b) => a.t - b.t);
        for (const location of locations) this.deliver(location);
      } finally {
        // A fenti szinkron feldolgozás alatt nem futhat JS callback, de a
        // `finally` védi azt az esetet is, ha a plugin-válasz feldolgozása
        // később aszinkron lépéssel bővülne.
        const remaining = this.bufferedLocations.splice(0).sort((a, b) => a.t - b.t);
        for (const location of remaining) this.deliver(location);
        this.awaitingForegroundDrain = false;
        this.drainPromise = null;
      }
    })();
    return this.drainPromise;
  }

  private deliver(location: NativeLocation): void {
    if (this.handlers === null || this.deliveredTimestamps.has(location.t)) return;
    this.deliveredTimestamps.add(location.t);
    this.handlers.onSample(location);
  }
}

function toTrackingError(error: unknown): TrackingError {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : '';
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : '';

  if (code === 'permission_denied' || message.includes('helyhozzáférés')) {
    return new TrackingError(
      'permission_denied',
      message || 'Nincs helyhozzáférés. Engedélyezd a GRUNDO számára a készülék beállításaiban.',
    );
  }
  if (code === 'location_disabled') {
    return new TrackingError(
      'unavailable',
      message || 'A helymeghatározás ki van kapcsolva a készüléken.',
    );
  }
  return new TrackingError('unavailable', message || 'A helymeghatározás nem sikerült.');
}

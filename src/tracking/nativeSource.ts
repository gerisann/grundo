/**
 * Pozíció a GRUNDO saját, Capacitoron át elérhető natív helyforrásából.
 *
 * Az iOS WKWebView `navigator.geolocation` API-ja a webes eredetet
 * ("localhost") nevezi meg az engedélykérésben. A plugin ezzel szemben a
 * tényleges GRUNDO alkalmazás natív jogosultságát kéri, és nem függ a
 * WKWebView böngészős helytárolásától. A Swift réteg a lezárt képernyő alatt
 * is sorba teszi a pontokat, amelyeket az ébredő JavaScript átvesz.
 */

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { ActivityType } from '@/types';
import {
  TrackingError,
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
  start(options: { activityType: ActivityType }): Promise<{
    permission: 'granted' | 'prompt';
    backgroundPermission?: 'granted' | 'not_granted';
  }>;
  stop(): Promise<void>;
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
  private lastDeliveredAt = 0;

  async start(handlers: PositionHandlers, activityType: ActivityType = 'run'): Promise<void> {
    await this.stop();
    this.handlers = handlers;
    this.locationListener = await BackgroundLocation.addListener('location', (location) => {
      this.deliver(location);
    });
    this.errorListener = await BackgroundLocation.addListener('error', (error) => {
      handlers.onError(toTrackingError(error));
    });
    this.visibilityListener = () => {
      if (document.visibilityState === 'visible') void this.drain();
    };
    document.addEventListener('visibilitychange', this.visibilityListener);

    try {
      const status = await BackgroundLocation.start({ activityType });
      this.backgroundPermissionGranted = status.backgroundPermission === 'granted';
      await this.drain();
    } catch (error) {
      await this.stop();
      throw toTrackingError(error);
    }
  }

  async stop(): Promise<void> {
    if (this.handlers !== null) await this.drain();
    await this.locationListener?.remove();
    await this.errorListener?.remove();
    if (this.visibilityListener !== null) {
      document.removeEventListener('visibilitychange', this.visibilityListener);
    }
    this.locationListener = null;
    this.errorListener = null;
    this.visibilityListener = null;
    this.handlers = null;
    this.backgroundPermissionGranted = false;
    await BackgroundLocation.stop().catch(() => undefined);
  }

  private async drain(): Promise<void> {
    const queued = await BackgroundLocation.drain().catch(() => null);
    for (const location of queued?.locations ?? []) this.deliver(location);
  }

  private deliver(location: NativeLocation): void {
    if (this.handlers === null || location.t <= this.lastDeliveredAt) return;
    this.lastDeliveredAt = location.t;
    this.handlers.onSample(location);
  }
}

function toTrackingError(error: unknown): TrackingError {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : '';
  const message = error instanceof Error ? error.message : '';

  if (code === 'permission_denied' || message.includes('helyhozzáférés')) {
    return new TrackingError(
      'permission_denied',
      'Nincs helyhozzáférés. Engedélyezd a GRUNDO számára a készülék beállításaiban.',
    );
  }
  return new TrackingError('unavailable', 'A helymeghatározás nem sikerült.');
}

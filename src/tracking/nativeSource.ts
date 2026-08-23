/**
 * Pozíció a Capacitor natív Geolocation pluginjából.
 *
 * Az iOS WKWebView `navigator.geolocation` API-ja a webes eredetet
 * ("localhost") nevezi meg az engedélykérésben. A plugin ezzel szemben a
 * tényleges GRUNDO alkalmazás natív jogosultságát kéri, és nem függ a
 * WKWebView böngészős helytárolásától.
 */

import { Geolocation, type CallbackID, type Position } from '@capacitor/geolocation';
import {
  TrackingError,
  type PositionHandlers,
  type PositionSample,
  type PositionSource,
} from './types';

const OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 30_000,
} as const;

export class NativePositionSource implements PositionSource {
  readonly name = 'native';
  // Háttérméréshez külön Background Modes és erre tervezett szolgáltatás kell.
  readonly supportsBackground = false;
  readonly ordered = true;

  private watchId: CallbackID | null = null;

  async start(handlers: PositionHandlers): Promise<void> {
    const current = await Geolocation.checkPermissions();
    const permission = current.location === 'granted'
      ? current
      : await Geolocation.requestPermissions({ permissions: ['location'] });

    if (permission.location !== 'granted') {
      throw new TrackingError(
        'permission_denied',
        'Nincs helyhozzáférés. Engedélyezd a GRUNDO számára a készülék beállításaiban.',
      );
    }

    await this.stop();
    this.watchId = await Geolocation.watchPosition(OPTIONS, (position, error) => {
      if (error) {
        handlers.onError(toTrackingError(error));
        return;
      }
      if (position) handlers.onSample(toSample(position));
    });
  }

  async stop(): Promise<void> {
    if (this.watchId === null) return;
    const id = this.watchId;
    this.watchId = null;
    await Geolocation.clearWatch({ id });
  }
}

function toSample(position: Position): PositionSample {
  const c = position.coords;
  return {
    lat: c.latitude,
    lng: c.longitude,
    t: position.timestamp,
    accuracy: c.accuracy,
    ...(c.altitude !== null ? { elevation: c.altitude } : {}),
    ...(c.speed !== null ? { speed: c.speed } : {}),
  };
}

function toTrackingError(error: unknown): TrackingError {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : '';

  if (code === 'OS-PLUG-GLOC-0003' || code === 'OS-PLUG-GLOC-0008') {
    return new TrackingError(
      'permission_denied',
      'Nincs helyhozzáférés. Engedélyezd a GRUNDO számára a készülék beállításaiban.',
    );
  }
  if (code === 'OS-PLUG-GLOC-0010') {
    return new TrackingError('timeout', 'Nem érkezett helyadat. Keressük a jelet…');
  }
  if (code === 'OS-PLUG-GLOC-0007') {
    return new TrackingError('unavailable', 'A készüléken ki van kapcsolva a helymeghatározás.');
  }
  return new TrackingError('unavailable', 'A helymeghatározás nem sikerült.');
}

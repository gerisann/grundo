import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { normalizeBearing } from '@/lib/heading';
import { isNativeApp } from '@/lib/platform';

export type HeadingAccuracy = 'unreliable' | 'low' | 'medium' | 'high';

export interface DeviceHeadingSample {
  degrees: number;
  at: number;
  source: 'true' | 'magnetic';
  accuracy?: HeadingAccuracy;
  accuracyDeg?: number;
}

interface NativeHeadingEvent {
  degrees?: unknown;
  at?: unknown;
  source?: unknown;
  accuracy?: unknown;
  accuracyDeg?: unknown;
}

interface DeviceHeadingPlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
  addListener(
    eventName: 'heading',
    listener: (event: NativeHeadingEvent) => void,
  ): Promise<PluginListenerHandle>;
}

const DeviceHeading = registerPlugin<DeviceHeadingPlugin>('DeviceHeading');
const ACCURACY_VALUES = new Set<HeadingAccuracy>(['unreliable', 'low', 'medium', 'high']);

/** Subscribe to native compass samples. Web intentionally has no fallback. */
export async function watchDeviceHeading(
  listener: (sample: DeviceHeadingSample) => void,
): Promise<() => Promise<void>> {
  if (!isNativeApp()) return async () => undefined;

  const handle = await DeviceHeading.addListener('heading', (event) => {
    const sample = parseHeadingEvent(event);
    if (sample) listener(sample);
  });
  try {
    await DeviceHeading.start();
  } catch (error) {
    await handle.remove();
    throw error;
  }

  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    await handle.remove();
    await DeviceHeading.stop();
  };
}

export function parseHeadingEvent(event: NativeHeadingEvent): DeviceHeadingSample | null {
  if (typeof event.degrees !== 'number' || !Number.isFinite(event.degrees)) return null;
  const rawDegrees = event.degrees;

  const rawAt = Number(event.at);
  const rawAccuracyDeg = typeof event.accuracyDeg === 'number' ? event.accuracyDeg : Number.NaN;
  const rawAccuracy = String(event.accuracy ?? '') as HeadingAccuracy;
  return {
    degrees: normalizeBearing(rawDegrees),
    at: Number.isFinite(rawAt) && rawAt > 0 ? rawAt : Date.now(),
    source: event.source === 'true' ? 'true' : 'magnetic',
    ...(ACCURACY_VALUES.has(rawAccuracy) ? { accuracy: rawAccuracy } : {}),
    ...(Number.isFinite(rawAccuracyDeg) && rawAccuracyDeg >= 0
      ? { accuracyDeg: rawAccuracyDeg }
      : {}),
  };
}

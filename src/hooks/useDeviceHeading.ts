import { useEffect, useState } from 'react';
import { watchDeviceHeading, type DeviceHeadingSample } from '@/lib/deviceHeading';

/** Native compass heading while the caller's map needs it. */
export function useDeviceHeading(enabled: boolean): DeviceHeadingSample | null {
  const [sample, setSample] = useState<DeviceHeadingSample | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSample(null);
      return;
    }

    let disposed = false;
    let stop: (() => Promise<void>) | null = null;
    void watchDeviceHeading((next) => {
      if (!disposed) setSample(next);
    }).then((unsubscribe) => {
      if (disposed) void unsubscribe().catch(() => undefined);
      else stop = unsubscribe;
    }).catch(() => {
      if (!disposed) setSample(null);
    });

    return () => {
      disposed = true;
      if (stop) void stop().catch(() => undefined);
    };
  }, [enabled]);

  return sample;
}

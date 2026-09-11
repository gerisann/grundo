import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const native = vi.hoisted(() => {
  let listener: ((event: Record<string, unknown>) => void) | null = null;
  const remove = vi.fn(async () => undefined);
  const plugin = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    addListener: vi.fn(async (_eventName: string, next: typeof listener) => {
      listener = next;
      return { remove };
    }),
  };
  return {
    plugin,
    remove,
    emit(event: Record<string, unknown>) {
      listener?.(event);
    },
    reset() {
      listener = null;
      vi.clearAllMocks();
    },
  };
});

const platform = vi.hoisted(() => ({ native: true }));

vi.mock('@capacitor/core', () => ({ registerPlugin: () => native.plugin }));
vi.mock('@/lib/platform', () => ({ isNativeApp: () => platform.native }));

import { parseHeadingEvent, watchDeviceHeading } from './deviceHeading';

describe('device heading bridge', () => {
  beforeEach(() => {
    native.reset();
    platform.native = true;
  });

  it('normalizes native headings and preserves calibration metadata', () => {
    expect(parseHeadingEvent({
      degrees: 725,
      at: 42,
      source: 'true',
      accuracyDeg: 8,
    })).toEqual({
      degrees: 5,
      at: 42,
      source: 'true',
      accuracyDeg: 8,
    });
    expect(parseHeadingEvent({ degrees: 'invalid' })).toBeNull();
  });

  it('is compiled and registered by both native applications', () => {
    const iosProject = readFileSync(
      new URL('../../ios/App/App.xcodeproj/project.pbxproj', import.meta.url),
      'utf8',
    );
    const iosBridge = readFileSync(
      new URL('../../ios/App/App/GRUNDOBridgeViewController.swift', import.meta.url),
      'utf8',
    );
    const androidActivity = readFileSync(
      new URL(
        '../../android/app/src/main/java/app/grundo/android/MainActivity.java',
        import.meta.url,
      ),
      'utf8',
    );

    expect(iosProject).toContain('DeviceHeadingPlugin.swift in Sources');
    expect(iosBridge).toContain('registerPluginInstance(DeviceHeadingPlugin())');
    expect(androidActivity).toContain('registerPlugin(DeviceHeadingPlugin.class)');
  });

  it('starts and stops the native sensor around the subscription', async () => {
    const received: number[] = [];
    const stop = await watchDeviceHeading((sample) => received.push(sample.degrees));

    native.emit({ degrees: -10, at: 100, accuracy: 'high' });
    expect(received).toEqual([350]);
    expect(native.plugin.start).toHaveBeenCalledOnce();

    await stop();
    expect(native.remove).toHaveBeenCalledOnce();
    expect(native.plugin.stop).toHaveBeenCalledOnce();
  });

  it('does not touch a native sensor on the web', async () => {
    platform.native = false;
    const stop = await watchDeviceHeading(vi.fn());
    await stop();

    expect(native.plugin.addListener).not.toHaveBeenCalled();
    expect(native.plugin.start).not.toHaveBeenCalled();
  });
});

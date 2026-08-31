import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockLocation {
  lat: number;
  lng: number;
  t: number;
  accuracy: number;
}

const native = vi.hoisted(() => {
  let locationListener: ((location: MockLocation) => void) | null = null;
  let resolveDrain: ((value: { locations: MockLocation[] }) => void) | null = null;

  const plugin = {
    start: vi.fn(async () => ({
      permission: 'granted' as const,
      backgroundPermission: 'granted' as const,
    })),
    stop: vi.fn(async () => undefined),
    syncActivity: vi.fn(async () => undefined),
    drain: vi.fn(() => new Promise<{ locations: MockLocation[] }>((resolve) => {
      resolveDrain = resolve;
    })),
    addListener: vi.fn(async (eventName: string, listener: (value: MockLocation) => void) => {
      if (eventName === 'location') locationListener = listener;
      return { remove: vi.fn(async () => undefined) };
    }),
  };

  return {
    plugin,
    emit(location: MockLocation) {
      locationListener?.(location);
    },
    finishDrain(locations: MockLocation[]) {
      if (resolveDrain === null) throw new Error('A drain még nem indult el.');
      resolveDrain({ locations });
      resolveDrain = null;
    },
    reset() {
      locationListener = null;
      resolveDrain = null;
      vi.clearAllMocks();
    },
  };
});

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => native.plugin,
}));

vi.mock('./liveActivity', () => ({
  liveActivityEnabled: () => true,
}));

import { NativePositionSource } from './nativeSource';

const BASE = { lat: 47.4979, lng: 19.0402 };

function sample(t: number, offset = 0): MockLocation {
  return {
    lat: BASE.lat + offset / 111_320,
    lng: BASE.lng,
    t,
    accuracy: 5,
  };
}

describe('NativePositionSource háttérsor', () => {
  beforeEach(() => {
    native.reset();
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('nem ejti el a háttérsor régebbi pontjait, ha egy friss esemény megelőzi a draint', async () => {
    const received: number[] = [];
    const source = new NativePositionSource();
    const starting = source.start({
      onSample: (location) => received.push(location.t),
      onError: vi.fn(),
    }, 'ride');

    await vi.waitFor(() => expect(native.plugin.drain).toHaveBeenCalledOnce());

    // Ébredéskor a Capacitor bridge friss eseménye versenyez a tartós sor
    // drainjével. A köztes útvonal akkor is előbb és pontosan egyszer kell.
    native.emit(sample(300, 30));
    native.finishDrain([sample(100, 10), sample(200, 20), sample(300, 30)]);
    await starting;

    expect(received).toEqual([100, 200, 300]);
  });

  it('a leállítás bevárja a már futó draint a listener leválasztása előtt', async () => {
    const received: number[] = [];
    const source = new NativePositionSource();
    const starting = source.start({
      onSample: (location) => received.push(location.t),
      onError: vi.fn(),
    }, 'ride');

    await vi.waitFor(() => expect(native.plugin.drain).toHaveBeenCalledOnce());
    const stopping = source.stop();
    await Promise.resolve();
    expect(native.plugin.stop).not.toHaveBeenCalled();

    native.finishDrain([sample(100, 10), sample(200, 20)]);
    await Promise.all([starting, stopping]);

    expect(received).toEqual([100, 200]);
    expect(native.plugin.stop).toHaveBeenCalledOnce();
  });

  it('háttérből ébredéskor a drain előtt érkező élő pontot is időrendbe rendezi', async () => {
    const received: number[] = [];
    const source = new NativePositionSource();
    const starting = source.start({
      onSample: (location) => received.push(location.t),
      onError: vi.fn(),
    }, 'ride');

    await vi.waitFor(() => expect(native.plugin.drain).toHaveBeenCalledOnce());
    native.finishDrain([]);
    await starting;

    const addEventListener = vi.mocked(document.addEventListener);
    const onVisibility = addEventListener.mock.calls.find(([name]) => name === 'visibilitychange')?.[1];
    if (typeof onVisibility !== 'function') throw new Error('A visibility listener nem lett regisztrálva.');

    (document as unknown as { visibilityState: string }).visibilityState = 'hidden';
    onVisibility(new Event('visibilitychange'));
    native.emit(sample(300, 30));
    expect(received).toEqual([]);

    (document as unknown as { visibilityState: string }).visibilityState = 'visible';
    onVisibility(new Event('visibilitychange'));
    await vi.waitFor(() => expect(native.plugin.drain).toHaveBeenCalledTimes(2));
    native.finishDrain([sample(100, 10), sample(200, 20), sample(300, 30)]);
    await vi.waitFor(() => expect(received).toEqual([100, 200, 300]));
  });
});

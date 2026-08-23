import { beforeEach, describe, expect, it } from 'vitest';
import { liveActivityEnabled, setLiveActivityEnabled } from './liveActivity';

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
});

describe('Live Activity eszközbeállítás', () => {
  it('alapból engedélyezett, de tartósan kikapcsolható', () => {
    expect(liveActivityEnabled()).toBe(true);
    setLiveActivityEnabled(false);
    expect(liveActivityEnabled()).toBe(false);
    setLiveActivityEnabled(true);
    expect(liveActivityEnabled()).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { ForegroundUsageMeter } from './appUsage';

describe('ForegroundUsageMeter', () => {
  it('csak a látható időt számolja', () => {
    const meter = new ForegroundUsageMeter(true, 1_000);
    expect(meter.total(6_000)).toBe(5_000);
    meter.setVisible(false, 6_000);
    expect(meter.total(20_000)).toBe(5_000);
    meter.setVisible(true, 20_000);
    expect(meter.total(23_000)).toBe(8_000);
  });

  it('az óra visszaugrása nem von le időt', () => {
    const meter = new ForegroundUsageMeter(true, 10_000);
    expect(meter.total(5_000)).toBe(0);
  });
});

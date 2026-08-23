import { describe, expect, it } from 'vitest';
import { describeResumeCause } from './lifecycle';

describe('describeResumeCause', () => {
  it('az explicit újratöltést nevezi meg elsőként', () => {
    expect(describeResumeCause({ kind: 'hidden', at: 1 }, 'reload')).toContain('újratöltődött');
  });

  it('megkülönbözteti a valódi pagehide eseményt', () => {
    expect(describeResumeCause({ kind: 'pagehide', at: 1, persisted: false }, 'navigate')).toContain('bezárult');
  });

  it('nem állít GPS-hibát ismeretlen megszakításra', () => {
    expect(describeResumeCause(null, undefined)).toContain('újraindult');
  });
});

import { describe, expect, it } from 'vitest';
import {
  BASIC_RESUME_WINDOW_MS,
  isInsideBasicResumeWindow,
  isRemoteTrackingVisible,
} from './resumePolicy';

const NOW = 1_800_000_000_000;

describe('rögzítés-folytatási szabály', () => {
  it('az alap helyreállítás legfeljebb egy órás', () => {
    expect(isInsideBasicResumeWindow(NOW - BASIC_RESUME_WINDOW_MS, NOW)).toBe(true);
    expect(isInsideBasicResumeWindow(NOW - BASIC_RESUME_WINDOW_MS - 1, NOW)).toBe(false);
  });

  it('csak friss recording vagy paused távoli előnézet látható', () => {
    expect(isRemoteTrackingVisible('recording', NOW - 10_000, NOW)).toBe(true);
    expect(isRemoteTrackingVisible('paused', NOW - 10_000, NOW)).toBe(true);
    expect(isRemoteTrackingVisible('finished', NOW - 10_000, NOW)).toBe(false);
    expect(isRemoteTrackingVisible('recording', NOW - BASIC_RESUME_WINDOW_MS - 1, NOW)).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEEDBACK_SETTINGS } from './feedbackSettings';

class FakeAudio {
  static instances: FakeAudio[] = [];

  currentTime = 0;
  paused = true;
  preload = '';
  volume = 1;
  playCount = 0;

  constructor(readonly src: string) {
    FakeAudio.instances.push(this);
  }

  setAttribute(): void {}

  play(): Promise<void> {
    this.paused = false;
    this.playCount += 1;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  FakeAudio.instances = [];
});

describe('folytatható hanglejátszás', () => {
  it('elengedéskor megtartja a pozíciót, újranyomáskor onnan folytatja', async () => {
    vi.stubGlobal('Audio', FakeAudio);
    const { pauseSoundPlayback, resumeSoundPlayback } = await import('./sound');

    resumeSoundPlayback('pressing-finish-activity', DEFAULT_FEEDBACK_SETTINGS);
    const audio = FakeAudio.instances[0]!;
    audio.currentTime = 0.65;

    pauseSoundPlayback('pressing-finish-activity');
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(0.65);

    resumeSoundPlayback('pressing-finish-activity', DEFAULT_FEEDBACK_SETTINGS);
    expect(audio.paused).toBe(false);
    expect(audio.currentTime).toBe(0.65);
    expect(audio.playCount).toBe(2);
  });

  it('sikeres befejezéskor nullára tekeri a hangot', async () => {
    vi.stubGlobal('Audio', FakeAudio);
    const { pauseSoundPlayback, resumeSoundPlayback } = await import('./sound');

    resumeSoundPlayback('pressing-finish-activity', DEFAULT_FEEDBACK_SETTINGS);
    const audio = FakeAudio.instances[0]!;
    audio.currentTime = 1;

    pauseSoundPlayback('pressing-finish-activity', true);
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(0);
  });
});

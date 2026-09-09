import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = { native: false };
const startMock = vi.fn();
const stopMock = vi.fn();
const deleteMock = vi.fn();
const convertMock = vi.fn((uri: string) => `local:${uri}`);

vi.mock('./platform', () => ({ isNativeApp: () => platform.native }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (uri: string) => convertMock(uri) },
  registerPlugin: () => ({
    startVideoRecording: () => startMock(),
    stopVideoRecording: () => stopMock(),
    deleteVideoRecording: (options: { uri: string }) => deleteMock(options),
  }),
}));

beforeEach(() => {
  platform.native = false;
  startMock.mockReset();
  stopMock.mockReset();
  deleteMock.mockReset().mockResolvedValue(undefined);
  convertMock.mockClear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('native video recording', () => {
  it('rejects on the web without opening a system capture prompt', async () => {
    const video = await import('./videoRecording');
    await expect(video.startVideoRecording()).rejects.toBeInstanceOf(video.VideoRecordingError);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('reads the temporary native MP4 and then deletes it', async () => {
    platform.native = true;
    stopMock.mockResolvedValue({ uri: 'file:///tmp/report.mp4', durationMs: 12_345 });
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const video = await import('./videoRecording');

    const result = await video.stopVideoRecording();

    expect(result.blob.type).toBe('video/mp4');
    expect(result.blob.size).toBe(3);
    expect(result.durationMs).toBe(12_345);
    expect(convertMock).toHaveBeenCalledWith('file:///tmp/report.mp4');
    expect(deleteMock).toHaveBeenCalledWith({ uri: 'file:///tmp/report.mp4' });
  });

  it('deletes the native file when reading it fails', async () => {
    platform.native = true;
    stopMock.mockResolvedValue({ uri: 'file:///tmp/report.mp4', durationMs: 1000 });
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
    const video = await import('./videoRecording');

    await expect(video.stopVideoRecording()).rejects.toBeInstanceOf(video.VideoRecordingError);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});

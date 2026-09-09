import { beforeEach, describe, expect, it, vi } from 'vitest';

const submitMock = vi.fn();
const attachMock = vi.fn();
const uploadMock = vi.fn();
const refMock = vi.fn((_storage: unknown, path: string) => ({ path }));

vi.mock('firebase/storage', () => ({ ref: refMock, uploadBytes: uploadMock }));
vi.mock('./api', () => ({
  api: {
    submitBugReport: (input: unknown) => submitMock(input),
    attachBugReportMedia: (id: string, media: unknown) => attachMock(id, media),
  },
}));
vi.mock('./breadcrumbs', () => ({ readBreadcrumbs: () => [] }));
vi.mock('./debugMode', () => ({
  currentSessionId: () => 'session-1',
  currentSessionStartedAt: () => 1000,
}));
vi.mock('./firebase', () => ({ storage: {} }));
vi.mock('../tracking/deviceInfo', () => ({ captureDeviceInfo: () => ({ platform: 'ios' }) }));

beforeEach(() => {
  submitMock.mockReset().mockResolvedValue({
    reportId: 'report-1',
    uploadPrefix: 'bugreports/uid-1/report-1/',
  });
  attachMock.mockReset().mockResolvedValue({ ok: true });
  uploadMock.mockReset().mockResolvedValue(undefined);
  refMock.mockClear();
  vi.stubGlobal('window', {
    location: { pathname: '/grund', search: '' },
    innerWidth: 390,
    innerHeight: 844,
    devicePixelRatio: 3,
  });
  vi.stubGlobal('navigator', {
    onLine: true,
    permissions: { query: vi.fn().mockResolvedValue({ state: 'granted' }) },
  });
  vi.stubGlobal('Notification', { permission: 'granted' });
});

describe('bug report media', () => {
  it('uploads a video as MP4 and stores its duration', async () => {
    const { submitBugReport } = await import('./bugReport');
    const video = new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' });

    await submitBugReport(
      { kind: 'video', severity: 'normal', note: '', recorder: 'idle' },
      video,
      12_345,
    );

    const path = refMock.mock.calls[0]?.[1] as string;
    expect(path).toMatch(/^bugreports\/uid-1\/report-1\/\d+\.mp4$/);
    expect(uploadMock).toHaveBeenCalledWith({ path }, video, { contentType: 'video/mp4' });
    expect(attachMock).toHaveBeenCalledWith('report-1', {
      path,
      contentType: 'video/mp4',
      bytes: 3,
      durationMs: 12_345,
    });
  });
});

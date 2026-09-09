/** Native screen recording for tester bug reports. */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { isNativeApp } from '@/lib/platform';

export const MAX_VIDEO_DURATION_MS = 30_000;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

interface NativeVideoResult {
  uri: string;
  durationMs: number;
}

interface BugReportPlugin {
  startVideoRecording(): Promise<void>;
  stopVideoRecording(): Promise<NativeVideoResult>;
  deleteVideoRecording(options: { uri: string }): Promise<void>;
}

const BugReport = registerPlugin<BugReportPlugin>('BugReport');

export class VideoRecordingError extends Error {}

export interface RecordedVideo {
  blob: Blob;
  durationMs: number;
}

export async function startVideoRecording(): Promise<void> {
  if (!isNativeApp()) {
    throw new VideoRecordingError('A videó csak a natív alkalmazásban érhető el.');
  }
  await BugReport.startVideoRecording();
}

/**
 * Stops the native recorder and copies its temporary MP4 into a Web Blob.
 * The native cache file is removed after the copy, including on failures.
 */
export async function stopVideoRecording(): Promise<RecordedVideo> {
  if (!isNativeApp()) {
    throw new VideoRecordingError('A videó csak a natív alkalmazásban érhető el.');
  }

  const result = await BugReport.stopVideoRecording();
  if (!result.uri) throw new VideoRecordingError('A videó nem készült el.');

  try {
    const response = await fetch(Capacitor.convertFileSrc(result.uri));
    if (!response.ok) throw new VideoRecordingError('A videófájl nem olvasható.');
    const source = await response.blob();
    if (source.size === 0) throw new VideoRecordingError('A videó üres lett.');
    if (source.size > MAX_VIDEO_BYTES) {
      throw new VideoRecordingError('A videó nagyobb lett 50 MB-nál, ezért nem küldhető el.');
    }
    return {
      blob: new Blob([source], { type: 'video/mp4' }),
      durationMs: Math.max(0, Math.min(MAX_VIDEO_DURATION_MS, result.durationMs)),
    };
  } finally {
    await BugReport.deleteVideoRecording({ uri: result.uri }).catch(() => undefined);
  }
}

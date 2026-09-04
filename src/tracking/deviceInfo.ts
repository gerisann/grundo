import { Capacitor } from '@capacitor/core';
import { buildInfo } from '@/lib/buildInfo';

/**
 * Diagnosztikai eszközadat egy aktivitáshoz.
 *
 * Kizárólag utólagos hibakereséshez kell (pl. „ez a nyomvonal-lyuk
 * Android-specifikus, vagy webes rögzítésnél is előfordul?") — a mentés
 * gameplay-számítását sosem befolyásolja, a szerver csak tárolja.
 */
export interface RecordingDeviceInfo {
  platform: 'ios' | 'android' | 'web';
  native: boolean;
  /**
   * A WebView/böngésző saját `navigator.userAgent`-je. Natív appban is ez
   * hordozza az OS-verziót és az eszközmodellt (pl. „…Android 13; Pixel 6…",
   * „…iPhone OS 17_4…") — külön `@capacitor/device` plugin (és ezzel új natív
   * build) nélkül is elég pontos ehhez a diagnosztikai célhoz.
   */
  userAgent: string;
  appVersion: string;
  channel: string;
  revision: string;
}

export function captureDeviceInfo(): RecordingDeviceInfo {
  return {
    platform: Capacitor.getPlatform() as RecordingDeviceInfo['platform'],
    native: Capacitor.isNativePlatform(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    appVersion: buildInfo.version,
    channel: buildInfo.channel,
    revision: buildInfo.revision,
  };
}

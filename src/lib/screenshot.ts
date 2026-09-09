/**
 * Bugreport-képernyőkép — natív pillanatkép a webnézetről.
 *
 * ⚠️ NEM `html2canvas`: az a DOM-ot rajzolná újra, tehát a Mapbox GL vászon
 * ÜRESEN maradna a mentett képen — pont a térkép hiányozna a bugreportból
 * (docs/ai/terv-2026-09-09-bugreport-rendszer.md, 9. pont). A natív plugin
 * (iOS: `WKWebView.takeSnapshot`, Android: `PixelCopy`) azt menti, ami
 * TÉNYLEGESEN a képernyőn van — pixelről pixelre.
 *
 * Weben nincs megfelelője: a böngésző nem ad natív pillanatképet a saját
 * lapjáról. Ott a funkció nem érhető el (lásd `DebugFab`).
 *
 * ⚠️ A hívó felelőssége elrejteni a lebegő 🐞 gombot és a menüt a hívás
 * előtt — a plugin a teljes webnézetet lefényképezi, tehát a debug-felület
 * is rajta lenne, ha nyitva marad.
 */

import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from '@/lib/platform';

interface BugReportPlugin {
  captureScreenshot(): Promise<{ base64: string }>;
}

const BugReport = registerPlugin<BugReportPlugin>('BugReport');

export class ScreenshotError extends Error {}

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

/** PNG a jelenlegi képernyőről. Csak natív appban érhető el. */
export async function captureScreenshot(): Promise<Blob> {
  if (!isNativeApp()) {
    throw new ScreenshotError('A képernyőkép csak a natív alkalmazásban érhető el.');
  }

  const { base64 } = await BugReport.captureScreenshot();
  if (!base64) throw new ScreenshotError('A képernyőkép nem készült el.');
  return base64ToBlob(base64, 'image/png');
}

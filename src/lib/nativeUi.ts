import { StatusBar, Style } from '@capacitor/status-bar';
import type { Theme } from './theme';
import { isNativeIos } from './platform';

/** A WKWebView fölötti iOS státuszsávot a webes GRUNDO-témához igazítja. */
export async function syncNativeStatusBar(theme: Theme): Promise<void> {
  if (!isNativeIos()) return;
  await StatusBar.setOverlaysWebView({ overlay: true });
  await StatusBar.setStyle({ style: theme === 'dark' ? Style.Light : Style.Dark });
}

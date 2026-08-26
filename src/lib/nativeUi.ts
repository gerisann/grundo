import { StatusBar, Style } from '@capacitor/status-bar';
import type { Theme } from './theme';
import { isNativeApp } from './platform';

/** A natív státuszsávot a webes GRUNDO-témához igazítja. */
export async function syncNativeStatusBar(theme: Theme): Promise<void> {
  if (!isNativeApp()) return;
  await StatusBar.setOverlaysWebView({ overlay: true });
  await StatusBar.setStyle({ style: theme === 'dark' ? Style.Light : Style.Dark });
}

import { Capacitor } from '@capacitor/core';

/** Igaz a Capacitor által csomagolt natív alkalmazásban, weben mindig hamis. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** Az iOS-specifikus natív képességek megkülönböztetése. */
export function isNativeIos(): boolean {
  return Capacitor.getPlatform() === 'ios';
}

/** Az Android-specifikus natív képességek megkülönböztetése. */
export function isNativeAndroid(): boolean {
  return Capacitor.getPlatform() === 'android';
}

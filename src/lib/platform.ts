import { Capacitor } from '@capacitor/core';

/** Igaz a Capacitor által csomagolt natív alkalmazásban, weben mindig hamis. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** Az első iOS kiadásban támogatott natív platform megkülönböztetése. */
export function isNativeIos(): boolean {
  return Capacitor.getPlatform() === 'ios';
}

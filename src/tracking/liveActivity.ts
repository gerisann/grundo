const LIVE_ACTIVITY_ENABLED_KEY = 'grundo.liveActivityEnabled';

/** Alapértelmezés szerint aktív; csak a felhasználó kifejezett tiltása kapcsolja ki. */
export function liveActivityEnabled(): boolean {
  try {
    return localStorage.getItem(LIVE_ACTIVITY_ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setLiveActivityEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LIVE_ACTIVITY_ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    // A beállítás kényelmi funkció; blokkolt tárhely mellett marad az alapérték.
  }
}

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyTheme,
  loadSettings,
  nextThemeCheck,
  resolveTheme,
  saveSettings,
  systemPrefersDark,
  type Coords,
  type Theme,
  type ThemeSettings,
} from '@/lib/theme';

/**
 * A téma életciklusa egy helyen.
 *
 * - egyetlen időzítő fut, a KÖVETKEZŐ váltás időpontjára állítva
 *   (nem pollozunk percenként),
 * - a rendszerbeállítás változását figyeljük,
 * - visszatéréskor (láthatóvá váló fül) újraszámolunk, mert a telefon
 *   alvás közben nem futtatja az időzítőket,
 * - AKTÍV RÖGZÍTÉS KÖZBEN NEM VÁLTUNK: a térképstílus cseréje félbeszakítaná
 *   a futást és újratöltené a Mapbox stílust. A váltás a mentés után történik.
 */
export function useTheme(options?: { coords?: Coords | null; recordingActive?: boolean }) {
  const coords = options?.coords ?? null;
  const recordingActive = options?.recordingActive ?? false;

  const [settings, setSettings] = useState<ThemeSettings>(loadSettings);
  const [theme, setTheme] = useState<Theme>(() =>
    resolveTheme(loadSettings(), new Date(), coords, systemPrefersDark()),
  );

  const timer = useRef<number | null>(null);
  const deferred = useRef<Theme | null>(null);

  const evaluate = useCallback(() => {
    const next = resolveTheme(settings, new Date(), coords, systemPrefersDark());

    if (recordingActive) {
      // Elhalasztjuk: a rögzítés alatti témaváltás zavaró és drága.
      deferred.current = next;
      return;
    }

    deferred.current = null;
    setTheme(next);
    applyTheme(next);
  }, [settings, coords, recordingActive]);

  // Újraszámolás + időzítő a következő váltásra
  useEffect(() => {
    evaluate();

    if (timer.current !== null) window.clearTimeout(timer.current);
    const next = nextThemeCheck(settings, new Date(), coords);
    if (next) {
      const delay = Math.max(1000, next.getTime() - Date.now());
      // setTimeout felső korlátja ~24,8 nap — a mi távjaink ezen belül vannak
      timer.current = window.setTimeout(evaluate, delay);
    }

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [settings, coords, evaluate]);

  // A rendszerbeállítás változása (csak a 'system' mód érdekli, de olcsó)
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const onChange = () => evaluate();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [evaluate]);

  // Visszatérés a háttérből: alvás alatt nem futottak az időzítők
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') evaluate();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [evaluate]);

  // A rögzítés végén alkalmazzuk az elhalasztott váltást
  useEffect(() => {
    if (!recordingActive && deferred.current) {
      const next = deferred.current;
      deferred.current = null;
      setTheme(next);
      applyTheme(next);
    }
  }, [recordingActive]);

  const update = useCallback((patch: Partial<ThemeSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  return { theme, settings, update };
}

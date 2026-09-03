import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadForStaleChunk } from './chunkReload';

describe('isChunkLoadError', () => {
  it('felismeri mindhárom böngésző szövegét', () => {
    // Chrome — Geri éles hibaüzenete (2026-09-03, /profil).
    expect(
      isChunkLoadError(
        new Error(
          'Failed to fetch dynamically imported module: https://grundo.web.app/assets/ProfileScreen-KUzTnBFi.js',
        ),
      ),
    ).toBe(true);
    // Firefox
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
    // Safari — ez jön a natív iOS WebViewból is.
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
  });

  it('a többi hibát békén hagyja', () => {
    // ⚠️ Ez a fontosabb irány: egy VALÓDI alkalmazáshibát újratöltés-hurokba
    // vinnénk, ha itt tévesen igazat adnánk.
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(new Error('Firestore: permission denied'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError({})).toBe(false);
  });
});

describe('reloadForStaleChunk', () => {
  const reload = vi.fn();
  const store = new Map<string, string>();

  beforeEach(() => {
    reload.mockClear();
    store.clear();
    // A tesztek DOM nélkül futnak, ezért a böngészős felületet kistuboljuk.
    vi.stubGlobal('window', { location: { reload } });
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('elsőre újratölt', () => {
    expect(reloadForStaleChunk(1_000_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a hurkot megtöri: a rövid időn belüli második hibára NEM tölt újra', () => {
    expect(reloadForStaleChunk(1_000_000)).toBe(true);
    expect(reloadForStaleChunk(1_005_000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('egy későbbi telepítés utáni elavulást újra kezel', () => {
    expect(reloadForStaleChunk(1_000_000)).toBe(true);
    expect(reloadForStaleChunk(1_000_000 + 61_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

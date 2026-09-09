/**
 * Üzemmód és menet-nyilvántartás.
 *
 * A lényeg a NEM TISZTA LEÁLLÁS felismerése: az app nem tudja elkapni a saját
 * összeomlását, csak azt veheti észre a következő indításkor, hogy az előző
 * menet nyitva maradt. Ez a teszt azt rögzíti, mikor SZABAD ezt felajánlani —
 * és főleg, mikor nem:
 *
 * - rendesen lezárt menet után soha,
 * - normál módú menet után sem, mert ott nincs napló, amit el lehetne küldeni.
 *
 * ⚠️ A jelzés BECSLÉS. Ugyanígy néz ki a valódi összeomlás, az app-váltóból
 * kihúzás és az OS memória-visszavétele is — a felület szövege ezért nem
 * állíthatja, hogy összeomlott (`DebugLayer.tsx`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SESSION_KEY = 'grundo.debug.session';
const MODE_KEY = 'grundo.debug.mode';
const ASK_KEY = 'grundo.debug.ask';

let store: Map<string, string>;

/** A `localStorage` dobhat is (privát ablak) — ezt külön eset állítja be. */
let throwOnAccess = false;

beforeEach(() => {
  store = new Map();
  throwOnAccess = false;
  vi.resetModules();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => {
        if (throwOnAccess) throw new Error('a tárolás le van tiltva');
        return store.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (throwOnAccess) throw new Error('a tárolás le van tiltva');
        store.set(key, value);
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function load() {
  return import('./debugMode');
}

/** Egy előző, adott állapotban hagyott menet a tárolóban. */
function seedPreviousSession(input: { open: boolean; mode: 'normal' | 'debug' }) {
  store.set(
    SESSION_KEY,
    JSON.stringify({
      id: 'elozo-menet',
      startedAt: 1000,
      mode: input.mode,
      route: '/rogzites',
      open: input.open,
      seenAt: 2000,
    }),
  );
}

describe('menet és crash-jelzés', () => {
  it('nyitva maradt debug menet után felajánlja a bejelentést', async () => {
    seedPreviousSession({ open: true, mode: 'debug' });
    const debugMode = await load();

    const hint = debugMode.startAppSession('debug', '/');
    expect(hint).not.toBeNull();
    expect(hint?.previousSessionId).toBe('elozo-menet');
    expect(hint?.lastRoute).toBe('/rogzites');
  });

  it('rendesen lezárt menet után nincs jelzés', async () => {
    seedPreviousSession({ open: false, mode: 'debug' });
    const debugMode = await load();

    expect(debugMode.startAppSession('debug', '/')).toBeNull();
  });

  it('normál módú menet után nincs jelzés, akkor sem, ha nyitva maradt', async () => {
    seedPreviousSession({ open: true, mode: 'normal' });
    const debugMode = await load();

    expect(debugMode.startAppSession('debug', '/')).toBeNull();
  });

  it('a jelzés csak EGYSZER kérhető le', async () => {
    seedPreviousSession({ open: true, mode: 'debug' });
    const debugMode = await load();
    debugMode.startAppSession('debug', '/');

    expect(debugMode.takeCrashHint()).not.toBeNull();
    expect(debugMode.takeCrashHint()).toBeNull();
  });

  it('az új menet nyitottként kerül a tárolóba, a lezárás után zártként', async () => {
    const debugMode = await load();
    debugMode.startAppSession('debug', '/grund');

    expect(JSON.parse(store.get(SESSION_KEY)!).open).toBe(true);

    debugMode.closeAppSession();
    expect(JSON.parse(store.get(SESSION_KEY)!).open).toBe(false);

    // Háttérből visszatérve a menet újra nyitott — különben egy egyszerű
    // képernyőzár után minden indulás „összeomlásnak" látszana.
    debugMode.reopenAppSession();
    expect(JSON.parse(store.get(SESSION_KEY)!).open).toBe(true);
  });

  it('az útvonal frissül a menetrekordban', async () => {
    const debugMode = await load();
    debugMode.startAppSession('debug', '/');
    debugMode.noteSessionRoute('/profil');

    expect(JSON.parse(store.get(SESSION_KEY)!).route).toBe('/profil');
  });

  it('a sérült menetrekord nem dönti el az indulást', async () => {
    store.set(SESSION_KEY, '{ ez nem json');
    const debugMode = await load();

    expect(debugMode.startAppSession('debug', '/')).toBeNull();
  });
});

describe('üzemmód', () => {
  it('a tárolt értékből indul', async () => {
    store.set(MODE_KEY, 'debug');
    const debugMode = await load();

    expect(debugMode.getAppMode()).toBe('debug');
  });

  it('az átállítás megmarad és értesíti a feliratkozókat', async () => {
    const debugMode = await load();
    const seen: string[] = [];
    debugMode.subscribeAppMode((next) => seen.push(next));

    debugMode.setAppMode('debug');

    expect(seen).toEqual(['debug']);
    expect(store.get(MODE_KEY)).toBe('debug');
  });

  it('az azonos értékre állítás nem szól feleslegesen', async () => {
    const debugMode = await load();
    const seen: string[] = [];
    debugMode.subscribeAppMode((next) => seen.push(next));

    debugMode.setAppMode('normal');

    expect(seen).toEqual([]);
  });

  it('alapból kérdez induláskor, kikapcsolva nem', async () => {
    const debugMode = await load();
    expect(debugMode.askModeOnStart()).toBe(true);

    debugMode.setAskModeOnStart(false);
    expect(store.get(ASK_KEY)).toBe('off');
    expect(debugMode.askModeOnStart()).toBe(false);
  });

  it('letiltott tárolás mellett is működik, csak nem emlékszik', async () => {
    throwOnAccess = true;
    const debugMode = await load();

    expect(() => debugMode.setAppMode('debug')).not.toThrow();
    expect(debugMode.getAppMode()).toBe('debug');
    expect(() => debugMode.startAppSession('debug', '/')).not.toThrow();
  });
});

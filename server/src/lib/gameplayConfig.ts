/**
 * A futásidejű játékkonfiguráció betöltése.
 *
 * Az alapértékek a `src/config/gameplay.ts`-ben vannak, az `appConfig/gameplay`
 * dokumentum pedig CSAK az eltéréseket tárolja. Így egy alapérték-változás a
 * kódban automatikusan érvényre jut mindenhol, ahol az admin nem tért el tőle,
 * és a dokumentumból ránézésre látszik, mihez nyúltunk hozzá.
 *
 * PILLANATKÉP-ELV: egy aktivitás feldolgozása a legelején kér egy pillanatképet,
 * és végig azzal számol. A gyorsítótár frissülhet közben — de a már futó
 * számítás nem vehet át félúton új szorzókat, mert akkor egy futás fele a régi,
 * fele az új szabály szerint dőlne el.
 *
 * docs/05-adatmodell.md → `appConfig/gameplay`
 */

import { resolveGameplay, type ResolvedGameplay } from '../../../src/config/tunables';
import type { GameplayConfig } from '../../../src/config/gameplay';
import { APP_CONFIG_DOCS, COLLECTIONS, db } from './firebase';

export interface GameplaySnapshot {
  config: GameplayConfig;
  /** Az `appConfig/gameplay` verziószáma; 0 = nincs felülírás, tiszta alapérték. */
  version: number;
  applied: Record<string, number | boolean>;
}

/**
 * Gyorsítótár élettartama.
 *
 * Elég rövid ahhoz, hogy az admin egy állítás után egy percen belül lássa a
 * hatást (a `docs/06` „a hatás azonnal él" ígéretének gyakorlati olvasata), és
 * elég hosszú ahhoz, hogy ne olvassuk újra a dokumentumot minden mentésnél.
 */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  snapshot: GameplaySnapshot;
  loadedAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<GameplaySnapshot> | null = null;

/** Csak teszthez: a következő hívás újra olvassa a dokumentumot. */
export function resetGameplayCache(): void {
  cache = null;
  inFlight = null;
}

/**
 * Az érvényes konfiguráció pillanatképe.
 *
 * SOHA nem dob. Ha az olvasás elhasal (hálózat, jogosultság, hiányzó
 * dokumentum), az alapértékekkel tér vissza — egy konfigurációs olvasási hiba
 * nem akadályozhatja meg, hogy a felhasználó elmentse a futását.
 */
export async function getGameplaySnapshot(now: Date = new Date()): Promise<GameplaySnapshot> {
  const fresh = cache && now.getTime() - cache.loadedAt < CACHE_TTL_MS;
  if (cache && fresh) return cache.snapshot;
  if (inFlight) return inFlight;

  inFlight = loadSnapshot()
    .then((snapshot) => {
      cache = { snapshot, loadedAt: Date.now() };
      return snapshot;
    })
    .catch((error: unknown) => {
      console.error('[gameplayConfig] az appConfig/gameplay olvasása nem sikerült', error);
      // Ha volt korábbi jó pillanatkép, inkább az járjon le későn, mint hogy a
      // konfiguráció egy pillanatra visszaugorjon az alapértékre.
      const fallback = cache?.snapshot ?? defaultSnapshot();
      cache = { snapshot: fallback, loadedAt: Date.now() };
      return fallback;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

async function loadSnapshot(): Promise<GameplaySnapshot> {
  const doc = await db
    .collection(COLLECTIONS.appConfig)
    .doc(APP_CONFIG_DOCS.gameplay)
    .get();

  if (!doc.exists) return defaultSnapshot();

  const data = doc.data() as { version?: number; overrides?: Record<string, unknown> } | undefined;
  const resolved = resolveGameplay(data?.overrides);
  reportRejected(resolved);

  return {
    config: resolved.config,
    version: Number.isFinite(data?.version) ? Number(data?.version) : 0,
    applied: resolved.applied,
  };
}

function defaultSnapshot(): GameplaySnapshot {
  const resolved = resolveGameplay(null);
  return { config: resolved.config, version: 0, applied: {} };
}

/**
 * Az eldobott felülírásokat naplózzuk, nem nyeljük el.
 *
 * Egy elrontott kulcs nem állítja meg a játékot — de ha csendben maradna, az
 * admin azt látná, hogy „beállítottam, mégsem történt semmi", és nem lenne hol
 * utánanéznie.
 */
function reportRejected(resolved: ResolvedGameplay): void {
  for (const item of resolved.rejected) {
    console.warn(
      `[gameplayConfig] a(z) "${item.path}" felülírás eldobva (${item.reason}); érték: ${JSON.stringify(item.value)}`,
    );
  }
}

/**
 * Morzsanapló a hibabejelentéshez.
 *
 * A tesztelő azt látja, hogy „valami elromlott"; a fejlesztőnek az kell, ami
 * ELŐTTE történt. Natív appban a konzolhoz utólag nem lehet hozzáférni, ezért
 * a legutóbbi események egy memóriabeli gyűrűpufferben állnak, és a
 * bejelentéssel együtt mennek el.
 *
 * ⚠️ CSAK DEBUG MÓDBAN FUT. A `arm()` hívása nélkül egyetlen sor sem gyűlik,
 * és a konzol sincs átkötve — a normál felhasználó nem fizet ennek a
 * költségét (`docs/ai/terv-2026-09-09-bugreport-rendszer.md` → 10.).
 *
 * ⚠️ GPS-KOORDINÁTA NEM KERÜLHET IDE. A rögzítő átmenetei állapotnevek, nem
 * pontok; a privát zóna logikája ugyanaz, mint a fotóknál (`src/lib/photos.ts`
 * fejléce): ami egyszer kikerül, azt nem lehet visszavenni.
 */

export type BreadcrumbLevel = 'info' | 'warn' | 'error' | 'route' | 'api' | 'life';

export interface Breadcrumb {
  /** Unix ms. */
  t: number;
  level: BreadcrumbLevel;
  msg: string;
}

/** Ennyi morzsát tartunk. A szerver ugyanennyinél vág (`bugreports.ts`). */
export const BREADCRUMB_CAPACITY = 200;
/** Egy sor ennél hosszabban nem olvasható, és csak a helyet fogyasztaná. */
const MAX_MESSAGE = 500;

const buffer: Breadcrumb[] = [];
let armed = false;

/** Az eredeti konzolfüggvények, hogy a leszereléskor pontosan visszaálljanak. */
let originalWarn: typeof console.warn | null = null;
let originalError: typeof console.error | null = null;

function shorten(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, MAX_MESSAGE);
  if (value instanceof Error) return `${value.name}: ${value.message}`.slice(0, MAX_MESSAGE);
  try {
    return JSON.stringify(value)?.slice(0, MAX_MESSAGE) ?? String(value).slice(0, MAX_MESSAGE);
  } catch {
    // Körkörös hivatkozás vagy nem sorosítható objektum — a típusa is elég.
    return Object.prototype.toString.call(value);
  }
}

export function addBreadcrumb(level: BreadcrumbLevel, ...parts: unknown[]): void {
  if (!armed) return;
  buffer.push({ t: Date.now(), level, msg: parts.map(shorten).join(' ').slice(0, MAX_MESSAGE) });
  // A legrégebbi esik ki. A `shift()` kétszáz elemnél mérhetetlen, viszont a
  // gyűrű-index bonyolultsága nélkül marad helyes a sorrend.
  if (buffer.length > BREADCRUMB_CAPACITY) buffer.shift();
}

/** A napló másolata, legrégebbitől a legújabbig. */
export function readBreadcrumbs(): Breadcrumb[] {
  return buffer.slice();
}

export function clearBreadcrumbs(): void {
  buffer.length = 0;
}

function onError(event: ErrorEvent): void {
  addBreadcrumb('error', `${event.message} @ ${event.filename}:${event.lineno}`);
}

function onRejection(event: PromiseRejectionEvent): void {
  addBreadcrumb('error', 'Elkapatlan ígéret:', event.reason);
}

/**
 * A napló bekapcsolása. A visszaadott függvény MINDENT visszaállít — a
 * konzolt is.
 *
 * Kétszeri hívás nem duplázza a bekötést: a második hívás ugyanazt a leszerelő
 * függvényt adja vissza. Egy React `StrictMode`-os dupla effekt így nem hagy
 * maga után rétegzett konzol-becsomagolást, amiből minden `console.error` két
 * morzsát írna.
 */
export function armBreadcrumbs(): () => void {
  if (armed) return disarmBreadcrumbs;
  armed = true;

  if (typeof console !== 'undefined') {
    originalWarn = console.warn;
    originalError = console.error;
    console.warn = (...args: unknown[]) => {
      addBreadcrumb('warn', ...args);
      originalWarn?.apply(console, args as never);
    };
    console.error = (...args: unknown[]) => {
      addBreadcrumb('error', ...args);
      originalError?.apply(console, args as never);
    };
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
  }

  return disarmBreadcrumbs;
}

export function disarmBreadcrumbs(): void {
  if (!armed) return;
  armed = false;

  if (typeof console !== 'undefined') {
    if (originalWarn) console.warn = originalWarn;
    if (originalError) console.error = originalError;
  }
  originalWarn = null;
  originalError = null;

  if (typeof window !== 'undefined') {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  }
}

export function breadcrumbsArmed(): boolean {
  return armed;
}

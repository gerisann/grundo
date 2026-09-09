/**
 * Üzemmód (Normál / Debug) és a menetek nyilvántartása.
 *
 * A debug mód a TESZTELŐI kör eszköze: ebben él a lebegő hibabejelentő gomb és
 * a morzsanapló. Normál módban egyik sem létezik.
 *
 * ⚠️ Az üzemmód-választó nem jelenhet meg mindenkinek — ki jogosult rá, azt a
 * `debugModeAvailable()` dönti el, és az alapja a szerverről jövő `tester`
 * mező vagy az admin szerepkör.
 *
 * docs/ai/terv-2026-09-09-bugreport-rendszer.md → 2., 5.
 */

export type AppMode = 'normal' | 'debug';

const MODE_KEY = 'grundo.debug.mode';
const ASK_KEY = 'grundo.debug.ask';
const SESSION_KEY = 'grundo.debug.session';

interface SessionRecord {
  id: string;
  startedAt: number;
  mode: AppMode;
  route: string;
  /** `true`, amíg az app fut. Ha egy KÖVETKEZŐ indulás így találja, az előző
   *  menet nem zárult rendesen. */
  open: boolean;
  /** Az utolsó életjel: ekkor tudtunk utoljára írni. */
  seenAt: number;
}

/**
 * Amit az előző, rendesen le nem zárt menetről tudunk.
 *
 * ⚠️ EZ BECSLÉS, NEM BIZONYÍTÉK. Ugyanígy néz ki a valódi összeomlás, a
 * folyamat kilövése az app-váltóból, és az OS memória-visszavétele is. A
 * felületnek ezért nem szabad azt állítania, hogy összeomlott.
 */
export interface CrashHint {
  previousSessionId: string;
  lastRoute: string;
  startedAt: number;
  seenAt: number;
}

/* ── Tároló, ami minden környezetben elviselhető ─────────────────────────── */

/**
 * A `localStorage` privát ablakban és letiltott sütiknél MAGA A HOZZÁFÉRÉS is
 * dobhat, nem csak az írás — ezért van try/catch már az olvasáson is.
 */
function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Tárolás nélkül is működnie kell: az üzemmód ilyenkor a menet végéig él.
  }
}

/* ── Üzemmód ────────────────────────────────────────────────────────────── */

let mode: AppMode = readRaw(MODE_KEY) === 'debug' ? 'debug' : 'normal';
const listeners = new Set<(next: AppMode) => void>();

export function getAppMode(): AppMode {
  return mode;
}

export function setAppMode(next: AppMode): void {
  if (next === mode) return;
  mode = next;
  writeRaw(MODE_KEY, next);
  for (const listener of listeners) listener(next);
}

export function subscribeAppMode(listener: (next: AppMode) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Megkérdezzük-e minden hidegindításkor? A tesztelő kikapcsolhatja. */
export function askModeOnStart(): boolean {
  return readRaw(ASK_KEY) !== 'off';
}

export function setAskModeOnStart(ask: boolean): void {
  writeRaw(ASK_KEY, ask ? 'on' : 'off');
}

/**
 * Jogosult-e egyáltalán a debug módra.
 *
 * Helyi fejlesztésben mindig, különben a `tester` mező vagy bármilyen admin
 * szerepkör kell hozzá. Aki a triázst látja, az tesztelhet is.
 */
export function debugModeAvailable(input: { tester?: boolean; role?: string | null }): boolean {
  if (import.meta.env.DEV) return true;
  return input.tester === true || Boolean(input.role);
}

/* ── Menetek és a nem tiszta leállás felismerése ─────────────────────────── */

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

let session: SessionRecord | null = null;
let crashHint: CrashHint | null = null;

function persist(): void {
  if (!session) return;
  writeRaw(SESSION_KEY, JSON.stringify(session));
}

function readPrevious(): SessionRecord | null {
  const raw = readRaw(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SessionRecord>;
    if (typeof parsed.id !== 'string') return null;
    return {
      id: parsed.id,
      startedAt: Number(parsed.startedAt) || 0,
      mode: parsed.mode === 'debug' ? 'debug' : 'normal',
      route: typeof parsed.route === 'string' ? parsed.route : '',
      open: parsed.open === true,
      seenAt: Number(parsed.seenAt) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Új menet nyitása. Az ELŐZŐ rekordot még a felülírás előtt megnézi.
 *
 * A crash-jelzést csak akkor adjuk vissza, ha az előző menet DEBUG módban
 * futott: normál módban nincs morzsanapló, tehát a bejelentésben semmi nem
 * lenne azon kívül, hogy „bezárult" — és a felhasználó nem is tesztelő.
 */
export function startAppSession(currentMode: AppMode, route: string): CrashHint | null {
  const previous = readPrevious();
  if (previous && previous.open && previous.mode === 'debug') {
    crashHint = {
      previousSessionId: previous.id,
      lastRoute: previous.route,
      startedAt: previous.startedAt,
      seenAt: previous.seenAt,
    };
  }

  const now = Date.now();
  session = { id: newId(), startedAt: now, mode: currentMode, route, open: true, seenAt: now };
  persist();
  return crashHint;
}

/** A jelzés EGYSZER kérhető le — a felajánlás után nem jöhet vissza. */
export function takeCrashHint(): CrashHint | null {
  const hint = crashHint;
  crashHint = null;
  return hint;
}

export function currentSessionId(): string {
  return session?.id ?? '';
}

export function currentSessionStartedAt(): number {
  return session?.startedAt ?? 0;
}

export function noteSessionRoute(route: string): void {
  if (!session) return;
  session.route = route;
  session.seenAt = Date.now();
  persist();
}

export function noteSessionMode(next: AppMode): void {
  if (!session) return;
  session.mode = next;
  persist();
}

/**
 * Tiszta leállás.
 *
 * ⚠️ A `beforeunload` natív WebView-ban megbízhatatlan — a `pagehide` és a
 * Capacitor `appStateChange` az, ami tényleg lefut háttérbe küldéskor. Ezért
 * hívja mindhárom ugyanezt, és ezért idempotens.
 */
export function closeAppSession(): void {
  if (!session || !session.open) return;
  session.open = false;
  session.seenAt = Date.now();
  persist();
}

/** Visszatérés háttérből: a menet újra nyitott. */
export function reopenAppSession(): void {
  if (!session || session.open) return;
  session.open = true;
  session.seenAt = Date.now();
  persist();
}

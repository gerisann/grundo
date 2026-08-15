/**
 * GRUNDO témakezelés — világos / sötét, napszakkövetéssel.
 *
 * Négy mód, közülük a felhasználó választ. Az alapértelmezett az `auto`:
 * nappal világos, este sötét — mert a GRUNDO alapkaraktere világos, de
 * este a térkép és a mérőóra sötéten sokkal kényelmesebb.
 *
 * Precedencia: a felhasználó kifejezett választása (light/dark) MINDIG
 * felülírja az automatikát. A rendszerbeállítást csak a `system` mód követi.
 *
 * Tiszta modul: nincs benne React és nincs benne Firebase.
 */

export type Theme = 'light' | 'dark';
export type ThemeMode = 'light' | 'dark' | 'system' | 'auto';
export type AutoStrategy = 'sun' | 'fixed';

export interface ThemeSettings {
  /** Alapértelmezés: 'auto' */
  mode: ThemeMode;
  /** 'sun' = valódi napnyugta/napkelte a pozíció alapján, 'fixed' = fix órák */
  autoStrategy: AutoStrategy;
  /** 'fixed' stratégiánál — "HH:MM" */
  darkFrom: string;
  darkTo: string;
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  mode: 'auto',
  autoStrategy: 'sun',
  darkFrom: '20:00',
  darkTo: '06:30',
};

export const STORAGE_KEY = 'grundo.theme';
/** A legutóbb kiszámolt téma — az index.html inline scriptje ezt olvassa,
 *  hogy az első kirajzolás már a helyes témában történjen (villanás nélkül). */
export const LAST_THEME_KEY = 'grundo.theme.last';

export interface Coords {
  lat: number;
  lng: number;
}

/* ═══════════════════════════════════════════════════════════════════
   A téma kiszámítása
   ═══════════════════════════════════════════════════════════════════ */

export function resolveTheme(
  settings: ThemeSettings,
  now: Date,
  coords: Coords | null,
  systemPrefersDark: boolean,
): Theme {
  switch (settings.mode) {
    case 'light':
      return 'light';
    case 'dark':
      return 'dark';
    case 'system':
      return systemPrefersDark ? 'dark' : 'light';
    case 'auto':
      return resolveAuto(settings, now, coords);
  }
}

function resolveAuto(settings: ThemeSettings, now: Date, coords: Coords | null): Theme {
  // Napnyugta-alapú: akkor működik, ha van pozíciónk. Sarkkörön túl a
  // napkelte/napnyugta nem létezik minden napon — ilyenkor visszaesünk
  // a fix órákra, különben poláris télen örökre sötét maradna.
  if (settings.autoStrategy === 'sun' && coords) {
    const times = sunTimes(now, coords.lat, coords.lng);
    if (times) {
      return now >= times.sunset || now < times.sunrise ? 'dark' : 'light';
    }
  }
  return withinFixedWindow(now, settings.darkFrom, settings.darkTo) ? 'dark' : 'light';
}

/** "HH:MM" ablak, ami átnyúlhat éjfélen (pl. 20:00 → 06:30). */
export function withinFixedWindow(now: Date, from: string, to: string): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = parseHhMm(from);
  const end = parseHhMm(to);
  if (start === null || end === null) return false;
  return start <= end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end; // éjfélen átnyúló ablak
}

function parseHhMm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Mikor kell legközelebb újraszámolni a témát? Ezzel elkerüljük, hogy
 * percenként pollozzunk: egyetlen időzítőt állítunk a következő váltásra.
 */
export function nextThemeCheck(
  settings: ThemeSettings,
  now: Date,
  coords: Coords | null,
): Date | null {
  if (settings.mode !== 'auto') return null;

  if (settings.autoStrategy === 'sun' && coords) {
    const times = sunTimes(now, coords.lat, coords.lng);
    if (times) {
      if (now < times.sunrise) return times.sunrise;
      if (now < times.sunset) return times.sunset;
      const tomorrow = sunTimes(new Date(now.getTime() + 86_400_000), coords.lat, coords.lng);
      return tomorrow?.sunrise ?? null;
    }
  }

  // Fix ablak: a következő határ.
  const next = new Date(now);
  const candidates = [settings.darkFrom, settings.darkTo]
    .map(parseHhMm)
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b);

  const minutes = now.getHours() * 60 + now.getMinutes();
  const upcoming = candidates.find((m) => m > minutes);
  if (upcoming !== undefined) {
    next.setHours(Math.floor(upcoming / 60), upcoming % 60, 0, 0);
  } else {
    next.setDate(next.getDate() + 1);
    const first = candidates[0] ?? 0;
    next.setHours(Math.floor(first / 60), first % 60, 0, 0);
  }
  return next;
}

/* ═══════════════════════════════════════════════════════════════════
   Napkelte / napnyugta — helyben számolva, külső API nélkül.
   (NOAA közelítés, SunCalc-alapú. A pontosság ±1 perc, ami bőven elég
   ahhoz, hogy eldöntsük, sötét legyen-e a felület.)
   ═══════════════════════════════════════════════════════════════════ */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
/** A Nap felső pereme a horizonton. */
const SUNSET_ANGLE = -0.833 * RAD;

export function sunTimes(
  date: Date,
  lat: number,
  lng: number,
): { sunrise: Date; sunset: Date } | null {
  const lw = RAD * -lng;
  const phi = RAD * lat;
  const d = toDays(date);

  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;

  const M = RAD * (357.5291 + 0.98560028 * ds);
  const L = eclipticLongitude(M);
  const dec = Math.asin(Math.sin(L) * Math.sin(RAD * 23.4397));

  const jNoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);

  const cosH =
    (Math.sin(SUNSET_ANGLE) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));

  // |cosH| > 1 → sarkköri nappal vagy sarkköri éjszaka: nincs napkelte/nyugta.
  if (cosH > 1 || cosH < -1) return null;

  const H = Math.acos(cosH);
  const jSet = jNoon + H / (2 * Math.PI);
  const jRise = jNoon - H / (2 * Math.PI);

  return { sunrise: fromJulian(jRise), sunset: fromJulian(jSet) };
}

function toDays(date: Date): number {
  return date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
}

function fromJulian(j: number): Date {
  return new Date((j + 0.5 - J1970) * DAY_MS);
}

function eclipticLongitude(M: number): number {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372;
  return M + C + P + Math.PI;
}

/* ═══════════════════════════════════════════════════════════════════
   Alkalmazás a DOM-ra
   ═══════════════════════════════════════════════════════════════════ */

/** A világos és a sötét téma felületi alapszíne — a böngészőkeret színéhez. */
const THEME_COLOR: Record<Theme, string> = {
  light: '#f7f7fa',
  dark: '#09080d',
};

export function applyTheme(theme: Theme, animate = true): void {
  const root = document.documentElement;

  try {
    localStorage.setItem(LAST_THEME_KEY, theme);
  } catch {
    /* privát böngészés */
  }

  if (root.getAttribute('data-theme') === theme) return;

  if (animate) {
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 300);
  }

  root.setAttribute('data-theme', theme);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
}

export function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/* ═══════════════════════════════════════════════════════════════════
   Tárolás
   ═══════════════════════════════════════════════════════════════════ */

export function loadSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME_SETTINGS;
    return { ...DEFAULT_THEME_SETTINGS, ...(JSON.parse(raw) as Partial<ThemeSettings>) };
  } catch {
    return DEFAULT_THEME_SETTINGS;
  }
}

export function saveSettings(settings: ThemeSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* privát böngészés — a beállítás nem marad meg, de az app működik */
  }
}

/** Mapbox stílus a témához. */
export function mapStyleFor(theme: Theme): string {
  // `||`, nem `??` — a környezeti változó létezhet ÜRES stringként is
  // (pl. ha a titkot felvették, de nem töltötték ki). A `??` ilyenkor az
  // üres stringet adná vissza, és a térkép némán nem töltődne be.
  const light = import.meta.env.VITE_MAPBOX_STYLE_LIGHT;
  const dark = import.meta.env.VITE_MAPBOX_STYLE_DARK;
  return theme === 'dark'
    ? dark || 'mapbox://styles/mapbox/dark-v11'
    : light || 'mapbox://styles/mapbox/light-v11';
}

/**
 * Megjelenítési formázók. A területet SEHOL ne formázd kézzel — mindig
 * a `formatArea()`-t hívd, különben szétcsúszik a mértékegység-logika.
 *
 * docs/03-jatekszabalyok.md → A terület megjelenítése
 */

const hu = (opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat('hu-HU', opts);

/**
 * Terület MINDIG km²-ben, három tizedesjeggyel.
 *   0,001 km²  ·  0,072 km²  ·  1,845 km²  ·  55,830 km²
 *
 * Miért nem m²? Mert a valós számok gyorsan hatjegyűek lesznek („143 104 m²"),
 * és egy hatjegyű szám nem mond semmit — nincs mihez viszonyítani. A km² a
 * térképen is értelmezhető nagyságrend.
 *
 * AMIT EZ ÁLDOZ: három tizedesjegy km²-ben ezer négyzetméteres felbontás, egy
 * hexagon viszont 307 m². Néhány mezőnyi terület ezért „0,000 km²"-ként
 * jelenik meg. Ez tudatos csere: a kezdő felhasználó pár mezője úgyis
 * jelentéktelen, a nagyságrend viszont az első pillanattól olvasható.
 */
export function formatArea(m2: number): string {
  return `${hu({ minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(m2 / 1_000_000)} km²`;
}

/** Előjeles területváltozás: `+0,840 km²` / `−0,021 km²` */
export function formatAreaDelta(m2: number): string {
  const sign = m2 > 0 ? '+' : m2 < 0 ? '−' : '';
  return `${sign}${formatArea(Math.abs(m2))}`;
}

/**
 * Mezőszám tömören: `847`, `1K`, `2,2K`, `14K`.
 *
 * MIÉRT KELL? A statisztikapanel három egymás melletti dobozból áll, és a
 * mezőszám a terület MELLÉ kerül. Egy `12 480` ott kiszorítaná a km²-t —
 * márpedig a kettő együtt mond valamit: mekkora és hány darabból.
 *
 * Ezer alatt pontos szám, mert ott a pontosság még olvasható és érdekes.
 * Fölötte egy tizedes: a `2,2K` ugyanolyan gyorsan megfogható, mint a `847`,
 * és nem tolja szét a dobozt. A tízezres tartományban a tizedes már zaj,
 * ezért ott elmarad.
 *
 * Milliós fokozat is van: egy Balaton-méretű grund ~1,95 millió mező, és az
 * `1950K` alakban olvashatatlan. `1,9M` — ennyi.
 */
export function formatCellCount(cells: number): string {
  const value = Math.max(0, Math.round(cells));
  if (value < 1000) return hu({ maximumFractionDigits: 0 }).format(value);
  if (value < 10_000) {
    return `${hu({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 1000)}K`;
  }
  if (value < 1_000_000) return `${hu({ maximumFractionDigits: 0 }).format(value / 1000)}K`;
  return `${hu({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 1_000_000)}M`;
}

export function formatGp(gp: number): string {
  return `${hu({ maximumFractionDigits: 0 }).format(gp)} GP`;
}

/** Csak a szám, mértékegység nélkül — pl. a Home statisztikapanel kiemelt sorához. */
export function formatNumber(value: number): string {
  return hu({ maximumFractionDigits: 0 }).format(value);
}

export function formatDistance(meters: number, unit: 'km' | 'mi' = 'km'): string {
  if (unit === 'mi') {
    return `${hu({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(meters / 1609.344)} mi`;
  }
  return `${hu({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(meters / 1000)} km`;
}

/** Tempó másodperc/km-ből: `7:40` */
export function formatPace(secondsPerKm: number): string {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return '--:--';
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Időtartam: `52:24` vagy `1:04:18` */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  return h > 0
    ? `${h}:${mm}:${String(s).padStart(2, '0')}`
    : `${mm}:${String(s).padStart(2, '0')}`;
}

export function formatElevation(meters: number): string {
  const sign = meters > 0 ? '+' : '';
  return `${sign}${hu({ maximumFractionDigits: 0 }).format(meters)} m`;
}

/** Szorzó magyar tizedesvesszővel: `×1,15` */
export function formatMultiplier(value: number): string {
  return `×${hu({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

/** `1×` … `5×` */
export function formatDefense(level: number): string {
  return `${level}×`;
}

/** Átlagsebesség km/h-ban: `21,4 km/h` — bringánál ez a beszélt mérték. */
export function formatSpeed(metersPerSecond: number): string {
  if (!Number.isFinite(metersPerSecond) || metersPerSecond <= 0) return '--';
  return `${hu({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(metersPerSecond * 3.6)} km/h`;
}

/**
 * Sebesség a rögzítés képernyő nagy számához — az ÁLLÁS is mérés.
 *
 * A `formatSpeed` a nullát „nincs adat"-nak veszi, és `--`-t ad rá: egy kész
 * aktivitás átlagánál ez a helyes. Mérés közben viszont a 0,0 km/h VALÓDI
 * érték (állsz a lámpánál), és a felület sem lehet olyan, hogy minden
 * megállásnál eltűnik a legnagyobb szám a képernyőről.
 *
 * A mértékegység SZÁNDÉKOSAN a sztring része: a rögzítés panelen a sebesség
 * ugyanúgy „12,0 km/h" alakban áll, ahogy a megtett táv „1,55 km" — azonos
 * méretben és színben, a címke pedig alatta a mérőszám NEVE („sebesség").
 */
export function formatLiveSpeed(metersPerSecond: number | null): string {
  if (metersPerSecond === null || !Number.isFinite(metersPerSecond)) return '—';
  const kmh = Math.max(0, metersPerSecond) * 3.6;
  return `${hu({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(kmh)} km/h`;
}

/**
 * A mozgásforma fő tempó-mérőszáma.
 *
 * Futásnál és sétánál a TEMPÓ (perc/km) a beszélt mérték, bringánál a
 * SEBESSÉG (km/h). Ugyanaz az adat, de aki bringázik, annak a „3:00/km"
 * semmit nem mond — és fordítva.
 */
export function formatEffort(
  type: 'run' | 'walk' | 'ride',
  meters: number,
  seconds: number,
): { value: string; label: string } {
  if (meters <= 0 || seconds <= 0) return { value: '--', label: type === 'ride' ? 'seb.' : 'tempó' };
  return type === 'ride'
    ? { value: formatSpeed(meters / seconds), label: 'seb.' }
    : { value: `${formatPace(seconds / (meters / 1000))}/km`, label: 'tempó' };
}

/**
 * „ma", „tegnap", vagy dátum.
 *
 * Naptári napokat hasonlítunk, nem eltelt órákat: egy tegnap este 23:00-kor
 * kezdett futás ma reggel 7-kor „9 órája" lenne, pedig a felhasználó fejében
 * egyértelműen tegnapi.
 */
export function formatRelativeDay(at: number): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(at))) / 86_400_000);
  if (days <= 0) return 'ma';
  if (days === 1) return 'tegnap';
  if (days < 7) return `${days} napja`;
  return new Date(at).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
}

/** Teljes dátum és időpont: `2026. aug. 15. 15:54` */
export function formatDateTime(at: number): string {
  return new Date(at).toLocaleString('hu-HU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const DAY_PART = [
  { until: 5, name: 'Éjszakai' },
  { until: 10, name: 'Reggeli' },
  { until: 14, name: 'Délelőtti' },
  { until: 18, name: 'Délutáni' },
  { until: 22, name: 'Esti' },
];

const MOVEMENT: Record<'run' | 'walk' | 'ride', string> = {
  run: 'futás',
  walk: 'séta',
  ride: 'bringázás',
};

/**
 * A napnevek melléknévi alakja, a hét napjának sorszáma szerint (0 = vasárnap).
 *
 * ⚠️ NEM az `Intl` hu-HU kimenetéhez ragasztunk „i" végződést: a toldalékolás
 * ICU-verziófüggő lenne, itt viszont fix, ellenőrizhető lista kell.
 */
const WEEKDAY_ADJECTIVE = [
  'Vasárnapi', 'Hétfői', 'Keddi', 'Szerdai', 'Csütörtöki', 'Pénteki', 'Szombati',
] as const;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Automatikus cím: „Délutáni bringázás".
 *
 * Az aktivitásnak lesz szerkeszthető címe, de amíg a felhasználó nem ad neki,
 * a napszak + mozgásforma sokkal használhatóbb, mint egy azonosító. Egy
 * listában így is meg lehet különböztetni a reggeli futást az estitől.
 *
 * ⚠️ NYOLC ÓRÁNÁL HOSSZABB aktivitásnál a napszak félrevezető — egy egész
 * napos túra nem „reggeli" —, ezért ott a BEFEJEZÉS napjának neve jön:
 * „Szombati bringázás".
 */
export function activityTitle(
  type: 'run' | 'walk' | 'ride', startedAt: number, durationS = 0,
  endedAt = startedAt, timeZone?: string,
): string {
  if (durationS > 8 * 60 * 60) {
    const short = new Intl.DateTimeFormat('en-US', { weekday: 'short', ...(timeZone ? { timeZone } : {}) })
      .format(new Date(endedAt));
    const day = WEEKDAY_ADJECTIVE[WEEKDAY_INDEX[short] ?? new Date(endedAt).getDay()]!;
    return `${day} ${MOVEMENT[type]}`;
  }
  const hour = timeZone
    ? Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(startedAt)))
    : new Date(startedAt).getHours();
  const part = DAY_PART.find((p) => hour < p.until)?.name ?? 'Éjszakai';
  return `${part} ${MOVEMENT[type]}`;
}

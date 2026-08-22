import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { WeatherIcon } from '@/components/WeatherIcon';
import { useAuth } from '@/hooks/AuthProvider';
import { db } from '@/lib/firebase';
import { api, apiConfigured, ApiError, type WeatherResult } from '@/lib/api';
import './weatherWidget.css';

/**
 * Kompakt időjárás — a köszöntő sor jobb szélén, KIBONTHATÓAN.
 *
 * Zárva egyetlen ikon és a hőmérséklet, egymás mellett. (A referenciaképen
 * egymás alatt vannak; ez szándékos eltérés, Geri kérésére — a köszöntő sorba
 * így fér be anélkül, hogy megnőne a fejléc magassága.)
 *
 * KOPPINTÁSRA UGYANAZ A PANEL NŐ MEG BALRA, nem nyílik külön doboz: a
 * mérőszámok a pillen BELÜL jelennek meg, a bal szélen álló nyílhegy pedig
 * eleve elárulja, hogy van mit kinyitni. Három adat jön elő — csapadék
 * esélye, páratartalom, szél —, a hőmérséklet és az égkép NEM ismétlődik
 * meg, hiszen ott van mellettük a panel jobb szélén.
 *
 * Nyitva a „Szia, <név>" felirat elrejtőzik (`home.css`, `:has()`): a sáv
 * úgyis eltakarná, így viszont a hely is felszabadul neki.
 *
 * ⚠️ NEM KÉR HELYZETET MAGÁTÓL, amikor betölt az app.
 *
 * Ez a legfontosabb döntés a komponensben. Egy engedélykérő ablak az
 * indításkor, egy időjárás-csempéért, az egyik legbiztosabb módja annak, hogy
 * a felhasználó örökre megtagadja a helyzetét — és akkor a TÉRKÉP sem működik,
 * ami viszont a termék lényege. Ezért:
 *
 *   1. először a `users/{uid}/private/position` dokumentumot olvassuk. Ezt a
 *      Grund képernyő már úgyis felírta, ha a felhasználó járt ott — ilyenkor
 *      az időjárás kérés nélkül megjelenik;
 *   2. ha nincs ilyen, a widget helyén egy KOPPINTHATÓ jel áll. A böngésző
 *      engedélykérése csak akkor jön elő, ha a felhasználó maga kérte.
 */

/** Ennyi ideig hisszük el a betöltött időjárást, mielőtt újrakérnénk. */
const REFRESH_MS = 10 * 60 * 1000;

type Position = { lat: number; lon: number };

export function WeatherWidget() {
  const { user } = useAuth();
  const [position, setPosition] = useState<Position | null>(null);
  const [weather, setWeather] = useState<WeatherResult | null>(null);
  /** Nem tudunk hova nyúlni: se tárolt pozíció, se megadott engedély. */
  const [needsPosition, setNeedsPosition] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLButtonElement | null>(null);

  /* ── 1. A már tárolt pozíció — engedélykérés NÉLKÜL ──────────── */

  useEffect(() => {
    if (!user || !db) {
      setNeedsPosition(true);
      return;
    }
    let alive = true;
    void getDoc(doc(db, 'users', user.uid, 'private', 'position'))
      .then((snapshot) => {
        if (!alive) return;
        const data = snapshot.data() as { lat?: number; lng?: number } | undefined;
        if (typeof data?.lat === 'number' && typeof data?.lng === 'number') {
          setPosition({ lat: data.lat, lon: data.lng });
        } else {
          setNeedsPosition(true);
        }
      })
      .catch(() => {
        if (alive) setNeedsPosition(true);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  /* ── 2. Kérésre: a böngésző helymeghatározása ────────────────── */

  const askPosition = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setFailed(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setNeedsPosition(false);
        setPosition({ lat: p.coords.latitude, lon: p.coords.longitude });
      },
      () => setFailed(true),
      /*
        Az időjáráshoz NEM kell pontos fix: egy városnyi pontosság bőven elég,
        és a `maximumAge` miatt egy nemrég mért helyzet azonnal jó — nem
        kapcsol be a GPS a semmiért.
      */
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  }, []);

  /* ── 3. Az időjárás lekérése ─────────────────────────────────── */

  useEffect(() => {
    if (position === null || !apiConfigured) return;
    let alive = true;

    const load = () => {
      api
        .weather(position.lat, position.lon)
        .then((result) => {
          if (alive) setWeather(result);
        })
        .catch((error: unknown) => {
          /*
            A HIÁNYZÓ ADAT ITT NEM HIBAÜZENET.

            Az időjárás dísz a köszöntő sorban, nem funkció. Ha a szolgáltató
            néma, a widget egyszerűen nincs ott — egy piros hibasáv a Home
            tetején rosszabb, mint a hiánya.
          */
          if (alive) {
            setFailed(true);
            if (!(error instanceof ApiError)) return;
          }
        });
    };

    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [position]);

  /* ── 4. A kibontott sáv bezárása ─────────────────────────────── */

  useEffect(() => {
    if (!open) return;
    /*
      Kívülre koppintva és Escape-re is záródik. A `pointerdown` (és nem
      `click`) azért kell, hogy a sáv már a következő koppintás ELEJÉN
      eltűnjön — különben a mögötte lévő gombot csak második nekifutásra
      lehetne eltalálni.
    */
    function onPointerDown(event: PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (failed) return null;

  if (needsPosition) {
    return (
      <button
        type="button"
        className="weather weather--ask"
        onClick={askPosition}
        aria-label="Időjárás megjelenítése a helyzeted alapján"
        title="Időjárás megjelenítése"
      >
        <PinIcon />
      </button>
    );
  }

  if (weather === null) return <span className="weather weather--pending" aria-hidden="true" />;

  return (
    <button
      type="button"
      ref={wrap}
      className={`weather weather--toggle${open ? ' weather--open' : ''}`}
      aria-expanded={open}
      /* A képernyőolvasónak a leírás is jár — az ikon önmagában néma. */
      aria-label={`${weather.description}, ${weather.tempC} fok. Részletek megnyitása.`}
      title={weather.description}
      onClick={() => setOpen((value) => !value)}
    >
      {/* Csak a nyílhegy: ennyi elég ahhoz, hogy legyen mire koppintani. */}
      <ChevronIcon />

      <span className="weather__detail" aria-hidden={!open}>
        <Metric
          icon={<PrecipitationIcon />}
          tone="precip"
          label="csapadék esélye"
          value={weather.precipitationChance === null ? '–' : `${weather.precipitationChance}%`}
        />
        <Metric
          icon={<HumidityIcon />}
          tone="humidity"
          label="páratartalom"
          value={weather.humidity === null ? '–' : `${weather.humidity}%`}
        />
        <Metric
          icon={<WindIcon />}
          tone="wind"
          label="szél"
          value={weather.windKph === null ? '–' : `${weather.windKph} km/h`}
        />
      </span>

      <WeatherIcon condition={weather.condition} night={weather.night} />
      <span className="weather__temp">{weather.tempC} °C</span>
    </button>
  );
}

function Metric({
  icon,
  tone,
  label,
  value,
}: {
  icon: React.ReactNode;
  /** Az ikon színe — mérőszámonként más, hogy szét lehessen kapni őket. */
  tone: 'precip' | 'humidity' | 'wind';
  label: string;
  value: string;
}) {
  return (
    <span className="weather__metric" title={label}>
      <span className={`weather__metric-icon weather__metric-icon--${tone}`} aria-hidden="true">
        {icon}
      </span>
      <span className="weather__metric-value">
        {/* A címke csak a képernyőolvasónak és az egérnek szól: a sávban
            négy adatnak kell elférnie egy telefon szélességében. */}
        <span className="weather__metric-label">{label}: </span>
        {value}
      </span>
    </span>
  );
}

/* ── Ikonok ───────────────────────────────────────────────────────── */

const metricIcon = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

function PrecipitationIcon() {
  return (
    <svg {...metricIcon}>
      <path d="M7 15a4 4 0 0 1 .6-8A5 5 0 0 1 17 8.5a3.2 3.2 0 0 1 .3 6.5" />
      <path d="M9 18.5v1.5M13 18v2.5M17 18.5v1.5" />
    </svg>
  );
}

function HumidityIcon() {
  return (
    <svg {...metricIcon}>
      <path d="M12 3.5s5.5 6 5.5 9.5a5.5 5.5 0 1 1-11 0C6.5 9.5 12 3.5 12 3.5Z" />
    </svg>
  );
}

function WindIcon() {
  return (
    <svg {...metricIcon}>
      <path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5M3 12h14a2.5 2.5 0 1 1-2.5 2.5M3 16h7.5a2 2 0 1 1-2 2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="weather__chevron"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}

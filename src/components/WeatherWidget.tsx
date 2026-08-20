import { useCallback, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { WeatherIcon } from '@/components/WeatherIcon';
import { useAuth } from '@/hooks/AuthProvider';
import { db } from '@/lib/firebase';
import { api, apiConfigured, ApiError, type WeatherResult } from '@/lib/api';
import './weatherWidget.css';

/**
 * Kompakt időjárás — a köszöntő sor jobb szélén.
 *
 * Egyetlen ikon és a hőmérséklet, EGYMÁS MELLETT. (A referenciaképen egymás
 * alatt vannak; ez szándékos eltérés, Geri kérésére — a köszöntő sorba így fér
 * be anélkül, hogy megnőne a fejléc magassága.)
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
            néma vagy a kulcs nincs beállítva, a widget egyszerűen nincs ott —
            egy piros hibasáv a Home tetején rosszabb, mint a hiánya.
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
    <div
      className="weather"
      /* A képernyőolvasónak a leírás is jár — az ikon önmagában néma. */
      aria-label={`${weather.description}, ${weather.tempC} fok`}
      title={weather.description}
    >
      <WeatherIcon condition={weather.condition} night={weather.night} />
      <span className="weather__temp">{weather.tempC} °C</span>
    </div>
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

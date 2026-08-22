import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ScreenHeader, SegmentedControl } from '@/components/ui';
import { useProfile } from '@/hooks/ProfileProvider';
import { useThemeContext } from '@/hooks/ThemeProvider';
import { useSharedPosition } from '@/hooks/useSharedPosition';
import { routeImageUrl } from '@/lib/staticMap';
import { rememberDailyMission } from '@/lib/dailyMission';
import { formatArea, formatDistance, formatNumber } from '@/lib/format';
import { api, ApiError, apiConfigured, type Mission, type MissionResult } from '@/lib/api';
import { GAMEPLAY } from '@/config/gameplay';
import type { ActivityType } from '@/types';
import './missions.css';

/**
 * Küldetés-ajánló — „van 45 perced?".
 *
 * EZ NEM ÚTVONALTERVEZŐ. A „fuss 8 km-t" logika bármelyik futóappban megvan;
 * itt az útvonalnak játékbeli TÉTJE van, és a kártya ezt mondja ki: mennyi
 * területet szerzel, kitől veszel el, melyik zónád védelme nő.
 *
 * A bemenet IDŐ, nem távolság — a felhasználónak nem kell fejben átváltania,
 * hogy nála 45 perc hány kilométer. A célhosszt a szerver számolja a saját
 * átlagtempójából.
 *
 * docs/02-funkcionalis-spec.md → Útvonalak fül — Küldetés-ajánló
 */

const TYPE_OPTIONS: { value: ActivityType; label: string }[] = [
  { value: 'run', label: 'Futás' },
  { value: 'walk', label: 'Séta' },
  { value: 'ride', label: 'Bringa' },
];

const LAST_TYPE_KEY = 'grundo.lastActivityType';

/** A kártya fejléce karakterenként — szín, ikon, felirat. */
const KIND_META: Record<Mission['kind'], { label: string; tone: string }> = {
  conquest: { label: 'Hódítás', tone: 'conquest' },
  raid: { label: 'Rajtaütés', tone: 'raid' },
  fortify: { label: 'Erősítés', tone: 'fortify' },
  explore: { label: 'Felfedezés', tone: 'explore' },
};

export function MissionsScreen() {
  const navigate = useNavigate();
  const { profile } = useProfile();
  const shared = useSharedPosition(profile?.uid);

  const [minutes, setMinutes] = useState<number>(45);
  const [type, setType] = useState<ActivityType>(() => readType());
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [result, setResult] = useState<MissionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (shared) setPosition({ lat: shared.lat, lng: shared.lng });
  }, [shared]);

  useEffect(() => {
    try {
      localStorage.setItem(LAST_TYPE_KEY, type);
    } catch {
      /* privát böngészés — a választás nem marad meg, de működik */
    }
  }, [type]);

  /**
   * A helyzet a küldetéshez KELL — enélkül nincs mihez képest kört keresni.
   *
   * Ha nincs tárolt pozíció (a Grund képernyő még nem írt egyet), itt kérjük
   * el. Ez felhasználói gesztusra történik, nem az app indulásakor — lásd a
   * `WeatherWidget` fejlécében ugyanezt az indoklást.
   */
  function askPosition(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (position) {
        resolve(position);
        return;
      }
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (fix) => {
          const next = { lat: fix.coords.latitude, lng: fix.coords.longitude };
          setPosition(next);
          resolve(next);
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      );
    });
  }

  async function generate() {
    if (!apiConfigured) {
      setError('A háttérszolgáltatás nincs beállítva, a küldetés nem generálható.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const where = await askPosition();
      if (!where) {
        setError('A küldetéshez tudnunk kell, hol vagy. Engedélyezd a helymeghatározást.');
        return;
      }

      const generated = await api.generateMissions({ ...where, minutes, type });
      setResult(generated);
      // A legjobb ajánlat átkerül a Home „mai küldetés" kártyájára is.
      rememberDailyMission(generated.missions[0]);
    } catch (problem: unknown) {
      setResult(null);
      setError(
        problem instanceof ApiError ? problem.message : 'A küldetés-generálás most nem működik.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <ScreenHeader title="Küldetések" backTo="/" />

      <div className="screen-body stack">
        <section className="card mission__form">
          <div className="mission__question">Mennyi időd van?</div>

          {/*
            Gombsor, nem csúszka. A docs csúszkát ír, de öt fix érték mellett a
            csúszka csak pontatlanabb: ugyanaz az öt állás, nehezebben
            eltalálható. A jelentés változatlan.
          */}
          <div className="mission__minutes" role="group" aria-label="Időkeret">
            {GAMEPLAY.MISSION_MINUTE_OPTIONS.map((option) => (
              <button
                type="button"
                key={option}
                className={`mission__minute${option === minutes ? ' mission__minute--active' : ''}`}
                aria-pressed={option === minutes}
                onClick={() => setMinutes(option)}
              >
                {option}
                <span className="mission__minute-unit">perc</span>
              </button>
            ))}
          </div>

          <SegmentedControl
            options={TYPE_OPTIONS}
            value={type}
            onChange={setType}
            label="Mozgásforma"
            block
          />

          <Button block onClick={() => void generate()} loading={loading}>
            {result ? 'Újragenerálás' : 'Küldetéseket kérek'}
          </Button>

          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}

          {result?.quota && !result.quota.unlimited ? (
            <p className="mission__quota">
              Ezen a héten {result.quota.used}/{result.quota.limit} ingyenes generálás.
            </p>
          ) : null}
        </section>

        {result ? <Results result={result} onStart={() => navigate('/rogzites')} /> : null}
      </div>
    </>
  );
}

function Results({ result, onStart }: { result: MissionResult; onStart: () => void }) {
  if (result.missions.length === 0) {
    return (
      <section className="card">
        <p className="mission__empty">
          {result.reason === 'no_loops'
            ? 'Ezen a környéken most nem találtunk bezárható kört ennyi időre. Próbáld hosszabb időkerettel, vagy indulj el egy másik pontról.'
            : 'Most nincs ajánlható küldetés.'}
        </p>
      </section>
    );
  }

  return (
    <>
      <p className="mission__target">
        Célhossz: <strong>{formatDistance(result.targetKm * 1000)}</strong> — a saját tempódból
        számolva.
      </p>
      {result.missions.map((mission) => (
        <MissionCard key={mission.kind} mission={mission} onStart={onStart} />
      ))}
    </>
  );
}

function MissionCard({ mission, onStart }: { mission: Mission; onStart: () => void }) {
  const { theme } = useThemeContext();
  const [mapFailed, setMapFailed] = useState(false);
  const meta = KIND_META[mission.kind];
  const mapUrl = mapFailed ? null : routeImageUrl(mission.polyline, { theme });

  return (
    <section className={`card mission__card mission__card--${meta.tone}`}>
      <header className="mission__head">
        <span className={`mission__badge mission__badge--${meta.tone}`}>{meta.label}</span>
        <span className="mission__distance">{formatDistance(mission.distanceKm * 1000)}</span>
      </header>

      <p className="mission__headline">{headlineOf(mission)}</p>

      {mapUrl ? (
        <img
          className="mission__map"
          src={mapUrl}
          alt=""
          loading="lazy"
          onError={() => setMapFailed(true)}
        />
      ) : null}

      <dl className="mission__stats">
        <MissionStat label={areaStat(mission).label} value={areaStat(mission).value} />
        <MissionStat label="Becsült GP" value={formatNumber(mission.estimatedGp)} />
        <MissionStat label="Mező" value={formatNumber(mission.cellCount)} />
      </dl>

      <Button block variant="secondary" onClick={onStart}>
        Indítás most
      </Button>
    </section>
  );
}

/**
 * A terület-rovat KARAKTERENKÉNT MÁST mér.
 *
 * Az erősítésnél a szerzett terület per definíció NULLA — a cellák már a
 * tieid, csak a védelmük nő. „Terület: 0,000 km²" ott hibásnak látszana,
 * pedig a küldetésnek épp az a lényege, hogy a MEGLÉVŐ grundodat erősíted.
 * Ezért ott a megerősített területet mutatjuk, saját felirattal.
 */
function areaStat(mission: Mission): { label: string; value: string } {
  if (mission.kind === 'fortify') {
    const cells = mission.counts?.reclaimed ?? 0;
    return { label: 'Megerősített', value: formatArea(cells * GAMEPLAY.CELL_AREA_M2) };
  }
  return { label: 'Új terület', value: formatArea(mission.areaM2) };
}

function MissionStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="mission__stat">
      <dt className="mission__stat-label">{label}</dt>
      <dd className="mission__stat-value">{value}</dd>
    </div>
  );
}

/**
 * A kártya egy mondata — karakterenként MÁS állítás.
 *
 * ⚠️ A CÉLPONT NEVE A SZERVERTŐL JÖN, és `null`, ha a fiókja privát vagy ma
 * már szerepelt célpontként. A felület ilyenkor nem talál ki nevet: „egy
 * helyi játékostól" a helyes szöveg. A küldetés nem lehet célzott zaklatási
 * eszköz (docs/02 → Adatvédelmi korlát).
 */
function headlineOf(mission: Mission): string {
  const area = formatArea(mission.areaM2);
  switch (mission.kind) {
    case 'conquest':
      return `Ezzel a körrel ${area} új területet szerezhetsz.`;
    case 'raid': {
      const stolen = formatArea(mission.victimAreaM2);
      return mission.victimName
        ? `Ha erre mész, elvehetsz ${stolen}-t ${mission.victimName} grundjából.`
        : `Ha erre mész, elvehetsz ${stolen}-t egy helyi játékostól.`;
    }
    case 'fortify':
      return `Ez a kör megerősíti a meglévő grundodat — ${formatNumber(
        mission.counts?.reclaimed ?? 0,
      )} mező védelme nő.`;
    case 'explore':
      return `${formatNumber(mission.newBlocks)} olyan körzet, ahol még egyetlen meződ sincs.`;
  }
}

function readType(): ActivityType {
  try {
    const stored = localStorage.getItem(LAST_TYPE_KEY);
    if (stored === 'run' || stored === 'walk' || stored === 'ride') return stored;
  } catch {
    /* privát böngészés */
  }
  return 'run';
}

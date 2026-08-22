import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ScreenHeader, SegmentedControl } from '@/components/ui';
import { useProfile } from '@/hooks/ProfileProvider';
import { useThemeContext } from '@/hooks/ThemeProvider';
import { useSharedPosition } from '@/hooks/useSharedPosition';
import { routeImageUrl } from '@/lib/staticMap';
import { readDailyMissionResult, rememberDailyMission } from '@/lib/dailyMission';
import { rememberGhostRoute } from '@/lib/ghostRoute';
import { MISSION_KIND_META, missionAreaStat } from '@/lib/missionMeta';
import { isRouteSaved, saveRoute } from '@/lib/savedRoutes';
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

type TimeUnit = 'minute' | 'hour';

const UNIT_OPTIONS: { value: TimeUnit; label: string }[] = [
  { value: 'minute', label: 'perc' },
  { value: 'hour', label: 'óra' },
];

/**
 * A ténylegesen elküldendő időkeret PERCBEN.
 *
 * A szerver mindig percet vár, tehát az óra/perc választás itt oldódik fel.
 * A határokat a kliens is ismeri (`GAMEPLAY.MISSION_MIN/MAX_MINUTES`), hogy
 * a felhasználó azonnal visszajelzést kapjon — de a szerver is ellenőrzi,
 * mert a kliens ellenőrzése sosem elég.
 */
/**
 * Hány percre szólt egy visszatöltött eredmény?
 *
 * Nem tároljuk külön: a válasz `targetKm`-je és `paceSecPerKm`-je pontosan
 * ebből számolódott (`targetDistanceKm`), tehát visszafelé is megvan. Így az
 * űrlap ugyanazt az időt mutatja, amiből a kártyák készültek — különben az
 * „Újragenerálás" csendben másik időkerettel indulna.
 */
function minutesOf(result: MissionResult | null): number | null {
  if (!result || !(result.targetKm > 0) || !(result.paceSecPerKm > 0)) return null;
  const minutes = Math.round((result.targetKm * result.paceSecPerKm) / 60);
  return minutes >= GAMEPLAY.MISSION_MIN_MINUTES && minutes <= GAMEPLAY.MISSION_MAX_MINUTES
    ? minutes
    : null;
}

function resolveMinutes(
  customOpen: boolean,
  preset: number,
  raw: string,
  unit: TimeUnit,
): number | null {
  if (!customOpen) return preset;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  const asMinutes = Math.round(unit === 'hour' ? value * 60 : value);
  if (asMinutes < GAMEPLAY.MISSION_MIN_MINUTES || asMinutes > GAMEPLAY.MISSION_MAX_MINUTES) {
    return null;
  }
  return asMinutes;
}

export function MissionsScreen() {
  const navigate = useNavigate();
  const { profile } = useProfile();
  const shared = useSharedPosition(profile?.uid);

  /*
    A MAI GENERÁLÁS VISSZATÖLTVE — nem új hívás, nem fogyaszt kvótát.

    A Home kártyája eddig egy konkrét ajánlatot mutatott, a gombja viszont ide,
    egy ÜRES képernyőre vitt: a felhasználó azt látta, hogy amit az előbb
    olvasott, itt nyoma sincs. A tár amúgy is naponta ürül, tehát ami
    visszajön, az mindig a mai birtokviszonyra épült.

    A `useState` LUSTA alakja fontos: a tár olvasása és a JSON értelmezése így
    egyszer fut le, nem minden rendernél.
  */
  const [restored] = useState(() => {
    const result = readDailyMissionResult();
    const minutes = minutesOf(result);
    const preset =
      minutes !== null && (GAMEPLAY.MISSION_MINUTE_OPTIONS as readonly number[]).includes(minutes);
    return { result, minutes, preset };
  });

  const [minutes, setMinutes] = useState<number>(
    restored.preset && restored.minutes !== null ? restored.minutes : 45,
  );
  const [customOpen, setCustomOpen] = useState(restored.minutes !== null && !restored.preset);
  const [customValue, setCustomValue] = useState(
    restored.minutes !== null && !restored.preset ? String(restored.minutes) : '90',
  );
  const [customUnit, setCustomUnit] = useState<TimeUnit>('minute');
  const [type, setType] = useState<ActivityType>(() => readType());
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [result, setResult] = useState<MissionResult | null>(restored.result);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** Igaz, amíg a képernyőn a visszatöltött, nem a most kért eredmény áll. */
  const [fromToday, setFromToday] = useState(restored.result !== null);

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

    const wanted = resolveMinutes(customOpen, minutes, customValue, customUnit);
    if (wanted === null) {
      const maxHours = Math.round(GAMEPLAY.MISSION_MAX_MINUTES / 60);
      setError(
        `Az időkeret ${GAMEPLAY.MISSION_MIN_MINUTES} perc és ${maxHours} óra között lehet.`,
      );
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

      const generated = await api.generateMissions({ ...where, minutes: wanted, type });
      setResult(generated);
      setFromToday(false);
      // Az eredmény átkerül a Home „mai küldetés" kártyájára, és ide is
      // visszatölthető marad, ha a felhasználó közben elnavigál.
      rememberDailyMission(generated);
    } catch (problem: unknown) {
      setResult(null);
      setFromToday(false);
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
                className={`mission__minute${
                  !customOpen && option === minutes ? ' mission__minute--active' : ''
                }`}
                aria-pressed={!customOpen && option === minutes}
                onClick={() => {
                  setCustomOpen(false);
                  setMinutes(option);
                }}
              >
                {option}
                <span className="mission__minute-unit">perc</span>
              </button>
            ))}
            <button
              type="button"
              className={`mission__minute${customOpen ? ' mission__minute--active' : ''}`}
              aria-pressed={customOpen}
              onClick={() => setCustomOpen(true)}
            >
              <PencilIcon />
              <span className="mission__minute-unit">egyedi</span>
            </button>
          </div>

          {/*
            EGYEDI IDŐ — a fix gombok nem fedik le mindenki napját.

            Az érték a beírt szám ÉS a mértékegység szorzata; a `minutes`
            állapot mindig percben marad, mert a szerver azt várja. Így az
            óra/perc váltás tisztán megjelenítési kérdés, nem kerül át a
            hálózati szerződésbe.
          */}
          {customOpen ? (
            <div className="mission__custom">
              <input
                type="number"
                className="mission__custom-input"
                inputMode="numeric"
                min={1}
                value={customValue}
                aria-label={customUnit === 'hour' ? 'Óra' : 'Perc'}
                onChange={(event) => setCustomValue(event.target.value)}
              />
              <SegmentedControl
                options={UNIT_OPTIONS}
                value={customUnit}
                onChange={setCustomUnit}
                label="Mértékegység"
                size="sm"
              />
            </div>
          ) : null}

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

        {result && fromToday && result.missions.length > 0 ? (
          <p className="mission__restored">A ma generált küldetéseid.</p>
        ) : null}

        {result ? (
          <Results
            result={result}
            onStart={(mission) => {
              // A vonal a rögzítés térképén „szellemvonalként" jelenik meg —
              // a küldetés ígér egy útvonalat, ez viszi el oda a rajzot.
              rememberGhostRoute(mission);
              navigate('/rogzites');
            }}
          />
        ) : null}
      </div>
    </>
  );
}

function Results({
  result,
  onStart,
}: {
  result: MissionResult;
  onStart: (mission: Mission) => void;
}) {
  if (result.missions.length === 0) {
    return (
      <section className="card">
        <p className="mission__empty">{emptyMessage(result.reason)}</p>
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
        <MissionCard key={mission.kind} mission={mission} onStart={() => onStart(mission)} />
      ))}
    </>
  );
}

/**
 * Az üres válasz OKA — háromféle, és mindegyikre MÁS a teendő.
 *
 * Korábban mindhárom ugyanazt az üzenetet kapta („nincs bezárható kör"),
 * ami félrevezető volt: ha az útvonaltervező adott is kört, csak rossz
 * méretűt, a felhasználó hiába indult el máshonnan.
 */
function emptyMessage(reason: string | undefined): string {
  switch (reason) {
    case 'no_routes':
      return 'Az útvonaltervező most nem adott vissza útvonalat erről a pontról. Próbáld újra, vagy indulj el egy közeli utcáról.';
    case 'no_loops':
      return 'Innen most nem jött ki bezárható kör — errefelé kevés az átkötő utca. Próbáld másik mozgásformával, vagy indulj el egy másik pontról.';
    case 'no_fit':
      return 'Találtunk köröket, de egyik sem fért bele ebbe az időkeretbe. Próbáld hosszabb idővel.';
    default:
      return 'Most nincs ajánlható küldetés.';
  }
}

function MissionCard({ mission, onStart }: { mission: Mission; onStart: () => void }) {
  const { theme } = useThemeContext();
  const [mapFailed, setMapFailed] = useState(false);
  const [saved, setSaved] = useState(() => isRouteSaved(mission));
  const meta = MISSION_KIND_META[mission.kind];
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
        <MissionStat label={missionAreaStat(mission).label} value={missionAreaStat(mission).value} />
        <MissionStat label="Becsült GP" value={formatNumber(mission.estimatedGp)} />
        <MissionStat label="Mező" value={formatNumber(mission.cellCount)} />
      </dl>

      <div className="mission__actions">
        <Button variant="secondary" onClick={onStart}>
          Indítás most
        </Button>
        <Button
          variant="ghost"
          disabled={saved}
          onClick={() => {
            saveRoute(mission);
            setSaved(true);
          }}
        >
          {saved ? 'Mentve' : 'Mentés'}
        </Button>
      </div>
    </section>
  );
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

function PencilIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="M14.5 7.5 16.5 9.5" />
    </svg>
  );
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

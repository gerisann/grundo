import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, SegmentedControl } from '@/components/ui';
import { ActivityCard } from '@/components/ActivityCard';
import { useActivities } from '@/hooks/useActivities';
import type { FeedActivity, FeedResult, FeedScope } from '@/lib/api';
import './feed.css';

/**
 * Aktivitás-feed, nézetekkel.
 *
 *   Mindenki → Globális — minden aktivitás, időrendben
 *   Mindenki → Helyi    — csak a közelben történtek, állítható sugárral
 *   Követed              — akiket követsz (még nincs követési gráf)
 *
 * A választás megmarad: aki a helyi nézetet szereti, annak minden megnyitáskor
 * átkattintani fölösleges lépés.
 */

const TAB_KEY = 'grundo.feed.tab';
const RADIUS_KEY = 'grundo.feed.radiusKm';
const DATE_KEY = 'grundo.feed.date';

type Tab = 'global' | 'following';
type GlobalView = 'world' | 'local';
type DatePreset = 'today' | 'week' | 'month' | 'always' | 'custom';

/** A választható sugarak. Nem szabad szöveges beviteli mező: futás után, egy
 *  kézzel senki nem akar számot gépelni. */
const RADII = [1, 5, 10, 25, 50] as const;

export function Feed() {
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>(() => read(TAB_KEY) === 'following' ? 'following' : 'global');
  const [view, setView] = useState<GlobalView>('world');
  const [radiusKm, setRadiusKm] = useState<number>(() => Number(read(RADIUS_KEY)) || 10);
  const [datePreset, setDatePreset] = useState<DatePreset>(() => readDatePreset());
  const [customFrom, setCustomFrom] = useState(() => localDateValue(new Date()));
  const [customTo, setCustomTo] = useState(() => localDateValue(new Date()));

  /**
   * A helyi nézethez a saját pozíció kell.
   *
   * Kis pontossággal, akár gyorsítótárból kérjük: nem mérünk vele, csak azt
   * döntjük el, mi számít „közelinek". Egy 10 km-es sugárnál a néhány száz
   * méteres tévedés nem számít, viszont a pontos fix megvárása másodpercekbe
   * kerülne, és külön engedélykérést villantana fel.
   */
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [positionDenied, setPositionDenied] = useState(false);

  useEffect(() => {
    if (tab !== 'global' || view !== 'local' || position !== null) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setPositionDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => setPosition({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setPositionDenied(true),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, [tab, view, position]);

  const scope: FeedScope =
    tab === 'following'
      ? 'following'
      : view === 'local'
        ? 'local'
        : 'world';
  const dateRange = feedDateRange(datePreset, customFrom, customTo);

  // A helyi nézet pozíció nélkül nem kérdezhető le — addig nem indítunk kérést.
  const awaitingPosition = scope === 'local' && position === null;
  const { result, loading, error, reload } = useActivities(
    awaitingPosition || dateRange === null
      ? null
      : {
          scope,
          ...dateRange,
          ...(scope === 'local' ? { ...position!, radiusKm } : {}),
        },
  );

  function chooseTab(next: Tab) {
    setTab(next);
    write(TAB_KEY, next);
  }

  function chooseRadius(next: number) {
    setRadiusKm(next);
    write(RADIUS_KEY, String(next));
  }

  function chooseDate(next: DatePreset) {
    setDatePreset(next);
    write(DATE_KEY, next);
  }

  return (
    <div className="feed">
      <SegmentedControl
        label="Feed nézet"
        block
        value={tab}
        onChange={chooseTab}
        options={[
          { value: 'global', label: 'Mindenki' },
          { value: 'following', label: 'Követed' },
        ]}
      />

      <div className="feed__filterbar">
        {tab === 'global' ? (
          <div className="feed__geo" role="group" aria-label="Területi szűrés">
            <button
              type="button"
              className={view === 'world' ? 'feed__geo-btn feed__geo-btn--on' : 'feed__geo-btn'}
              onClick={() => setView('world')}
            >
              Globális
            </button>
            <button
              type="button"
              className={view === 'local' ? 'feed__geo-btn feed__geo-btn--on' : 'feed__geo-btn'}
              onClick={() => setView('local')}
            >
              Helyi
            </button>
          </div>
        ) : (
          <span />
        )}

        <label className="feed__date-select">
          <span className="sr-only">Dátumszűrés</span>
          <select
            value={datePreset}
            onChange={(event) => chooseDate(event.target.value as DatePreset)}
          >
            <option value="today">MA</option>
            <option value="week">HÉT</option>
            <option value="month">HÓNAP</option>
            <option value="always">MINDIG</option>
            <option value="custom">EGYEDI</option>
          </select>
        </label>
      </div>

      {datePreset === 'custom' ? (
        <div className="feed__custom-dates">
          <label>
            <span>Ettől</span>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </label>
          <label>
            <span>Eddig</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </label>
        </div>
      ) : null}

      {tab === 'global' && view === 'local' ? (
        <div className="feed__radius">
          <span className="feed__radius-label">Ekkora körzetben:</span>
          <div className="feed__radius-options">
            {RADII.map((km) => (
              <button
                key={km}
                type="button"
                className={`feed__radius-chip${km === radiusKm ? ' feed__radius-chip--on' : ''}`}
                onClick={() => chooseRadius(km)}
              >
                {km} km
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {dateRange === null ? (
        <div className="card" role="alert">Az egyedi időszak kezdete nem lehet később a végénél.</div>
      ) : positionDenied && scope === 'local' ? (
        <div className="card">
          A helyi nézethez tudnunk kell, hol vagy. Engedélyezd a helyhozzáférést, vagy válts a
          Globális nézetre.
        </div>
      ) : awaitingPosition ? (
        <div className="card">Helymeghatározás…</div>
      ) : (
        <ActivityList
          scope={scope}
          result={result}
          loading={loading}
          error={error}
          radiusKm={radiusKm}
          onRetry={reload}
          onStart={() => navigate('/rogzites')}
        />
      )}
    </div>
  );
}

export interface ActivityListProps {
  scope: FeedScope;
  result: FeedResult | null;
  loading: boolean;
  error: string;
  radiusKm?: number;
  onRetry: () => void;
  onStart: () => void;
}

/**
 * A lista maga — a profil is ezt használja, saját lekérdezéssel.
 *
 * Külön exportált, mert a profil UGYANABBÓL a betöltésből építi a heti
 * oszlopdiagramot és az összegzőket is. Ha ott is a teljes `Feed` futna,
 * ugyanaz az adat kétszer jönne le.
 */
export function ActivityList({
  scope,
  result,
  loading,
  error,
  radiusKm = 10,
  onRetry,
  onStart,
}: ActivityListProps) {
  if (error) {
    return (
      <div className="card" role="alert">
        {error}
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <Button size="sm" onClick={onRetry}>
            Újrapróbálom
          </Button>
        </div>
      </div>
    );
  }

  if (result === null || loading) return <div className="card">Betöltés…</div>;

  /**
   * A követés nem „üres", hanem NINCS MÉG.
   *
   * A kettő között a felhasználó szempontjából óriási a különbség: az egyik
   * azt jelenti, hogy keressen embereket, a másik azt, hogy ne is próbálja.
   */
  if (result.unavailable === 'following') {
    return (
      <EmptyState
        title="A követés még nem elérhető"
        description="Hamarosan követhetsz másokat, és itt fognak megjelenni az ő aktivitásaik. Addig nézd a Globális feedet."
      />
    );
  }

  if (result.activities.length === 0) {
    return scope === 'mine' ? (
      <EmptyState
        title="Még nincs aktivitásod"
        description="Zárj be egy kört, és a közrezárt terület a tiéd lesz. Minden méter pontot ér — akkor is, ha nem zárul a kör."
        action={<Button onClick={onStart}>Kezdd az első aktivitásod</Button>}
      />
    ) : (
      <EmptyState
        title={scope === 'local' ? 'Nincs itt még senki' : 'Nincs mit mutatni'}
        description={
          scope === 'local'
            ? `${radiusKm} km-es körzetben senki nem rögzített még aktivitást. Próbálj nagyobb sugarat, vagy legyél te az első.`
            : 'Még senki nem rögzített aktivitást.'
        }
      />
    );
  }

  return (
    <>
      <div className="feed__list">
        {result.activities.map((item: FeedActivity) => (
          <ActivityCard key={item.id} item={item} showAuthor={scope !== 'mine'} />
        ))}
      </div>
      {result.truncated ? (
        <p className="feed__note">
          Sok az aktivitás — lehet, hogy nem mindegyik fér bele a listába.
        </p>
      ) : null}
    </>
  );
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* privát böngészés — a választás nem marad meg, de működik */
  }
}

function readDatePreset(): DatePreset {
  const value = read(DATE_KEY);
  return value === 'today' || value === 'week' || value === 'month' || value === 'custom'
    ? value
    : 'always';
}

function feedDateRange(
  preset: DatePreset,
  customFrom: string,
  customTo: string,
): { dateFrom?: number; dateTo?: number } | null {
  const now = new Date();
  const end = new Date(now);
  let start: Date | null = null;

  if (preset === 'today') {
    start = startOfDay(now);
  } else if (preset === 'week') {
    start = startOfDay(now);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  } else if (preset === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (preset === 'custom') {
    const from = dateInputToLocal(customFrom);
    const to = dateInputToLocal(customTo);
    if (!from || !to || from.getTime() > to.getTime()) return null;
    to.setHours(23, 59, 59, 999);
    return { dateFrom: from.getTime(), dateTo: to.getTime() };
  }

  return start ? { dateFrom: start.getTime(), dateTo: end.getTime() } : {};
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateInputToLocal(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

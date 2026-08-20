import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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

const DATE_OPTIONS: readonly { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'MA' },
  { value: 'week', label: 'HÉT' },
  { value: 'month', label: 'HÓNAP' },
  { value: 'always', label: 'MINDIG' },
  { value: 'custom', label: 'EGYEDI' },
];

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
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const dateSelectRef = useRef<HTMLDivElement | null>(null);
  const dateTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!dateMenuOpen) return;

    const closeFromOutside = (event: PointerEvent) => {
      if (!dateSelectRef.current?.contains(event.target as Node)) setDateMenuOpen(false);
    };
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDateMenuOpen(false);
      dateTriggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeFromOutside);
    window.addEventListener('keydown', closeFromKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      window.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [dateMenuOpen]);

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
  // A „most" időbélyeg egy renderen belül stabil marad. Korábban minden
  // render új `dateTo` értéket adott, ami új lekérést, majd újabb rendert
  // indított — ettől vibrált a feed minden nem-MINDIG szűrőnél.
  const dateRange = useMemo(
    () => feedDateRange(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  );

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
    setDateMenuOpen(false);
    dateTriggerRef.current?.focus();
  }

  function focusDateOption(direction: 1 | -1, event: KeyboardEvent<HTMLButtonElement>) {
    event.preventDefault();
    const options = Array.from(
      dateSelectRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    const current = options.indexOf(event.currentTarget);
    options[(current + direction + options.length) % options.length]?.focus();
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

        <div className="feed__date-select" ref={dateSelectRef}>
          <button
            ref={dateTriggerRef}
            type="button"
            className="feed__date-trigger"
            aria-label="Dátumszűrés"
            aria-haspopup="listbox"
            aria-expanded={dateMenuOpen}
            onClick={() => setDateMenuOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              setDateMenuOpen(true);
              window.requestAnimationFrame(() => {
                dateSelectRef.current
                  ?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
                  ?.focus();
              });
            }}
          >
            <span>{DATE_OPTIONS.find((option) => option.value === datePreset)?.label}</span>
            <ChevronIcon open={dateMenuOpen} />
          </button>

          {dateMenuOpen ? (
            <div className="feed__date-menu" role="listbox" aria-label="Időszak">
              {DATE_OPTIONS.map((option) => {
                const selected = option.value === datePreset;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`feed__date-option${selected ? ' feed__date-option--on' : ''}`}
                    onClick={() => chooseDate(option.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') focusDateOption(1, event);
                      else if (event.key === 'ArrowUp') focusDateOption(-1, event);
                    }}
                  >
                    <span>{option.label}</span>
                    {selected ? <CheckIcon /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`feed__date-chevron${open ? ' feed__date-chevron--open' : ''}`}
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
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

export interface ActivityListProps {
  scope: FeedScope;
  result: FeedResult | null;
  loading: boolean;
  error: string;
  radiusKm?: number;
  onRetry: () => void;
  /** Csak a `mine` nézet üres állapotában van rá szükség. */
  onStart?: () => void;
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

  if (result.activities.length === 0) {
    if (scope === 'mine') {
      return (
        <EmptyState
          title="Még nincs aktivitásod"
          description="Zárj be egy kört, és a közrezárt terület a tiéd lesz. Minden méter pontot ér — akkor is, ha nem zárul a kör."
          action={<Button onClick={onStart}>Kezdd az első aktivitásod</Button>}
        />
      );
    }
    /**
     * A követett feed üressége KÉT dolgot jelenthet: nem követsz még senkit,
     * vagy akiket követsz, azok nem mozogtak. A szerver ezt nem különbözteti
     * meg, ezért a szöveg mindkettőre értelmes marad — de a globális feedre
     * mutat, ahol embereket lehet találni.
     */
    if (scope === 'following') {
      return (
        <EmptyState
          title="Üres a követett feed"
          description="Vagy még nem követsz senkit, vagy akiket követsz, épp nem mozogtak. A Globális feeden találsz embereket — koppints valakinek a nevére, és onnan követheted."
        />
      );
    }
    /**
     * Idegen profilon a globális feed szövege („Még senki nem rögzített
     * aktivitást") hazugság: nem mindenkiről van szó, hanem EGY emberről.
     */
    if (scope === 'user') {
      return (
        <EmptyState
          title="Még nincs látható aktivitás"
          description="Ez a felhasználó vagy még nem rögzített aktivitást, vagy nem osztja meg őket nyilvánosan."
        />
      );
    }
    return (
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

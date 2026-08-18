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
 *   Globális → Világ   — minden aktivitás, időrendben
 *   Globális → Helyi   — csak a közelben történtek, állítható sugárral
 *   Követés            — akiket követsz (még nincs követési gráf)
 *   Saját              — a te aktivitásaid
 *
 * A választás megmarad: aki a helyi nézetet szereti, annak minden megnyitáskor
 * átkattintani fölösleges lépés.
 */

const TAB_KEY = 'grundo.feed.tab';
const RADIUS_KEY = 'grundo.feed.radiusKm';

type Tab = 'global' | 'following' | 'mine';
type GlobalView = 'world' | 'local';

/** A választható sugarak. Nem szabad szöveges beviteli mező: futás után, egy
 *  kézzel senki nem akar számot gépelni. */
const RADII = [1, 5, 10, 25, 50] as const;

export function Feed() {
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>(() => (read(TAB_KEY) as Tab) ?? 'mine');
  const [view, setView] = useState<GlobalView>('world');
  const [radiusKm, setRadiusKm] = useState<number>(() => Number(read(RADIUS_KEY)) || 10);

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
    tab === 'mine'
      ? 'mine'
      : tab === 'following'
        ? 'following'
        : view === 'local'
          ? 'local'
          : 'world';

  // A helyi nézet pozíció nélkül nem kérdezhető le — addig nem indítunk kérést.
  const awaitingPosition = scope === 'local' && position === null;
  const { result, loading, error, reload } = useActivities(
    awaitingPosition ? null : { scope, ...(scope === 'local' ? { ...position!, radiusKm } : {}) },
  );

  function chooseTab(next: Tab) {
    setTab(next);
    write(TAB_KEY, next);
  }

  function chooseRadius(next: number) {
    setRadiusKm(next);
    write(RADIUS_KEY, String(next));
  }

  return (
    <div className="feed">
      <SegmentedControl
        label="Feed nézet"
        block
        value={tab}
        onChange={chooseTab}
        options={[
          { value: 'global', label: 'Globális' },
          { value: 'following', label: 'Követés' },
          { value: 'mine', label: 'Saját' },
        ]}
      />

      {tab === 'global' ? (
        <SegmentedControl
          label="Globális nézet"
          block
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'world', label: 'Világ' },
            { value: 'local', label: 'Helyi' },
          ]}
        />
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

      {positionDenied && scope === 'local' ? (
        <div className="card">
          A helyi nézethez tudnunk kell, hol vagy. Engedélyezd a helyhozzáférést, vagy válts a
          Világ nézetre.
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

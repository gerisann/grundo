import { ActivityPagination } from '@/components/Feed';
import { DiscoverBandas, SearchPublicBandas } from './CommunityBandasScreen';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CommunityHeader } from '@/components/CommunityHeader';
import { Avatar, ActivityCard } from '@/components/ActivityCard';
import { RivalBadge } from '@/components/RivalBadge';
import { Button, EmptyState, OptionSwitch } from '@/components/ui';
import { useActivities } from '@/hooks/useActivities';
import { useProfile } from '@/hooks/ProfileProvider';
import { api, ApiError, type DiscoverUser, type FeedActivity, type FollowStatus } from '@/lib/api';
import '@/screens/search.css';
import '@/components/feed.css';
import './discover.css';

const DEBOUNCE_MS = 300;

/** Hány további lapot kérjen be magától a Felfedezés, ha üresre szűrődött. */
const DISCOVER_AUTO_PAGE_BUDGET = 4;
type SearchKind = 'people' | 'bandas';
type FeedView = 'world' | 'local';

/**
 * Felfedezés (docs/02 → Közösség → Felfedezés).
 *
 * Két rész van egy képernyőn:
 *   1. Kereső — emberek szerint (a banda-szűrő a Bandák fülig üres, ld. lent),
 *      inline Követés gombbal.
 *   2. Aktivitás-feed NEM követett felhasználóktól — a meglévő világ/helyi
 *      lekérdezésre épül, a már követett szerzők kliensoldalon szűrve ki.
 *      A szerver nem ismer ilyen szűrést, ezért ez csak annyira pontos,
 *      amennyire a betöltött követési lista (max 100 elem) lefedi — ha valaki
 *      100-nál többet követ, a lista vége felé tévesen bent maradhat egy már
 *      követett szerző. Ritka eset, és a lista így is szűkíti a feedet.
 */
export function DiscoverScreen() {
  /*
    A választó az EGÉSZ FÜLET kapcsolja, nem csak a keresőmezőt: bandákra
    váltva a lenti lista is bandákat mutat. Korábban a kereső bandás
    állásában csak egy „a Bandák fülön elérhető" mondat állt, alatta viszont
    továbbra is emberek aktivitásai futottak — a választónak így nem volt
    értelme.
  */
  const [kind, setKind] = useState<SearchKind>('people');

  return (
    <>
      <CommunityHeader active="discover" />
      <div className="screen-body stack">
        <DiscoverSearch kind={kind} onKindChange={setKind} />
        {kind === 'bandas' ? <DiscoverBandas /> : <DiscoverFeed />}
      </div>
    </>
  );
}

function DiscoverSearch({
  kind,
  onKindChange,
}: {
  kind: SearchKind;
  onKindChange: (kind: SearchKind) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<DiscoverUser[] | null>(null);
  const [error, setError] = useState('');
  const [busyUid, setBusyUid] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== 'people') return;
    const trimmed = query.trim();
    if (!trimmed) {
      setItems(null);
      setError('');
      return;
    }

    let alive = true;
    const timer = window.setTimeout(() => {
      api
        .discoverSearch(trimmed)
        .then((result) => {
          if (alive) setItems(result.items);
        })
        .catch((problem: unknown) => {
          if (!alive) return;
          setItems([]);
          setError(problem instanceof ApiError ? problem.message : 'A keresés most nem működik.');
        });
    }, DEBOUNCE_MS);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, kind]);

  async function toggleFollow(user: DiscoverUser) {
    if (busyUid) return;
    setBusyUid(user.uid);
    try {
      const isFollowingOrRequested = user.followStatus === 'following' || user.followStatus === 'requested';
      const { status } = isFollowingOrRequested
        ? await api.unfollow(user.username)
        : await api.follow(user.username);
      setItems((prev) =>
        prev?.map((item) => (item.uid === user.uid ? { ...item, followStatus: status } : item)) ?? prev,
      );
    } catch {
      // A gomb visszaáll az előző állapotra — nem írtunk felül semmit, mert
      // optimista frissítés helyett a válaszból állítjuk be az új állapotot.
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <section className="card discover-search">
      <OptionSwitch
        label="Keresés típusa"
        options={[
          { value: 'people', label: 'Emberek' },
          { value: 'bandas', label: 'Bandák' },
        ]}
        value={kind}
        onChange={onKindChange}
      />

      {kind === 'bandas' ? (
        <SearchPublicBandas />
      ) : (
        <>
          <div className="search__field" style={{ marginTop: 'var(--sp-3)' }}>
            <SearchFieldIcon />
            <input
              type="search"
              inputMode="search"
              className="search__input"
              placeholder="Felhasználónév"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Felhasználónév keresése"
            />
            {query ? (
              <button
                type="button"
                className="search__clear"
                aria-label="Keresés törlése"
                onClick={() => setQuery('')}
              >
                ×
              </button>
            ) : null}
          </div>

          {!query.trim() ? (
            <p className="search__note">Kezdj el gépelni egy felhasználónevet, vagy nézd meg lent, ki mozgott mostanában.</p>
          ) : items === null ? (
            <p className="search__note">Keresés…</p>
          ) : error && items.length === 0 ? (
            <p className="search__note" role="alert">
              {error}
            </p>
          ) : items.length === 0 ? (
            <p className="search__note">Nincs ilyen nevű felhasználó.</p>
          ) : (
            <div className="search__list" style={{ marginTop: 'var(--sp-2)' }}>
              {items.map((user) => (
                <div className="search__row discover-search__row" key={user.uid}>
                  <button
                    type="button"
                    className="discover-search__identity"
                    onClick={() => navigate(`/felhasznalo/${encodeURIComponent(user.username)}`)}
                    aria-label={`${user.username} profiljának megnyitása`}
                  >
                    <Avatar url={user.photoURL} name={user.username} size={40} />
                    <span className="search__identity">
                      <span className="search__name">{user.username}</span>
                      <RivalBadge uid={user.uid} />
                    </span>
                  </button>
                  <FollowButton
                    status={user.followStatus}
                    account={user.account}
                    busy={busyUid === user.uid}
                    onClick={() => toggleFollow(user)}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function FollowButton({
  status,
  account,
  busy,
  onClick,
}: {
  status: FollowStatus;
  account: 'public' | 'private';
  busy: boolean;
  onClick: () => void;
}) {
  if (status === 'following') {
    return (
      <Button variant="secondary" size="sm" loading={busy} onClick={onClick}>
        Követve
      </Button>
    );
  }
  if (status === 'requested') {
    return (
      <Button variant="secondary" size="sm" loading={busy} onClick={onClick}>
        Kérés elküldve
      </Button>
    );
  }
  return (
    <Button size="sm" loading={busy} onClick={onClick}>
      {account === 'private' ? 'Kérés küldése' : 'Követés'}
    </Button>
  );
}

function DiscoverFeed() {
  const { profile } = useProfile();
  const [view, setView] = useState<FeedView>('world');
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [positionDenied, setPositionDenied] = useState(false);
  const [followingIds, setFollowingIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (view !== 'local' || position !== null) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setPositionDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => setPosition({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setPositionDenied(true),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, [view, position]);

  useEffect(() => {
    const username = profile?.username;
    if (!username) return;
    let alive = true;
    api
      .connections(username, 'following')
      .then((result) => {
        if (alive) setFollowingIds(new Set(result.items.map((item) => item.uid)));
      })
      .catch(() => {
        if (alive) setFollowingIds(new Set());
      });
    return () => {
      alive = false;
    };
  }, [profile?.username]);

  const awaitingPosition = view === 'local' && position === null;
  const { result, loading, error, reload, hasMore, loadingMore, loadMore } = useActivities(
    awaitingPosition
      ? null
      : {
          scope: view,
          ...(view === 'local' ? { ...position!, radiusKm: 10 } : {}),
        },
  );

  const discovered = useMemo<FeedActivity[] | null>(() => {
    if (!result || !followingIds) return null;
    const myUid = profile?.uid;
    return result.activities.filter(
      (item) => item.author.uid !== myUid && !followingIds.has(item.author.uid),
    );
  }, [result, followingIds, profile?.uid]);

  /*
    ⚠️ ÜRESRE SZŰRT LAP — AUTOMATIKUS UTÁNTÖLTÉS.

    A Felfedezés a saját és a KÖVETETT felhasználók sorait kliensoldalon
    dobja el, a szerver viszont tízesével lapoz. Ha az első tíz aktivitás
    mind ilyen, a lista üresen maradt, holott van még mit mutatni — a
    felhasználónak úgy nézett ki, mintha „nincs itt senki új".

    Ezért amíg nincs egyetlen találat sem, magunktól kérjük a következő
    lapot. A `PAGE_BUDGET` a fék: sok követett mellett sem indul végtelen
    láncbetöltés, a maradékot a „Továbbiak betöltése" gomb hozza.
  */
  const autoPages = useRef(0);
  useEffect(() => {
    autoPages.current = 0;
  }, [view]);
  useEffect(() => {
    if (!discovered || discovered.length > 0) return;
    if (!hasMore || loadingMore || autoPages.current >= DISCOVER_AUTO_PAGE_BUDGET) return;
    autoPages.current += 1;
    loadMore();
  }, [discovered, hasMore, loadingMore, loadMore]);

  return (
    <section className="stack">
      <h2 className="discover-feed__title">Ki mozog most?</h2>
      <OptionSwitch
        label="Feed nézete"
        options={[
          { value: 'world', label: 'Népszerű' },
          { value: 'local', label: 'Helyi' },
        ]}
        value={view}
        onChange={(next) => {
          setView(next);
          if (next === 'local') setPosition(null);
        }}
      />

      {view === 'local' && positionDenied ? (
        <EmptyState
          title="Nincs helyadat"
          description="A helyi nézethez engedélyezd a helymeghatározást a böngészőben, vagy válaszd a Népszerű nézetet."
        />
      ) : error && result === null ? (
        <div className="card" role="alert">
          {error}
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <Button size="sm" onClick={reload}>
              Újrapróbálom
            </Button>
          </div>
        </div>
      ) : discovered === null || loading || awaitingPosition ? (
        <div className="card">Betöltés…</div>
      ) : discovered.length === 0 ? (
        <EmptyState
          title="Nincs itt még senki új"
          description="Vagy mindenkit követsz már, aki erre mozgott, vagy egyszerűen csend van. Próbáld a másik nézetet."
        />
      ) : (
        <div className="feed__list">
          {discovered.map((item) => (
            <ActivityCard key={item.id} item={item} showAuthor />
          ))}
        </div>
      )}
      {error && result !== null ? <p role="alert">{error}</p> : null}
      <ActivityPagination hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
    </section>
  );
}

function SearchFieldIcon() {
  return (
    <svg
      className="search__field-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8 20.5 20.5" />
    </svg>
  );
}

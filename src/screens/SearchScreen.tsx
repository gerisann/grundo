import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RivalBadge } from '@/components/RivalBadge';
import { Avatar } from '@/components/ActivityCard';
import { ScreenHeader } from '@/components/ui';
import { api, ApiError, type Connection } from '@/lib/api';
import './search.css';

/** Ennyit várunk gépelés után, mielőtt kérünk — enélkül minden billentyű egy hívás lenne. */
const DEBOUNCE_MS = 300;

/**
 * Felhasználónév-keresés — a Home fejléc nagyítóikonja.
 *
 * Prefix-illeszkedés (`GET /api/users/search`), tehát a „ger" a „Gerivagyok"-
 * ot is megtalálja, de a „ivagyok"-ot nem — ugyanaz a korlát, mint a
 * felhasználónév-feloldásnál mindenütt a kódban.
 */
export function SearchScreen() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Connection[] | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setItems(null);
      setError('');
      return;
    }

    let alive = true;
    const timer = window.setTimeout(() => {
      api
        .searchUsers(trimmed)
        .then((result) => {
          if (alive) setItems(result.items);
        })
        .catch((problem: unknown) => {
          if (!alive) return;
          setItems([]);
          setError(
            problem instanceof ApiError ? problem.message : 'A keresés most nem működik.',
          );
        });
    }, DEBOUNCE_MS);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <>
      <ScreenHeader title="Keresés" backTo="/" />

      <div className="screen-body stack">
        <div className="search__field">
          <SearchFieldIcon />
          <input
            ref={inputRef}
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
          <p className="search__note">Kezdj el gépelni egy felhasználónevet.</p>
        ) : items === null ? (
          <p className="search__note">Keresés…</p>
        ) : error && items.length === 0 ? (
          <p className="search__note" role="alert">
            {error}
          </p>
        ) : items.length === 0 ? (
          <p className="search__note">Nincs ilyen nevű felhasználó.</p>
        ) : (
          <div className="search__list">
            {items.map((user) => (
              <button
                type="button"
                key={user.uid}
                className="search__row"
                onClick={() => navigate(`/felhasznalo/${encodeURIComponent(user.username)}`)}
                aria-label={`${user.username} profiljának megnyitása`}
              >
                <Avatar url={user.photoURL} name={user.username} size={40} />
                <span className="search__name">{user.username}</span>
                <RivalBadge uid={user.uid} />
              </button>
            ))}
          </div>
        )}
      </div>
    </>
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

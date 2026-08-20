import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ActivityCard';
import { api, ApiError, type Connection } from '@/lib/api';
import './connectionsSheet.css';

/**
 * Követők / követettek listája — teljes képernyős lap.
 *
 * A profil számlálójáról nyílik („12 követő" → kik azok?), és egyetlen dolgot
 * csinál: kép, név, és koppintásra a nyilvános profil. Ugyanaz a szerkezet,
 * mint az értesítés-lapnál — így a két teljes képernyős lista egyformán
 * viselkedik (fejléc balra, bezárás a jobb sarokban, Escape zár).
 *
 * ⚠️ A Z-INDEX SZÁNDÉKOSAN 60. A Dock 40-en ül, a feed lebegő eleme 30-on;
 * egy 50-es lap alatt kilátszana a dokk, és a lista mögül elérhető maradna a
 * navigáció. A 60 a lapok szintje az egész alkalmazásban (értesítések,
 * hozzászólások, bejelentés) — ez a lista is oda tartozik.
 */
export function ConnectionsSheet({
  username,
  kind,
  onClose,
}: {
  /** Kinek a listája — a saját profilnál a saját felhasználónév. */
  username: string;
  kind: 'followers' | 'following';
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<Connection[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setItems(null);
    setError('');
    api
      .connections(username, kind)
      .then((result) => {
        if (!alive) return;
        setItems(result.items);
        setHasMore(result.hasMore);
      })
      .catch((problem: unknown) => {
        if (!alive) return;
        setItems([]);
        setError(
          problem instanceof ApiError
            ? problem.message
            : 'A lista most nem tölthető be. Próbáld később.',
        );
      });
    return () => {
      alive = false;
    };
  }, [username, kind]);

  const title = kind === 'followers' ? 'Követők' : 'Követettek';

  return (
    <div className="conn" role="dialog" aria-modal="true" aria-label={title}>
      <header className="conn__head">
        <h2 className="conn__title">{title}</h2>
        <button type="button" className="conn__close" aria-label="Bezárás" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <div className="conn__list">
        {items === null ? (
          <p className="conn__note">Betöltés…</p>
        ) : error ? (
          <p className="conn__note" role="alert">
            {error}
          </p>
        ) : items.length === 0 ? (
          <p className="conn__note">
            {kind === 'followers' ? 'Még nincs követőd.' : 'Még nem követsz senkit.'}
          </p>
        ) : (
          <>
            {items.map((item) => (
              <button
                key={item.uid}
                type="button"
                className="conn__row"
                onClick={() => {
                  // A lap bezárul, mielőtt navigálnánk: visszalépésnél ne egy
                  // nyitva felejtett lista fogadja a felhasználót.
                  onClose();
                  navigate(`/felhasznalo/${encodeURIComponent(item.username)}`);
                }}
              >
                <Avatar url={item.photoURL} name={item.username} size={40} />
                <span className="conn__name">{item.username}</span>
                <ChevronIcon />
              </button>
            ))}

            {hasMore ? (
              <p className="conn__note">
                A legutóbbi {items.length} látszik. A teljes lista lapozása még nincs kész.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="conn__chevron"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

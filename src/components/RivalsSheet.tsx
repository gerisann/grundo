import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ActivityCard';
import { RivalScore } from '@/components/RivalScore';
import { api, ApiError, type Rival } from '@/lib/api';
import './connectionsSheet.css';
import './rivalsSheet.css';

/**
 * A teljes rivális-lista — teljes képernyős lap, kereshetően.
 *
 * A `ConnectionsSheet` szerkezetét és stílusát használja (`conn__*`), mert a
 * kettő ugyanaz a dolog: egy névsor, ahonnan a nyilvános profilra lehet
 * lépni. Csak két többlete van — a kereső és a soronkénti mérleg —, ezek
 * kapnak saját osztályt.
 *
 * ⚠️ A KERESÉS A BETÖLTÖTT LISTÁN FUT, nem a szerveren. A rivális-lista a
 * kicserélt mezők szerint rendezve érkezik, egy kérésben; a szűrés így
 * azonnali, gépelés közben, hálózat nélkül. Ha valakinek a szerver
 * felső határánál is több riválisa van, azt a `hasMore` megmondja — akkor a
 * lista VÉGÉRŐL hiányoznak emberek, vagyis a legkevesebbet cserélt
 * ellenfelek. A keresés tehát pontosan azokat találja meg, akik számítanak.
 */
export function RivalsSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<Rival[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    api
      .rivals()
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
            : 'A rivális-lista most nem tölthető be. Próbáld később.',
        );
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!items) return null;
    const needle = query.trim().toLocaleLowerCase('hu-HU');
    if (!needle) return items;
    // Nem csak prefix: a rivális nevének BÁRMELY részére lehessen keresni —
    // a felhasználó gyakran csak egy darabkára emlékszik a névből.
    return items.filter((item) => item.username.toLocaleLowerCase('hu-HU').includes(needle));
  }, [items, query]);

  return (
    <div className="conn" role="dialog" aria-modal="true" aria-label="Riválisok">
      <header className="conn__head">
        <h2 className="conn__title">Riválisok</h2>
        <button type="button" className="conn__close" aria-label="Bezárás" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      {items && items.length > 0 ? (
        <div className="rivals__search">
          <input
            type="search"
            className="rivals__search-input"
            placeholder="Keresés név szerint"
            aria-label="Keresés a riválisok között"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : null}

      <div className="conn__list">
        {items === null ? (
          <p className="conn__note">Betöltés…</p>
        ) : error ? (
          <p className="conn__note" role="alert">
            {error}
          </p>
        ) : items.length === 0 ? (
          <p className="conn__note">
            Még nincs riválisod. Akkor lesz, ha területet veszel el valakitől — vagy ő tőled.
          </p>
        ) : filtered && filtered.length === 0 ? (
          <p className="conn__note">Nincs ilyen nevű riválisod.</p>
        ) : (
          <>
            {(filtered ?? []).map((rival) => (
              <button
                key={rival.uid}
                type="button"
                className="conn__row"
                onClick={() => {
                  onClose();
                  navigate(`/felhasznalo/${encodeURIComponent(rival.username)}`);
                }}
              >
                <Avatar url={rival.photoURL} name={rival.username} size={40} />
                <span className="conn__name">{rival.username}</span>
                <RivalScore rival={rival} />
              </button>
            ))}

            {hasMore && !query ? (
              <p className="conn__note">
                A legtöbbet cserélt {items.length} rivális látszik. Akikkel ennél kevesebb mező
                cserélt gazdát, azok most kimaradnak.
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

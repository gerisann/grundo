import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ActivityCard';
import { Button, ScreenHeader } from '@/components/ui';
import { api, ApiError, type Connection } from '@/lib/api';
import './blockedUsers.css';

/**
 * Tiltott felhasználók — a tiltás egyetlen visszaútja.
 *
 * MIÉRT KELL EZ A KÉPERNYŐ? A letiltott felhasználó eltűnik mindenhonnan
 * (feed, keresés, profil), tehát nincs mód rá, hogy a felhasználó egy
 * felületen ÚJRA rátaláljon, és onnan oldja fel — a tiltás egyirányú
 * zsákutca lenne. Ez a lista az egyetlen hely, ahonnan a `blocks`
 * alkollekció egyáltalán elérhető.
 */
export function BlockedUsersScreen() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Connection[] | null>(null);
  const [error, setError] = useState('');
  /** Melyik sor felold-gombja fut éppen — egyszerre csak egy. */
  const [busyUid, setBusyUid] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .blockedUsers()
      .then((result) => {
        if (alive) setItems(result.items);
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
  }, []);

  async function unblock(user: Connection) {
    setBusyUid(user.uid);
    try {
      await api.unblockUser(user.username);
      // Optimista törlés a listából — a szerver már megerősítette a hívást.
      setItems((current) => current?.filter((item) => item.uid !== user.uid) ?? current);
    } catch {
      setError('A feloldás nem sikerült. Próbáld újra.');
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <>
      <ScreenHeader title="Tiltott felhasználók" backTo="/beallitasok" />

      <div className="screen-body stack">
        {items === null ? (
          <p className="blocked__note">Betöltés…</p>
        ) : error && items.length === 0 ? (
          <p className="blocked__note" role="alert">
            {error}
          </p>
        ) : items.length === 0 ? (
          <p className="blocked__note">Nincs letiltott felhasználód.</p>
        ) : (
          <div className="blocked__list">
            {items.map((user) => (
              <div key={user.uid} className="blocked__row">
                <button
                  type="button"
                  className="blocked__identity"
                  onClick={() => navigate(`/felhasznalo/${encodeURIComponent(user.username)}`)}
                  aria-label={`${user.username} profiljának megnyitása`}
                >
                  <Avatar url={user.photoURL} name={user.username} size={40} />
                  <span className="blocked__name">{user.username}</span>
                </button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busyUid === user.uid}
                  onClick={() => void unblock(user)}
                >
                  Feloldás
                </Button>
              </div>
            ))}
          </div>
        )}

        {error && items && items.length > 0 ? (
          <p className="blocked__note" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/ActivityCard';
import { Button } from '@/components/ui';
import { useProfile } from '@/hooks/ProfileProvider';
import { api, ApiError, type Connection } from '@/lib/api';
import './connectionsSheet.css';
import './rivalsSheet.css';

type InviteState = 'idle' | 'inviting' | 'invited' | 'error';

/**
 * Appon belüli meghívás a követett-felhasználó listából (GRUNDO #30).
 *
 * A `ConnectionsSheet`/`RivalsSheet` szerkezetét használja (`conn__*`), de a
 * sor koppintásra NEM navigál — a jobb szélén egy „Meghívás" gomb van,
 * soronként külön állapottal, hogy egy sikertelen meghívás ne zárja be az
 * egész lapot és ne törölje a többi sor eredményét.
 *
 * ⚠️ A KÖVETETT-LISTA A SAJÁT `following`-om, nem a banda tagsága —
 * ugyanaz a végpont, mint a profil „Követettek" számlálója mögött
 * (`api.connections`). A már tag felhasználók a `memberIds` alapján
 * szűrődnek ki, hogy ne lehessen újra meghívni őket.
 */
export function BandaInviteSheet({
  bandaId,
  memberIds,
  onClose,
  onInvited,
}: {
  bandaId: string;
  memberIds: ReadonlySet<string>;
  onClose: () => void;
  /** Egy sikeres meghívás után — a hívó fél frissítheti a saját állapotát. */
  onInvited?: (uid: string) => void;
}) {
  const { profile } = useProfile();
  const [items, setItems] = useState<Connection[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [states, setStates] = useState<Record<string, InviteState>>({});

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!profile?.username) return;
    let alive = true;
    api
      .connections(profile.username, 'following')
      .then((result) => {
        if (alive) setItems(result.items);
      })
      .catch((problem: unknown) => {
        if (!alive) return;
        setItems([]);
        setError(
          problem instanceof ApiError
            ? problem.message
            : 'A követett-lista most nem tölthető be. Próbáld később.',
        );
      });
    return () => {
      alive = false;
    };
  }, [profile?.username]);

  const invitable = useMemo(() => (items ?? []).filter((item) => !memberIds.has(item.uid)), [items, memberIds]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('hu-HU');
    if (!needle) return invitable;
    return invitable.filter((item) => item.username.toLocaleLowerCase('hu-HU').includes(needle));
  }, [invitable, query]);

  async function invite(uid: string) {
    setStates((prev) => ({ ...prev, [uid]: 'inviting' }));
    try {
      await api.bandas.invite(bandaId, uid);
      setStates((prev) => ({ ...prev, [uid]: 'invited' }));
      onInvited?.(uid);
    } catch {
      setStates((prev) => ({ ...prev, [uid]: 'error' }));
    }
  }

  return (
    <div className="conn" role="dialog" aria-modal="true" aria-label="Meghívás a bandába">
      <header className="conn__head">
        <h2 className="conn__title">Meghívás</h2>
        <button type="button" className="conn__close" aria-label="Bezárás" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      {invitable.length > 0 ? (
        <div className="rivals__search">
          <input
            type="search"
            className="rivals__search-input"
            placeholder="Keresés a követettek között"
            aria-label="Keresés a követettek között"
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
        ) : invitable.length === 0 ? (
          <p className="conn__note">
            Mindenki, akit követsz, már tagja ennek a bandának — vagy még nem követsz senkit.
          </p>
        ) : filtered.length === 0 ? (
          <p className="conn__note">Nincs ilyen nevű követett.</p>
        ) : (
          filtered.map((item) => {
            const state = states[item.uid] ?? 'idle';
            return (
              <div className="conn__row" key={item.uid}>
                <span className="conn__identity">
                  <Avatar url={item.photoURL} name={item.username} size={40} />
                  <span className="conn__name">{item.username}</span>
                </span>
                <Button
                  size="sm"
                  variant={state === 'invited' ? 'secondary' : 'primary'}
                  loading={state === 'inviting'}
                  disabled={state === 'invited'}
                  onClick={() => invite(item.uid)}
                >
                  {state === 'invited' ? 'Meghívva' : state === 'error' ? 'Próbáld újra' : 'Meghívás'}
                </Button>
              </div>
            );
          })
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

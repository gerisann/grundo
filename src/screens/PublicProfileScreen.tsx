import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RivalBadge } from '@/components/RivalBadge';
import { Avatar } from '@/components/ActivityCard';
import { ActivityList } from '@/components/Feed';
import { BadgeList } from '@/components/BadgeList';
import { Button, Chip, EmptyState } from '@/components/ui';
import { ReportUserSheet } from '@/components/ReportUserSheet';
import { useActivities } from '@/hooks/useActivities';
import { useProfile } from '@/hooks/ProfileProvider';
import { levelProgress } from '@/game/levels';
import { api, ApiError, apiConfigured, type PublicProfileResult } from '@/lib/api';
import { formatArea, formatDistance, formatGp } from '@/lib/format';
import './publicProfile.css';

/**
 * Más felhasználó profilja — `/felhasznalo/:username`.
 *
 * A saját profil (`/profil`) SZÁNDÉKOSAN külön képernyő. Ott a szerkesztés, a
 * heti diagram és a beállítások a lényeg; itt az, hogy ki ez az ember,
 * követem-e, és mit csinált. A kettő összevonása mindkettőt rontaná.
 *
 * A saját nevünkre navigálva átirányítunk a `/profil`-ra — a Feedből a saját
 * kártyánkra koppintva ez a leggyakoribb út.
 *
 * TODO(F3): jelvények, riválisok — mindkettőnek van helye a specben
 * (`users/{uid}/badges`, illetve a riválisokhoz még adatmodell-döntés kell).
 */

/** Ennyi aktivitást kérünk le a profilhoz. */
const HISTORY_LIMIT = 20;

export function PublicProfileScreen() {
  const navigate = useNavigate();
  const { username = '' } = useParams();
  const { profile: me } = useProfile();

  const [state, setState] = useState<PublicProfileResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    if (!username) return;
    /**
     * Backend nélkül NEM hagyjuk örök „Betöltés…" állapotban a képernyőt.
     *
     * Ez a helyi fejlesztés valós állapota (`VITE_API_BASE_URL` nélkül), és
     * egy soha véget nem érő pörgő rosszabb, mint egy őszinte mondat.
     */
    if (!apiConfigured) {
      setState(null);
      setError('A háttérszolgáltatás nincs beállítva, így a profil nem tölthető be.');
      return;
    }
    setError('');
    api
      .publicProfile(username)
      .then(setState)
      .catch((err: unknown) => {
        setState(null);
        setError(
          err instanceof ApiError && err.code === 'user_not_found'
            ? 'Nincs ilyen felhasználó.'
            : err instanceof Error
              ? err.message
              : 'Nem sikerült betölteni a profilt.',
        );
      });
  }, [username]);

  useEffect(load, [load]);

  /**
   * A saját nevünkre a SAJÁT profil jár.
   *
   * A `replace` azért kell, hogy a Vissza gomb ne ide dobjon vissza, ahonnan
   * azonnal újra továbbmennénk — abból végtelen oda-vissza lenne.
   */
  useEffect(() => {
    if (me && username && me.usernameLower === username.toLowerCase()) {
      navigate('/profil', { replace: true });
    }
  }, [me, username, navigate]);

  const relationship = state?.relationship ?? null;
  const restricted = state?.restricted ?? true;
  const targetUid = state?.profile.uid ?? '';

  /**
   * Az aktivitáslistát csak akkor kérjük le, ha látható is a profil. A `null`
   * a hook megállapodása arra, hogy ne induljon kérés — privát fióknál és
   * tiltásnál nincs is mit lekérni.
   */
  const feed = useActivities(
    !restricted && targetUid ? { scope: 'user', userId: targetUid, limit: HISTORY_LIMIT } : null,
  );

  async function act(action: () => Promise<unknown>, message = '') {
    setBusy(true);
    setNotice('');
    try {
      await action();
      setNotice(message);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'A művelet nem sikerült.');
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  }

  return (
    <>
      <header className="screen-header pprof__header">
        <button
          type="button"
          className="screen-header__back"
          aria-label="Vissza"
          onClick={() => navigate(-1)}
        >
          <BackIcon />
        </button>
        <h1 className="screen-header__title">{state?.profile.username ?? 'Profil'}</h1>
        {state && !relationship?.self ? (
          <button
            type="button"
            className="screen-header__back"
            aria-label="További lehetőségek"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <DotsIcon />
          </button>
        ) : null}
      </header>

      <div className="screen-body stack">
        {error ? (
          <div className="card" role="alert">
            {error}
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <Button size="sm" onClick={load}>
                Újrapróbálom
              </Button>
            </div>
          </div>
        ) : null}

        {notice ? (
          <p className="pprof__notice" role="status">
            {notice}
          </p>
        ) : null}

        {state === null && !error ? <div className="card">Betöltés…</div> : null}

        {state ? (
          <>
            <div className="pprof__identity">
              <Avatar url={state.profile.photoURL} name={state.profile.username} size={88} />
              <span className="pprof__name">{state.profile.username}</span>
              <RivalBadge uid={state.profile.uid} />
              <span className="pprof__handle">@{state.profile.usernameLower}</span>
              <span className="pprof__since">{memberSince(state.profile.memberSince)}</span>
              {state.profile.pro.active ? <Chip variant="accent">PRO</Chip> : null}
            </div>

            {relationship && !relationship.self ? (
              <FollowButton
                relationship={relationship}
                busy={busy}
                account={state.profile.account}
                onFollow={() =>
                  act(
                    () => api.follow(username),
                    state.profile.account === 'private' ? 'Elküldtük a követési kérést.' : '',
                  )
                }
                onUnfollow={() => act(() => api.unfollow(username))}
                onUnblock={() => act(() => api.unblockUser(username), 'A tiltást feloldottad.')}
              />
            ) : null}

            {relationship?.followedBy && !relationship.blocked ? (
              <p className="pprof__followsyou">Követ téged</p>
            ) : null}

            {/*
              A jelvények privát fiókon és tiltásnál is látszanak — lásd a
              szerver oldali indoklást (`server/src/routes/users.ts`). Üres
              listánál nem jelenik meg semmi (`hideEmpty`): idegen profilon
              az „Még nincs jelvényed" felszólítás nem neked szól.
            */}
            <BadgeList badges={state.profile.badges} hideEmpty />

            {state.restricted ? (
              <EmptyState
                title={relationship?.blocked ? 'Letiltottad ezt a felhasználót' : 'Privát fiók'}
                description={
                  relationship?.blocked
                    ? 'Nem látod az aktivitásait, és ő sem a tieidet. A tiltás feloldásával újra láthatóvá válik.'
                    : 'A profil tartalmát csak az elfogadott követők látják. Küldj követési kérést, ha kíváncsi vagy rá.'
                }
              />
            ) : (
              <>
                {state.profile.bio ? <p className="pprof__bio">{state.profile.bio}</p> : null}

                <div className="pprof__grid">
                  <Tile
                    value={String(state.profile.counters.followers)}
                    label="követő"
                    onClick={undefined}
                  />
                  <Tile value={String(state.profile.counters.following)} label="követett" />
                  <Tile
                    value={formatArea(
                      state.profile.territoryM2.foot + state.profile.territoryM2.bike,
                    )}
                    label="grund"
                    accent
                  />
                  <Tile
                    value={formatDistance(
                      (state.profile.counters.distanceKm.run +
                        state.profile.counters.distanceKm.walk +
                        state.profile.counters.distanceKm.ride) *
                        1000,
                    )}
                    label="összes táv"
                  />
                  <Tile value={String(state.profile.counters.activities)} label="aktivitás" />
                  <Tile
                    value={String(state.profile.cellCount.foot + state.profile.cellCount.bike)}
                    label="mező"
                    accent
                  />
                </div>

                <div className="pprof__chips">
                  <Chip variant="accent">{levelProgress(state.profile.gpTotal).name}</Chip>
                  <Chip>{formatGp(state.profile.gpTotal)}</Chip>
                  <Chip>{state.profile.streak.current} napos sorozat</Chip>
                </div>

                <div>
                  <div className="label" style={{ marginBottom: 'var(--sp-3)' }}>
                    Legutóbbi aktivitások
                  </div>
                  <ActivityList
                    scope="user"
                    result={feed.result}
                    loading={feed.loading}
                    error={feed.error}
                    onRetry={feed.reload}
                  />
                </div>
              </>
            )}
          </>
        ) : null}
      </div>

      {menuOpen && state ? (
        <div className="pprof__sheet" role="dialog" aria-label="További lehetőségek">
          <button
            type="button"
            className="pprof__scrim"
            aria-label="Bezárás"
            onClick={() => setMenuOpen(false)}
          />
          <div className="pprof__menu">
            <span className="pprof__menu-title">Lehetőségek</span>
            <button
              type="button"
              className="pprof__menu-item pprof__menu-item--warn"
              onClick={() => {
                setMenuOpen(false);
                setReportOpen(true);
              }}
            >
              Felhasználó jelentése
            </button>
            {relationship?.blocked ? (
              <button
                type="button"
                className="pprof__menu-item"
                disabled={busy}
                onClick={() => act(() => api.unblockUser(username), 'A tiltást feloldottad.')}
              >
                @{state.profile.usernameLower} tiltásának feloldása
              </button>
            ) : (
              <button
                type="button"
                className="pprof__menu-item pprof__menu-item--danger"
                disabled={busy}
                onClick={() =>
                  act(() => api.blockUser(username), 'Letiltottad ezt a felhasználót.')
                }
              >
                @{state.profile.usernameLower} letiltása
              </button>
            )}
            <button
              type="button"
              className="pprof__menu-item pprof__menu-item--cancel"
              onClick={() => setMenuOpen(false)}
            >
              Mégse
            </button>
          </div>
        </div>
      ) : null}

      {reportOpen && state ? (
        <ReportUserSheet
          username={username}
          displayName={state.profile.username}
          onClose={() => setReportOpen(false)}
          onDone={() => {
            setReportOpen(false);
            setNotice('Köszönjük, a bejelentést megkaptuk. Megvizsgáljuk.');
          }}
        />
      ) : null}
    </>
  );
}

/**
 * A követés gomb HÁROM állapotot mutat, és mindegyik mást ígér:
 * követem · kérés elküldve (privát fiók, még nem bírálták el) · nem követem.
 * A tiltás felülír mindent: letiltott felhasználót nem lehet követni.
 */
function FollowButton({
  relationship,
  account,
  busy,
  onFollow,
  onUnfollow,
  onUnblock,
}: {
  relationship: { following: boolean; requested: boolean; blocked: boolean };
  account: 'public' | 'private';
  busy: boolean;
  onFollow: () => void;
  onUnfollow: () => void;
  onUnblock: () => void;
}) {
  if (relationship.blocked) {
    return (
      <Button variant="secondary" block loading={busy} onClick={onUnblock}>
        Tiltás feloldása
      </Button>
    );
  }
  if (relationship.following) {
    return (
      <Button variant="secondary" block loading={busy} onClick={onUnfollow}>
        Követed
      </Button>
    );
  }
  if (relationship.requested) {
    return (
      <Button variant="secondary" block loading={busy} onClick={onUnfollow}>
        Kérés elküldve
      </Button>
    );
  }
  return (
    <Button block loading={busy} onClick={onFollow}>
      {account === 'private' ? 'Követés kérése' : 'Követés'}
    </Button>
  );
}

function Tile({
  value,
  label,
  accent = false,
  onClick,
}: {
  value: string;
  label: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className={`pprof__tile-value${accent ? ' pprof__tile-value--accent' : ''}`}>
        {value}
      </span>
      <span className="pprof__tile-label">{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="pprof__tile" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="pprof__tile">{content}</div>
  );
}

const MONTHS = [
  'január',
  'február',
  'március',
  'április',
  'május',
  'június',
  'július',
  'augusztus',
  'szeptember',
  'október',
  'november',
  'december',
];

function memberSince(millis: number | null): string {
  if (millis === null) return '';
  const date = new Date(millis);
  return `${date.getFullYear()}. ${MONTHS[date.getMonth()]} óta tag`;
}

function BackIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

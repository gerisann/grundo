import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chip } from '@/components/ui';
import { ActivityList } from '@/components/Feed';
import { BadgeList } from '@/components/BadgeList';
import { Avatar } from '@/components/ActivityCard';
import { ConnectionsSheet } from '@/components/ConnectionsSheet';
import { RivalsCard } from '@/components/RivalsCard';
import { ProfileHeader } from '@/components/ProfileHeader';
import { useActivities } from '@/hooks/useActivities';
import { useProfile } from '@/hooks/ProfileProvider';
import { useAuth } from '@/hooks/AuthProvider';
import { api } from '@/lib/api';
import { uploadProfilePhoto } from '@/lib/photos';
import { levelProgress } from '@/game/levels';
import { weekSummary } from '@/lib/week';
import { formatArea, formatDistance, formatDuration, formatGp, formatPace } from '@/lib/format';
import './profile.css';

/**
 * Profil.
 *
 * A képernyő két kérdésre válaszol, ebben a sorrendben:
 *   1. hol tartok? — szint, haladás a következőig, terület, GP
 *   2. mit csináltam? — ez a hét, összegzők, és a saját aktivitásaim
 *
 * A SZINT SZÁMÍTOTT érték a `gpTotal`-ból (src/game/levels.ts), nem a tárolt
 * `profile.level` mező. Korábban az utóbbit mutattuk, ami a profil
 * létrehozásakor 1-re állt és soha nem frissült — mindenki örökre az első
 * szinten maradt, akármennyi pontot gyűjtött.
 *
 * TODO(F2): a második haladásjelző, a távolság-jelvény („38,4 / 50 km").
 */

/** Ennyi aktivitást kérünk le: bőven fedi az aktuális hetet is. */
const HISTORY_LIMIT = 50;

export function ProfileScreen() {
  const navigate = useNavigate();
  const { profile, reload: reloadProfile } = useProfile();
  const { user } = useAuth();
  const avatarInput = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  /** Melyik kapcsolat-lista van nyitva a számlálókról — vagy egyik sem. */
  const [connections, setConnections] = useState<'followers' | 'following' | null>(null);
  const [avatarError, setAvatarError] = useState('');
  const { result, loading, error, reload } = useActivities({ scope: 'mine', limit: HISTORY_LIMIT });

  const territoryM2 = (profile?.territoryM2.foot ?? 0) + (profile?.territoryM2.bike ?? 0);
  const distanceKm =
    (profile?.counters.distanceKm.run ?? 0) +
    (profile?.counters.distanceKm.walk ?? 0) +
    (profile?.counters.distanceKm.ride ?? 0);

  const level = levelProgress(profile?.gpTotal ?? 0);
  const week = useMemo(() => weekSummary(result?.activities ?? []), [result]);

  return (
    <>
      <ProfileHeader active="profile" />

      <div className="screen-body stack">
        <div className="prof__identity">
          <button
            type="button"
            className="prof__avatar-edit"
            aria-label="Profilkép feltöltése vagy módosítása"
            disabled={avatarBusy || !user}
            onClick={() => avatarInput.current?.click()}
          >
            <Avatar url={profile?.photoURL ?? null} name={profile?.username ?? '?'} size={64} />
            <span className="prof__avatar-badge" aria-hidden="true">
              <PencilIcon />
            </span>
          </button>
          <input
            ref={avatarInput}
            className="prof__avatar-input"
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (!file || !user) return;
              setAvatarBusy(true);
              setAvatarError('');
              void uploadProfilePhoto(file, user.uid)
                .then((url) => api.updateProfilePhoto(url))
                .then(() => reloadProfile())
                .catch((err: unknown) => {
                  setAvatarError(err instanceof Error ? err.message : 'Nem sikerült feltölteni a képet.');
                })
                .finally(() => setAvatarBusy(false));
            }}
          />
          <div className="prof__names">
            <span className="prof__display">{profile?.username ?? 'Profil'}</span>
            <span className="prof__handle">@{profile?.usernameLower ?? ''}</span>
            <span className="prof__avatar-help">
              {avatarBusy ? 'Profilkép feltöltése…' : 'Koppints a képre a módosításhoz'}
            </span>
          </div>
        </div>
        {avatarError ? <p className="field__error" role="alert">{avatarError}</p> : null}

        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <Chip variant="accent">{level.name}</Chip>
          <Chip variant="territory">{formatArea(territoryM2)}</Chip>
          <Chip>{formatGp(profile?.gpTotal ?? 0)}</Chip>
        </div>

        {/* ── Haladás a következő szintig ─────────────────────────── */}
        <section className="prof__level" aria-label="Haladás a következő szintig">
          <div className="prof__level-head">
            {/* Csak a név. A rang és a fokozat önmagában elhelyezi a
                felhasználót; a sorszám mellé írva csak zaj. */}
            <span className="prof__level-name">{level.name}</span>
            <span className="prof__level-gp">{formatGp(profile?.gpTotal ?? 0)}</span>
          </div>

          <div
            className="prof__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level.ratio * 100)}
          >
            <span className="prof__bar-fill" style={{ width: `${level.ratio * 100}%` }} />
          </div>

          <span className="prof__level-note">
            {level.nextName
              ? `Még ${formatGp(level.remaining)} a következő szintig · ${level.nextName}`
              : 'A legmagasabb szinten vagy — innen már csak a terület nő.'}
          </span>
        </section>

        {/*
          A két KAPCSOLAT-számláló koppintható, az aktivitásoké nem: azok
          listája már ott van lentebb ezen a képernyőn. A `Stat` ettől lesz
          gomb — enélkül egy div maradna, amit billentyűzetről nem lehet
          elérni.
        */}
        <div className="prof__stats">
          <Stat value={String(profile?.counters.activities ?? 0)} label="aktivitás" />
          <Stat
            value={String(profile?.counters.followers ?? 0)}
            label="követő"
            onOpen={profile?.username ? () => setConnections('followers') : undefined}
          />
          <Stat
            value={String(profile?.counters.following ?? 0)}
            label="követett"
            onOpen={profile?.username ? () => setConnections('following') : undefined}
          />
        </div>

        {/* ── Ez a hét ────────────────────────────────────────────── */}
        <section className="prof__week card" aria-label="Ez a hét">
          <div className="prof__week-head">
            <span className="label">Ez a hét</span>
            <span className="prof__week-total">{formatDistance(week.distanceM)}</span>
          </div>

          <div className="prof__week-bars">
            {week.days.map((day) => (
              <div key={day.startOfDay} className="prof__day">
                <div className="prof__day-track">
                  {/*
                    A magasság a hét LEGHOSSZABB napjához mérve, nem fix
                    skálához: így egy 2 km-es és egy 40 km-es hét diagramja is
                    olvasható marad. A minimum 4 % azért kell, hogy egy rövid
                    aktivitás is látható csíkot adjon.
                  */}
                  <span
                    className={`prof__day-bar${day.today ? ' prof__day-bar--today' : ''}`}
                    style={{
                      height:
                        day.distanceM > 0 && week.peakM > 0
                          ? `${Math.max(4, (day.distanceM / week.peakM) * 100)}%`
                          : '0%',
                    }}
                  />
                </div>
                <span className={`prof__day-label${day.today ? ' prof__day-label--today' : ''}`}>
                  {day.label}
                </span>
              </div>
            ))}
          </div>

          <dl className="prof__week-summary">
            <Summary label="aktivitás" value={String(week.activities)} />
            <Summary label="idő" value={formatDuration(week.movingS)} />
            <Summary
              label="átlagtempó"
              value={
                week.distanceM > 0
                  ? `${formatPace(week.movingS / (week.distanceM / 1000))}/km`
                  : '--:--'
              }
            />
            <Summary label="pont" value={formatGp(week.gp)} />
          </dl>
        </section>

        {/*
          NÉGY doboz, 2×2-ben — korábban három volt egy sorban.

          A negyedik a „Grundod mérete": eddig a terület csak a fenti
          chip-sorban szerepelt, tehát a legfontosabb saját szám hiányzott
          innen. A 2×2 elrendezésben a felső sor a GRUNDRÓL szól (mérete és
          mezőszáma), az alsó a MOZGÁSRÓL (táv, sorozat).
        */}
        <div className="prof__stats prof__stats--grid">
          <Stat value={formatArea(territoryM2)} label="Grundod mérete" />
          <Stat
            value={String((profile?.cellCount.foot ?? 0) + (profile?.cellCount.bike ?? 0))}
            label="Birtokolt mező"
          />
          <Stat value={formatDistance(distanceKm * 1000)} label="Megtett táv" />
          <Stat value={`${profile?.streak.current ?? 0} nap`} label="Sorozat" />
        </div>

        {/* docs/02 → „Jelvények fül (kép #12)". Itt nem külön fülként, hanem
            beágyazva jelenik meg — a képernyőnek jelenleg nincs füles
            szerkezete, és egy jelvény-sáv önmagában nem indokol egyet. */}
        <div>
          <div className="label" style={{ marginBottom: 'var(--sp-3)' }}>
            Jelvények
          </div>
          <BadgeList badges={profile?.badges ?? []} />
        </div>

        {/* Riválisok — a TOP 3, a teljes lista gomb mögött. A szekció
            magától eltűnik, ha még nincs kivel összecsapni. */}
        <RivalsCard onOpenAll={() => navigate('/profil/rivalisok')} />

        {/* A saját aktivitások — fülek nélkül: ez a te oldalad. */}
        <div>
          <div className="label" style={{ marginBottom: 'var(--sp-3)' }}>
            Aktivitásaid
          </div>
          <ActivityList
            scope="mine"
            result={result}
            loading={loading}
            error={error}
            onRetry={reload}
            onStart={() => navigate('/rogzites')}
          />
        </div>
      </div>

      {connections && profile?.username ? (
        <ConnectionsSheet
          username={profile.username}
          kind={connections}
          onClose={() => setConnections(null)}
        />
      ) : null}
    </>
  );
}

function Stat({
  value,
  label,
  onOpen,
}: {
  value: string;
  label: string;
  /** Ha van, a csempe GOMB lesz — koppintásra listát nyit. */
  onOpen?: () => void;
}) {
  const content = (
    <>
      <span className="prof__stat-value">{value}</span>
      <span className="prof__stat-label">{label}</span>
    </>
  );

  if (!onOpen) return <div className="prof__stat">{content}</div>;

  return (
    <button
      type="button"
      className="prof__stat prof__stat--tap"
      onClick={onOpen}
      aria-label={`${value} ${label} — lista megnyitása`}
    >
      {content}
    </button>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="prof__summary">
      <dt className="prof__summary-label">{label}</dt>
      <dd className="prof__summary-value">{value}</dd>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

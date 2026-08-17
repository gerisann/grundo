import { useNavigate } from 'react-router-dom';
import { Chip } from '@/components/ui';
import { Feed } from '@/components/Feed';
import { useProfile } from '@/hooks/ProfileProvider';
import { formatArea, formatDistance, formatGp } from '@/lib/format';
import { GAMEPLAY } from '@/config/gameplay';
import './profile.css';

/**
 * Profil — Profil · Statisztikák · Útvonalak · Edzés · Jelvények.
 *
 * A számok a VALÓDI profilból jönnek. Korábban be voltak drótozva nullára,
 * ezért mutatott a fejléc 0 m²-t és 0 GP-t azoknak is, akiknek volt területük.
 *
 * TODO(F2): a profilon KÉT haladásjelző fut majd egymás alatt: felül a
 * GP-szint, alatta a távolság-jelvény („38,4 / 50 km").
 */
export function ProfileScreen() {
  const navigate = useNavigate();
  const { profile } = useProfile();

  const territoryM2 = (profile?.territoryM2.foot ?? 0) + (profile?.territoryM2.bike ?? 0);
  const distanceKm =
    (profile?.counters.distanceKm.run ?? 0) +
    (profile?.counters.distanceKm.walk ?? 0) +
    (profile?.counters.distanceKm.ride ?? 0);

  return (
    <>
      <header
        className="screen-header"
        style={{ justifyContent: 'space-between', paddingLeft: 'var(--sp-4)' }}
      >
        <h1 className="screen-header__title">{profile?.username ?? 'Profil'}</h1>
        <button
          type="button"
          className="screen-header__back"
          aria-label="Beállítások"
          onClick={() => navigate('/beallitasok')}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </header>

      <div className="screen-body stack">
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <Chip variant="accent">{GAMEPLAY.LEVEL_NAMES[(profile?.level ?? 1) - 1] ?? 'ÚJONC'}</Chip>
          <Chip variant="territory">{formatArea(territoryM2)}</Chip>
          <Chip>{formatGp(profile?.gpTotal ?? 0)}</Chip>
        </div>

        <div className="prof__stats">
          <div className="prof__stat">
            <span className="prof__stat-value">{profile?.counters.activities ?? 0}</span>
            <span className="prof__stat-label">aktivitás</span>
          </div>
          <div className="prof__stat">
            <span className="prof__stat-value">{formatDistance(distanceKm * 1000)}</span>
            <span className="prof__stat-label">összes táv</span>
          </div>
          <div className="prof__stat">
            <span className="prof__stat-value">{profile?.streak.current ?? 0}</span>
            <span className="prof__stat-label">napos sorozat</span>
          </div>
        </div>

        {/* A saját aktivitások — fülek nélkül: ez a te oldalad. */}
        <Feed fixedScope="mine" />
      </div>
    </>
  );
}

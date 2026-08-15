import { useNavigate } from 'react-router-dom';
import { Button, Chip, EmptyState } from '@/components/ui';
import { formatArea, formatGp } from '@/lib/format';

/**
 * Profil — Profil · Statisztikák · Útvonalak · Edzés · Jelvények.
 *
 * Egyelőre csak a váz és a Beállítások belépési pontja. A profilon KÉT
 * haladásjelző fut majd egymás alatt: felül a GP-szint, alatta a
 * távolság-jelvény („38,4 / 50 km").
 */
export function ProfileScreen() {
  const navigate = useNavigate();

  return (
    <>
      <header
        className="screen-header"
        style={{ justifyContent: 'space-between', paddingLeft: 'var(--sp-4)' }}
      >
        <h1 className="screen-header__title">Profil</h1>
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
          <Chip variant="accent">ÚJONC</Chip>
          <Chip variant="territory">{formatArea(0)}</Chip>
          <Chip>{formatGp(0)}</Chip>
        </div>

        <EmptyState
          title="Még nincs aktivitásod"
          description="Zárj be egy kört, és a közrezárt terület a tiéd lesz. Minden méter pontot ér — akkor is, ha nem zárul a kör."
          action={
            <Button onClick={() => navigate('/rogzites')}>Kezdd az első aktivitásod</Button>
          }
        />
      </div>
    </>
  );
}

import { useState } from 'react';
import { OtpDialog } from '@/components/OtpDialog';
import { useAuth } from '@/hooks/AuthProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import { formatArea, formatGp } from '@/lib/format';
import { Feed } from '@/components/Feed';
import './home.css';

/**
 * Home — aktivitás-feed.
 *
 * Sávok fentről: hitelesítés-banner · köszöntő sor (terület-chip, GP-chip,
 * időjárás) · összegző kártya · napi küldetés · feed-váltó · feed.
 */
export function HomeScreen() {
  const { user } = useAuth();
  const { profile, reload } = useProfile();
  const [otpOpen, setOtpOpen] = useState(false);

  /**
   * A GRUNDO-identitás a FELHASZNÁLÓNÉV, nem a Google-fiókból átvett valódi
   * név. Ezt a nevet választotta a felhasználó, ez látszik a ranglistán, és
   * ezen szólítjuk meg — nem a polgári nevén.
   */
  const name = profile?.username ?? user?.displayName ?? 'sportoló';
  const needsVerification = user ? !user.emailVerified && !profile?.emailVerified : false;

  return (
    <>
      <header className="screen-header">
        <h1 className="screen-header__title">GRUNDO</h1>
      </header>

      <div className="screen-body stack">
        {needsVerification ? (
          <button
            type="button"
            className="card"
            style={{ textAlign: 'left', width: '100%' }}
            onClick={() => setOtpOpen(true)}
          >
            <div className="row__label">Hitelesítsd az e-mail-címed</div>
            <div className="row__desc">
              Hét napod van rá. Utána a közösségi funkciók zárolódnak — a rögzítés és a
              területfoglalás soha.
            </div>
          </button>
        ) : null}

        <div className="home__hero">
          <h2 className="home__greeting">
            Szia, <strong>{name}</strong>
          </h2>
          <dl className="home__summary">
            <HomeMetric
              label="Terület"
              value={formatArea(
                (profile?.territoryM2.foot ?? 0) + (profile?.territoryM2.bike ?? 0),
              )}
            />
            <HomeMetric label="GP" value={formatGp(profile?.gpTotal ?? 0)} />
            <HomeMetric label="Sorozat" value={`${profile?.streak.current ?? 0} nap`} />
          </dl>
        </div>

        <Feed />
      </div>

      {otpOpen && user?.email ? (
        <OtpDialog
          email={user.email}
          onClose={() => setOtpOpen(false)}
          onVerified={() => {
            setOtpOpen(false);
            void user.reload().then(() => reload());
          }}
        />
      ) : null}
    </>
  );
}

function HomeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="home__metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

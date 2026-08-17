import { useState } from 'react';
import { Chip } from '@/components/ui';
import { OtpDialog } from '@/components/OtpDialog';
import { useAuth } from '@/hooks/AuthProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import { formatArea, formatGp } from '@/lib/format';
import { Feed } from '@/components/Feed';

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

        <div>
          <div className="label">Jó napot</div>
          <h2 style={{ margin: 'var(--sp-1) 0 var(--sp-3)', fontSize: 'var(--fs-title)' }}>
            {name}
          </h2>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <Chip variant="territory">
              {formatArea((profile?.territoryM2.foot ?? 0) + (profile?.territoryM2.bike ?? 0))}
            </Chip>
            <Chip>{formatGp(profile?.gpTotal ?? 0)}</Chip>
            <Chip variant="accent">{profile?.streak.current ?? 0} napos sorozat</Chip>
          </div>
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

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Chip, EmptyState } from '@/components/ui';
import { OtpDialog } from '@/components/OtpDialog';
import { useAuth } from '@/hooks/AuthProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import { formatArea, formatDistance, formatDuration, formatGp } from '@/lib/format';
import { api, apiConfigured, type FeedActivity } from '@/lib/api';
import './territory.css';

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

/**
 * Aktivitás-feed.
 *
 * Egyelőre CSAK a sajátod. A követés és a lokális feed külön adatszerkezetet
 * igényel (kit követsz, mely aktivitások láthatók) — az F2 dolga. Addig is ez
 * a képernyő legfontosabb funkciója: látni, hogy amit megcsináltál, az
 * megmaradt.
 */
function Feed() {
  const navigate = useNavigate();
  const [items, setItems] = useState<FeedActivity[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!apiConfigured) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void api
      .activities()
      .then((r) => {
        if (!cancelled) setItems(r.activities);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return <div className="card">Nem sikerült betölteni az aktivitásaidat.</div>;
  }

  if (items === null) {
    return <div className="card">Betöltés…</div>;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="A területed üres"
        description="Zárj be egy kört, és a közrezárt terület a tiéd lesz. Minden méter pontot ér — akkor is, ha nem zárul a kör."
        action={<Button onClick={() => navigate('/rogzites')}>Kezdd az első aktivitásod</Button>}
      />
    );
  }

  return (
    <div className="feed">
      {items.map((item) => (
        <div className="feed__item" key={item.id}>
          <span className="feed__icon" aria-hidden="true">
            {item.type === 'ride' ? '🚲' : item.type === 'walk' ? '🚶' : '🏃'}
          </span>
          <span>
            <span className="feed__title">{ACTIVITY_LABEL[item.type]}</span>
            <span className="feed__meta">
              {formatRelativeDay(item.startedAt)} · {formatDistance(item.distanceM / 1000)} ·{' '}
              {formatDuration(item.movingS)}
            </span>
          </span>
          <span className="feed__gain">
            <span className="feed__gain-value">
              {item.areaGainedM2 > 0 ? formatArea(item.areaGainedM2) : `${item.gp} GP`}
            </span>
            <span className="feed__gain-label">
              {item.areaGainedM2 > 0 ? 'szerzett' : 'pont'}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

const ACTIVITY_LABEL: Record<FeedActivity['type'], string> = {
  run: 'Futás',
  walk: 'Séta',
  ride: 'Bringa',
};

/**
 * „ma", „tegnap", vagy dátum.
 *
 * Naptári napokat hasonlítunk, nem eltelt órákat: egy tegnap este 23:00-kor
 * kezdett futás ma reggel 7-kor „9 órája" lenne, pedig a felhasználó fejében
 * egyértelműen tegnapi.
 */
function formatRelativeDay(at: number): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(at))) / 86_400_000);
  if (days <= 0) return 'ma';
  if (days === 1) return 'tegnap';
  if (days < 7) return `${days} napja`;
  return new Date(at).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
}

import { useState } from 'react';
import { OtpDialog } from '@/components/OtpDialog';
import { useAuth } from '@/hooks/AuthProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import { formatArea, formatCellCount, formatGp } from '@/lib/format';
import { Feed } from '@/components/Feed';
import { WeatherWidget } from '@/components/WeatherWidget';
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
      <header className="screen-header home__header">
        <h1 className="screen-header__title home__brand">
          {/*
            A jel a NÉV ELŐTT áll, és pontosan olyan magas, mint a betűk.
            A színátmenete ugyanaz, mint a statisztikapanelé — a kettő így egy
            rendszer része, nem két külön díszítés.
          */}
          <span className="home__mark" aria-hidden="true" />
          GRUNDO
        </h1>

        {/*
          Három művelet, EGYELŐRE INAKTÍVAN.
          Szándékosan `disabled`, nem elrejtve: a helyük innentől foglalt, és
          a fejléc nem fog átrendeződni, amikor megjön mögéjük a működés.
        */}
        <div className="home__actions">
          <button type="button" className="home__action" aria-label="Keresés" disabled>
            <SearchIcon />
          </button>
          <button type="button" className="home__action" aria-label="Üzenetek" disabled>
            <MessageIcon />
          </button>
          <button type="button" className="home__action" aria-label="Értesítések" disabled>
            <BellIcon />
          </button>
        </div>
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
          {/*
            A köszöntés és az időjárás EGY SORBAN: a név balra, a widget a
            jobb szélen. A widget maga dönti el, megjelenik-e — ha nincs
            tárolt pozíció vagy néma a szolgáltató, nem foglal helyet.
          */}
          <div className="home__greet-row">
            <h2 className="home__greeting">
              Szia, <strong>{name}</strong>
            </h2>
            <WeatherWidget />
          </div>
          <dl className="home__summary">
            {/*
              A GRUND doboz SZÉLESEBB (40%), mert két adatot hordoz: mekkora és
              hány mezőből. A másik kettő 30-30% — azoknak egy szám elég.
            */}
            <HomeMetric
              label="Grund"
              value={formatArea(
                (profile?.territoryM2.foot ?? 0) + (profile?.territoryM2.bike ?? 0),
              )}
              extra={`${formatCellCount(
                (profile?.cellCount.foot ?? 0) + (profile?.cellCount.bike ?? 0),
              )} mező`}
            />
            {/* A címke „Aktivitás", de az ÉRTÉK továbbra is GP — a mértékegység
                nem változik attól, hogy a doboz felirata beszédesebb lett. */}
            <HomeMetric label="Aktivitás" value={formatGp(profile?.gpTotal ?? 0)} />
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

function HomeMetric({
  label,
  value,
  extra,
}: {
  label: string;
  value: string;
  /** Másodlagos adat a fő érték mellé — ma csak a grund mezőszáma. */
  extra?: string;
}) {
  return (
    <div className="home__metric">
      <dt>{label}</dt>
      <dd>
        {value}
        {extra ? <span className="home__metric-extra">{extra}</span> : null}
      </dd>
    </div>
  );
}

/* ── Fejléc-ikonok ─────────────────────────────────────────────────
   Egységes 20×20, 1,8-as vonalvastagság — ugyanaz a rajzolási nyelv, mint a
   Grund oldal szem- és hexagon-ikonjánál. */

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8 20.5 20.5" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.5 12.4c0 3.9-3.8 7-8.5 7-1 0-2-.14-2.9-.4L4 20.5l1.6-3.7C4.2 15.6 3.5 14.1 3.5 12.4c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 15.5V10.5a6 6 0 1 0-12 0v5L4.2 18h15.6L18 15.5z" />
      <path d="M9.8 21a2.4 2.4 0 0 0 4.4 0" />
    </svg>
  );
}

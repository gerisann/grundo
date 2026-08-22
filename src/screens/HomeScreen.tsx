import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OtpDialog } from '@/components/OtpDialog';
import { useAuth } from '@/hooks/AuthProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import { formatArea, formatCellCount, formatDistance, formatNumber } from '@/lib/format';
import {
  dismissDailyMissionCard,
  isDailyMissionCardDismissed,
  readDailyMission,
} from '@/lib/dailyMission';
import type { Mission } from '@/lib/api';
import { Feed } from '@/components/Feed';
import { WeatherWidget } from '@/components/WeatherWidget';
import { NotificationPanel } from '@/components/NotificationPanel';
import { useNotifications } from '@/hooks/useNotifications';
import { initIfAlreadyGranted } from '@/lib/push';
import './home.css';

/**
 * Home — aktivitás-feed.
 *
 * Sávok fentről: hitelesítés-banner · köszöntő sor (terület-chip, GP-chip,
 * időjárás) · összegző kártya · napi küldetés · feed-váltó · feed.
 */
export function HomeScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile, reload } = useProfile();
  const [otpOpen, setOtpOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { unreadCount } = useNotifications();

  /**
   * PASSZÍV token-frissítés — csak akkor, ha az engedély MÁR megvan.
   *
   * Nem itt kérünk push-engedélyt (az a Beállítások/Értesítések kapcsolója,
   * felhasználói gesztusra) — ez csak azt biztosítja, hogy egy már
   * engedélyezett eszköz tokenje ne évüljön el csendben.
   */
  useEffect(() => {
    if (user) void initIfAlreadyGranted(user.uid);
  }, [user]);

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
        {/*
          A LOGÓ két PNG-ből jön, témánként — a szöveges „GRUNDO" felirat és
          az előtte álló színátmenetes hexagon helyére.

          Miért PNG, és miért NEM SVG? A logót Geri exportálta mindkét
          formában, és a PNG-ben a hexagon színátmenete simább — az SVG
          verzió a hexagon feltöltéséhez sávozó (banding) színátmenetet
          adott, a PNG-ét a tervezőprogram már rásterelte, ott ez nem
          jelenik meg. Emiatt itt kivételesen a raszteres kép a hitelesebb.

          Miért KÉT fájl, nem egy átszínezhető? Mert a két változat nem csak
          színben tér el: a betűk belső üregei (a G és a d „lyukai") máshogy
          vannak kivágva bennük — egy fájl átszínezése ezt nem adná vissza.

          Az `alt` CSAK a világos változaton van kitöltve: a kettő ugyanazt a
          szót jelenti, és képernyőolvasóval kétszer felolvasva „GRUNDO
          GRUNDO" hangzana el.
        */}
        <h1 className="screen-header__title home__brand">
          <img
            className="home__logo home__logo--light"
            src="/grundo-logo-light.png"
            alt="GRUNDO"
            width={80}
            height={24}
          />
          <img
            className="home__logo home__logo--dark"
            src="/grundo-logo-dark.png"
            alt=""
            aria-hidden="true"
            width={80}
            height={24}
          />
        </h1>

        {/*
          Az Üzenetek EGYELŐRE INAKTÍV. Szándékosan `disabled`, nem elrejtve:
          a helye innentől foglalt, és a fejléc nem fog átrendeződni, amikor
          megjön mögéje a működés. A Keresés ide tartozott, de már él.
        */}
        <div className="home__actions">
          <button
            type="button"
            className="home__action"
            aria-label="Keresés"
            onClick={() => navigate('/kereses')}
          >
            <SearchIcon />
          </button>
          <button type="button" className="home__action" aria-label="Üzenetek" disabled>
            <MessageIcon />
          </button>
          <button
            type="button"
            className="home__action"
            aria-label={unreadCount > 0 ? `Értesítések, ${unreadCount} olvasatlan` : 'Értesítések'}
            onClick={() => setNotificationsOpen(true)}
          >
            <BellIcon />
            {unreadCount > 0 ? <span className="home__action-dot" aria-hidden="true" /> : null}
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

              Mindhárom doboz HÁROM SORT mutat: felül a címke, középen a
              KIEMELT érték (nagyobb betű), alul a mértékegység vagy a
              kiegészítő adat. A GRUND-nál a középső sor már tartalmazza a
              saját mértékegységét (km²), az alsó sor ott egy MÁSIK adat
              (mezőszám) — a másik kettőnél viszont az alsó sor tényleg csak
              a felirat a bare számhoz.
            */}
            <HomeMetric
              label="Grund"
              value={formatArea(
                (profile?.territoryM2.foot ?? 0) + (profile?.territoryM2.bike ?? 0),
              )}
              unit={`${formatCellCount(
                (profile?.cellCount.foot ?? 0) + (profile?.cellCount.bike ?? 0),
              )} mező`}
            />
            {/* A címke „Aktivitás", de az érték továbbra is GP — a mértékegység
                nem változik attól, hogy a doboz felirata beszédesebb lett. */}
            <HomeMetric label="Aktivitás" value={formatNumber(profile?.gpTotal ?? 0)} unit="GP" />
            <HomeMetric label="Sorozat" value={formatNumber(profile?.streak.current ?? 0)} unit="nap" />
          </dl>
        </div>

        <DailyMissionCard />

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

      {notificationsOpen ? <NotificationPanel onClose={() => setNotificationsOpen(false)} /> : null}
    </>
  );
}

/**
 * „A mai küldetésed" — a legerősebb visszahívó elem (docs/02).
 *
 * Nem általános biztatás, hanem konkrét, helyi, mérhető tét. Ha ma már volt
 * generálás, a legjobb ajánlat itt is megjelenik, egy koppintással
 * indíthatóan; ha nem, a kártya odahív a Küldetések képernyőre.
 *
 * ⚠️ EZ A KÁRTYA SOSEM GENERÁL. Lásd `src/lib/dailyMission.ts` — a generálás
 * kvótás, és egy Home-betöltés nem égetheti el a felhasználó heti keretét.
 */
function DailyMissionCard() {
  const navigate = useNavigate();
  const [mission, setMission] = useState<Mission | null>(null);
  /*
    ALAPBÓL REJTVE, amíg a tár meg nem szólal. Fordítva — alapból látszóból
    indulva — a kártya minden betöltéskor felvillanna, majd eltűnne annak is,
    aki tegnap… illetve ma már bezárta.
  */
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setMission(readDailyMission());
    setDismissed(isDailyMissionCardDismissed());
  }, []);

  if (dismissed) return null;

  return (
    /*
      ⚠️ A BEZÁRÓ GOMB NEM LEHET A NAGY GOMBON BELÜL — egymásba ágyazott
      interaktív elem érvénytelen HTML, és a képernyőolvasó sem tudná
      szétválasztani a két műveletet. Ezért burkoló elem, benne két gomb.
    */
    <div className="home__mission-wrap">
      <button
        type="button"
        className="home__mission"
        onClick={() => navigate('/kuldetesek')}
        aria-label={mission ? 'A mai küldetésed megnyitása' : 'Küldetés kérése'}
      >
        <span className="home__mission-label">A mai küldetésed</span>
        <span className="home__mission-text">
          {mission
            ? missionSummary(mission)
            : 'Van fél órád? Mutatunk egy kört, aminek tétje van.'}
        </span>
        {mission ? (
          <span className="home__mission-meta">
            {formatDistance(mission.distanceKm * 1000)} · {formatArea(mission.areaM2)} ·{' '}
            {formatNumber(mission.estimatedGp)} GP
          </span>
        ) : null}
        <ChevronRightIcon />
      </button>

      <button
        type="button"
        className="home__mission-close"
        aria-label="A mai küldetés kártyájának bezárása"
        onClick={() => {
          dismissDailyMissionCard();
          setDismissed(true);
        }}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

/** A „tovább" jelzés — eddig semmi nem mutatta, hogy a kártya kattintható. */
function ChevronRightIcon() {
  return (
    <svg
      className="home__mission-chevron"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

function missionSummary(mission: Mission): string {
  switch (mission.kind) {
    case 'raid':
      return mission.victimName
        ? `Elvehetsz ${formatArea(mission.victimAreaM2)}-t ${mission.victimName} grundjából.`
        : `Elvehetsz ${formatArea(mission.victimAreaM2)}-t egy helyi játékostól.`;
    case 'fortify':
      return `Megerősítheted a meglévő grundodat — ${formatNumber(
        mission.counts?.reclaimed ?? 0,
      )} mező védelme nő.`;
    case 'explore':
      return `${formatNumber(mission.newBlocks)} körzet, ahol még egyetlen meződ sincs.`;
    case 'conquest':
    default:
      return `Megszerezhetsz ${formatArea(mission.areaM2)} új területet.`;
  }
}

function HomeMetric({
  label,
  value,
  unit,
}: {
  label: string;
  /** A KIEMELT, középső sor — 20%-kal nagyobb betűvel, mint a többi szöveg. */
  value: string;
  /** Az alsó sor: a Grundnál másik adat (mezőszám), a többinél a mértékegység. */
  unit: string;
}) {
  return (
    <div className="home__metric">
      <dt>{label}</dt>
      <dd className="home__metric-value">{value}</dd>
      <span className="home__metric-unit">{unit}</span>
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

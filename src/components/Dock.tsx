import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, NavLink } from 'react-router-dom';
import { useRecorderContext } from '@/hooks/RecorderProvider';
import { useTrackingEnvironment } from '@/tracking/environment';
import { HoldFinishButton, SwipeFinishButton } from '@/components/FinishGestureButtons';
import { GAMEPLAY } from '@/config/gameplay';
import { playSound, unlockSounds } from '@/lib/sound';
import './Dock.css';

/**
 * Alsó dock — a navigáció gerince ÉS a rögzítés vezérlője.
 *
 * A középső gomb nem csak egy menüpont: ez a képernyő domináns akciója, és
 * a rögzítés állapotától függően mást csinál.
 *
 *   nincs rögzítés   → Play. Máshonnan a rögzítés képernyőre visz, ott indít.
 *   rögzítés fut     → Pause, és két gomb nyúlik ki belőle: Kör és Befejezés.
 *   szüneteltetve    → Play (folytatás), ugyanazzal a két gombbal.
 *   befejezve        → „Új rögzítés" felirat, kiszélesített gombban.
 *
 * A kinyúló gombok miatt a menüpontok a szélek felé csúsznak — erről a
 * `dock--wide` osztály gondoskodik.
 *
 * docs/01-kepernyoterkep.md → Navigációs architektúra
 */
export function Dock() {
  const navigate = useNavigate();
  const location = useLocation();
  const trackingEnvironment = useTrackingEnvironment();
  const {
    state,
    upload,
    begin,
    pause,
    resume,
    markLap,
    finish,
    discard,
    pendingType,
    setPendingType,
    pickerOpen,
    setPickerOpen,
    countdown,
    setCountdown,
    statsFullView,
    finishGesture,
  } = useRecorderContext();

  // LAB E2E-ben ugyanaz a Dock vezérli ugyanazt a recordert, csak az oldal
  // admin útvonalon él. Ilyenkor nem navigálunk el `/rogzites`-re a Play előtt.
  const onTrackingScreen = location.pathname === '/rogzites' || trackingEnvironment.mode === 'lab';
  const idle = state.status === 'idle';
  const running = state.status === 'recording';
  const paused = state.status === 'paused';
  const done = state.status === 'finished';
  const active = running || paused;
  /**
   * TÚL RÖVID RÖGZÍTÉS — Geri kérése (2026-08-27): ilyenkor a TrackingScreen
   * SOSEM tölti fel (nincs mit), tehát `upload.status` örökre `'idle'`
   * marad. A régi „Új rögzítés" gomb ezért a `done` ágban a
   * `upload.status !== 'done'` feltétel miatt csak `navigate('/rogzites')`-t
   * hívott — ami a rögzítés képernyőjén NULLA hatású volt, a gomb
   * láthatóan „nem csinált semmit".
   */
  const tooShortDone = done && state.distanceM < GAMEPLAY.MIN_DISTANCE_M;

  /**
   * INDÍTÁS ELŐTT: 3-2-1 VISSZASZÁMLÁLÁS A GOMBON, MAJD „RAJT!" A KÖZÉPEN.
   *
   * Geri kérése (2026-08-27): a Play gomb második megnyomása nem indítja
   * AZONNAL a mérést — előbb egy 3 másodperces visszaszámlálás fut a gombon
   * magán, utána jelenik meg a „RAJT!" felirat, és CSAK EZUTÁN hívódik a
   * valódi `begin()`. Így a rögzítés kezdő időbélyege pontosan a „RAJT!"
   * pillanatára esik, nem a gombnyomásra.
   */
  const [showRajt, setShowRajt] = useState(false);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      // A „RAJT!" hangja a felirattal EGYSZERRE — Geri kérése (2026-09-01).
      playSound('count-down-start');
      if (pendingType) void begin(pendingType);
      setShowRajt(true);
      return;
    }
    /*
      A síp a SZÁM MEGJELENÉSEKOR szól, nem az időzítő lejártakor: a hatás
      minden új értékre újrafut (3 → 2 → 1), tehát pontosan háromszor. A
      hangzár feloldása a gombnyomásnál megtörtént (`primaryAction`), így az
      első síp sem esik ki.
    */
    playSound('count-down-beep');
    const timer = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, pendingType, begin, setCountdown]);

  /**
   * FUTÓ MÉRÉS KÖZBEN A RÖGZÍTÉS KÉPERNYŐJE RAGADÓS.
   *
   * A böngésző „vissza" gombja ZSÁKUTCÁBA vitt (Geri, 2026-08-26): a Home
   * jelent meg, a dokk viszont a rögzítés vezérlőit mutatta — és mivel az
   * `active` állapotban a dokk CSAK a három gombot tartalmazza, menüpontok
   * nélkül, a felhasználó nem tudott sehova továbblépni. A képernyő és a dokk
   * két külön dolgot állított, és egyik sem vezetett ki.
   *
   * A történelmi navigációt nem lehet megbízhatóan letiltani (és nem is
   * volna helyes elvenni a böngésző gombját), ezért a másik irányt
   * választottuk: bármit tölt be a vissza/előre, azonnal visszaváltunk a
   * mérésre. A `replace` szándékos — így a felhasználó nem tud egy hosszú
   * oda-vissza láncot építeni magának a nyomógombbal.
   *
   * ⚠️ A LAB E2E-t KI KELL HAGYNI: ott a rögzítés admin útvonalon fut, és egy
   * `/rogzites`-re dobás kirántaná a mérést a saját környezetéből.
   */
  useEffect(() => {
    if (!active || onTrackingScreen) return;
    navigate('/rogzites', { replace: true });
  }, [active, onTrackingScreen, navigate]);

  function primaryAction() {
    /**
     * ⚠️ A HANGZÁR FELOLDÁSA ITT, ÉS SEHOL MÁSHOL.
     *
     * Minden mai böngésző csak felhasználói gesztusból engedi az első
     * lejátszást — iOS-en elemenként. Ez az a koppintás, ami minden rögzítés
     * előtt biztosan megtörténik, és még a visszaszámlálás ELŐTT van, tehát
     * az első síp sem késik le. A hívás idempotens (lásd `sound.ts`).
     */
    unlockSounds();
    if (running) return pause();
    if (paused) return resume();
    if (done) {
      /**
       * TÚL RÖVID RÖGZÍTÉS: NINCS MIT VÉDENI. Se terület, se GP nem jár érte
       * (lásd a TrackingScreen figyelmeztetését) — az alábbi, mentett-mérést
       * védő szabály itt nem vonatkozik, mert nincs mit menteni. A gomb
       * ilyenkor amúgy is a sima Play ikont mutatja (`showFinishedLabel`
       * lent), tehát ez a koppintás egyenesen egy friss indítást takar.
       */
      if (tooShortDone) return void discard();
      /**
       * ⚠️ MENTETLEN MÉRÉST SOHA NEM DOBUNK EL EGY KOPPINTÁSRA.
       *
       * A `discard()` VÉGLEG törli a megőrzött rögzítést. Korábban a `done`
       * ág feltétel nélkül ezt hívta — és ez éles adatvesztéshez vezetett
       * (2026-08-26): a rögzítés képernyőjéről elnavigálva a gomb nem is
       * „Új rögzítés" feliratot viselt, hanem egy Play ikont (a felirathoz
       * `onTrackingScreen` is kell), tehát a felhasználó a folytatás
       * szándékával nyomta meg — és ezzel törölte a saját futását.
       *
       * Amíg a feltöltés nincs kész, ez a gomb a rögzítés képernyőjére visz,
       * ahol LÁTSZIK, mi történt (küldés, hiba, újrapróbálás). Eldobni csak
       * onnan lehet, tudatosan.
       */
      if (upload.status !== 'done') return navigate('/rogzites');
      return void discard();
    }
    if (!onTrackingScreen) return navigate('/rogzites');
    // Visszaszámlálás közben a gomb inert — nincs mit kezdeni egy újabb
    // koppintással, amíg a „RAJT!" felé tartunk.
    if (countdown !== null) return;
    if (!pickerOpen) {
      // Első koppintás: nyitja a választót, és MINDIG üresen — Geri kérése
      // (2026-08-27), hogy sose emlékezzen az előző mozgásformára.
      setPendingType(null);
      setPickerOpen(true);
      return;
    }
    if (!pendingType) return; // még nincs választva — a gomb ilyenkor `disabled`.
    setPickerOpen(false);
    setCountdown(3);
  }

  /** A választóban NINCS kiválasztva semmi — a gomb inaktív, sárga, ↑. */
  const picking = idle && pickerOpen && !pendingType;
  /** Van választott mozgásforma, VAGY fut a visszaszámlálás — piros, kész. */
  const armed = (idle && pickerOpen && !!pendingType) || countdown !== null;

  // Túl rövid rögzítésnél NEM a kiszélesített „Új rögzítés" felirat jön —
  // a sima Play ikon jelzi, hogy ez gyakorlatilag egy friss indítás lesz.
  const showFinishedLabel = done && onTrackingScreen && !tooShortDone;

  const primaryLabel = running
    ? 'Szünet'
    : paused
      ? 'Folytatás'
      : showFinishedLabel
        ? 'Új rögzítés'
        : countdown !== null
          ? `Indul: ${countdown}`
          : picking
            ? 'Válassz mozgásformát'
            : 'Aktivitás indítása';

  const controls = (
    <div className="dock__center">
      {active ? (
        /*
          SZÜNETBEN NEM LEHET KÖRT NYITNI (Geri, 2026-08-26). Álló mérésnél a
          kör kezdete értelmezhetetlen: nincs mozgás, amit elválasztana, és a
          folytatás pillanatában amúgy is szakadás van a nyomvonalban.
        */
        <button className="dock__side dock__side--left" onClick={markLap} disabled={paused}>
          Új kör
        </button>
      ) : null}

      <button
        className={`dock__play${showFinishedLabel ? ' dock__play--wide' : ''}${
          idle && !pickerOpen && countdown === null ? ' dock__play--idle' : ''
        }${active ? ' dock__play--large' : ''}${picking ? ' dock__play--picking' : ''}${
          armed ? ' dock__play--armed' : ''
        }${paused ? ' dock__play--paused' : ''}`}
        onClick={primaryAction}
        disabled={picking}
        aria-label={primaryLabel}
      >
        {countdown !== null ? (
          <span className="dock__play-countdown">{countdown}</span>
        ) : showFinishedLabel ? (
          <span className="dock__play-text">Új rögzítés</span>
        ) : running ? (
          <PauseIcon />
        ) : picking ? (
          <UpArrowIcon />
        ) : (
          <PlayIcon />
        )}
      </button>

      {active ? (
        finishGesture === 'swipe' ? (
          <SwipeFinishButton onFinish={() => void finish()} />
        ) : (
          <HoldFinishButton onFinish={() => void finish()} />
        )
      ) : null}

      {/*
        „RAJT!" — a visszaszámlálás VÉGÉN jelenik meg, ugyanazzal a portál-
        technikával, mint a befejezés-visszajelzés: a `body`-ba megy, hogy a
        `dock`/`dock__center` `overflow`-ja ne vágja le. Az `onAnimationEnd`
        szedi le magát — nincs külön timer, ami elszaladhatna az animációtól.
      */}
      {showRajt
        ? createPortal(
            <div
              className="rajt-overlay"
              aria-hidden="true"
              onAnimationEnd={() => setShowRajt(false)}
            >
              RAJT!
            </div>,
            document.body,
          )
        : null}
    </div>
  );

  /*
    A statisztika-panel teljes nézetében a dokk „beleolvad" a panelbe —
    Geri kérése (2026-08-27): azonos háttér, se keret, se árnyék, se blur,
    hogy a kettő egy felületnek hasson. Lásd `Dock.css` → `.dock--blend`.

    Szünetben a teljes nézet MAGA VÁLT SÁRGÁRA (`.track__panel--paused`,
    tracking.css) — a dokknak KÖVETNIE kell, különben a beolvadás pont
    akkor törne meg, amikor a felhasználó megáll.
  */
  const dockClassName = `dock${statsFullView ? ' dock--blend' : ''}${
    statsFullView && paused ? ' dock--paused' : ''
  }`;

  if (active) {
    return (
      <nav className={`${dockClassName} dock--controls`} aria-label="Rögzítés vezérlése">
        {controls}
      </nav>
    );
  }

  return (
    <nav className={dockClassName} aria-label="Fő navigáció és rögzítés">
      <NavLink to="/" className="dock__item" aria-label="Kezdőlap">
        <HomeIcon />
      </NavLink>
      <NavLink to="/grund" className="dock__item" aria-label="Grund">
        <HexIcon />
      </NavLink>
      {controls}
      <NavLink to="/kozosseg" className="dock__item" aria-label="Közösség">
        <PeopleIcon />
      </NavLink>
      <NavLink to="/profil" className="dock__item" aria-label="Profil">
        <PersonIcon />
      </NavLink>
    </nav>
  );
}


function PauseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <rect x="6.5" y="5" width="4" height="14" rx="1.4" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.4" />
    </svg>
  );
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const HomeIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" {...stroke}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20h14V9.5" />
  </svg>
);

const HexIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" {...stroke}>
    <path d="M12 2.5 20 7v10l-8 4.5L4 17V7z" />
  </svg>
);

const PeopleIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" {...stroke}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.8 20c0-3.4 2.8-5.6 6.2-5.6s6.2 2.2 6.2 5.6" />
    <path d="M16.5 5.4a3.2 3.2 0 0 1 0 6.1M17.5 14.8c2.3.5 3.9 2.4 3.9 5.2" />
  </svg>
);

const PersonIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" {...stroke}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
  </svg>
);

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
);

/** A mozgásforma-választó nyitott állapotát jelzi — „válassz felül". */
const UpArrowIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

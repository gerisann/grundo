import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, NavLink } from 'react-router-dom';
import { useRecorderContext } from '@/hooks/RecorderProvider';
import { useTrackingEnvironment } from '@/tracking/environment';
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
  const { state, begin, pause, resume, markLap, finish, discard } = useRecorderContext();
  const dockRef = useDockHeight();

  // LAB E2E-ben ugyanaz a Dock vezérli ugyanazt a recordert, csak az oldal
  // admin útvonalon él. Ilyenkor nem navigálunk el `/rogzites`-re a Play előtt.
  const onTrackingScreen = location.pathname === '/rogzites' || trackingEnvironment.mode === 'lab';
  const running = state.status === 'recording';
  const paused = state.status === 'paused';
  const done = state.status === 'finished';
  const active = running || paused;

  function primaryAction() {
    if (running) return pause();
    if (paused) return resume();
    if (done) return void discard();
    if (!onTrackingScreen) return navigate('/rogzites');
    return void begin();
  }

  const showFinishedLabel = done && onTrackingScreen;

  const primaryLabel = running
    ? 'Szünet'
    : paused
      ? 'Folytatás'
      : showFinishedLabel
        ? 'Új rögzítés'
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
          state.status === 'idle' ? ' dock__play--idle' : ''
        }${active ? ' dock__play--large' : ''}`}
        onClick={primaryAction}
        aria-label={primaryLabel}
      >
        {showFinishedLabel ? (
          <span className="dock__play-text">Új rögzítés</span>
        ) : running ? (
          <PauseIcon />
        ) : (
          <PlayIcon />
        )}
      </button>

      {active ? <FinishButton onFinish={() => void finish()} /> : null}
    </div>
  );

  if (active) {
    return (
      <>
        <PausePanel shown={paused} />
        <nav ref={dockRef} className="dock dock--controls" aria-label="Rögzítés vezérlése">
          {controls}
        </nav>
      </>
    );
  }

  return (
    <nav ref={dockRef} className="dock" aria-label="Fő navigáció és rögzítés">
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

/**
 * A dokk VALÓDI magassága, CSS-változóként.
 *
 * MIÉRT NEM ELÉG A `--dock-height` TOKEN? Mert rögzítés közben a dokk
 * `dock--controls` módba vált, ahol a magasság `auto` — a token ilyenkor nem
 * a tényleges méret. A szünet-panelnek viszont pontosan a dokk fölé kell
 * ülnie, és egy néhány pixeles tévedés vagy rést hagy, vagy átfedést csinál.
 *
 * A `ResizeObserver` a témaváltást, a safe-area változását és a
 * képernyőforgatást is lekezeli — mindegyik átméretezi a dokkot.
 */
function useDockHeight() {
  const ref = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const publish = () => {
      document.documentElement.style.setProperty(
        '--dock-measured-height',
        `${Math.round(node.getBoundingClientRect().height)}px`,
      );
    };

    publish();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  });

  return ref;
}

/**
 * SZÜNET — sárga panel, ami a dokk MÖGÜL úszik fel.
 *
 * Korábban a képernyő közepén lüktetett egy „SZÜNET" doboz. Geri kérése
 * (2026-08-26): ne a tartalom közepét takarja el, hanem a vezérlők mellől
 * jelentse be magát, és ne pulzáljon — a szünet állapot, nem riasztás.
 *
 * ⚠️ MINDIG KI VAN RENDERELVE, csak eltolva. Így a kifelé tartó animáció is
 * lefut; ha a `paused` állapot leszedné a DOM-ból, a panel eltűnne ahelyett,
 * hogy lecsúszna. A `--dock-measured-height` teszi lehetővé, hogy a rejtett
 * állapotban pontosan a dokk mögé kerüljön, ne csak „nagyjából alá".
 *
 * ⚠️ `aria-hidden` REJTETT ÁLLAPOTBAN. A képernyőolvasó különben folyamatosan
 * bemondaná a szünet-szöveget rögzítés közben is, amikor nincs is szünet.
 */
function PausePanel({ shown }: { shown: boolean }) {
  return (
    <div
      className={`dock__pause${shown ? ' dock__pause--shown' : ''}`}
      role="status"
      aria-hidden={!shown}
    >
      <strong className="dock__pause-title">Szünet</strong>
      <span className="dock__pause-hint">A mérés áll — a PLAY gombbal folytathatod.</span>
    </div>
  );
}

/**
 * A nyomva tartás ideje.
 *
 * ⚠️ FELEZVE 2026-08-26-án (2000 → 1000 ms). A két másodperc a középre
 * kitett, nagy visszajelzés nélkül volt indokolt: addig a felhasználó a saját
 * ujja alatt nem látta, hogy egyáltalán történik valami. Most látja, tehát a
 * hosszú várakozás már csak lassítás. Nullára azért nem megy: a véletlen
 * koppintás nem szakíthatja félbe egy futás rögzítését.
 */
const FINISH_HOLD_MS = 1000;

function FinishButton({ onFinish }: { onFinish: () => void }) {
  const [progress, setProgress] = useState(0);
  const holding = useRef(false);
  const frame = useRef(0);
  const startedAt = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function start() {
    if (holding.current) return;
    holding.current = true;
    startedAt.current = performance.now();

    const step = (now: number) => {
      if (!holding.current) return;
      const value = Math.min(1, (now - startedAt.current) / FINISH_HOLD_MS);
      setProgress(value);
      if (value >= 1) {
        holding.current = false;
        setProgress(0);
        onFinish();
        return;
      }
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }

  function cancel() {
    if (!holding.current) return;
    holding.current = false;
    cancelAnimationFrame(frame.current);
    setProgress(0);
  }

  const percent = progress * 100;
  const holdingNow = progress > 0;

  return (
    <>
      {/*
        A KÖZÉPRE KITETT VISSZAJELZÉS — ez a lényege a 2026-08-26-i
        átalakításnak.

        A régi megoldásban csak az alsó gomb töltődött, amit a felhasználó
        SAJÁT UJJA TAKART EL. Emiatt a gomb úgy viselkedett, mintha nem
        reagálna: nem derült ki, hogy nyomva kell tartani, csak az, hogy
        a koppintás „nem csinál semmit".

        Portálban megy a `body`-ba, nem a gombon belül: a `.dock__finish`
        `overflow: hidden`, a dokk pedig `position: fixed` — egy belülre tett
        teljes képernyős réteg mindkettőn elvérezne.

        ⚠️ `pointer-events: none` (a CSS-ben): a réteg NEM foghatja el a
        mutatót, különben a `pointerup`/`pointerleave` nem a gombhoz érkezne,
        és a nyomva tartás beragadna.
      */}
      {holdingNow && typeof document !== 'undefined'
        ? createPortal(
            <div className="finish-overlay" aria-hidden="true">
              {/* A sötétítés a haladással ARÁNYOS, és 50%-nál megáll: a
                  térképnek végig látszania kell alatta. */}
              <div className="finish-overlay__veil" style={{ opacity: progress * 0.5 }} />
              <div className="finish-overlay__button">
                <span className="finish-overlay__fill" style={{ width: `${percent}%` }} />
                <span className="finish-overlay__label">Befejezés</span>
                <span
                  className="finish-overlay__label finish-overlay__label--filled"
                  style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}
                >
                  Befejezés
                </span>
              </div>
              <span className="finish-overlay__hint">Tartsd nyomva</span>
            </div>,
            document.body,
          )
        : null}

      <button
        className={`dock__side dock__side--right dock__finish${
          holdingNow ? ' dock__finish--holding' : ''
        }`}
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            start();
          }
        }}
        onKeyUp={cancel}
        onBlur={cancel}
        aria-label="Befejezés — tartsd nyomva egy másodpercig"
      >
        <span className="dock__finish-fill" style={{ width: `${percent}%` }} aria-hidden="true" />
        <span className="dock__finish-label">Befejezés</span>
        <span
          className="dock__finish-label dock__finish-label--filled"
          style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}
          aria-hidden="true"
        >
          Befejezés
        </span>
      </button>
    </>
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
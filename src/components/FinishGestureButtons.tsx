import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import './Dock.css';

/**
 * A KÉTFÉLE BEFEJEZÉS-GESZTUS — Geri kérése (2026-08-27): a régi nyomva
 * tartós gomb (`HoldFinishButton`) mellé egy iPhone-os „slide to unlock"
 * stílusú húzás is választhatóvá vált (`SwipeFinishButton`). Mindkettő
 * ide, közös fájlba került, mert a `Dock` (éles használat) ÉS a
 * Beállítások képernyő (`/beallitasok/mukodes`, kipróbálható előnézet)
 * egyaránt importálja őket.
 */

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

/**
 * Elengedéskor NEM ugrik vissza nullára, hanem visszaanimál — Geri kérése
 * (2026-08-27): a hirtelen eltűnés úgy hatott, mintha a gomb elakadt volna.
 * A idő ARÁNYOS a bejárt úttal (`progress * FINISH_RELEASE_MS`): egy alig
 * megkezdett nyomásból gyors a visszafolyás, egy majdnem kész bezárásból
 * ez a teljes hossz — sosem tűnik indokolatlanul lassúnak egy koppintás után.
 */
const FINISH_RELEASE_MS = 350;

export function HoldFinishButton({
  onFinish,
  showOverlay = true,
}: {
  onFinish: () => void;
  /** `false`: a képernyő közepére kitett, teljes képernyős visszajelzés
      NEM jelenik meg — csak az önmagában is elég a kis gomb. Geri kérése
      (2026-08-27): a `/beallitasok/mukodes` kipróbáló-előnézetén az
      overlay (ami `document.body`-ba portál, tehát FÜGGETLEN attól, hol
      áll a gomb) eltakarta a lap többi részét, holott ott a lényeg maga
      a gomb viselkedése, nem a teljes rögzítés-élmény felidézése. */
  showOverlay?: boolean;
}) {
  const [progress, setProgress] = useState(0);
  const holding = useRef(false);
  const frame = useRef(0);
  const startedAt = useRef(0);
  /** A legfrissebb `progress` — a `start()`/`cancel()` zárványai ebből
      olvasnak, hogy egy visszafolyás KÖZBENI újranyomás onnan folytassa,
      ahonnan a sáv épp tart, ne nulláról induljon újra. */
  const progressRef = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function setProgressValue(value: number) {
    progressRef.current = value;
    setProgress(value);
  }

  function start() {
    if (holding.current) return;
    holding.current = true;
    cancelAnimationFrame(frame.current);
    // Ha épp visszafolyóban volt a sáv, onnan folytatja fölfelé — nem
    // nulláról indul újra.
    startedAt.current = performance.now() - progressRef.current * FINISH_HOLD_MS;

    const step = (now: number) => {
      if (!holding.current) return;
      const value = Math.min(1, (now - startedAt.current) / FINISH_HOLD_MS);
      setProgressValue(value);
      if (value >= 1) {
        holding.current = false;
        setProgressValue(0);
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

    const releaseFrom = progressRef.current;
    if (releaseFrom <= 0) {
      setProgressValue(0);
      return;
    }
    const releaseStartedAt = performance.now();
    const releaseDuration = releaseFrom * FINISH_RELEASE_MS;

    const step = (now: number) => {
      const t = Math.min(1, (now - releaseStartedAt) / releaseDuration);
      const value = releaseFrom * (1 - t);
      setProgressValue(value);
      if (t < 1) {
        frame.current = requestAnimationFrame(step);
      }
    };
    frame.current = requestAnimationFrame(step);
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
      {showOverlay && holdingNow && typeof document !== 'undefined'
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

/**
 * A HÚZÁSOS BEFEJEZÉS — „slide to unlock" mintára (Geri kérése,
 * 2026-08-27): a sávot nem tartani kell, hanem a bal szélén ülő kerek
 * fogantyút kell jobbra húzni a végéig.
 *
 * ⚠️ NINCS KÖZÉPRE KITETT VISSZAJELZÉS — szándékosan, Geri kérése szerint:
 * a húzás közben a felhasználó UJJA ALATT látja a fogantyút és a piros
 * kitöltést, nincs szükség a `HoldFinishButton` „ujj eltakarja" trükkjére.
 *
 * A piros kitöltés-animáció ugyanaz a technika, mint a nyomva tartós
 * gombnál (`.dock__finish-fill`-lel rokon `.swipe-finish__fill`): egy bal
 * oldalról induló sáv, aminek a szélessége a haladással nő.
 */
const SWIPE_COMPLETE_THRESHOLD = 0.82;

export function SwipeFinishButton({ onFinish }: { onFinish: () => void }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLButtonElement | null>(null);
  const [maxX, setMaxX] = useState(0);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number } | null>(null);

  /** A pálya hossza (sáv szélessége mínusz a fogantyú szélessége) —
      újramérve, ha a doboz mérete változik (pl. asztali/mobil váltás). */
  useLayoutEffect(() => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;
    const measure = () => setMaxX(Math.max(0, track.clientWidth - thumb.offsetWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (maxX <= 0) return;
    drag.current = { pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const track = trackRef.current;
    if (!track) return;
    const trackRect = track.getBoundingClientRect();
    const thumbWidth = thumbRef.current?.offsetWidth ?? 0;
    const x = event.clientX - trackRect.left - thumbWidth / 2;
    setProgress(Math.max(0, Math.min(1, maxX > 0 ? x / maxX : 0)));
  }

  function pointerUp() {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    setProgress((current) => {
      if (current >= SWIPE_COMPLETE_THRESHOLD) onFinish();
      return 0;
    });
  }

  const percent = progress * 100;

  return (
    <div
      ref={trackRef}
      className={`dock__side dock__side--right swipe-finish${dragging ? ' swipe-finish--dragging' : ''}`}
    >
      <span className="swipe-finish__fill" style={{ width: `${percent}%` }} aria-hidden="true" />
      <span className="swipe-finish__label" aria-hidden="true">
        Befejezés
      </span>
      {/* Kétrétegű felirat, mint a nyomva tartós gombnál — Geri kérése
          (2026-08-27): a piros kitöltés ELNYELTE a piros szöveget, ahogy a
          sáv pirosra telt. A betűk PONTOSAN ott váltanak fehérre, ahol a
          piros már alattuk van. */}
      <span
        className="swipe-finish__label swipe-finish__label--filled"
        style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}
        aria-hidden="true"
      >
        Befejezés
      </span>
      <button
        ref={thumbRef}
        type="button"
        className="swipe-finish__thumb"
        style={{
          transform: `translateX(${progress * maxX}px)`,
          // Nyugalmi állapotban NEM teli piros — Geri kérése (2026-08-27):
          // a fogantyú a húzással EGYÜTT telik pirosra, ugyanaz az elv, mint
          // a sáv kitöltésénél. Az ikon a hátérrel ellentétes irányba fut
          // (pirosból fehérbe), hogy a kontraszt a teljes úton megmaradjon.
          background: `color-mix(in srgb, var(--danger) ${Math.round(progress * 100)}%, var(--bg-elevated))`,
          color: `color-mix(in srgb, #fff ${Math.round(progress * 100)}%, var(--danger))`,
        }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        aria-label="Befejezés — húzd jobbra a sáv végéig"
      >
        <SwipeArrowIcon />
      </button>
    </div>
  );
}

function SwipeArrowIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

import { useMemo, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { formatArea, formatCellCount } from '@/lib/format';
import type { CaptureEvent, CaptureKind } from '@/lib/captureEvents';
import './territoryToast.css';

/**
 * „Grund megszerezve!" — a hurokbezárás felugró visszajelzése.
 *
 * ⚠️ PORTÁLBAN, a `body`-ba. Ugyanaz az ok, mint a „RAJT!" feliratnál
 * (`Dock.tsx`): a rögzítés képernyőjének átfedő rétegei (`.track__overlay`
 * `overflow-y: auto`, a statisztika-panel, a dokk) levágnák vagy alá
 * rétegeznék. Ez az üzenet MINDEN fölött van, öt másodpercig.
 *
 * A KONFETTI TISZTA CSS. Nem canvas és nem külső könyvtár: a rögzítés
 * képernyőjén már fut egy Mapbox WebGL kontextus, egy második rajzoló réteg
 * mellé fölösleges kockázat — a `transform`/`opacity` animációkat viszont a
 * kompozitor viszi, a fő szál terhelése nélkül. `prefers-reduced-motion`
 * mellett a darabkák egyszerűen nem készülnek el.
 */

export interface TerritoryToastProps {
  event: CaptureEvent;
  kind: CaptureKind;
  onClose: () => void;
  /** A felhasználó választott cellaszíne — a konfetti ebből is kap. */
  accentColor?: string | null;
}

const TITLE: Record<CaptureKind, string> = {
  claimed: 'Grund megszerezve!',
  stolen: 'Grund elfoglalva!',
  /**
   * HARMADIK ESET, amit a kérés nem nevesített, de a játék előállítja: a
   * bezárás ugyanazt a saját területet kerítette be újra, tehát nem szerzés
   * történt, hanem védelemnövelés. Üzenet nélkül a hang és a konfetti
   * megmagyarázatlan maradna.
   */
  reinforced: 'Grund megerősítve!',
};

export function TerritoryToast({ event, kind, onClose, accentColor }: TerritoryToastProps) {
  const pieces = useMemo(() => confettiPieces(accentColor ?? null), [accentColor]);

  const summary =
    kind === 'reinforced'
      ? `${formatCellCount(event.reinforced)} cella megerősítve`
      : `${formatArea(event.gainedAreaM2)} · ${formatCellCount(event.gainedCells)} cella`;

  return createPortal(
    <div className="tterr" role="status" aria-live="polite">
      {pieces.length > 0 ? (
        <div className="tterr__confetti" aria-hidden="true">
          {pieces.map((piece, index) => (
            <span key={index} className={piece.className} style={piece.style} />
          ))}
        </div>
      ) : null}

      <div className={`tterr__card tterr__card--${kind}`}>
        <button
          type="button"
          className="tterr__close"
          aria-label="Üzenet bezárása"
          onClick={onClose}
        >
          ✕
        </button>

        <strong className="tterr__title">{TITLE[kind]}</strong>
        <span className="tterr__summary">{summary}</span>

        {/*
          A BONTÁS csak akkor, ha tényleg többféle történt. Egy tiszta,
          negyven szabad cellás bezárásnál a „40 új" sor csak megismételné a
          fenti számot.
        */}
        <div className="tterr__chips">
          {event.stolen > 0 ? (
            <span className="tterr__chip tterr__chip--stolen">
              {formatCellCount(event.stolen)} elvéve
            </span>
          ) : null}
          {event.captured > 0 && kind !== 'claimed' ? (
            <span className="tterr__chip">{formatCellCount(event.captured)} új</span>
          ) : null}
          {event.reinforced > 0 && kind !== 'reinforced' ? (
            <span className="tterr__chip">{formatCellCount(event.reinforced)} megerősítve</span>
          ) : null}
          {event.maxed > 0 ? (
            <span className="tterr__chip tterr__chip--max">
              {formatCellCount(event.maxed)} maxon
            </span>
          ) : null}
          {event.breakthrough > 0 ? (
            <span className="tterr__chip">{formatCellCount(event.breakthrough)} áttörve</span>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Konfetti
   ═══════════════════════════════════════════════════════════════════ */

const CONFETTI_COUNT = 26;
/** Két robbanás, sugaranként ennyi szikra — ez adja a „tűzijáték" részt. */
const BURSTS = [
  { x: 30, y: 34 },
  { x: 70, y: 28 },
];
const SPARKS_PER_BURST = 10;

const FESTIVE = ['#FFD502', '#FF6000', '#01FF1F', '#2879FD', '#FF00A8', '#00E4FE'];

interface ConfettiPiece {
  className: string;
  style: CSSProperties;
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A darabkák egyszer készülnek el, eseményenként.
 *
 * Minden érték egyedi CSS-változóként megy át; az animációt a stíluslap
 * végzi. Így a React egyetlen renderrel végez, és nincs másodpercenkénti
 * újrarajzolás rögzítés közben.
 */
function confettiPieces(accentColor: string | null): ConfettiPiece[] {
  if (reducedMotion()) return [];

  const palette = accentColor ? [accentColor, accentColor, ...FESTIVE] : FESTIVE;
  const pieces: ConfettiPiece[] = [];

  for (let index = 0; index < CONFETTI_COUNT; index += 1) {
    pieces.push({
      className: 'tterr__piece',
      style: {
        '--x': `${Math.round(Math.random() * 100)}%`,
        '--drift': `${Math.round((Math.random() - 0.5) * 120)}px`,
        '--spin': `${Math.round((Math.random() - 0.5) * 1080)}deg`,
        '--delay': `${Math.round(Math.random() * 700)}ms`,
        '--duration': `${2200 + Math.round(Math.random() * 1600)}ms`,
        '--size': `${6 + Math.round(Math.random() * 6)}px`,
        '--ratio': Math.random() > 0.5 ? '1.9' : '1',
        background: palette[index % palette.length]!,
      } as CSSProperties,
    });
  }

  for (const burst of BURSTS) {
    for (let index = 0; index < SPARKS_PER_BURST; index += 1) {
      const angle = (360 / SPARKS_PER_BURST) * index + Math.random() * 12;
      pieces.push({
        className: 'tterr__spark',
        style: {
          '--x': `${burst.x}%`,
          '--y': `${burst.y}%`,
          '--angle': `${angle}deg`,
          '--distance': `${70 + Math.round(Math.random() * 70)}px`,
          '--delay': `${burst.x > 50 ? 220 : 0}ms`,
          background: palette[(index * 3) % palette.length]!,
        } as CSSProperties,
      });
    }
  }

  return pieces;
}

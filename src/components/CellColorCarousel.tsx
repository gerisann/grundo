import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { CELL_COLORS, type CellColor } from '@/lib/cellColors';
import { generateColorTerritory, type ColorTerritoryCell } from '@/lib/colorTerritory';

interface CellColorCarouselProps {
  colors: readonly CellColor[];
  active: CellColor;
  isLocked?: (color: CellColor) => boolean;
  onChoose: (color: CellColor) => void;
}

interface Burst {
  id: number;
  color: string;
  cellWidth: number;
  centerX: number;
  centerY: number;
  cells: ColorTerritoryCell[];
}

const COPIES = [0, 1, 2, 3, 4] as const;
const CENTER_COPY = 2;
const ITEM_GAP_PX = 16;

export function CellColorCarousel({
  colors,
  active,
  isLocked = () => false,
  onChoose,
}: CellColorCarouselProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const burstDelayRef = useRef<number | null>(null);
  const burstEndRef = useRef<number | null>(null);
  const burstIdRef = useRef(0);
  const alreadyCenteredSelectionRef = useRef<CellColor | null>(null);
  const [burst, setBurst] = useState<Burst | null>(null);

  useLayoutEffect(() => {
    if (alreadyCenteredSelectionRef.current === active) {
      alreadyCenteredSelectionRef.current = null;
      return;
    }
    const frame = window.requestAnimationFrame(() => centerActive(viewportRef.current, active));
    return () => window.cancelAnimationFrame(frame);
  }, [active, colors]);

  useEffect(() => () => {
    if (burstDelayRef.current !== null) window.clearTimeout(burstDelayRef.current);
    if (burstEndRef.current !== null) window.clearTimeout(burstEndRef.current);
  }, []);

  function select(event: MouseEvent<HTMLButtonElement>, color: CellColor) {
    const locked = isLocked(color);
    centerElement(viewportRef.current, event.currentTarget, reducedMotion() ? 'auto' : 'smooth');
    scheduleBurst(color, event.currentTarget.offsetWidth);

    if (locked) return;
    if (color !== active) alreadyCenteredSelectionRef.current = color;
    onChoose(color);
  }

  function scheduleBurst(color: CellColor, cellWidth: number) {
    if (burstDelayRef.current !== null) window.clearTimeout(burstDelayRef.current);
    if (burstEndRef.current !== null) window.clearTimeout(burstEndRef.current);
    setBurst(null);

    const delay = reducedMotion() ? 0 : 320;
    burstDelayRef.current = window.setTimeout(() => {
      const viewportBox = viewportRef.current?.getBoundingClientRect();
      if (!viewportBox) return;

      const next: Burst = {
        id: ++burstIdRef.current,
        color: CELL_COLORS[color].hex,
        cellWidth,
        centerX: viewportBox.left + viewportBox.width / 2,
        centerY: viewportBox.top + viewportBox.height / 2,
        cells: generateColorTerritory(),
      };
      setBurst(next);
      burstEndRef.current = window.setTimeout(() => setBurst(null), 5_000);
    }, delay);
  }

  function move(direction: -1 | 1) {
    const viewport = viewportRef.current;
    const swatch = viewport?.querySelector<HTMLElement>('[data-color-swatch]');
    if (!viewport || !swatch) return;
    viewport.scrollBy({
      left: direction * (swatch.offsetWidth + ITEM_GAP_PX),
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
  }

  return (
    <div className="ccolor__carousel">
      {burst && typeof document !== 'undefined'
        ? createPortal(<TerritoryBurst key={burst.id} burst={burst} />, document.body)
        : null}
      <button
        type="button"
        className="ccolor__arrow ccolor__arrow--left"
        aria-label="Előző színek"
        onClick={() => move(-1)}
      >
        <ArrowIcon direction="left" />
      </button>
      <div
        ref={viewportRef}
        className="ccolor__viewport"
        onScroll={(event) => normalizeInfiniteScroll(event.currentTarget, colors.length)}
        aria-label="Területszín-választó"
      >
        <div className="ccolor__track">
          {COPIES.flatMap((copy) => colors.map((color) => (
            <ColorSwatch
              key={`${copy}-${color}`}
              copy={copy}
              color={color}
              active={color === active}
              locked={isLocked(color)}
              onClick={select}
            />
          )))}
        </div>
      </div>
      <button
        type="button"
        className="ccolor__arrow ccolor__arrow--right"
        aria-label="Következő színek"
        onClick={() => move(1)}
      >
        <ArrowIcon direction="right" />
      </button>
    </div>
  );
}

function ColorSwatch({
  copy,
  color,
  active,
  locked,
  onClick,
}: {
  copy: number;
  color: CellColor;
  active: boolean;
  locked: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>, color: CellColor) => void;
}) {
  const { hex, label } = CELL_COLORS[color];
  const lockedLabel = `${label} — Pro-előnézet, előfizetéssel választható`;
  return (
    <button
      type="button"
      className={`ccolor__swatch${active ? ' ccolor__swatch--on' : ''}${locked ? ' ccolor__swatch--locked' : ''}`}
      data-color-swatch
      data-copy={copy}
      data-color={color}
      aria-pressed={active}
      aria-label={locked ? lockedLabel : label}
      title={locked ? lockedLabel : label}
      tabIndex={copy === CENTER_COPY ? 0 : -1}
      style={{ '--ccolor': hex } as CSSProperties}
      onClick={(event) => onClick(event, color)}
    >
      <span className="ccolor__fill" />
      {locked ? <span className="ccolor__lock" aria-hidden="true">PRO</span> : null}
      {active ? <span className="ccolor__check" aria-hidden="true">✓</span> : null}
    </button>
  );
}

function TerritoryBurst({ burst }: { burst: Burst }) {
  const cellHeight = burst.cellWidth * 1.1547;
  return (
    <div className="ccolor__territory" aria-hidden="true">
      {burst.cells.map((cell) => (
        <span
          key={`${cell.q},${cell.r}`}
          className="ccolor__territory-cell"
          style={{
            '--ccolor': burst.color,
            '--cell-width': `${burst.cellWidth}px`,
            '--cell-height': `${cellHeight}px`,
            '--cell-x': `${burst.centerX + burst.cellWidth * (cell.q + cell.r / 2)}px`,
            '--cell-y': `${burst.centerY + cellHeight * 0.75 * cell.r}px`,
            '--cell-delay': `${cell.delayMs}ms`,
            '--cell-duration': `${cell.durationMs}ms`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

function centerActive(viewport: HTMLDivElement | null, active: CellColor): void {
  if (!viewport) return;
  const buttons = viewport.querySelectorAll<HTMLButtonElement>('[data-color-swatch]');
  const middle = Array.from(buttons).find(
    (button) => button.dataset.copy === String(CENTER_COPY) && button.dataset.color === active,
  ) ?? Array.from(buttons).find((button) => button.dataset.copy === String(CENTER_COPY));
  if (middle) centerElement(viewport, middle, 'auto');
}

function centerElement(
  viewport: HTMLDivElement | null,
  element: HTMLElement,
  behavior: ScrollBehavior,
): void {
  if (!viewport) return;
  const viewportBox = viewport.getBoundingClientRect();
  const elementBox = element.getBoundingClientRect();
  viewport.scrollBy({
    left: elementBox.left + elementBox.width / 2 - viewportBox.left - viewportBox.width / 2,
    behavior,
  });
}

function normalizeInfiniteScroll(viewport: HTMLDivElement, colorCount: number): void {
  const swatch = viewport.querySelector<HTMLElement>('[data-color-swatch]');
  const cycleWidth = swatch ? (swatch.offsetWidth + ITEM_GAP_PX) * colorCount : 0;
  if (cycleWidth <= 0) return;

  // Öt azonos ciklusból mindig a középső három valamelyikében tartjuk a
  // viewportot. Az azonos tartalom miatt a ±2 ciklusos rebase vizuálisan
  // ugyanazt a pixelt hagyja a képernyőn, viszont soha nem érünk a valódi
  // scroll-tartomány végére. A CSS-ben nincs globális smooth scroll, ezért
  // ez az áthelyezés azonnali és láthatatlan marad swipe közben is.
  if (viewport.scrollLeft < cycleWidth * 1.25) {
    viewport.scrollLeft += cycleWidth * 2;
  } else if (viewport.scrollLeft > cycleWidth * 3.75) {
    viewport.scrollLeft -= cycleWidth * 2;
  }
}

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={direction === 'left' ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'}
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

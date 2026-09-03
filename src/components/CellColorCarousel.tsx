import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { CELL_COLORS, type CellColor } from '@/lib/cellColors';
import { generateColorTerritory, type ColorTerritoryCell } from '@/lib/colorTerritory';

interface CellColorCarouselProps {
  colors: readonly CellColor[];
  active: CellColor;
  locked: boolean;
  onChoose: (color: CellColor) => void;
}

interface Burst {
  id: number;
  color: string;
  cellWidth: number;
  cells: ColorTerritoryCell[];
}

const COPIES = [0, 1, 2] as const;
const ITEM_GAP_PX = 16;

export function CellColorCarousel({ colors, active, locked, onChoose }: CellColorCarouselProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const burstDelayRef = useRef<number | null>(null);
  const burstEndRef = useRef<number | null>(null);
  const burstIdRef = useRef(0);
  const [burst, setBurst] = useState<Burst | null>(null);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => centerActive(viewportRef.current, active));
    return () => window.cancelAnimationFrame(frame);
  }, [active, colors]);

  useEffect(() => () => {
    if (burstDelayRef.current !== null) window.clearTimeout(burstDelayRef.current);
    if (burstEndRef.current !== null) window.clearTimeout(burstEndRef.current);
  }, []);

  function select(event: MouseEvent<HTMLButtonElement>, color: CellColor) {
    if (locked) return;
    centerElement(viewportRef.current, event.currentTarget, 'smooth');
    scheduleBurst(color);
    onChoose(color);
  }

  function scheduleBurst(color: CellColor) {
    if (burstDelayRef.current !== null) window.clearTimeout(burstDelayRef.current);
    if (burstEndRef.current !== null) window.clearTimeout(burstEndRef.current);
    setBurst(null);

    const delay = reducedMotion() ? 0 : 280;
    burstDelayRef.current = window.setTimeout(() => {
      const next: Burst = {
        id: ++burstIdRef.current,
        color: CELL_COLORS[color].hex,
        cellWidth: viewportRef.current?.querySelector<HTMLElement>('[data-color-swatch]')?.offsetWidth ?? 112,
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
    viewport.scrollBy({ left: direction * (swatch.offsetWidth + ITEM_GAP_PX), behavior: 'smooth' });
  }

  return (
    <div className="ccolor__carousel">
      {burst ? <TerritoryBurst key={burst.id} burst={burst} /> : null}
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
      >
        <div className="ccolor__track">
          {COPIES.flatMap((copy) => colors.map((color) => (
            <ColorSwatch
              key={`${copy}-${color}`}
              copy={copy}
              color={color}
              active={color === active}
              locked={locked}
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
  return (
    <button
      type="button"
      className={`ccolor__swatch${active ? ' ccolor__swatch--on' : ''}${locked ? ' ccolor__swatch--locked' : ''}`}
      data-color-swatch
      data-copy={copy}
      data-color={color}
      aria-pressed={active}
      aria-disabled={locked}
      aria-label={locked ? `${label} — Pro-előfizetéssel` : label}
      title={locked ? `${label} — Pro-előfizetéssel` : label}
      style={{ '--ccolor': hex } as CSSProperties}
      onClick={(event) => onClick(event, color)}
    >
      <span className="ccolor__fill" />
      {locked ? <span className="ccolor__lock" aria-hidden="true">🔒</span> : null}
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
            '--cell-x': `${burst.cellWidth * (cell.q + cell.r / 2)}px`,
            '--cell-y': `${cellHeight * 0.75 * cell.r}px`,
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
    (button) => button.dataset.copy === '1' && button.dataset.color === active,
  ) ?? Array.from(buttons).find((button) => button.dataset.copy === '1');
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
  if (viewport.scrollLeft < cycleWidth * 0.5) viewport.scrollLeft += cycleWidth;
  if (viewport.scrollLeft > cycleWidth * 1.5) viewport.scrollLeft -= cycleWidth;
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

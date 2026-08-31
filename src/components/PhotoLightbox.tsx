import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ActivityPhoto } from '@/lib/api';
import { ActivityPhotoImage } from '@/components/ActivityPhotoImage';
import './photoLightbox.css';

/**
 * Teljes képernyős, lapozható képnézegető — az aktivitás részletezőről és a
 * feed-kártyáról is ugyanaz nyílik, hogy a viselkedés (nagyítás, lapozás,
 * lehúzva bezárás) egy helyen legyen karbantartva.
 */
export function PhotoLightbox({
  activityId,
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  activityId: string;
  photos: readonly ActivityPhoto[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const lightboxRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const pan = useRef<{
    pointerId: number;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dismissY, setDismissY] = useState(0);
  const [interacting, setInteracting] = useState(false);
  const photo = photos[index];

  function resetView() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setDismissY(0);
  }

  function changeZoom(delta: number) {
    setScale((current) => {
      const next = clampZoom(current + delta);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
    setDismissY(0);
  }

  useEffect(() => {
    resetView();
  }, [index]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') onIndexChange((index - 1 + photos.length) % photos.length);
      if (event.key === 'ArrowRight') onIndexChange((index + 1) % photos.length);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [index, onClose, onIndexChange, photos.length]);

  /**
   * A React `onWheel` figyelője passzív lehet, ezért azon belül a
   * `preventDefault()` böngészőhibát írt minden görgetésnél. A nagyításnak
   * meg kell állítania az oldal görgetését, ezért itt explicit nem passzív
   * natív figyelőt használunk.
   */
  useEffect(() => {
    const element = lightboxRef.current;
    if (!element) return;

    const wheelZoom = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      setScale((current) => {
        const next = clampZoom(current * factor);
        if (next === 1) setOffset({ x: 0, y: 0 });
        return next;
      });
      setDismissY(0);
    };

    element.addEventListener('wheel', wheelZoom, { passive: false });
    return () => element.removeEventListener('wheel', wheelZoom);
  }, []);

  if (!photo) return null;

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest('button')) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteracting(true);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) pinch.current = { distance: pointDistance(a, b), scale };
      swipe.current = null;
      pan.current = null;
      setDismissY(0);
    } else if (scale > 1) {
      pan.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        offsetX: offset.x,
        offsetY: offset.y,
      };
    } else {
      swipe.current = { x: event.clientX, y: event.clientY };
    }
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const ratio = pointDistance(a, b) / Math.max(1, pinch.current.distance);
      setScale(clampZoom(pinch.current.scale * ratio));
      return;
    }

    if (scale > 1 && pan.current?.pointerId === event.pointerId) {
      setOffset({
        x: pan.current.offsetX + event.clientX - pan.current.x,
        y: pan.current.offsetY + event.clientY - pan.current.y,
      });
      return;
    }

    if (swipe.current) setDismissY(Math.max(0, event.clientY - swipe.current.y));
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    const wasPinching = pinch.current !== null || pointers.current.size > 1;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setInteracting(false);
    pan.current = null;

    if (wasPinching || scale > 1) {
      swipe.current = null;
      setDismissY(0);
      return;
    }

    swipe.current = null;
    setDismissY(0);
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (dy > 90 && Math.abs(dy) > Math.abs(dx)) {
      onClose();
    } else if (photos.length > 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      onIndexChange(
        dx < 0 ? (index + 1) % photos.length : (index - 1 + photos.length) % photos.length,
      );
    }
  }

  function pointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) setInteracting(false);
    swipe.current = null;
    pan.current = null;
    pinch.current = null;
    setDismissY(0);
  }

  return (
    <div
      ref={lightboxRef}
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Aktivitás képei"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerCancel}
    >
      <div className="lightbox__topbar">
        <div className="lightbox__meta" aria-live="polite">
          <span className="lightbox__meta-label">Képek</span>
          <span className="lightbox__counter">{index + 1} / {photos.length}</span>
        </div>
        <button
          type="button"
          className="lightbox__control lightbox__close"
          aria-label="Képnézegető bezárása"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>

      <div
        className={[
          'lightbox__frame',
          scale > 1 ? 'lightbox__frame--zoomed' : '',
          interacting ? 'lightbox__frame--interacting' : '',
        ].filter(Boolean).join(' ')}
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y + dismissY}px, 0) scale(${scale})`,
          opacity: scale > 1 ? 1 : Math.max(0.35, 1 - dismissY / 360),
        }}
        onDoubleClick={() => (scale > 1 ? resetView() : changeZoom(1))}
      >
        <ActivityPhotoImage
          activityId={activityId}
          path={photo.path}
          loadImmediately
          alt={`Aktivitás képe, ${index + 1}/${photos.length}`}
          draggable={false}
        />
      </div>

      {photos.length > 1 ? (
        <>
          <button
            type="button"
            className="lightbox__control lightbox__nav lightbox__nav--prev"
            aria-label="Előző kép"
            onClick={() => onIndexChange((index - 1 + photos.length) % photos.length)}
          >
            <ChevronIcon direction="left" />
          </button>
          <button
            type="button"
            className="lightbox__control lightbox__nav lightbox__nav--next"
            aria-label="Következő kép"
            onClick={() => onIndexChange((index + 1) % photos.length)}
          >
            <ChevronIcon direction="right" />
          </button>
        </>
      ) : null}

      <div className="lightbox__bottom">
        <span className="lightbox__hint">
          {scale > 1 ? 'Húzd a kép mozgatásához' : 'Csippents vagy görgess a nagyításhoz'}
        </span>
        <div className="lightbox__zoom" aria-label="Nagyítás vezérlése">
          <button
            type="button"
            className="lightbox__zoom-btn"
            aria-label="Kicsinyítés"
            disabled={scale <= 1}
            onClick={() => changeZoom(-0.5)}
          >
            <MinusIcon />
          </button>
          <button
            type="button"
            className="lightbox__zoom-value"
            aria-label="Nagyítás visszaállítása"
            onClick={resetView}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            className="lightbox__zoom-btn"
            aria-label="Nagyítás"
            disabled={scale >= 4}
            onClick={() => changeZoom(0.5)}
          >
            <PlusIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function clampZoom(value: number): number {
  return Math.min(4, Math.max(1, value));
}

function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function CloseIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === 'left' ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'} />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

import { useEffect, useId, useState } from 'react';
import { api, apiConfigured } from '@/lib/api';
import './socialActions.css';

/**
 * Kedvelés és hozzászólás — a kártyán és a részletek képernyőn is ez fut.
 *
 * A kedvelés OPTIMISTA: a szív azonnal megtelik, a kérés utána megy el. Egy
 * mobilhálózaton a válasz fél másodperc is lehet, és ha addig nem történik
 * semmi, a felhasználó másodszor is megnyomja. Hiba esetén visszaállunk —
 * inkább villanjon vissza, mint hogy hazudjunk.
 */
export function LikeButton({
  activityId,
  count,
  liked,
  onChange,
}: {
  activityId: string;
  count: number;
  liked: boolean;
  onChange?: (next: { likeCount: number; likedByMe: boolean }) => void;
}) {
  const [state, setState] = useState({ count, liked });
  const [busy, setBusy] = useState(false);
  const gradientId = `heart-${useId().replace(/:/g, '')}`;

  // A szülő frissebb adatot hozhat (újratöltés, másik aktivitás) — kövessük.
  useEffect(() => setState({ count, liked }), [count, liked]);

  async function toggle() {
    if (busy || !apiConfigured) return;

    const previous = state;
    const next = { liked: !state.liked, count: state.count + (state.liked ? -1 : 1) };
    setState(next);
    setBusy(true);

    try {
      const result = await api.setLike(activityId, next.liked);
      setState({ count: result.likeCount, liked: result.likedByMe });
      onChange?.(result);
    } catch {
      setState(previous);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`social__btn social__btn--like${state.liked ? ' social__btn--on' : ''}`}
      aria-pressed={state.liked}
      aria-label={state.liked ? 'Kedvelés visszavonása' : 'Kedvelem'}
      onClick={() => void toggle()}
    >
      <HeartIcon filled={state.liked} hasLikes={state.count > 0} gradientId={gradientId} />
      <span className="social__count">{state.count}</span>
    </button>
  );
}

export function CommentButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="social__btn"
      aria-label="Hozzászólások"
      onClick={onOpen}
    >
      <CommentIcon />
      <span className="social__count">{count}</span>
    </button>
  );
}

function HeartIcon({ filled, hasLikes, gradientId }: { filled: boolean; hasLikes: boolean; gradientId: string }) {
  const color = filled ? (hasLikes ? 'var(--territory-rival)' : `url(#${gradientId})`) : 'currentColor';
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {filled && !hasLikes ? <defs>
        <linearGradient id={gradientId} x1="3" y1="4" x2="21" y2="21">
          <stop stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--territory-rival)" />
        </linearGradient>
      </defs> : null}
      <path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21.2l7.7-7.7 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.9L3 20.5l1.6-4.8A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
    </svg>
  );
}

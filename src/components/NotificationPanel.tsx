import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@/hooks/useNotifications';
import { iconFor, screenFor, type StoredNotification } from '@/lib/notificationTypes';
import { formatRelativeDay } from '@/lib/format';
import './notificationPanel.css';

/**
 * Értesítések — TELJES KÉPERNYŐS lap.
 *
 * Korábban alulról felcsúszó lap volt, a `CommentSheet` mintájára. Geri
 * kifejezetten teljes képernyőset kért helyette (2026-08-20), és jó okkal: a
 * hozzászólás-lap alatt ott marad az aktivitás, amihez tartozik, az
 * értesítés-lista viszont önálló képernyő — a mögötte átderengő Home csak
 * zajt adott hozzá, a magasságát pedig fölöslegesen korlátozta.
 *
 * docs/02-funkcionalis-spec.md → „Értesítések (kép #32): in-app lista
 * típus-ikonnal, olvasott/olvasatlan, koppintásra a célképernyőre."
 */
export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const {
    items,
    unreadCount,
    loading,
    hasMore,
    loadMore,
    markRead,
    markAllRead,
    remove,
    removeAll,
  } = useNotifications();
  /** A „mindet törlöm" visszavonhatatlan, ezért kétlépcsős. */
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function open(notification: StoredNotification) {
    markRead(notification.id);
    onClose();
    navigate(screenFor(notification));
  }

  return (
    <div className="npanel" role="dialog" aria-modal="true" aria-label="Értesítések">
      <header className="npanel__head">
        <h2 className="npanel__title">Értesítések</h2>

        <div className="npanel__tools">
          <button
            type="button"
            className="npanel__tool"
            aria-label="Összes értesítés törlése"
            title="Összes törlése"
            disabled={items.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            <TrashIcon />
          </button>
          <button
            type="button"
            className="npanel__tool"
            aria-label="Összes megjelölése olvasottként"
            title="Mind olvasott"
            disabled={unreadCount === 0}
            onClick={markAllRead}
          >
            <EnvelopeOpenIcon />
          </button>
          <button
            type="button"
            className="npanel__tool npanel__tool--close"
            aria-label="Bezárás"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      {confirmClear ? (
        <div className="npanel__confirm" role="alertdialog" aria-label="Összes törlése">
          <span>Törlöd az összes értesítést? Ez nem vonható vissza.</span>
          <span className="npanel__confirm-actions">
            <button
              type="button"
              className="npanel__confirm-btn"
              onClick={() => setConfirmClear(false)}
            >
              Mégse
            </button>
            <button
              type="button"
              className="npanel__confirm-btn npanel__confirm-btn--danger"
              onClick={() => {
                setConfirmClear(false);
                void removeAll();
              }}
            >
              Törlöm
            </button>
          </span>
        </div>
      ) : null}

      <div className="npanel__list">
        {loading ? (
          <p className="npanel__note">Betöltés…</p>
        ) : items.length === 0 ? (
          <p className="npanel__note">Még nincs értesítésed.</p>
        ) : (
          <>
            {items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                onOpen={open}
                onRead={markRead}
                onDelete={remove}
              />
            ))}

            {hasMore ? (
              <button type="button" className="npanel__more" onClick={loadMore}>
                További értesítések betöltése
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Egy sor, húzható kártyával ───────────────────────────────────────── */

/**
 * A húzás mechanikája.
 *
 * BALRA = OLVASOTT, JOBBRA = TÖRLÉS. A kártya MÖGÖTT bal szélen a kuka, jobb
 * szélen a nyitott boríték áll — vagyis mindig az az ikon bukkan elő, amelyik
 * művelet a húzás végén megtörténik.
 *
 * A `Pointer` eseményekkel megy, nem `Touch`-csal: így ugyanaz a kód szolgálja
 * ki az ujjat és az egeret, tehát PC-n is húzható a kártya.
 */

/** Eddig még koppintás, nem húzás — enélkül nyitás közben elcsúszna a kártya. */
const DRAG_START_PX = 8;
/** A művelet a kártya szélességének felénél kap el. */
const COMMIT_RATIO = 0.5;
/** Gyors pöccintésnél ennyi is elég… */
const FLICK_RATIO = 0.25;
/** …ha a mozdulat ennél rövidebb ideig tartott. */
const FLICK_MS = 300;
/** A kicsúszó kártya animációja — ennyi után hívjuk a törlést. */
const LEAVE_MS = 180;

interface Gesture {
  id: number;
  x: number;
  y: number;
  at: number;
  width: number;
  /** Amíg `?`, még nem dőlt el, hogy a lista görgetése vagy a sor húzása. */
  axis: '?' | 'x' | 'y';
}

function NotificationRow({
  item,
  onOpen,
  onRead,
  onDelete,
}: {
  item: StoredNotification;
  onOpen: (item: StoredNotification) => void;
  onRead: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const card = useRef<HTMLButtonElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  /** A koppintás és a húzás ugyanazzal az eseménnyel indul — ez választja szét. */
  const dragged = useRef(false);
  const [dx, setDx] = useState(0);
  /*
    ⚠️ AZ ELMOZDULÁS REFBEN IS BENNE VAN, nem csak állapotban.

    A `pointerup` kezelője a saját renderelésének a lezárásából olvasná a
    `dx`-et — ha a mozdulat és az elengedés UGYANABBA a feldolgozási körbe
    esik (gyors pöccintés, automatizált ellenőrzés), a React még nem
    rajzolt újra, tehát ott a RÉGI érték állna: nulla. Mérve is így volt:
    a kártyát 220 pixellel elhúzva sem történt semmi. A megjelenítéshez
    az állapot kell (attól mozdul a kártya), a döntéshez a ref.
  */
  const dxNow = useRef(0);
  const [snapping, setSnapping] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => onDelete(item.id), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, item.id, onDelete]);

  function down(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: Date.now(),
      width: card.current?.offsetWidth ?? 320,
      axis: '?',
    };
    dragged.current = false;
    setSnapping(false);
  }

  function move(event: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    const moveX = event.clientX - g.x;
    const moveY = event.clientY - g.y;

    if (g.axis === '?') {
      if (Math.abs(moveX) < DRAG_START_PX && Math.abs(moveY) < DRAG_START_PX) return;
      /*
        AZ ELSŐ NYOLC PIXEL DÖNT. Ha a mozdulat inkább függőleges, a lista
        görgetéséé — a sor meg sem mozdul. Enélkül görgetés közben oldalra
        ugrálnának a kártyák.
      */
      g.axis = Math.abs(moveX) > Math.abs(moveY) ? 'x' : 'y';
      if (g.axis === 'x') {
        /*
          A mutató elfogása ATTÓL FÜGG, hogy az adott mutató még aktív-e. Ha
          közben elengedték (vagy a húzást nem valódi ujj/egér indította,
          hanem egy automatizált ellenőrzés), a hívás dob — és a kivétel a
          húzás közepén hagyná a kártyát. A húzás enélkül is megy, csak a
          sor széléről kifutva megszakad.
        */
        try {
          card.current?.setPointerCapture(event.pointerId);
        } catch {
          /* nem baj: elfogás nélkül is végigvihető a mozdulat */
        }
        dragged.current = true;
      }
    }
    if (g.axis !== 'x') return;

    // Olvasott sornál a balra húzásnak nincs értelme: nem is enged elmozdulni.
    const next = item.read ? Math.max(0, moveX) : moveX;
    dxNow.current = next;
    setDx(next);
  }

  function up(event: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.id !== event.pointerId || g.axis !== 'x') return;

    const flick = Date.now() - g.at < FLICK_MS;
    const needed = g.width * (flick ? FLICK_RATIO : COMMIT_RATIO);
    const moved = dxNow.current;

    if (moved >= needed) {
      setLeaving(true);
      return;
    }
    if (moved <= -needed && !item.read) {
      onRead(item.id);
    }
    setSnapping(true);
    dxNow.current = 0;
    setDx(0);
  }

  const revealing = dx !== 0 || leaving;

  return (
    <div className={`nrow${leaving ? ' nrow--leaving' : ''}`}>
      {/*
        A HÁTTÉR-IKONOK a kártya MÖGÖTT ülnek: a bal szélen a kuka (jobbra
        húzva ez lesz), a jobb szélen a nyitott boríték (balra húzva ez).
        Egérrel a sor fölé érve is előbukkannak — PC-n enélkül semmi nem
        árulná el, hogy a kártya húzható.
      */}
      <div className={`nrow__behind${revealing ? ' nrow__behind--open' : ''}`} aria-hidden="true">
        <span className="nrow__behind-icon nrow__behind-icon--delete">
          <TrashIcon />
        </span>
        {!item.read ? (
          <span className="nrow__behind-icon nrow__behind-icon--read">
            <EnvelopeOpenIcon />
          </span>
        ) : null}
      </div>

      <button
        ref={card}
        type="button"
        className={`nrow__card${item.read ? '' : ' nrow__card--unread'}${
          snapping ? ' nrow__card--snap' : ''
        }`}
        style={{ transform: leaving ? 'translateX(110%)' : `translateX(${dx}px)` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={() => {
          // Húzás után nem nyitunk: a mozdulat a törlésé vagy az olvasotté volt.
          if (dragged.current) return;
          onOpen(item);
        }}
      >
        <span className="nrow__icon" aria-hidden="true">
          {iconFor(item.type)}
        </span>
        <span className="nrow__text">
          <span className="nrow__title">{item.title}</span>
          {item.body ? <span className="nrow__body">{item.body}</span> : null}
          <span className="nrow__when">{formatRelativeDay(item.createdAt)}</span>
        </span>
        {!item.read ? <span className="nrow__dot" aria-hidden="true" /> : null}
      </button>
    </div>
  );
}

/* ── Ikonok ───────────────────────────────────────────────────────────── */

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M10 4h4M9 7v12M15 7v12M6 7l1 13h10l1-13" />
    </svg>
  );
}

function EnvelopeOpenIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10.5 12 4l9 6.5V20H3z" />
      <path d="M3 10.5 12 16l9-5.5" />
    </svg>
  );
}

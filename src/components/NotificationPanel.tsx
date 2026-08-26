import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@/hooks/useNotifications';
import {
  NOTIFICATION_TYPES,
  screenFor,
  type NotificationType,
  type StoredNotification,
} from '@/lib/notificationTypes';
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
/**
 * A kártya ENNYIT mozdulhat el, se többet.
 *
 * A Gmail is így viselkedik: a kártya csak megbillen, a színes háttér pedig
 * a mozdulat mértékével erősödik. Korábban a kártya az ujjat követte a
 * képernyő széléig, ami két bajjal járt — a sor alatti tartalom kilátszott,
 * és a művelet küszöbe a kártya szélességéhez volt kötve.
 */
const MAX_DRAG_PX = 120;
/**
 * Elengedéskor ennél nagyobb elmozdulás indítja a műveletet.
 *
 * ⚠️ EZ NEM LEHET A KÁRTYA SZÉLESSÉGÉHEZ KÖTVE. Korábban a felénél kapott
 * el (`width * 0.5`), ami egy 320 pixeles kártyánál 160 px — a 60 pixeles
 * plafon mellett ez SOHA nem teljesülne, tehát se törölni, se olvasottra
 * állítani nem lehetne húzással. A küszöb ezért a plafonhoz igazodik.
 */
const COMMIT_PX = 84;
/** Gyors pöccintésnél ennyi is elég… */
const FLICK_PX = 48;
/** …ha a mozdulat ennél rövidebb ideig tartott. */
const FLICK_MS = 300;
/** A kicsúszó kártya animációja — ennyi után hívjuk a törlést. */
const LEAVE_MS = 180;
const READ_MS = 180;

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
  const [reading, setReading] = useState(false);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => onDelete(item.id), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, item.id, onDelete]);

  useEffect(() => {
    if (!reading) return;
    const timer = window.setTimeout(() => {
      onRead(item.id);
      // Az olvasott státusz lokálisan azonnal frissül, de a sor komponense
      // ugyanazzal az id-val a listában marad. Ezt kötelezően nullázzuk,
      // különben a zöld háttér a kicsúszott kártya mögött beragad.
      setReading(false);
      setSnapping(false);
      dxNow.current = 0;
      setDx(0);
    }, READ_MS);
    return () => window.clearTimeout(timer);
  }, [reading, item.id, onRead]);

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
    const raw = item.read ? Math.max(0, moveX) : moveX;
    // A plafon a Gmail-érzés lényege: a kártya megbillen, nem elúszik.
    const next = Math.max(-MAX_DRAG_PX, Math.min(MAX_DRAG_PX, raw));
    dxNow.current = next;
    setDx(next);
  }

  function up(event: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.id !== event.pointerId || g.axis !== 'x') return;

    const flick = Date.now() - g.at < FLICK_MS;
    const needed = flick ? FLICK_PX : COMMIT_PX;
    const moved = dxNow.current;

    if (moved >= needed) {
      setLeaving(true);
      return;
    }
    if (moved <= -needed && !item.read) {
      setReading(true);
    }
    setSnapping(true);
    dxNow.current = 0;
    setDx(0);
  }

  /**
   * A SZÍN ERŐSSÉGE a mozdulat mértékéből jön — ez a Gmail-érzés lényege.
   *
   * Nem ki-be kapcsol: ahogy húzod, úgy telítődik a háttér. Elengedve
   * visszahalványul, mert a `dx` nullázódik.
   */
  const progress = Math.min(1, Math.abs(dx) / MAX_DRAG_PX);
  /** Jobbra húzva törlés (piros), balra olvasott (zöld). */
  const direction = leaving ? 'delete' : reading ? 'read' : dx > 0 ? 'delete' : dx < 0 ? 'read' : null;

  return (
    <div className={`nrow${leaving ? ' nrow--leaving' : ''}${reading ? ' nrow--reading' : ''}`}>
      {/*
        A HÁTTÉR a kártya mögött, TELJES felületen — nem egy ikon mögötti
        folt. A színátmenet abból a szélből indul, amelyik felől a mozdulat
        érkezik: jobbra húzva balról pirosodik, balra húzva jobbról zöldül.

        Az ikon színe SZÁNDÉKOSAN az alkalmazás alap háttérszíne: így úgy
        néz ki, mintha ki lenne vágva a színes felületből — pontosan úgy,
        ahogy a Gmail csinálja.
      */}
      <div
        className={`nrow__behind${direction ? ` nrow__behind--${direction}` : ''}`}
        style={{ opacity: leaving || reading ? 1 : progress }}
        aria-hidden="true"
      >
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
        style={{ transform: leaving ? 'translateX(110%)' : reading ? 'translateX(-110%)' : `translateX(${dx}px)` }}
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
        <span className={`nrow__icon nrow__icon--${toneFor(item.type)}`} aria-hidden="true">
          {typeIcon(item.type)}
        </span>
        {/*
          HÁROM SOR, MINDIG (Geri, 2026-08-26). A középső sor akkor is ott
          van, ha üres — enélkül a `body` nélküli értesítések alacsonyabbak
          lennének, és a lista lépcsőzne. A magasságot a CSS rögzíti, nem ez
          a szerkezet: itt csak annyi a dolgunk, hogy a három sor MINDIG
          kikerüljön.
        */}
        <span className="nrow__text">
          <span className="nrow__title">{item.title}</span>
          <span className="nrow__body">{middleLine(item)}</span>
          <span className="nrow__when">{formatRelativeDay(item.createdAt)}</span>
        </span>
        {!item.read ? <span className="nrow__dot" aria-hidden="true" /> : null}
      </button>
    </div>
  );
}

/**
 * A KÖZÉPSŐ SOR — minden értesítésnél kitöltve.
 *
 * Az aktivitáshoz kötődő értesítéseknél (kedvelés, követett felhasználó
 * aktivitása) ez az AKTIVITÁS NEVE: a cím már megmondta, KI és MIT csinált,
 * a hasznos többlet az, hogy MELYIK aktivitásról van szó. A nevet a szerver
 * küldi (`body`, illetve `data.activityTitle`).
 *
 * ⚠️ A RÉGI ÉRTESÍTÉSEKEN NINCS MEG. Azok a mező bevezetése előtt keletkeztek,
 * és visszamenőleg nem töltjük fel — ehhez minden korábbi értesítéshez ki
 * kellene olvasni a hozzá tartozó aktivitást. Ilyenkor a típus általános
 * felirata áll ott: nem mond újat, de a sor magassága stimmel, és nem
 * hazudik sem.
 */
function middleLine(item: StoredNotification): string {
  if (item.body) return item.body;
  const title = item.data?.activityTitle;
  if (title) return title;
  return NOTIFICATION_TYPES[item.type].label;
}

/* ── Típusikonok ──────────────────────────────────────────────────────── */

/**
 * Egyszínű flat ikon + szín típusonként — az emoji-kavalkád helyett.
 *
 * A színek a meglévő tokenkészletből jönnek (nincs új CSS-változó): a
 * jelentéshez illő, de visszafogott árnyalatok, ugyanazok a `--tier-*`,
 * `--weather-*`, `--danger`/`--success` értékek, amiket a jelvények és az
 * időjárás-widget is használ — így a lista nem hoz be egy harmadik palettát.
 */
function toneFor(type: NotificationType): string {
  switch (type) {
    case 'territory_stolen':
      return 'stolen';
    case 'territory_defended':
      return 'defended';
    case 'gp_activity':
    case 'gp_daily':
      return 'gp';
    case 'badge_awarded':
      return 'badge';
    case 'activity_liked':
      return 'like';
    case 'activity_commented':
    case 'comment_replied':
      return 'comment';
    case 'followed_activity':
    case 'new_follower':
      return 'social';
    case 'modifier_started':
      return 'modifier';
  }
}

function typeIcon(type: NotificationType) {
  switch (type) {
    case 'territory_stolen':
      return <ShieldAlertIcon />;
    case 'territory_defended':
      return <ShieldCheckIcon />;
    case 'gp_activity':
    case 'gp_daily':
      return <BoltIcon />;
    case 'badge_awarded':
      return <BadgeIcon />;
    case 'activity_liked':
      return <HeartIcon />;
    case 'activity_commented':
    case 'comment_replied':
      return <ChatIcon />;
    case 'followed_activity':
      return <RunnerIcon />;
    case 'new_follower':
      return <PersonAddIcon />;
    case 'modifier_started':
      return <MegaphoneIcon />;
  }
}

const typeIconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

function ShieldAlertIcon() {
  return (
    <svg {...typeIconProps}>
      <path d="M12 3.5 5 6.2v5.3c0 4.8 3 7.9 7 9 4-1.1 7-4.2 7-9V6.2L12 3.5Z" />
      <path d="M12 8.5v4.2M12 16v.01" />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg {...typeIconProps}>
      <path d="M12 3.5 5 6.2v5.3c0 4.8 3 7.9 7 9 4-1.1 7-4.2 7-9V6.2L12 3.5Z" />
      <path d="M9 12.3l2 2 4-4.3" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg {...typeIconProps}>
      <path d="M12.5 3 5 13.5h5.5L11 21l7.5-10.5H13L12.5 3Z" />
    </svg>
  );
}

function BadgeIcon() {
  return (
    <svg {...typeIconProps}>
      <circle cx="12" cy="9" r="5.5" />
      <path d="M9 13.5 7.5 21l4.5-2.3 4.5 2.3-1.5-7.5" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg {...typeIconProps}>
      <path d="M12 20s-7.5-4.7-9.5-9.4C1 6.9 3 4 6.3 4c1.9 0 3.4 1 5.7 3.3C14.3 5 15.8 4 17.7 4 21 4 23 6.9 21.5 10.6 19.5 15.3 12 20 12 20Z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg {...typeIconProps}>
      <path d="M4 5.5h16v10.5H9l-4 3.5V16H4V5.5Z" />
    </svg>
  );
}

function RunnerIcon() {
  return (
    <svg {...typeIconProps}>
      <circle cx="14.5" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
      <path d="M9 21l2.4-4.8-2-2 1.4-4.4 3 2.4 3.6 1M6 13.5l3-2.5 2 1.8" />
    </svg>
  );
}

function PersonAddIcon() {
  return (
    <svg {...typeIconProps}>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M18 8v5M15.5 10.5h5" />
    </svg>
  );
}

function MegaphoneIcon() {
  return (
    <svg {...typeIconProps}>
      <path d="M3 10.5v3l4 1v4.5a1.5 1.5 0 0 0 3 0v-3.7l8 2.7v-11l-8 2.7-4 1H3Z" />
      <path d="M18 8.5a4 4 0 0 1 0 7" />
    </svg>
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

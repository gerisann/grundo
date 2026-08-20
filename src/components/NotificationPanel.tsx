import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@/hooks/useNotifications';
import { iconFor, screenFor, type StoredNotification } from '@/lib/notificationTypes';
import { formatRelativeDay } from '@/lib/format';
import './notificationPanel.css';

/**
 * Értesítések — alulról felcsúszó lap, a `CommentSheet` mintájára (azonos
 * ok: a lista a hüvelykujj alatt legyen, ne egy középre helyezett ablakban).
 *
 * docs/02-funkcionalis-spec.md → „Értesítések (kép #32): in-app lista
 * típus-ikonnal, olvasott/olvasatlan, koppintásra a célképernyőre."
 */
export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { items, unreadCount, loading, markRead, markAllRead } = useNotifications();

  function open(notification: StoredNotification) {
    markRead(notification.id);
    onClose();
    navigate(screenFor(notification));
  }

  return (
    <div className="npanel" role="dialog" aria-modal="true" aria-label="Értesítések">
      <button type="button" className="npanel__scrim" aria-label="Bezárás" onClick={onClose} />

      <div className="npanel__sheet">
        <header className="npanel__head">
          <span className="npanel__grip" aria-hidden="true" />
          <h2 className="npanel__title">Értesítések</h2>
          {unreadCount > 0 ? (
            <button type="button" className="npanel__markall" onClick={markAllRead}>
              Mind olvasott
            </button>
          ) : null}
          <button type="button" className="npanel__close" aria-label="Bezárás" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="npanel__list">
          {loading ? (
            <p className="npanel__note">Betöltés…</p>
          ) : items.length === 0 ? (
            <p className="npanel__note">Még nincs értesítésed.</p>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`npanel__row${item.read ? '' : ' npanel__row--unread'}`}
                onClick={() => open(item)}
              >
                <span className="npanel__icon" aria-hidden="true">
                  {iconFor(item.type)}
                </span>
                <span className="npanel__text">
                  <span className="npanel__row-title">{item.title}</span>
                  {item.body ? <span className="npanel__row-body">{item.body}</span> : null}
                  <span className="npanel__row-when">{formatRelativeDay(item.createdAt)}</span>
                </span>
                {!item.read ? <span className="npanel__dot" aria-hidden="true" /> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

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

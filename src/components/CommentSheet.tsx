import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ActivityCard';
import { useProfile } from '@/hooks/ProfileProvider';
import { api, apiConfigured, type ActivityComment } from '@/lib/api';
import { formatRelativeDay } from '@/lib/format';
import './commentSheet.css';

/**
 * Hozzászólások — alulról felcsúszó lap.
 *
 * MIÉRT ALULRÓL, és miért nem középre igazított párbeszédablak? Mert a beviteli
 * mező a lap alján van, közvetlenül a hüvelykujj alatt, és a billentyűzet
 * fölött. Egy középre helyezett ablakban a mező a képernyő közepére kerülne, a
 * feljövő billentyűzet pedig kitakarná.
 *
 * A lista a LEGRÉGEBBIVEL kezdődik és a legfrissebbre görget: egy beszélgetés
 * fordított sorrendben olvashatatlan.
 */

/** Gyorsválasztó — sportos visszajelzésre való jelek, nem teljes emoji-tár. */
const EMOJI = [
  '👍', '❤️', '🔥', '💪', '👏', '🎉',
  '😀', '😅', '😍', '🤩', '😮', '🙌',
  '🏃', '🚴', '🚶', '🏔️', '⚡', '🥇',
  '😂', '🤝', '🫡', '🧠', '☀️', '🌧️',
];

export function CommentSheet({
  activityId,
  highlightCommentId = null,
  onClose,
  onCountChange,
}: {
  activityId: string;
  /** Egy értesítésről érkezve: erre a sorra görgetünk és kiemeljük. */
  highlightCommentId?: string | null;
  onClose: () => void;
  onCountChange?: (count: number) => void;
}) {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const [comments, setComments] = useState<ActivityComment[] | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!apiConfigured) {
      setComments([]);
      return;
    }
    let alive = true;
    api
      .comments(activityId)
      .then((result) => {
        if (alive) setComments(result.comments);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Nem sikerült betölteni.');
      });
    return () => {
      alive = false;
    };
  }, [activityId]);

  /**
   * Görgetés: alapból az aljára (oda érkezett az új sor), DE ha értesítésről
   * jöttünk, a KIEMELT hozzászóláshoz.
   *
   * A kiemelt sorhoz görgetés nyer, mert a felhasználó épp azt kereste — az
   * aljára ugrás elvinné róla a szemét.
   */
  useEffect(() => {
    const list = listRef.current;
    if (!list || comments === null) return;
    if (highlightCommentId) {
      const target = list.querySelector(`[data-comment-id="${CSS.escape(highlightCommentId)}"]`);
      if (target) {
        target.scrollIntoView({ block: 'center' });
        return;
      }
    }
    list.scrollTop = list.scrollHeight;
  }, [comments, highlightCommentId]);

  // Escape zárja a lapot, és alatta ne görögjön az oldal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function send() {
    const value = text.trim();
    if (value.length === 0 || sending || !apiConfigured) return;

    setSending(true);
    setError('');
    try {
      const created = await api.addComment(activityId, value, replyTo?.id);
      /**
       * A választ a LISTÁHOZ FŰZZÜK, nem töltjük újra az egészet.
       *
       * Az újratöltés egy fél másodperces üres állapotot villantana, és a
       * lista visszaugrana a tetejére — pont amikor a felhasználó a saját
       * mondatát keresné.
       */
      setComments((current) => {
        const next = [
          ...(current ?? []),
          {
            id: created.id,
            text: created.text,
            createdAt: created.createdAt,
            mine: true,
            replyToId: created.replyToId,
            replyToUsername: created.replyToUsername,
            /**
             * Az optimista sor is a már betöltött GRUNDO-profilt használja.
             * Korábban itt egy "Te" nevű ideiglenes szerző szerepelt, ezért
             * csak a kommentlap újranyitása után jelent meg a valódi név és kép.
             */
            author: {
              username: profile?.username ?? 'ismeretlen',
              photoURL: profile?.photoURL ?? null,
            },
          },
        ];
        onCountChange?.(next.length);
        return next;
      });
      setText('');
      setEmojiOpen(false);
      setReplyTo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'A hozzászólás nem ment el.');
    } finally {
      setSending(false);
    }
  }

  async function remove(commentId: string) {
    try {
      await api.deleteComment(activityId, commentId);
      setComments((current) => {
        const next = (current ?? []).filter((comment) => comment.id !== commentId);
        onCountChange?.(next.length);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'A törlés nem sikerült.');
    }
  }

  function insertEmoji(emoji: string) {
    setText((current) => current + emoji);
    inputRef.current?.focus();
  }

  return (
    <div className="csheet" role="dialog" aria-modal="true" aria-label="Hozzászólások">
      {/* A háttérre koppintás zár — a lap alatti tartalom így nem csapda. */}
      <button type="button" className="csheet__scrim" aria-label="Bezárás" onClick={onClose} />

      <div className="csheet__panel">
        <header className="csheet__head">
          <span className="csheet__grip" aria-hidden="true" />
          <h2 className="csheet__title">
            Hozzászólások{comments ? ` (${comments.length})` : ''}
          </h2>
          <button type="button" className="csheet__close" aria-label="Bezárás" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="csheet__list" ref={listRef}>
          {comments === null ? (
            <p className="csheet__note">Betöltés…</p>
          ) : comments.length === 0 ? (
            <p className="csheet__note">
              Még nincs hozzászólás. Legyél te az első.
            </p>
          ) : (
            comments.map((comment) => (
              <div
                key={comment.id}
                data-comment-id={comment.id}
                className={[
                  'csheet__row',
                  comment.mine ? 'csheet__row--mine' : '',
                  comment.id === highlightCommentId ? 'csheet__row--highlight' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <button
                  type="button"
                  className="csheet__avatar"
                  onClick={() => {
                    onClose();
                    navigate(`/felhasznalo/${encodeURIComponent(comment.author.username)}`);
                  }}
                  aria-label={`${comment.author.username} profiljának megnyitása`}
                >
                  <Avatar url={comment.author.photoURL} name={comment.author.username} size={32} />
                </button>
                <div
                  className={`csheet__bubble${comment.mine ? ' csheet__bubble--mine' : ''}`}
                >
                  {comment.mine ? (
                    <button
                      type="button"
                      className="csheet__del"
                      aria-label="Hozzászólás törlése"
                      onClick={() => void remove(comment.id)}
                    >
                      <CloseIcon />
                    </button>
                  ) : null}
                  <div className="csheet__meta">
                    <button
                      type="button"
                      className="csheet__author"
                      onClick={() => {
                        onClose();
                        navigate(`/felhasznalo/${encodeURIComponent(comment.author.username)}`);
                      }}
                    >
                      {comment.author.username}
                    </button>
                    <span className="csheet__when">{formatRelativeDay(comment.createdAt)}</span>
                  </div>
                  {comment.replyToUsername ? (
                    <span className="csheet__replyto">
                      <ReplyIcon /> Válasz — {comment.replyToUsername}
                    </span>
                  ) : null}
                  <p className="csheet__text">{comment.text}</p>
                  <button
                    type="button"
                    className="csheet__reply-btn"
                    onClick={() => {
                      setReplyTo({ id: comment.id, username: comment.author.username });
                      inputRef.current?.focus();
                    }}
                  >
                    Válasz
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {error ? (
          <p className="csheet__error" role="alert">
            {error}
          </p>
        ) : null}

        {emojiOpen ? (
          <div className="csheet__emoji" role="group" aria-label="Emoji választó">
            {EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="csheet__emoji-btn"
                onClick={() => insertEmoji(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}

        {replyTo ? (
          <div className="csheet__replying">
            <span>
              Válasz — <strong>{replyTo.username}</strong>
            </span>
            <button
              type="button"
              className="csheet__replying-cancel"
              aria-label="Válasz megszakítása"
              onClick={() => setReplyTo(null)}
            >
              <CloseIcon />
            </button>
          </div>
        ) : null}

        <div className="csheet__compose">
          <textarea
            ref={inputRef}
            className="csheet__input"
            rows={1}
            placeholder="Aa"
            value={text}
            maxLength={1000}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Enter küld, Shift+Enter új sor — ahogy minden üzenetküldőben.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            className={`csheet__emoji-toggle${emojiOpen ? ' csheet__emoji-toggle--on' : ''}`}
            aria-label="Emoji"
            aria-expanded={emojiOpen}
            onClick={() => setEmojiOpen((open) => !open)}
          >
            <SmileIcon />
          </button>
          <button
            type="button"
            className="csheet__send"
            aria-label="Küldés"
            disabled={text.trim().length === 0 || sending}
            onClick={() => void send()}
          >
            <SendIcon />
          </button>
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

function ReplyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 17 4 12l5-5" />
      <path d="M4 12h10a6 6 0 0 1 6 6v1" />
    </svg>
  );
}

function SmileIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
      <circle cx="9" cy="10" r="0.6" fill="currentColor" />
      <circle cx="15" cy="10" r="0.6" fill="currentColor" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12l16-8-6 8 6 8z" />
    </svg>
  );
}

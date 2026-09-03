import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/ActivityCard';
import { Button, SegmentedControl } from '@/components/ui';
import { useAuth } from '@/hooks/AuthProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import { api, ApiError, type BandaPost } from '@/lib/api';
import { BandaPostContent, formatBandaTimestamp } from '@/lib/bandaContent';
import {
  deleteBandaFeedImage,
  MAX_BANDA_FEED_IMAGE_BYTES,
  PhotoError,
  uploadBandaFeedImage,
} from '@/lib/photos';
import './bandaFeedWall.css';

const POST_MAX = 1000;

/** Hírfolyam / chat fal váltó. A beviteli sáv fix, a tartalomlista görgül. */
export function BandaFeedWall({ bandaId, canPostFeed }: { bandaId: string; canPostFeed: boolean }) {
  const [tab, setTab] = useState<'feed' | 'wall'>('feed');

  return (
    <section className="stack">
      <SegmentedControl
        label="Hírfolyam vagy chat fal"
        options={[
          { value: 'feed', label: 'Hírfolyam' },
          { value: 'wall', label: 'Chat fal' },
        ]}
        value={tab}
        onChange={setTab}
        block
      />
      {tab === 'feed' ? (
        <BandaPostBoard
          key="feed"
          bandaId={bandaId}
          kind="feed"
          canPost={canPostFeed}
          placeholder="Mi újság a bandában?"
          emptyText="Még nincs poszt a hírfolyamban."
          deniedText="Ebben a bandában a beállítás szerint most nem te posztolhatsz a hírfolyamba."
        />
      ) : (
        <BandaPostBoard
          key="wall"
          bandaId={bandaId}
          kind="wall"
          canPost
          placeholder="Üzenet a falra"
          emptyText="Még nincs üzenet a falon."
          deniedText=""
        />
      )}
    </section>
  );
}

function BandaPostBoard({
  bandaId,
  kind,
  canPost,
  placeholder,
  emptyText,
  deniedText,
}: {
  bandaId: string;
  kind: 'feed' | 'wall';
  canPost: boolean;
  placeholder: string;
  emptyText: string;
  deniedText: string;
}) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<BandaPost[] | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  function load() {
    return (kind === 'feed' ? api.bandas.feed(bandaId) : api.bandas.wall(bandaId))
      .then((result) => result.items)
      .catch((problem: unknown) => {
        setError(problem instanceof ApiError ? problem.message : 'Most nem tölthető be.');
        return [] as BandaPost[];
      });
  }

  useEffect(() => {
    let alive = true;
    setItems(null);
    setError('');
    load().then((result) => {
      if (alive) setItems(result);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandaId, kind]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    let uploadedPath: string | null = null;
    try {
      if (kind === 'feed' && imageFile) {
        if (!user) throw new PhotoError('Jelentkezz be a kép feltöltéséhez.');
        uploadedPath = await uploadBandaFeedImage(imageFile, user.uid, bandaId);
      }
      if (kind === 'feed') await api.bandas.postToFeed(bandaId, trimmed, uploadedPath ?? undefined);
      else await api.bandas.postToWall(bandaId, trimmed);
      setText('');
      setImageFile(null);
      setItems(await load());
      setNow(Date.now());
    } catch (problem) {
      if (uploadedPath) void deleteBandaFeedImage(uploadedPath).catch(() => undefined);
      setError(problem instanceof Error ? problem.message : 'Most nem sikerült elküldeni.');
    } finally {
      setBusy(false);
    }
  }

  function replaceSelection(replacer: (selected: string) => { value: string; cursorOffset: number }) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const replacement = replacer(text.slice(start, end));
    const next = text.slice(0, start) + replacement.value + text.slice(end);
    if (next.length > POST_MAX) return;
    setText(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + replacement.cursorOffset;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function wrapSelection(before: string, after = before) {
    replaceSelection((selected) => ({
      value: `${before}${selected}${after}`,
      cursorOffset: before.length + selected.length,
    }));
  }

  function prefixLines(kindOfPrefix: 'bullet' | 'ordered' | 'quote') {
    replaceSelection((selected) => {
      if (!selected) {
        const value = kindOfPrefix === 'ordered' ? '1. ' : kindOfPrefix === 'bullet' ? '- ' : '> ';
        return { value, cursorOffset: value.length };
      }
      const source = selected;
      const value = source.split('\n').map((line, index) => {
        if (kindOfPrefix === 'bullet') return `- ${line}`;
        if (kindOfPrefix === 'ordered') return `${index + 1}. ${line}`;
        return `> ${line}`;
      }).join('\n');
      return { value, cursorOffset: value.length };
    });
  }

  function insertLink() {
    const href = window.prompt('Link címe (https://…):', 'https://');
    if (!href) return;
    try {
      const url = new URL(href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
      replaceSelection((selected) => {
        const label = selected || 'Link szövege';
        const value = `[${label}](${url.toString()})`;
        return { value, cursorOffset: selected ? value.length : 1 };
      });
    } catch {
      setError('Érvényes http:// vagy https:// linket adj meg.');
    }
  }

  function chooseImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Csak képet lehet feltölteni.');
      return;
    }
    if (file.size > MAX_BANDA_FEED_IMAGE_BYTES) {
      setError('A kiválasztott kép legfeljebb 2 MB lehet.');
      return;
    }
    setError('');
    setImageFile(file);
  }

  return (
    <div className="card banda-board">
      {canPost ? (
        <div className="banda-board__composer">
          {kind === 'feed' ? (
            <div className="banda-editor__toolbar" role="toolbar" aria-label="Poszt formázása">
              <EditorButton label="Félkövér" onClick={() => wrapSelection('**')}><strong>B</strong></EditorButton>
              <EditorButton label="Dőlt" onClick={() => wrapSelection('_')}><em>I</em></EditorButton>
              <EditorButton label="Aláhúzott" onClick={() => wrapSelection('++')}><u>U</u></EditorButton>
              <EditorButton label="Felsorolás" onClick={() => prefixLines('bullet')}>• lista</EditorButton>
              <EditorButton label="Számozott felsorolás" onClick={() => prefixLines('ordered')}>1. lista</EditorButton>
              <EditorButton label="Idézet" onClick={() => prefixLines('quote')}>❞</EditorButton>
              <EditorButton label="Link beszúrása" onClick={insertLink}>🔗</EditorButton>
              <EditorButton label="Kép csatolása" onClick={() => fileInputRef.current?.click()}>🖼</EditorButton>
            </div>
          ) : null}

          <div className="banda-board__input-row">
            <textarea
              ref={textareaRef}
              className={`search__input banda-board__input${kind === 'feed' ? ' banda-board__input--feed' : ''}`}
              placeholder={placeholder}
              value={text}
              maxLength={POST_MAX}
              onChange={(event) => setText(event.target.value)}
              aria-label={placeholder}
            />
            <Button size="sm" loading={busy} disabled={!text.trim()} onClick={() => void submit()}>
              Küldés
            </Button>
          </div>

          {kind === 'feed' ? (
            <input
              ref={fileInputRef}
              className="banda-board__file"
              type="file"
              accept="image/*"
              onChange={(event) => {
                chooseImage(event.currentTarget.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
          ) : null}

          {imagePreview ? (
            <div className="banda-board__preview">
              <img src={imagePreview} alt="Csatolandó kép előnézete" />
              <button type="button" aria-label="Csatolt kép eltávolítása" onClick={() => setImageFile(null)}>×</button>
            </div>
          ) : null}
        </div>
      ) : deniedText ? (
        <p className="search__note">{deniedText}</p>
      ) : null}

      {error ? <p className="search__note banda-board__error" role="alert">{error}</p> : null}

      <div className="banda-board__messages">
        {items === null ? (
          <p className="search__note">Betöltés…</p>
        ) : items.length === 0 ? (
          <p className="search__note">{emptyText}</p>
        ) : items.map((item) => (
          <article key={item.id} className="banda-post">
            <Avatar url={null} name={item.authorUsername || '?'} size={32} />
            <div className="banda-post__body">
              <div className="banda-post__meta">
                <strong>{item.authorUid === profile?.uid ? 'Te' : item.authorUsername}</strong>
                <time dateTime={item.createdAt ? new Date(item.createdAt).toISOString() : undefined}>
                  {formatBandaTimestamp(item.createdAt, now)}
                </time>
              </div>
              <BandaPostContent text={item.text} format={item.format} />
              {kind === 'feed' && item.hasImage ? <BandaFeedImage bandaId={bandaId} postId={item.id} /> : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function EditorButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="banda-editor__button" aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function BandaFeedImage({ bandaId, postId }: { bandaId: string; postId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void api.bandas.feedImage(bandaId, postId, controller.signal).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bandaId, postId]);
  return url ? <img className="banda-post__image" src={url} alt="A poszthoz csatolt kép" /> : <div className="banda-post__image-loading">Kép betöltése…</div>;
}

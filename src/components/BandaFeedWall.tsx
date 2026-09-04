import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBold, faComment, faImage, faItalic, faLink, faList, faListOl, faPen, faQuoteLeft, faReply, faTrash, faUnderline } from '@fortawesome/free-solid-svg-icons';
import { Avatar } from '@/components/ActivityCard';
import { Button, SegmentedControl } from '@/components/ui';
import { useAuth } from '@/hooks/AuthProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import { api, ApiError, type BandaComment, type BandaPost } from '@/lib/api';
import { BandaPostContent, formatBandaTimestamp } from '@/lib/bandaContent';
import { deleteBandaFeedImage, MAX_BANDA_FEED_IMAGE_BYTES, PhotoError, uploadBandaFeedImage } from '@/lib/photos';
import './bandaFeedWall.css';

const POST_MAX = 1000;

export function BandaFeedWall({ bandaId, canPostFeed }: { bandaId: string; canPostFeed: boolean }) {
  const [tab, setTab] = useState<'feed' | 'wall'>('feed');
  return (
    <section className="stack">
      <SegmentedControl label="Hírfolyam vagy üzenőfal" options={[{ value: 'feed', label: 'Hírfolyam' }, { value: 'wall', label: 'Üzenőfal' }]} value={tab} onChange={setTab} block />
      <BandaPostBoard key={tab} bandaId={bandaId} kind={tab} canPost={tab === 'wall' || canPostFeed} placeholder={tab === 'feed' ? 'Mi újság a bandában?' : 'Üzenet az üzenőfalra'} emptyText={tab === 'feed' ? 'Még nincs poszt a hírfolyamban.' : 'Még nincs üzenet az üzenőfalon.'} deniedText="Ebben a bandában a beállítás szerint most nem te posztolhatsz a hírfolyamba." />
    </section>
  );
}

function BandaPostBoard({ bandaId, kind, canPost, placeholder, emptyText, deniedText }: { bandaId: string; kind: 'feed' | 'wall'; canPost: boolean; placeholder: string; emptyText: string; deniedText: string }) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const editorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<BandaPost[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(10);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [editorHasText, setEditorHasText] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState<BandaPost | null>(null);
  const [replyingTo, setReplyingTo] = useState<BandaPost | null>(null);

  async function load(limit = visibleLimit) {
    try {
      const result = kind === 'feed' ? await api.bandas.feed(bandaId, limit) : await api.bandas.wall(bandaId);
      setHasMore(result.hasMore);
      return result.items;
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'Most nem tölthető be.');
      return [];
    }
  }

  useEffect(() => {
    let alive = true;
    setItems(null);
    setError('');
    void load().then((result) => alive && setItems(result));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandaId, kind]);

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!imageFile) { setImagePreview(null); return; }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  function resetComposer() {
    setText(''); setEditing(null); setReplyingTo(null); setImageFile(null); setEditorHasText(false);
    if (editorRef.current) editorRef.current.innerHTML = '';
    if (textareaRef.current) textareaRef.current.style.height = '';
  }

  async function submit() {
    const content = kind === 'feed' ? editorToMarkdown(editorRef.current) : text.trim();
    if (!content || busy) return;
    setBusy(true); setError('');
    let uploadedPath: string | null = null;
    try {
      if (kind === 'feed' && editing) await api.bandas.editFeedPost(bandaId, editing.id, content);
      else if (kind === 'feed') {
        if (imageFile) {
          if (!user) throw new PhotoError('Jelentkezz be a kép feltöltéséhez.');
          uploadedPath = await uploadBandaFeedImage(imageFile, user.uid, bandaId);
        }
        await api.bandas.postToFeed(bandaId, content, uploadedPath ?? undefined);
      } else await api.bandas.postToWall(bandaId, content, replyingTo?.id);
      resetComposer(); setItems(await load()); setNow(Date.now());
    } catch (problem) {
      if (uploadedPath) void deleteBandaFeedImage(uploadedPath).catch(() => undefined);
      setError(problem instanceof Error ? problem.message : 'Most nem sikerült elküldeni.');
    } finally { setBusy(false); }
  }

  function editPost(item: BandaPost) {
    setEditing(item); setImageFile(null);
    if (editorRef.current) {
      editorRef.current.innerHTML = markdownToEditorHtml(item.text);
      setEditorHasText(true); editorRef.current.focus(); editorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  async function deletePost(item: BandaPost) {
    if (!window.confirm('Biztosan törlöd ezt a posztot?')) return;
    try { await api.bandas.deleteFeedPost(bandaId, item.id); setItems((current) => current?.filter((post) => post.id !== item.id) ?? current); }
    catch (problem) { setError(problem instanceof ApiError ? problem.message : 'A posztot most nem sikerült törölni.'); }
  }

  function chooseImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Csak képet lehet feltölteni.'); return; }
    if (file.size > MAX_BANDA_FEED_IMAGE_BYTES) { setError('A kiválasztott kép legfeljebb 2 MB lehet.'); return; }
    setError(''); setImageFile(file);
  }

  function updateItem(id: string, change: Partial<BandaPost>) { setItems((current) => current?.map((item) => item.id === id ? { ...item, ...change } : item) ?? current); }

  const composer = canPost ? (
    <div className={`banda-board__composer banda-board__composer--${kind}`}>
      {kind === 'feed' ? <>
        {editing ? <div className="banda-composer__context"><span>Poszt szerkesztése</span><button type="button" onClick={resetComposer}>Mégse</button></div> : null}
        <div className="banda-editor__toolbar" role="toolbar" aria-label="Poszt formázása">
          <EditorButton label="Félkövér" command="bold"><FontAwesomeIcon icon={faBold} /></EditorButton>
          <EditorButton label="Dőlt" command="italic"><FontAwesomeIcon icon={faItalic} /></EditorButton>
          <EditorButton label="Aláhúzott" command="underline"><FontAwesomeIcon icon={faUnderline} /></EditorButton>
          <EditorButton label="Felsorolás" command="insertUnorderedList"><FontAwesomeIcon icon={faList} /></EditorButton>
          <EditorButton label="Számozott felsorolás" command="insertOrderedList"><FontAwesomeIcon icon={faListOl} /></EditorButton>
          <EditorButton label="Idézet" command="formatBlock" value="blockquote"><FontAwesomeIcon icon={faQuoteLeft} /></EditorButton>
          <button type="button" className="banda-editor__button" aria-label="Link beszúrása" title="Link beszúrása" onMouseDown={(event) => {
            event.preventDefault(); const href = window.prompt('Link címe (https://…):', 'https://'); if (!href) return;
            try { const url = new URL(href); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); document.execCommand('createLink', false, url.toString()); }
            catch { setError('Érvényes http:// vagy https:// linket adj meg.'); }
          }}><FontAwesomeIcon icon={faLink} /></button>
        </div>
        <div ref={editorRef} className="banda-editor__surface" contentEditable role="textbox" aria-multiline="true" aria-label={placeholder} data-placeholder={placeholder} onInput={(event) => setEditorHasText(Boolean(event.currentTarget.textContent?.trim()))} onPaste={(event) => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); }} suppressContentEditableWarning />
        {!editing ? <div className="banda-image-block">
          <input ref={fileInputRef} type="file" accept="image/*" onChange={(event) => { chooseImage(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
          {imagePreview ? <div className="banda-board__preview"><img src={imagePreview} alt="Csatolandó kép előnézete" /><button type="button" aria-label="Csatolt kép eltávolítása" onClick={() => setImageFile(null)}>×</button></div> : <button type="button" className="banda-image-block__add" onClick={() => fileInputRef.current?.click()}><FontAwesomeIcon icon={faImage} /> Kép hozzáadása</button>}
        </div> : null}
        <Button size="sm" loading={busy} disabled={!editorHasText} onClick={() => void submit()}>{editing ? 'Mentés' : 'Közzététel'}</Button>
      </> : <>
        {replyingTo ? <div className="banda-composer__context"><span>Válasz neki: <strong>{replyingTo.authorUsername}</strong></span><button type="button" onClick={() => setReplyingTo(null)}>Mégse</button></div> : null}
        <div className="banda-board__input-row"><textarea ref={textareaRef} className="banda-board__input" placeholder={placeholder} value={text} maxLength={POST_MAX} onChange={(event) => { setText(event.target.value); event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 132)}px`; }} aria-label={placeholder} /><Button size="sm" loading={busy} disabled={!text.trim()} onClick={() => void submit()}>Küldés</Button></div>
      </>}
    </div>
  ) : deniedText ? <p className="search__note banda-board__denied">{deniedText}</p> : null;

  return <div className={`banda-board banda-board--${kind}`}>
    {composer}
    {error ? <p className="search__note banda-board__error" role="alert">{error}</p> : null}
    <div className="banda-board__messages">
      {items === null ? <p className="search__note">Betöltés…</p> : items.length === 0 ? <p className="search__note">{emptyText}</p> : items.map((item) => kind === 'feed' ?
        <FeedPostCard key={item.id} bandaId={bandaId} item={item} own={item.authorUid === profile?.uid} now={now} onEdit={() => editPost(item)} onDelete={() => void deletePost(item)} onChange={(change) => updateItem(item.id, change)} /> :
        <WallMessage key={item.id} bandaId={bandaId} item={item} own={item.authorUid === profile?.uid} now={now} onReply={() => { setReplyingTo(item); textareaRef.current?.focus(); }} onChange={(change) => updateItem(item.id, change)} />)}
      {kind === 'feed' && hasMore ? <Button variant="secondary" block onClick={() => { const next = visibleLimit + 10; setVisibleLimit(next); void load(next).then(setItems); }}>További 10 poszt</Button> : null}
    </div>
  </div>;
}

function EditorButton({ label, command, value, children }: { label: string; command: string; value?: string; children: ReactNode }) {
  return <button type="button" className="banda-editor__button" aria-label={label} title={label} onMouseDown={(event) => { event.preventDefault(); document.execCommand(command, false, value); }}>{children}</button>;
}

function FeedPostCard({ bandaId, item, own, now, onEdit, onDelete, onChange }: { bandaId: string; item: BandaPost; own: boolean; now: number; onEdit: () => void; onDelete: () => void; onChange: (change: Partial<BandaPost>) => void }) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<BandaComment[] | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  async function toggleComments() { const open = !commentsOpen; setCommentsOpen(open); if (open && comments === null) setComments((await api.bandas.feedComments(bandaId, item.id)).items); }
  async function addComment() {
    if (!comment.trim() || busy) return; setBusy(true);
    try { await api.bandas.addFeedComment(bandaId, item.id, comment.trim()); setComment(''); setComments((await api.bandas.feedComments(bandaId, item.id)).items); onChange({ commentCount: item.commentCount + 1 }); }
    finally { setBusy(false); }
  }
  return <article className="banda-post-card">
    <header className="banda-post__header"><Avatar url={item.authorPhotoURL} name={item.authorUsername || '?'} size={38} /><div><strong>{own ? 'Te' : item.authorUsername}</strong><time dateTime={item.createdAt ? new Date(item.createdAt).toISOString() : undefined}>{formatBandaTimestamp(item.createdAt, now)}{item.updatedAt ? ' · szerkesztve' : ''}</time></div>{own ? <div className="banda-post__manage"><button type="button" aria-label="Szerkesztés" onClick={onEdit}><FontAwesomeIcon icon={faPen} /></button><button type="button" aria-label="Törlés" onClick={onDelete}><FontAwesomeIcon icon={faTrash} /></button></div> : null}</header>
    <BandaPostContent text={item.text} format={item.format} />
    {item.hasImage ? <BandaFeedImage bandaId={bandaId} postId={item.id} /> : null}
    <footer className="banda-post__actions"><button type="button" className={item.likedByMe ? 'is-active' : ''} onClick={async () => { const result = await api.bandas.toggleFeedLike(bandaId, item.id); onChange({ likedByMe: result.liked, likeCount: result.likeCount }); }}>♥ <span>{item.likeCount || 'Kedvelés'}</span></button><button type="button" onClick={() => void toggleComments()}><FontAwesomeIcon icon={faComment} /> <span>{item.commentCount || 'Komment'}</span></button></footer>
    {commentsOpen ? <div className="banda-comments">{comments?.map((entry) => <div key={entry.id} className="banda-comment"><Avatar url={entry.authorPhotoURL} name={entry.authorUsername} size={28} /><div><strong>{entry.authorUsername}</strong><span>{entry.text}</span><time>{formatBandaTimestamp(entry.createdAt, now)}</time></div></div>)}<div className="banda-comments__input"><input value={comment} maxLength={500} placeholder="Írj kommentet…" onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void addComment()} /><Button size="sm" loading={busy} disabled={!comment.trim()} onClick={() => void addComment()}>Küldés</Button></div></div> : null}
  </article>;
}

function WallMessage({ bandaId, item, own, now, onReply, onChange }: { bandaId: string; item: BandaPost; own: boolean; now: number; onReply: () => void; onChange: (change: Partial<BandaPost>) => void }) {
  return <article className={`banda-message${own ? ' banda-message--own' : ''}`}>{!own ? <Avatar url={item.authorPhotoURL} name={item.authorUsername} size={30} /> : null}<div className="banda-message__column"><div className="banda-message__meta"><strong>{own ? 'Te' : item.authorUsername}</strong><time>{formatBandaTimestamp(item.createdAt, now)}</time></div><div className="banda-message__bubble">{item.replyToId ? <span className="banda-message__reply">Válasz neki: {item.replyToUsername}</span> : null}<span>{item.text}</span></div><div className="banda-message__actions"><button type="button" onClick={onReply}><FontAwesomeIcon icon={faReply} /> Válasz</button><button type="button" className={item.likedByMe ? 'is-active' : ''} onClick={async () => { const result = await api.bandas.toggleWallLike(bandaId, item.id); onChange({ likedByMe: result.liked, likeCount: result.likeCount }); }}>♥ {item.likeCount || ''}</button></div></div></article>;
}

function BandaFeedImage({ bandaId, postId }: { bandaId: string; postId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { const controller = new AbortController(); let objectUrl: string | null = null; void api.bandas.feedImage(bandaId, postId, controller.signal).then((blob) => { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(() => undefined); return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [bandaId, postId]);
  return url ? <img className="banda-post__image" src={url} alt="A poszthoz csatolt kép" /> : <div className="banda-post__image-loading">Kép betöltése…</div>;
}

function editorToMarkdown(root: HTMLDivElement | null): string {
  if (!root) return '';
  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof HTMLElement)) return '';
    const content = Array.from(node.childNodes).map(walk).join('');
    const tag = node.tagName;
    if (tag === 'BR') return '\n';
    if (tag === 'B' || tag === 'STRONG') return `**${content}**`;
    if (tag === 'I' || tag === 'EM') return `_${content}_`;
    if (tag === 'U') return `++${content}++`;
    if (tag === 'A') return /^https?:\/\//.test(node.getAttribute('href') ?? '') ? `[${content}](${node.getAttribute('href')})` : content;
    if (tag === 'BLOCKQUOTE') return content.split('\n').filter(Boolean).map((line) => `> ${line}`).join('\n') + '\n';
    if (tag === 'LI') { const siblings = Array.from(node.parentElement?.children ?? []); return `${node.parentElement?.tagName === 'OL' ? `${siblings.indexOf(node) + 1}.` : '-'} ${content}\n`; }
    if (tag === 'UL' || tag === 'OL') return content + '\n';
    if (tag === 'DIV' || tag === 'P') return content + '\n';
    return content;
  }
  return Array.from(root.childNodes).map(walk).join('').replace(/\n{3,}/g, '\n\n').trim().slice(0, POST_MAX);
}

function markdownToEditorHtml(markdown: string): string {
  const inline = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/_([^_\n]+)_/g, '<em>$1</em>').replace(/\+\+([^+\n]+)\+\+/g, '<u>$1</u>').replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  const lines = markdown.split('\n'); const output: string[] = [];
  for (let index = 0; index < lines.length;) {
    if (/^-\s+/.test(lines[index] ?? '')) { const items: string[] = []; while (index < lines.length && /^-\s+/.test(lines[index] ?? '')) items.push(`<li>${inline((lines[index++] ?? '').replace(/^-\s+/, ''))}</li>`); output.push(`<ul>${items.join('')}</ul>`); continue; }
    if (/^\d+\.\s+/.test(lines[index] ?? '')) { const items: string[] = []; while (index < lines.length && /^\d+\.\s+/.test(lines[index] ?? '')) items.push(`<li>${inline((lines[index++] ?? '').replace(/^\d+\.\s+/, ''))}</li>`); output.push(`<ol>${items.join('')}</ol>`); continue; }
    if (/^>\s?/.test(lines[index] ?? '')) { output.push(`<blockquote>${inline((lines[index++] ?? '').replace(/^>\s?/, ''))}</blockquote>`); continue; }
    output.push(`<div>${inline(lines[index++] ?? '') || '<br>'}</div>`);
  }
  return output.join('');
}

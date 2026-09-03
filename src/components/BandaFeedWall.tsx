import { useEffect, useState } from 'react';
import { Avatar } from '@/components/ActivityCard';
import { Button, SegmentedControl } from '@/components/ui';
import { useProfile } from '@/hooks/ProfileProvider';
import { api, ApiError, type BandaPost } from '@/lib/api';

const POST_MAX = 1000;

/**
 * Hírfolyam / chat fal váltó (GRUNDO #30, Phase 2 folytatása).
 *
 * A két tábla ugyanazt a `BandaPostBoard`-ot használja — a séma és a
 * végpontpár (`GET`/`POST` `/feed` és `/wall`) szándékosan tükör, csak a
 * posztolási jogosultság tér el: a hírfolyamra a `settings.postPermission`
 * dönt (`canPostFeed`), a falra bárki tag írhat.
 */
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
  const { profile } = useProfile();
  const [items, setItems] = useState<BandaPost[] | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

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

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    try {
      if (kind === 'feed') await api.bandas.postToFeed(bandaId, trimmed);
      else await api.bandas.postToWall(bandaId, trimmed);
      setText('');
      setItems(await load());
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'Most nem sikerült elküldeni.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      {canPost ? (
        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
          <textarea
            className="search__input"
            style={{ flex: 1, minHeight: 44, resize: 'vertical' }}
            placeholder={placeholder}
            value={text}
            maxLength={POST_MAX}
            onChange={(event) => setText(event.target.value)}
            aria-label={placeholder}
          />
          <Button size="sm" loading={busy} disabled={!text.trim()} onClick={submit}>
            Küldés
          </Button>
        </div>
      ) : deniedText ? (
        <p className="search__note">{deniedText}</p>
      ) : null}

      {error ? (
        <p className="search__note" role="alert">
          {error}
        </p>
      ) : null}

      {items === null ? (
        <p className="search__note">Betöltés…</p>
      ) : items.length === 0 ? (
        <p className="search__note">{emptyText}</p>
      ) : (
        <div className="stack">
          {items.map((item) => (
            <div key={item.id} style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <Avatar url={null} name={item.authorUsername || '?'} size={32} />
              <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 'var(--fs-small)' }}>
                  {item.authorUid === profile?.uid ? 'Te' : item.authorUsername}
                </strong>
                <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>{item.text}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

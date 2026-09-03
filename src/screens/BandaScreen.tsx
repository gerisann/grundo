import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '@/components/ActivityCard';
import { BandaFeedWall } from '@/components/BandaFeedWall';
import { BandaInviteSheet } from '@/components/BandaInviteSheet';
import { Button, Chip, EmptyState, List, ListRow, ScreenHeader } from '@/components/ui';
import { SegmentedControl } from '@/components/ui';
import {
  api,
  ApiError,
  canInvite,
  type Banda,
  type BandaMember,
  type BandaRole,
  type BandaSettings,
  type BandaPeriod,
  type BandaSport,
} from '@/lib/api';
import { formatArea } from '@/lib/format';
import './bandaScreen.css';

const ROLE_LABEL: Record<BandaRole, string> = {
  owner: 'Alapító',
  moderator: 'Moderátor',
  member: 'Tag',
};

const hu = new Intl.NumberFormat('hu-HU');
const PERIODS = [
  { value: 'day', label: 'Mai' },
  { value: 'week', label: 'Heti' },
  { value: 'month', label: 'Havi' },
  { value: 'alltime', label: 'Mindenkori' },
] as const;
const SPORTS = [
  { value: 'run', label: 'Futás' },
  { value: 'walk', label: 'Séta' },
  { value: 'ride', label: 'Bringa' },
] as const;

/**
 * Egy banda részletei (GRUNDO #29 Phase 1 → #30 Phase 2 folytatás).
 *
 * Nincs a Közösség-fülsor alatt — önálló képernyő, saját fejléccel, mint a
 * `/profil/rivalisok`. A hírfolyam és a chat fal (`BandaFeedWall`) és a
 * meghívás (`BandaInviteSheet`) itt élnek. Az alapító jobb felül a
 * fogaskerékkel jut a külön Phase 3 beállítás- és tagkezelő képernyőre.
 */
export function BandaScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [banda, setBanda] = useState<Banda | null>(null);
  const [role, setRole] = useState<BandaRole | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [settings, setSettings] = useState<BandaSettings | null>(null);
  const [members, setMembers] = useState<BandaMember[] | null>(null);
  const [error, setError] = useState('');
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [period, setPeriod] = useState<BandaPeriod>('day');
  const [sport, setSport] = useState<BandaSport>('run');
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  async function leaveBanda() {
    if (!id || role === 'owner' || !window.confirm('Biztosan kilépsz ebből a bandából?')) return;
    setLeaving(true);
    setError('');
    try {
      await api.bandas.leave(id);
      navigate('/kozosseg/bandak', { replace: true });
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'Most nem sikerült kilépni a bandából.');
      setLeaving(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setError('');
    api.bandas
      .detail(id)
      .then((result) => {
        if (!alive) return;
        setBanda(result.banda);
        setRole(result.role);
        setInviteCode(result.inviteCode);
        setSettings(result.settings);
      })
      .catch((problem: unknown) => {
        if (!alive) return;
        setError(problem instanceof ApiError ? problem.message : 'A banda most nem tölthető be.');
      });
    api.bandas
      .members(id)
      .then((result) => {
        if (alive) setMembers(result.items);
      })
      .catch(() => {
        if (alive) setMembers([]);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const memberIds = useMemo(() => new Set((members ?? []).map((member) => member.uid)), [members]);
  const rankedMembers = useMemo(() => rankMembers(members ?? [], sport, period), [members, sport, period]);
  const totals = useMemo(() => rankedMembers.reduce(
    (sum, member) => ({ areaM2: sum.areaM2 + member.areaM2, gp: sum.gp + member.gp }),
    { areaM2: 0, gp: 0 },
  ), [rankedMembers]);

  async function copyShare(kind: 'code' | 'link') {
    if (!id) return;
    const value = kind === 'code'
      ? inviteCode
      : inviteCode
        ? `${window.location.origin}/kozosseg/bandak?code=${encodeURIComponent(inviteCode)}`
        : `${window.location.origin}/bandak/${encodeURIComponent(id)}`;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  }

  if (error) {
    return (
      <>
        <ScreenHeader title="Banda" backTo="/kozosseg/bandak" />
        <div className="screen-body stack">
          <div className="card" role="alert">
            {error}
          </div>
        </div>
      </>
    );
  }

  if (!banda) {
    return (
      <>
        <ScreenHeader title="Banda" backTo="/kozosseg/bandak" />
        <div className="screen-body stack">
          <div className="card">Betöltés…</div>
        </div>
      </>
    );
  }

  return (
    <>
      <ScreenHeader
        title={banda.name}
        backTo="/kozosseg/bandak"
        action={role === 'owner' && id ? (
          <button
            type="button"
            className="screen-header__back"
            aria-label="Banda beállításai"
            onClick={() => navigate(`/bandak/${encodeURIComponent(id)}/beallitasok`)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 8.95 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.09A1.7 1.7 0 0 0 4.6 8.95a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.95 4.6 1.7 1.7 0 0 0 9.97 3.04V3h4v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.95a1.7 1.7 0 0 0 1.56 1.03H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
            </svg>
          </button>
        ) : undefined}
      />
      <div className="screen-body stack">
        <section className="card stack">
          {banda.coverURL ? <img className="banda-detail__cover" src={banda.coverURL} alt="" /> : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <Avatar url={banda.photoURL} name={banda.name} size={56} />
            <div className="stack" style={{ gap: 4 }}>
              <strong>{banda.name}</strong>
              <span className="search__note" style={{ margin: 0 }}>
                {hu.format(banda.memberCount)} tag
              </span>
            </div>
            <Chip variant={banda.visibility === 'private' ? 'default' : 'success'}>
              {banda.visibility === 'private' ? 'Privát' : 'Publikus'}
            </Chip>
          </div>
          {banda.description ? <p>{banda.description}</p> : null}
          {role ? (
            <div className="banda-share">
              {inviteCode ? (
                <div className="banda-share__row">
                  <span>Meghívókód</span><strong>{inviteCode}</strong>
                  <Button size="sm" variant="secondary" onClick={() => void copyShare('code')}>
                    {copied === 'code' ? 'Másolva' : 'Másolás'}
                  </Button>
                </div>
              ) : null}
              <div className="banda-share__row">
                <span>Megosztási link</span>
                <Button size="sm" variant="secondary" onClick={() => void copyShare('link')}>
                  {copied === 'link' ? 'Másolva' : 'Link másolása'}
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="card stack banda-ranking">
          <SegmentedControl options={PERIODS} value={period} onChange={setPeriod} label="Időszak" block columns={4} size="sm" />
          <SegmentedControl options={SPORTS} value={sport} onChange={setSport} label="Sportág" block columns={3} size="sm" />
          <div className="banda-ranking__totals">
            <div><span>Terület összesen</span><strong>{formatArea(totals.areaM2)}</strong></div>
            <div><span>GP összesen</span><strong>{hu.format(totals.gp)}</strong></div>
          </div>
          {members === null ? <div>Ranglista betöltése…</div> : rankedMembers.length ? (
            <>
              <BandaPodium entries={rankedMembers.slice(0, 3)} />
              {rankedMembers.length > 3 ? (
                <div className="banda-ranking__list">
                  {rankedMembers.slice(3, 10).map((member, index) => (
                    <button key={member.uid} type="button" onClick={() => navigate(`/felhasznalo/${encodeURIComponent(member.username)}`)}>
                      <strong>{index + 4}.</strong>
                      <Avatar url={member.photoURL} name={member.username} size={32} />
                      <span>{member.username}</span>
                      <small>{formatArea(member.areaM2)} · {hu.format(member.gp)} GP</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : <EmptyState title="Még nincs eredmény" description="Ebben az időszakban és sportágban még nincs rangsorolható aktivitás." />}
        </section>

        <section className="stack">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
            <h2 className="discover-feed__title" style={{ margin: 0 }}>
              Tagok
            </h2>
            {role && settings && canInvite(role, settings.whoCanInvite) ? (
              <Button size="sm" variant="secondary" onClick={() => setInviteSheetOpen(true)}>
                Meghívás
              </Button>
            ) : null}
          </div>
          {members === null ? (
            <div className="card">Betöltés…</div>
          ) : (
            <List>
              {members.map((member) => (
                <ListRow
                  key={member.uid}
                  label={member.username}
                  value={<Chip variant={member.role === 'owner' ? 'accent' : 'default'}>{ROLE_LABEL[member.role]}</Chip>}
                />
              ))}
            </List>
          )}
        </section>

        {role && settings ? (
          <BandaFeedWall bandaId={id ?? ''} canPostFeed={canInvite(role, settings.postPermission)} />
        ) : (
          <EmptyState
            title="Csak tagoknak"
            description="A hírfolyam és a chat fal csak a banda tagjainak látszik — csatlakozz, hogy megnézhesd."
          />
        )}

        {role && role !== 'owner' ? (
          <Button variant="danger" block loading={leaving} onClick={() => void leaveBanda()}>
            Kilépés a bandából
          </Button>
        ) : null}
      </div>

      {inviteSheetOpen && id ? (
        <BandaInviteSheet bandaId={id} memberIds={memberIds} onClose={() => setInviteSheetOpen(false)} />
      ) : null}
    </>
  );
}

interface RankedMember extends BandaMember { areaM2: number; gp: number }

function rankMembers(members: BandaMember[], sport: BandaSport, period: BandaPeriod): RankedMember[] {
  const areaKey = period === 'day' ? 'areaDayM2' : period === 'week' ? 'areaWeekM2' : period === 'month' ? 'areaMonthM2' : 'areaTotalM2';
  const gpKey = period === 'day' ? 'gpDay' : period === 'week' ? 'gpWeek' : period === 'month' ? 'gpMonth' : 'gpTotal';
  return members.map((member) => ({
    ...member,
    areaM2: member.stats?.[sport]?.[areaKey] ?? 0,
    gp: member.stats?.[sport]?.[gpKey] ?? 0,
  })).sort((a, b) => b.areaM2 - a.areaM2 || b.gp - a.gp || a.username.localeCompare(b.username, 'hu'));
}

function BandaPodium({ entries }: { entries: RankedMember[] }) {
  const navigate = useNavigate();
  const order = [entries[1], entries[0], entries[2]];
  const tones = ['silver', 'gold', 'bronze'] as const;
  return <div className="banda-podium">{order.map((entry, slot) => entry ? (
    <button key={entry.uid} type="button" className="banda-podium__column" onClick={() => navigate(`/felhasznalo/${encodeURIComponent(entry.username)}`)}>
      {slot === 1 ? <span className="banda-podium__crown" aria-hidden="true">♛</span> : null}
      <Avatar url={entry.photoURL} name={entry.username} size={slot === 1 ? 44 : 36} />
      <strong>{entry.username}</strong>
      <small>{formatArea(entry.areaM2)} · {hu.format(entry.gp)} GP</small>
      <span className={`banda-podium__bar banda-podium__bar--${tones[slot]}`}>{entries.indexOf(entry) + 1}</span>
    </button>
  ) : <span key={slot} />)}</div>;
}

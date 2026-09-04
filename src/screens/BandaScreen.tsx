import { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPersonBiking, faPersonRunning, faPersonWalking, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '@/components/ActivityCard';
import { BandaFeedWall } from '@/components/BandaFeedWall';
import { BandaInviteSheet } from '@/components/BandaInviteSheet';
import { BandaRoleChip } from '@/components/BandaRoleChip';
import { GearIcon } from '@/components/ProfileHeader';
import { Button, EmptyState, List, ListRow, ScreenHeader } from '@/components/ui';
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

const hu = new Intl.NumberFormat('hu-HU');
const PERIODS = [
  { value: 'day', label: 'Mai' },
  { value: 'week', label: 'Heti' },
  { value: 'month', label: 'Havi' },
  { value: 'alltime', label: 'Mindenkori' },
] as const;
const SPORTS = [
  { value: 'run', label: 'Futás', icon: faPersonRunning },
  { value: 'walk', label: 'Séta', icon: faPersonWalking },
  { value: 'ride', label: 'Bringa', icon: faPersonBiking },
] as const;

/**
 * A toplista szűrői megjegyzik az utolsó választást.
 *
 * Nézetenként külön kulcs, `localStorage`-ban: ez a felhasználó szokása,
 * nem játékadat — a szerverre nem tartozik, és eszközönként eltérhet.
 */
const FILTER_KEYS = {
  period: 'grundo.banda.period.v1',
  sport: 'grundo.banda.sport.v1',
} as const;

const FILTER_DEFAULTS = { period: 'day', sport: 'run' } as const;

function readStoredFilter<K extends keyof typeof FILTER_KEYS>(
  kind: K,
): K extends 'period' ? BandaPeriod : BandaSport {
  const allowed: readonly string[] = kind === 'period'
    ? PERIODS.map((option) => option.value)
    : SPORTS.map((option) => option.value);
  try {
    const stored = localStorage.getItem(FILTER_KEYS[kind]);
    if (stored !== null && allowed.includes(stored)) return stored as never;
  } catch {
    // Privát mód vagy letiltott tárhely: marad az alapértelmezés.
  }
  return FILTER_DEFAULTS[kind] as never;
}

function storeFilter(kind: keyof typeof FILTER_KEYS, value: string): void {
  try {
    localStorage.setItem(FILTER_KEYS[kind], value);
  } catch {
    // A megjegyzés kényelem, nem feltétel.
  }
}

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
  const [membersOpen, setMembersOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [joining, setJoining] = useState(false);
  const [period, setPeriod] = useState<BandaPeriod>(() => readStoredFilter('period'));
  const [sport, setSport] = useState<BandaSport>(() => readStoredFilter('sport'));
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  function choosePeriod(next: BandaPeriod) {
    setPeriod(next);
    storeFilter('period', next);
  }

  function chooseSport(next: BandaSport) {
    setSport(next);
    storeFilter('sport', next);
  }

  /**
   * Publikus bandához a banda oldaláról is lehet csatlakozni — eddig ehhez
   * vissza kellett menni a keresőbe, pedig a döntés épp itt születik meg.
   */
  async function joinBanda() {
    if (!id || joining) return;
    setJoining(true);
    setError('');
    try {
      await api.bandas.join(id);
      const result = await api.bandas.detail(id);
      setRole(result.role);
      setInviteCode(result.inviteCode);
      setSettings(result.settings);
      setBanda(result.banda);
      const memberList = await api.bandas.members(id);
      setMembers(memberList.items);
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'A csatlakozás most nem sikerült.');
    } finally {
      setJoining(false);
    }
  }

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

  async function shareBanda() {
    if (!id) return;
    const url = inviteCode
      ? `${window.location.origin}/kozosseg/bandak?code=${encodeURIComponent(inviteCode)}`
      : `${window.location.origin}/bandak/${encodeURIComponent(id)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: banda?.name ?? 'Banda', text: `Csatlakozz a(z) ${banda?.name ?? 'bandánk'} bandához!`, url });
        return;
      } catch (problem) {
        if ((problem as DOMException).name === 'AbortError') return;
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied('link');
    window.setTimeout(() => setCopied(null), 1800);
  }

  if (error) {
    return (
      <>
        <ScreenHeader title="BANDÁK" backTo="/kozosseg/bandak" />
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
        <ScreenHeader title="BANDÁK" backTo="/kozosseg/bandak" />
        <div className="screen-body stack">
          <div className="card">Betöltés…</div>
        </div>
      </>
    );
  }

  return (
    <>
      <ScreenHeader
        title="BANDÁK"
        backTo="/kozosseg/bandak"
        action={role === 'owner' && id ? (
          <button
            type="button"
            className="screen-header__back"
            aria-label="Banda beállításai"
            onClick={() => navigate(`/bandak/${encodeURIComponent(id)}/beallitasok`)}
          >
            <GearIcon />
          </button>
        ) : undefined}
      />
      <div className="screen-body stack banda-detail">
        {/* A háttérkép a TÖRZSÖN belül él, különben a fejlécre csúszik. */}
        {banda.coverURL ? <div className="banda-detail__backdrop" style={{ backgroundImage: `url(${banda.coverURL})` }} aria-hidden="true" /> : null}
        <section className="card stack banda-hero">
          <div className={`banda-hero__cover${banda.coverURL ? '' : ' banda-hero__cover--empty'}`}>
            {banda.coverURL ? <img src={banda.coverURL} alt={`${banda.name} borítóképe`} /> : null}
          </div>
          <div className="banda-hero__identity">
            <Avatar url={banda.photoURL} name={banda.name} size={72} />
            <strong>{banda.name}</strong>
          </div>
          <div className="banda-hero__badges">
            <span>{hu.format(banda.memberCount)} tag</span>
            <span>{banda.visibility === 'private' ? 'Privát' : 'Publikus'}</span>
          </div>
          {banda.description ? <p className="banda-hero__description">{banda.description}</p> : null}
          {role ? (
            <div className="banda-share">
              {inviteCode ? (
                <div className="banda-share__code">
                  <strong>{inviteCode}</strong>
                  <button type="button" onClick={() => void copyShare('code')}>
                    {copied === 'code' ? 'Másolva' : 'Másolás'}
                  </button>
                </div>
              ) : null}
              <div className="banda-share__actions">
                {settings && canInvite(role, settings.whoCanInvite) ? (
                  <Button block variant="secondary" onClick={() => setInviteSheetOpen(true)}>Meghívás</Button>
                ) : null}
                <Button block variant="secondary" onClick={() => void shareBanda()}>
                  {copied === 'link' ? 'Link másolva' : 'Banda megosztása'}
                </Button>
              </div>
            </div>
          ) : banda.visibility === 'public' ? (
            <div className="banda-share">
              <Button block loading={joining} onClick={() => void joinBanda()}>
                Csatlakozás a bandához
              </Button>
            </div>
          ) : null}
        </section>

        <section className="card stack banda-ranking">
          <div className="banda-ranking__controls">
            <label className="banda-ranking__period">
              <select value={period} onChange={(event) => choosePeriod(event.target.value as BandaPeriod)}>
                {PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="banda-ranking__sports" role="group" aria-label="Sportág">
              {SPORTS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={sport === option.value ? 'is-active' : ''}
                  aria-label={option.label}
                  aria-pressed={sport === option.value}
                  title={option.label}
                  onClick={() => chooseSport(option.value)}
                >
                  <FontAwesomeIcon icon={option.icon} />
                </button>
              ))}
            </div>
          </div>
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
          <h2 className="discover-feed__title" style={{ margin: 0 }}>Tagok</h2>
          {members === null ? (
            <div className="card">Betöltés…</div>
          ) : (
            <List>
              {members.slice(0, 10).map((member) => (
                <ListRow
                  key={member.uid}
                  label={member.username}
                  value={<BandaRoleChip role={member.role} />}
                />
              ))}
            </List>
          )}
          {(members?.length ?? 0) > 10 ? (
            <Button variant="secondary" block onClick={() => setMembersOpen(true)}>Összes tag</Button>
          ) : null}
        </section>

        {role && settings ? (
          <BandaFeedWall bandaId={id ?? ''} canPostFeed={canInvite(role, settings.postPermission)} />
        ) : (
          <EmptyState
            title="Csak tagoknak"
            description="A hírfolyam és az üzenőfal csak a banda tagjainak látszik — csatlakozz, hogy megnézhesd."
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
      {membersOpen && members ? (
        <div className="banda-members-modal" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setMembersOpen(false)}>
          <section className="banda-members-modal__panel" role="dialog" aria-modal="true" aria-labelledby="banda-members-title">
            <header>
              <h2 id="banda-members-title">Összes tag</h2>
              <button type="button" aria-label="Bezárás" onClick={() => setMembersOpen(false)}><FontAwesomeIcon icon={faXmark} /></button>
            </header>
            <div className="banda-members-modal__list">
              <List>
                {members.map((member) => (
                  <ListRow key={member.uid} label={member.username} value={<BandaRoleChip role={member.role} />} />
                ))}
              </List>
            </div>
          </section>
        </div>
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

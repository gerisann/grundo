import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '@/components/ActivityCard';
import { Button, Chip, ScreenHeader, SegmentedControl } from '@/components/ui';
import {
  api,
  ApiError,
  type BandaMember,
  type BandaPermission,
  type BandaSettings,
} from '@/lib/api';
import './bandaSettings.css';

const PERMISSION_OPTIONS = [
  { value: 'everyone', label: 'Mindenki' },
  { value: 'moderators', label: 'Moderátorok' },
  { value: 'owner', label: 'Csak én' },
] as const;

const ROLE_LABEL = {
  owner: 'Alapító',
  moderator: 'Moderátor',
  member: 'Tag',
} as const;

export function BandaSettingsScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [name, setName] = useState('Banda');
  const [settings, setSettings] = useState<BandaSettings | null>(null);
  const [members, setMembers] = useState<BandaMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<{ uid: string; kind: 'role' | 'remove' | 'transfer' } | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const [detail, memberList] = await Promise.all([api.bandas.detail(id), api.bandas.members(id)]);
      if (detail.role !== 'owner') {
        setError('Csak a banda alapítója nyithatja meg ezt a képernyőt.');
        return;
      }
      setName(detail.banda.name);
      setSettings(detail.settings);
      setMembers(memberList.items);
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'A banda beállításai most nem tölthetők be.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateSetting(key: keyof BandaSettings, value: BandaPermission) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
    setMessage('');
  }

  async function save() {
    if (!id || !settings) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.bandas.updateSettings(id, settings);
      setSettings(result.settings);
      setMessage('A banda beállításai elmentve.');
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'A beállításokat most nem sikerült menteni.');
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(member: BandaMember) {
    if (!id || member.role === 'owner') return;
    const nextRole = member.role === 'moderator' ? 'member' : 'moderator';
    setBusyAction({ uid: member.uid, kind: 'role' });
    setError('');
    setMessage('');
    try {
      await api.bandas.updateMemberRole(id, member.uid, nextRole);
      setMembers((current) => current.map((item) => item.uid === member.uid ? { ...item, role: nextRole } : item));
      setMessage(nextRole === 'moderator' ? `${member.username} mostantól moderátor.` : `${member.username} mostantól tag.`);
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'A szerepkört most nem sikerült módosítani.');
    } finally {
      setBusyAction(null);
    }
  }

  async function remove(member: BandaMember) {
    if (!id || !window.confirm(`Biztosan kirúgod ${member.username} felhasználót a bandából?`)) return;
    setBusyAction({ uid: member.uid, kind: 'remove' });
    setError('');
    setMessage('');
    try {
      await api.bandas.removeMember(id, member.uid);
      setMembers((current) => current.filter((item) => item.uid !== member.uid));
      setMessage(`${member.username} eltávolítva a bandából.`);
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'A tagot most nem sikerült eltávolítani.');
    } finally {
      setBusyAction(null);
    }
  }

  async function transfer(member: BandaMember) {
    if (!id || !window.confirm(
      `Biztosan átadod ${member.username} felhasználónak a banda tulajdonjogát? Te moderátor maradsz.`,
    )) return;
    setBusyAction({ uid: member.uid, kind: 'transfer' });
    setError('');
    try {
      await api.bandas.transferOwnership(id, member.uid);
      navigate(`/bandak/${encodeURIComponent(id)}`, { replace: true });
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'A tulajdonjogot most nem sikerült átadni.');
      setBusyAction(null);
    }
  }

  return (
    <>
      <ScreenHeader
        title={`${name} beállításai`}
        backTo={id ? `/bandak/${encodeURIComponent(id)}` : '/kozosseg/bandak'}
        action={settings ? <Button size="sm" loading={saving} onClick={() => void save()}>Mentés</Button> : undefined}
      />
      <div className="screen-body stack banda-settings">
        {loading ? <div className="card">Betöltés…</div> : null}
        {error ? <div className="card banda-settings__error" role="alert">{error}</div> : null}
        {message ? <p className="banda-settings__success" role="status">{message}</p> : null}

        {settings ? (
          <>
            <section className="card stack">
              <div>
                <h2 className="banda-settings__title">Ki hívhat meg tagokat?</h2>
                <p className="banda-settings__hint">Az appon belüli meghívás jogosultsága.</p>
              </div>
              <SegmentedControl options={PERMISSION_OPTIONS} value={settings.whoCanInvite} onChange={(value) => updateSetting('whoCanInvite', value)} label="Meghívási jogosultság" block columns={3} />

              <div>
                <h2 className="banda-settings__title">Ki láthatja a meghívókódot?</h2>
                <p className="banda-settings__hint">Privát bandánál szabályozza a kód megjelenítését.</p>
              </div>
              <SegmentedControl options={PERMISSION_OPTIONS} value={settings.inviteCodeVisibleTo} onChange={(value) => updateSetting('inviteCodeVisibleTo', value)} label="Meghívókód láthatósága" block columns={3} />

              <div>
                <h2 className="banda-settings__title">Ki posztolhat a hírfolyamba?</h2>
                <p className="banda-settings__hint">A chat falra továbbra is minden tag írhat.</p>
              </div>
              <SegmentedControl options={PERMISSION_OPTIONS} value={settings.postPermission} onChange={(value) => updateSetting('postPermission', value)} label="Hírfolyam-posztolási jogosultság" block columns={3} />
            </section>

            <section className="stack">
              <h2 className="banda-settings__section-title">Tagok kezelése</h2>
              <div className="list">
                {members.map((member) => (
                  <div className="banda-settings__member" key={member.uid}>
                    <Avatar url={member.photoURL} name={member.username} size={40} />
                    <span className="banda-settings__member-text">
                      <strong>{member.username}</strong>
                      <Chip variant={member.role === 'owner' ? 'accent' : 'default'}>{ROLE_LABEL[member.role]}</Chip>
                    </span>
                    {member.role !== 'owner' ? (
                      <span className="banda-settings__member-actions">
                        <Button size="sm" variant="secondary" loading={busyAction?.uid === member.uid && busyAction.kind === 'role'} disabled={busyAction !== null} onClick={() => void changeRole(member)}>
                          {member.role === 'moderator' ? 'Legyen tag' : 'Legyen moderátor'}
                        </Button>
                        <Button size="sm" variant="danger" loading={busyAction?.uid === member.uid && busyAction.kind === 'remove'} disabled={busyAction !== null} onClick={() => void remove(member)}>Kirúgás</Button>
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            <section className="stack">
              <div>
                <h2 className="banda-settings__section-title">Tulajdonjog átadása</h2>
                <p className="banda-settings__hint">Az átadás után az új alapító kezeli a beállításokat, te pedig moderátor maradsz.</p>
              </div>
              <div className="list">
                {members.filter((member) => member.role !== 'owner').map((member) => (
                  <div className="banda-settings__transfer" key={member.uid}>
                    <span>{member.username}</span>
                    <Button size="sm" variant="danger" loading={busyAction?.uid === member.uid && busyAction.kind === 'transfer'} disabled={busyAction !== null} onClick={() => void transfer(member)}>Átadás</Button>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}

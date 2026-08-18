import { useEffect, useState } from 'react';
import { Button, ScreenHeader, SegmentedControl, Switch } from '@/components/ui';
import { useProfile } from '@/hooks/ProfileProvider';
import { api } from '@/lib/api';
import './privacy.css';

type Radius = '50' | '100' | '200';

const RADII = [
  { value: '50', label: '50 m' },
  { value: '100', label: '100 m' },
  { value: '200', label: '200 m' },
] as const;

export function PrivacyScreen() {
  const { profile, reload } = useProfile();
  const [hideStart, setHideStart] = useState(true);
  const [startRadius, setStartRadius] = useState<Radius>('200');
  const [hideEnd, setHideEnd] = useState(true);
  const [endRadius, setEndRadius] = useState<Radius>('200');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile) return;
    setHideStart(profile.privacy.hideStart);
    setStartRadius(String(profile.privacy.startRadiusM) as Radius);
    setHideEnd(profile.privacy.hideEnd);
    setEndRadius(String(profile.privacy.endRadiusM) as Radius);
  }, [profile]);

  async function save() {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.updateActivityPrivacy({
        hideStart,
        startRadiusM: Number(startRadius) as 50 | 100 | 200,
        hideEnd,
        endRadiusM: Number(endRadius) as 50 | 100 | 200,
      });
      await reload();
      setMessage(
        result.rebuiltActivities > 0
          ? `${result.rebuiltActivities} aktivitás megosztott térképe frissült.`
          : 'Az adatvédelmi beállítások elmentve.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nem sikerült menteni a beállítást.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <ScreenHeader title="Aktivitás-adatvédelem" backTo="/beallitasok" />
      <div className="screen-body stack privacy-settings">
        <p className="privacy-settings__intro">
          A megosztott útvonal elejét és végét külön-külön elrejtheted. Te továbbra is a
          teljes nyomvonalat látod, a megszerzett területek pedig nyilvánosak maradnak.
        </p>

        <PrivacyZone
          title="Kiindulási pont"
          checked={hideStart}
          onChecked={setHideStart}
          radius={startRadius}
          onRadius={setStartRadius}
          disabled={saving}
        />
        <PrivacyZone
          title="Befejezési pont"
          checked={hideEnd}
          onChecked={setHideEnd}
          radius={endRadius}
          onRadius={setEndRadius}
          disabled={saving}
        />

        <div className="privacy-settings__note">
          A módosítás visszamenőleg minden korábbi aktivitásodra érvényes. Ha a teljes
          útvonal a védőkörön belül van, mások „Az útvonal rejtve” feliratot látnak.
        </div>

        {error ? <p className="field__error" role="alert">{error}</p> : null}
        {message ? <p className="privacy-settings__success" role="status">{message}</p> : null}
        <Button block loading={saving} onClick={() => void save()}>
          Beállítások mentése
        </Button>
      </div>
    </>
  );
}

function PrivacyZone({
  title,
  checked,
  onChecked,
  radius,
  onRadius,
  disabled,
}: {
  title: string;
  checked: boolean;
  onChecked: (value: boolean) => void;
  radius: Radius;
  onRadius: (value: Radius) => void;
  disabled: boolean;
}) {
  return (
    <section className="privacy-zone card">
      <Switch
        checked={checked}
        onChange={onChecked}
        label={`${title} elrejtése`}
        description="A megadott sugarú körön belüli nyomvonal nem kerül a megosztott térképre."
        disabled={disabled}
      />
      <div className={checked ? 'privacy-zone__radius' : 'privacy-zone__radius privacy-zone__radius--off'}>
        <span className="label">Védőkör sugara</span>
        <SegmentedControl
          options={RADII}
          value={radius}
          onChange={onRadius}
          label={`${title} védőkörének sugara`}
          block
          size="sm"
        />
      </div>
    </section>
  );
}

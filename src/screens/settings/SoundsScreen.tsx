import { List, ScreenHeader, Switch } from '@/components/ui';
import { useFeedbackSettings } from '@/hooks/useFeedbackSettings';
import { updateFeedbackSettings } from '@/lib/feedbackSettings';
import { SOUND_LABEL, playSound, unlockSounds, type SoundName } from '@/lib/sound';
import './sounds.css';

/**
 * Beállítások → Hangok.
 *
 * A rögzítés közbeni hangeffektek kapcsolói — Geri kérése (2026-09-01).
 *
 * MIÉRT VAN MELLETTE MEGHALLGATÁS-GOMB? Mert a hangok egy futás közben,
 * másodpercekre szólnak, és ha valaki nem tudja, MELYIK hangról van szó, a
 * kapcsolót sem tudja értelmesen beállítani. A gomb egyben a hangzár
 * feloldását is elvégzi: aki itt egyszer meghallgatta a hangokat, annál a
 * visszaszámlálás első sípja biztosan megszólal.
 *
 * A beállítás ESZKÖZHÖZ tartozik, nem fiókhoz (`lib/feedbackSettings.ts`):
 * ugyanaz a felhasználó a telefonján kérheti a hangot, az asztali
 * böngészőjében nem.
 */

/** Csoportonként: melyik kapcsoló alá milyen hangok tartoznak. */
const GROUPS: readonly {
  key: 'soundCountdown' | 'soundCells' | 'soundLoop' | 'soundActivity';
  label: string;
  description: string;
  sounds: readonly SoundName[];
}[] = [
  {
    key: 'soundActivity',
    label: 'Aktivitásvezérlés',
    description: 'Szünet, folytatás, új kör, befejezés és sikeres mentés.',
    sounds: [
      'pause-activity',
      'resume-activity',
      'new-lap',
      'pressing-finish-activity',
      'finish-activity',
      'activity-saved',
    ],
  },
  {
    key: 'soundCountdown',
    label: 'Indítás',
    description: 'A 3-2-1 visszaszámlálás és a „RAJT!” hangja.',
    sounds: ['count-down-beep', 'count-down-start'],
  },
  {
    key: 'soundLoop',
    label: 'Területszerzés',
    description: 'Amikor bezárod a kört, és megszerzed a területet.',
    sounds: ['loop-closed'],
  },
  {
    key: 'soundCells',
    label: 'Mezők',
    description:
      'Menet közben, minden új mezőnél — aszerint, hogy szabad, a tiéd, ' +
      'maximumon áll, vagy egy másik játékosé.',
    sounds: ['cell-captured', 'cell-defend', 'cell-max', 'cell-stolen'],
  },
];

export function SoundsScreen() {
  const settings = useFeedbackSettings();

  function preview(name: SoundName) {
    // A hangzár feloldása is felhasználói gesztust igényel — ez az.
    unlockSounds();
    /**
     * A MEGHALLGATÁS MINDIG SZÓL, akkor is, ha a csatorna ki van kapcsolva.
     *
     * Ez a gomb nem a rögzítés visszajelzése, hanem a hang azonosítása: aki
     * azt akarja eldönteni, kell-e neki, annak hallania kell. A `settings`
     * felülírása ezért szándékos — a rögzítés útjában lévő `playSound()`
     * hívások továbbra is a valódi beállítást nézik.
     */
    playSound(name, {
      ...settings,
      soundEnabled: true,
      soundCountdown: true,
      soundCells: true,
      soundLoop: true,
      soundActivity: true,
      soundVolume: settings.soundVolume > 0 ? settings.soundVolume : 0.7,
    });
  }

  const muted = !settings.soundEnabled;

  return (
    <>
      <ScreenHeader title="Hangok" backTo="/beallitasok" />

      <div className="screen-body stack">
        <section className="stack stack--tight">
          <div className="label">Hangeffektek</div>
          <List>
            <Switch
              label="Hangeffektek"
              description="Rögzítés közbeni visszajelzés hanggal. Kikapcsolva minden néma marad."
              checked={settings.soundEnabled}
              onChange={(soundEnabled) => {
                unlockSounds();
                updateFeedbackSettings({ soundEnabled });
              }}
            />
          </List>
          <p className="field__hint">
            A beállítás ehhez az eszközhöz tartozik — a telefonodon és a böngésződben külön
            állítható.
          </p>
        </section>

        <section className="stack stack--tight">
          <div className="label">Hangerő</div>
          <div className="sounds__volume">
            <span aria-hidden="true">🔈</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(settings.soundVolume * 100)}
              disabled={muted}
              aria-label="Hangerő"
              onChange={(event) =>
                updateFeedbackSettings({ soundVolume: Number(event.target.value) / 100 })
              }
              onPointerUp={() => preview('cell-captured')}
            />
            <span aria-hidden="true">🔊</span>
            <strong className="sounds__volume-value">
              {Math.round(settings.soundVolume * 100)}%
            </strong>
          </div>
          <p className="field__hint">
            Elengedéskor lejátszunk egy mintát, hogy hallható legyen, mit állítottál be.
          </p>
        </section>

        {GROUPS.map((group) => (
          <section className="stack stack--tight" key={group.key}>
            <div className="label">{group.label}</div>
            <List>
              <Switch
                label={group.label}
                description={group.description}
                checked={settings[group.key]}
                disabled={muted}
                onChange={(value) => updateFeedbackSettings({ [group.key]: value })}
              />
            </List>

            <div className="sounds__previews">
              {group.sounds.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="sounds__preview"
                  onClick={() => preview(name)}
                >
                  <span className="sounds__preview-icon" aria-hidden="true">
                    ▶
                  </span>
                  {SOUND_LABEL[name]}
                </button>
              ))}
            </div>
          </section>
        ))}

        <section className="stack stack--tight">
          <p className="field__hint">
            A hangok a rögzítés képernyőn szólalnak meg, és az admin Simulation LAB E2E
            tesztjeiben is — ott ugyanaz a felület fut, mint élesben.
          </p>
        </section>
      </div>
    </>
  );
}

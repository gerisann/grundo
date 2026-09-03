import { ScreenHeader, SegmentedControl } from '@/components/ui';
import { useGraphicsSettings } from '@/hooks/useGraphicsSettings';
import {
  MAX_RENDER_RADIUS_M,
  MAX_VIEWING_DISTANCE_M,
  MIN_RENDER_RADIUS_M,
  MIN_VIEWING_DISTANCE_M,
  RENDER_RADIUS_STEP_M,
  VIEWING_DISTANCE_STEP_M,
  updateGraphicsSettings,
  type GraphicsQuality,
} from '@/lib/graphicsSettings';
import './graphics.css';

const QUALITY_OPTIONS: readonly { value: GraphicsQuality; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'ultra', label: 'Ultra' },
];

const QUALITY_HINT: Record<GraphicsQuality, string> = {
  low: 'Minimális térképi animáció és részletesség, hosszú rögzítéshez vagy gyengébb telefonhoz.',
  medium: 'Kevesebb térképi részlet és ritkább útvonalfrissítés, jó üzemidővel.',
  high: 'Részletes térkép és folyamatos mozgás, kiegyensúlyozott alapbeállítás.',
  ultra: 'Legnagyobb részletesség és előtöltés erős készülékhez, magasabb fogyasztással.',
};

export function GraphicsScreen() {
  const settings = useGraphicsSettings();

  return (
    <>
      <ScreenHeader title="Grafika" backTo="/beallitasok" />
      <div className="screen-body stack graphics-settings">
        <section className="stack stack--tight">
          <div className="label">Grafikai minőség</div>
          <SegmentedControl
            options={QUALITY_OPTIONS}
            value={settings.quality}
            onChange={(quality) => updateGraphicsSettings({ quality })}
            label="Grafikai minőség"
            block
            columns={2}
          />
          <p className="field__hint">{QUALITY_HINT[settings.quality]}</p>
        </section>

        <section className="stack stack--tight">
          <div className="label">FOV - LÁTÓMEZŐ</div>
          <div className="graphics-settings__range">
            <span aria-hidden="true">−</span>
            <input
              type="range"
              min={MIN_RENDER_RADIUS_M}
              max={MAX_RENDER_RADIUS_M}
              step={RENDER_RADIUS_STEP_M}
              value={settings.renderRadiusM}
              aria-label="FOV - Látómező"
              aria-valuetext={`${settings.renderRadiusM} méter`}
              onChange={(event) => updateGraphicsSettings({ renderRadiusM: Number(event.target.value) })}
            />
            <span aria-hidden="true">＋</span>
            <strong className="graphics-settings__value">{formatRadius(settings.renderRadiusM)}</strong>
          </div>
          <p className="field__hint">
            Rögzítés közben legfeljebb ekkora sugarú terület készül elő a pozíciód körül.
            A képernyőn kívül kis ráhagyást tartunk, hogy forduláskor már készen álljon a térkép.
          </p>
        </section>

        <section className="stack stack--tight">
          <div className="label">LÁTÓTÁVOLSÁG (3D NÉZET)</div>
          <div className="graphics-settings__range">
            <span aria-hidden="true">−</span>
            <input
              type="range"
              min={MIN_VIEWING_DISTANCE_M}
              max={MAX_VIEWING_DISTANCE_M}
              step={VIEWING_DISTANCE_STEP_M}
              value={settings.viewingDistanceM}
              aria-label="Látótávolság 3D nézetben"
              aria-valuetext={`${settings.viewingDistanceM} méter`}
              onChange={(event) => updateGraphicsSettings({ viewingDistanceM: Number(event.target.value) })}
            />
            <span aria-hidden="true">＋</span>
            <strong className="graphics-settings__value">{formatRadius(settings.viewingDistanceM)}</strong>
          </div>
          <p className="field__hint">
            A bedöntött 3D térkép eddig a távolságig tölt be. A 2D nézetet ez nem befolyásolja.
          </p>
        </section>

        <p className="graphics-settings__note">
          Ezek a beállítások csak a térkép animációjára, részletességére, valamint a cellák és
          az útvonal kirajzolására hatnak. A menük, szövegek és a GRUNDO megjelenése nem változik.
        </p>
      </div>
    </>
  );
}

function formatRadius(meters: number): string {
  return meters >= 1_000 ? `${(meters / 1_000).toLocaleString('hu-HU')} km` : `${meters} m`;
}

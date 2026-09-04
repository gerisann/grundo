import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPersonBiking, faPersonRunning } from '@fortawesome/free-solid-svg-icons';
import type { Layer } from '@/types';
import './layerSwitch.css';

/**
 * Gyalogos ⇄ bringás váltó — kétállású kapcsoló.
 *
 * Miért nem `SegmentedControl`? Mert az három vagy több lehetőségre való, és
 * ott minden elem egyenrangú. Itt viszont KÉT állapot van, egymás
 * ellentéteként — erre a csúszkás kapcsoló a bevett forma: egy pillantásra
 * látszik, melyik oldalon állsz, és koppintásra átbillen.
 *
 * A két réteg két külön játék: ugyanazt a cellát más birtokolhatja gyalog és
 * bringával. Ezért nem szűrő, hanem VÁLTÓ — nem szűkíti a nézetet, hanem
 * kicseréli.
 */

export interface LayerSwitchProps {
  value: Layer;
  onChange: (value: Layer) => void;
}

export function LayerSwitch({ value, onChange }: LayerSwitchProps) {
  const isBike = value === 'bike';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isBike}
      aria-label="Réteg: gyalogos vagy bringás"
      className={`layersw${isBike ? ' layersw--bike' : ''}`}
      onClick={() => onChange(isBike ? 'foot' : 'bike')}
    >
      {/* A csúszka a feliratok ALATT van, ezért a szöveg mindkét állásban
          olvasható marad — a kiemelés nem takarja el. */}
      <span className="layersw__thumb" aria-hidden="true" />
      <span className={`layersw__option${isBike ? '' : ' layersw__option--on'}`}>
        <FontAwesomeIcon icon={faPersonRunning} aria-hidden="true" />
        Séta/Futás
      </span>
      <span className={`layersw__option${isBike ? ' layersw__option--on' : ''}`}>
        <FontAwesomeIcon icon={faPersonBiking} aria-hidden="true" />
        Bringa
      </span>
    </button>
  );
}

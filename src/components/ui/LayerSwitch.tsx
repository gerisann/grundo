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
      <span className="layersw__option">
        <FootIcon />
        Gyalogos
      </span>
      <span className="layersw__option">
        <BikeIcon />
        Bringás
      </span>
    </button>
  );
}

const icon = {
  width: 17,
  height: 17,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function FootIcon() {
  return (
    <svg {...icon}>
      <path d="M13 4a3 3 0 0 1 3 3c0 2.5-2 4-2 6v3a3 3 0 0 1-6 0v-2c0-2-2-3.2-2-6a4 4 0 0 1 4-4z" />
      <path d="M8 19h6" />
    </svg>
  );
}

function BikeIcon() {
  return (
    <svg {...icon}>
      <circle cx="5.5" cy="17" r="3.5" />
      <circle cx="18.5" cy="17" r="3.5" />
      <path d="M5.5 17 10 8h5l3.5 9M9 8h5" />
    </svg>
  );
}

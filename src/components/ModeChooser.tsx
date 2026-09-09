import { useState } from 'react';
import { Button, Checkbox } from '@/components/ui';
import type { AppMode } from '@/lib/debugMode';
import './debug.css';

/**
 * Üzemmód-választó indításkor — CSAK a tesztelői körnek.
 *
 * ⚠️ Ez a képernyő soha nem jelenhet meg a valódi felhasználónak: az App Store
 * és a Play felülvizsgálója is látná, a felhasználók fele pedig véletlenül
 * „Debug"-ot választana. A kaput a `debugModeAvailable()` adja, a hívó
 * (`DebugLayer`) pedig meg sem jeleníti enélkül.
 *
 * docs/ai/terv-2026-09-09-bugreport-rendszer.md → 2.
 */

export function ModeChooser({
  current,
  onChoose,
}: {
  current: AppMode;
  onChoose: (mode: AppMode, askAgain: boolean) => void;
}) {
  const [askAgain, setAskAgain] = useState(true);

  return (
    <div className="dbg-mode" role="dialog" aria-label="Üzemmód választása">
      <div className="dbg-mode__panel">
        <span className="dbg-mode__title">Milyen módban indulj?</span>
        <p className="dbg-mode__lead">
          Ezt a kérdést csak a tesztelői kör kapja. A választás bármikor módosítható a
          Beállításokban.
        </p>

        <div className="dbg-mode__options">
          <button
            type="button"
            className={`dbg-mode__option${current === 'normal' ? ' dbg-mode__option--on' : ''}`}
            onClick={() => onChoose('normal', askAgain)}
          >
            <span className="dbg-mode__option-name">Normál</span>
            <span className="dbg-mode__option-help">
              Pontosan az, amit a felhasználó lát. Semmilyen fejlesztői eszköz nem fut.
            </span>
          </button>

          <button
            type="button"
            className={`dbg-mode__option${current === 'debug' ? ' dbg-mode__option--on' : ''}`}
            onClick={() => onChoose('debug', askAgain)}
          >
            <span className="dbg-mode__option-name">Debug</span>
            <span className="dbg-mode__option-help">
              Lebegő hibabejelentő gomb és napló. A napló a hibakereséshez gyűjti, mi történt —
              helyadatot nem tartalmaz.
            </span>
          </button>
        </div>

        <div className="dbg-mode__ask">
          <Checkbox checked={!askAgain} onChange={(checked) => setAskAgain(!checked)}>
            Ne kérdezd többet, indulj a legutóbbi módban
          </Checkbox>
        </div>

        <Button variant="ghost" block onClick={() => onChoose(current, askAgain)}>
          Maradjon a legutóbbi ({current === 'debug' ? 'Debug' : 'Normál'})
        </Button>
      </div>
    </div>
  );
}

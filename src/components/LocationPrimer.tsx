import { useCallback, useSyncExternalStore } from 'react';
import './locationPrimer.css';

/**
 * MAGYARÁZAT A RENDSZER ENGEDÉLYKÉRÉSE ELŐTT.
 *
 * ⚠️ MÉRT HIBA (Jeff, iPhone 17 Pro Max, 2026-09-09): az első használatnál
 * többször is helyzet-engedélyt kellett adnia, és nem értette, miért. A
 * rendszerpárbeszéd magában nem mondja el, hogy a GRUNDO-nak MIÉRT kell a
 * helyzet, és azt sem, hogy egy MÁSODIK kérdés is jön — az iOS a lezárt
 * képernyős rögzítéshez külön, „Mindig” szintű engedélyt kér.
 *
 * Ez a képernyő ezt előre elmondja: mi fog megjelenni, mire nyomjon, és miért.
 * Az Apple ajánlása is ez (pre-permission priming): a rendszerkérdésre csak az
 * jusson el, aki már tudja, mire mond igent — egy elutasított engedélyt
 * ugyanis az appból többé nem lehet újra kérni, csak a Beállításokban.
 *
 * ⚠️ NEM HELYETTESÍTI a rendszerpárbeszédet, és nem is kerüli meg: a
 * „Folytatás” után jön a valódi kérdés, változatlanul.
 */

const STORAGE_KEY = 'grundo.locationPrimerSeen';

/** A `localStorage` privát módban dobhat — a rögzítés sosem múlhat ezen. */
function readSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Ha nem tudjuk megjegyezni, inkább ne mutassuk újra és újra.
    return true;
  }
}

const listeners = new Set<() => void>();
let seen = readSeen();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markLocationPrimerSeen(): void {
  if (seen) return;
  seen = true;
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* A memóriában akkor is beáll — ebben a munkamenetben nem jön elő újra. */
  }
  for (const listener of listeners) listener();
}

/** Látta már a felhasználó a magyarázatot ezen az eszközön? */
export function useLocationPrimerSeen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => seen,
    () => true,
  );
}

export function LocationPrimer({ onContinue }: { onContinue: () => void }) {
  const confirm = useCallback(() => {
    markLocationPrimerSeen();
    onContinue();
  }, [onContinue]);

  return (
    <div className="loc-primer" role="dialog" aria-modal="true" aria-labelledby="loc-primer-title">
      <div className="loc-primer__card">
        <h2 className="loc-primer__title" id="loc-primer-title">
          A GRUNDO-nak kell a helyzeted
        </h2>
        <p className="loc-primer__lead">
          Enélkül nincs mit rögzíteni: a megtett út és a bezárt terület is a helyadatból
          születik. A következő lépésben a telefonod fog kérdezni — itt elmondjuk előre, mi
          jön.
        </p>

        <ol className="loc-primer__steps">
          <li>
            <strong>Először</strong> ezt kérdezi:{' '}
            <em>„Engedélyezed a helyadatok használatát?”</em> — válaszd a{' '}
            <strong>„Alkalmazás használata közben”</strong> lehetőséget.
          </li>
          <li>
            <strong>Utána</strong> jöhet egy második kérdés a{' '}
            <strong>„Mindig”</strong> engedélyről. Ez ahhoz kell, hogy a rögzítés{' '}
            <strong>zárolt képernyőnél és zsebben is</strong> menjen tovább. Enélkül a mérés
            megáll, amint elteszed a telefont.
          </li>
        </ol>

        <p className="loc-primer__note">
          A helyadatot csak a saját aktivitásaidhoz használjuk. Ha most nemet mondasz, később
          csak a telefon Beállításaiban tudod megadni.
        </p>

        <button type="button" className="loc-primer__cta" onClick={confirm}>
          Értem, mehet
        </button>
      </div>
    </div>
  );
}

import { useCallback, useSyncExternalStore } from 'react';
import { isNativeIos } from '@/lib/platform';
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
 * ⚠️ NEM HELYETTESÍTI a rendszerpárbeszédet, és nem is kerüli meg: az
 * „Értem, mehet” után jön a valódi kérdés, változatlanul.
 *
 * ⚠️ MÁSODIK MÉRT HIBA (Geri, iPhone, 2026-09-09): a magyarázat MEGJELENT, de
 * a rendszer kérdése azonnal ráugrott — olvasni sem lehetett. Az ok nem itt
 * volt, hanem a `TrackingScreen`-ben: a `useSharedPosition` a képernyő
 * mountján kért helyzetet, a magyarázattól függetlenül. A magyarázó képernyő
 * ezért csak akkor ér valamit, ha a helyzetkérés IS a nyugtázás mögé kerül —
 * lásd ott a `primerSeen` átadását.
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
  /**
   * A második, ANGOL nyelvű kérdés csak a natív iOS appban jön elő — a
   * WebKit oldal-szintű engedélykérése. Weben és Androidon nem mértük, ezért
   * ott nem is állítunk róla semmit.
   */
  const ios = isNativeIos();

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
          születik. Amint a lenti gombra koppintasz, <strong>a telefonod kezd kérdezni</strong>{' '}
          — itt elmondjuk előre, pontosan mi jön, és mire nyomj.
        </p>

        {/*
          ⚠️ A LÉPÉSEK A MÉRT VALÓSÁGOT ÍRJÁK LE, NEM AZ ELVÁRTAT — a
          rendszerablakok SZÓ SZERINTI szövegével és a helyes válasszal.

          Korábban három ablak jött, és a második angol nyelvű, „localhost"
          nevű kérdés volt (mérve: iPhone, 2026-09-09). Az a WebKit
          oldal-szintű engedélykérése volt, amit a `navigator.geolocation`
          hívása váltott ki — azóta natívban a saját pluginünk adja az
          egyszeri fixet (`src/lib/currentPosition.ts`), tehát az az ablak
          nem jön többé. Ha valaha visszatérne, az azt jelenti, hogy valahol
          újra közvetlen `navigator.geolocation` hívás került a kódba.
        */}
        <ol className="loc-primer__steps">
          <li>
            <strong>Először</strong> a telefon kérdez:{' '}
            <em>„Engedélyezi a GRUNDO számára, hogy használja az Ön helyzetét?”</em> — válaszd
            az <strong>„Az app használata közben”</strong> lehetőséget.
          </li>
          <li>
            <strong>Utána</strong>, amikor elindítod a rögzítést, a telefon rákérdez arra is,
            hogy használhatja-e a helyzetedet <em>akkor is, ha nem használod az appot</em>. Ez
            ahhoz kell, hogy a mérés <strong>zárolt képernyőnél és zsebben is</strong> menjen
            tovább — válaszd a{' '}
            {ios ? (
              <strong>„Módosítás Engedélyezés mindig értékre”</strong>
            ) : (
              <strong>„Mindig engedélyezve”</strong>
            )}{' '}
            lehetőséget. Enélkül a mérés megáll, amint elteszed a telefont.
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

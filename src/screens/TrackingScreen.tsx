import { Placeholder } from '@/components/Placeholder';

/**
 * Rögzítés — a projekt legkockázatosabb képernyője.
 *
 * Állapotok: indítás előtt · aktív · szüneteltetve · összegzés és mentés.
 *
 * FIGYELEM (docs/06 → Kockázatok): a háttér-GPS megbízhatósága iOS-en a
 * kritikus út. Ezt kell először valós terepen kipróbálni — natív plugin,
 * "Allow all the time" engedély, foreground service / Live Activity.
 * A nyomvonal offline is rögzül (SQLite), a feltöltés később megy.
 */
export function TrackingScreen() {
  return (
    <Placeholder title="Rögzítés" spec="docs/02-funkcionalis-spec.md → Aktivitás rögzítése">
      Itt lesz a térkép, az élő adatok és a hexagon-nyom, ami bezáráskor kitöltődik.
    </Placeholder>
  );
}

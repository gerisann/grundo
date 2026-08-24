import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { AdminHomeScreen } from './AdminHomeScreen';
import { GameplayScreen } from './GameplayScreen';
import { ModifiersScreen } from './ModifiersScreen';
import { ActivityAuditScreen } from './ActivityAuditScreen';
import { ReplayScreen } from './ReplayScreen';
import { SimulationLabScreen } from './SimulationLabScreen';

/**
 * Az admin terület egyetlen belépési pontja.
 *
 * Alapértelmezett export, mert az `App.tsx` `React.lazy()`-vel tölti be: így az
 * egész terület — a szerkesztők, az audit és a visszajátszó — külön
 * JS-darabban van, amit a játékos böngészője soha nem kér le.
 *
 * A `docs/06` szerinti forma-döntés (lusta `/admin` terület külön alkalmazás
 * helyett) ezen a fájlon áll vagy bukik: ha ide bekerül egy statikus import a
 * játékos-képernyőkből, a szétválasztás megszűnik, és a chunk visszaolvad.
 */
export default function AdminArea() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<AdminHomeScreen />} />
        <Route path="jatekszabalyok" element={<GameplayScreen />} />
        <Route path="akciok" element={<ModifiersScreen />} />
        <Route path="aktivitasok" element={<ActivityAuditScreen />} />
        <Route path="visszajatszas" element={<ReplayScreen />} />
        <Route path="lab" element={<SimulationLabScreen />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}

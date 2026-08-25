import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { AdminHomeScreen } from './AdminHomeScreen';
import { GameplayScreen } from './GameplayScreen';
import { ModifiersScreen } from './ModifiersScreen';
import { ActivityAuditScreen } from './ActivityAuditScreen';
import { ReplayScreen } from './ReplayScreen';
import { SimulationLabScreen } from './SimulationLabScreen';
import { LabE2eLauncherScreen } from './LabE2eLauncherScreen';
import { LabE2eTrackingScreen } from './LabE2eTrackingScreen';

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
        <Route path="lab/e2e" element={<LabE2eLauncherScreen />} />
        <Route path="lab/e2e/:sessionId" element={<LabE2eTrackingScreen />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}

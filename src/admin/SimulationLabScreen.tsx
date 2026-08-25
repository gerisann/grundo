import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import { SimulationLabScenarioScreen } from './SimulationLabScenarioScreen';

export function SimulationLabScreen() {
  const navigate = useNavigate();
  return (
    <>
      <SimulationLabScenarioScreen />
      <div
        style={{
          position: 'fixed',
          right: 18,
          bottom: 18,
          zIndex: 120,
          filter: 'drop-shadow(0 8px 18px rgba(0,0,0,.22))',
        }}
      >
        <Button onClick={() => navigate('/admin/lab/e2e')}>
          E2E · Éles UI
        </Button>
      </div>
    </>
  );
}

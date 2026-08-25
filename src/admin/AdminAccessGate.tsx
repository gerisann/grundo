import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import { ApiError, api } from '@/lib/api';

/** Ugyanaz a szerveroldali role-check, mint az AdminLayoutban, layout nélkül. */
export function AdminAccessGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [state, setState] = useState<'loading' | 'allowed' | 'denied' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    void api.adminStatus().then(() => {
      if (alive) setState('allowed');
    }).catch((error: unknown) => {
      if (!alive) return;
      if (error instanceof ApiError && error.status === 403) setState('denied');
      else {
        setMessage(error instanceof Error ? error.message : 'Ismeretlen hiba.');
        setState('error');
      }
    });
    return () => { alive = false; };
  }, []);

  if (state === 'allowed') return <>{children}</>;
  if (state === 'loading') return <main className="admin-gate"><p>Admin jogosultság ellenőrzése…</p></main>;
  if (state === 'denied') {
    return (
      <main className="admin-gate">
        <h1>Ehhez nincs jogosultságod</h1>
        <Button onClick={() => navigate('/')}>Vissza a GRUNDO-ba</Button>
      </main>
    );
  }
  return (
    <main className="admin-gate">
      <h1>Nem sikerült ellenőrizni az admin jogosultságot</h1>
      <p>{message}</p>
      <Button onClick={() => window.location.reload()}>Újrapróbálom</Button>
    </main>
  );
}

import { useState, type FormEvent } from 'react';
import { Button, TextField } from '@/components/ui';
import { useAuth } from '@/hooks/AuthProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import { validateUsername } from '@/lib/validation';
import './auth.css';

/**
 * Felhasználónév-választó azoknak, akiknek van Firebase-fiókjuk, de még
 * nincs GRUNDO-profiljuk.
 *
 * Ez nem elméleti eset: minden fiók, ami a backend előtt jött létre, ide fut
 * be — és a felhasználónév lefoglalása csak itt történik meg, tranzakcióban.
 */
export function CompleteProfileScreen() {
  const { user, signOut } = useAuth();
  const { createProfile } = useProfile();

  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    const problem = validateUsername(username);
    setError(problem ?? '');
    if (problem) return;

    setBusy(true);
    try {
      await createProfile(username.trim().toLowerCase());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Nem sikerült létrehozni a profilt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div>
        <h1 className="auth__brand">GRUNDO</h1>
        <p className="auth__tagline">Már csak egy név kell.</p>
      </div>

      <form className="auth__form" onSubmit={submit} noValidate>
        {formError ? (
          <div className="auth__error" role="alert">
            {formError}
          </div>
        ) : null}

        <div className="auth__notice">
          Be vagy jelentkezve mint <strong>{user?.email}</strong>, de még nincs
          felhasználóneved. Válassz egyet — ez látszik majd a ranglistán.
        </div>

        <TextField
          label="Felhasználónév"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={error}
          hint="3–20 karakter: kisbetű, szám, pont, alulvonás. Később nem módosítható."
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
        />

        <Button type="submit" block loading={busy}>
          Profil létrehozása
        </Button>

        <p className="auth__switch">
          <button type="button" className="auth__link" onClick={() => void signOut()}>
            Kijelentkezés
          </button>
        </p>
      </form>
    </main>
  );
}

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, TextField } from '@/components/ui';
import { useAuth } from '@/hooks/AuthProvider';
import { authErrorMessage } from '@/lib/authErrors';
import { validateEmail } from '@/lib/validation';
import { FirebaseNotice } from './FirebaseNotice';
import './auth.css';

export function ForgotPasswordScreen() {
  const navigate = useNavigate();
  const { sendPasswordReset, status } = useAuth();

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    const e = validateEmail(email);
    setError(e ?? '');
    if (e) return;

    setBusy(true);
    try {
      await sendPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setFormError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div>
        <h1 className="auth__brand">GRUNDO</h1>
        <p className="auth__tagline">Jelszó visszaállítása</p>
      </div>

      <form className="auth__form" onSubmit={submit} noValidate>
        <FirebaseNotice />
        {formError ? (
          <div className="auth__error" role="alert">
            {formError}
          </div>
        ) : null}

        {sent ? (
          <>
            <div className="auth__notice">
              Elküldtük a visszaállító linket a <strong>{email}</strong> címre. Nézd meg a
              levélszemetet is.
            </div>
            <Button block onClick={() => navigate('/belepes')}>
              Vissza a belépéshez
            </Button>
          </>
        ) : (
          <>
            <TextField
              label="E-mail-cím"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error}
              hint="Küldünk egy linket, amivel új jelszót adhatsz meg."
              autoComplete="email"
              inputMode="email"
            />
            <Button type="submit" block loading={busy} disabled={status === 'unconfigured'}>
              Link küldése
            </Button>
            <p className="auth__switch">
              <button type="button" className="auth__link" onClick={() => navigate('/belepes')}>
                Mégsem, vissza a belépéshez
              </button>
            </p>
          </>
        )}
      </form>
    </main>
  );
}

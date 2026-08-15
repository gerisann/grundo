import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, TextField } from '@/components/ui';
import { useAuth } from '@/hooks/AuthProvider';
import { authErrorMessage, isAccountLinkError } from '@/lib/authErrors';
import { validateEmail } from '@/lib/validation';
import { FirebaseNotice } from './FirebaseNotice';
import './auth.css';

export function LoginScreen() {
  const navigate = useNavigate();
  const { signInWithEmail, signInWithGoogle, status } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [linkHint, setLinkHint] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    setLinkHint(false);

    const next: Record<string, string> = {};
    const e = validateEmail(email);
    if (e) next.email = e;
    if (!password) next.password = 'Adj meg egy jelszót.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      await signInWithEmail(email.trim(), password);
      navigate('/');
    } catch (error) {
      setFormError(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setFormError('');
    setLinkHint(false);
    setBusy(true);
    try {
      await signInWithGoogle();
      navigate('/');
    } catch (error) {
      setFormError(authErrorMessage(error));
      // A leggyakoribb eset: ugyanaz az e-mail már jelszóval regisztrált.
      // Ilyenkor nem elég a hibaüzenet — meg kell mutatni a kivezető utat.
      if (isAccountLinkError(error)) setLinkHint(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div>
        <h1 className="auth__brand">GRUNDO</h1>
        <p className="auth__tagline">Üdv újra. Folytassuk ott, ahol abbahagytad.</p>
      </div>

      <form className="auth__form" onSubmit={submit} noValidate>
        <FirebaseNotice />
        {formError ? (
          <div className="auth__error" role="alert">
            {formError}
          </div>
        ) : null}
        {linkHint ? (
          <div className="auth__notice">
            Lépj be a jelszavaddal, majd a <strong>Beállítások → Bejelentkezési módok</strong>{' '}
            alatt kapcsold össze a Google-fiókoddal. Utána bármelyikkel beléphetsz.
          </div>
        ) : null}

        <TextField
          label="E-mail-cím"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          autoComplete="email"
          inputMode="email"
        />

        <TextField
          label="Jelszó"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          autoComplete="current-password"
        />

        <div style={{ textAlign: 'right', marginTop: 'calc(-1 * var(--sp-2))' }}>
          <button
            type="button"
            className="auth__link"
            onClick={() => navigate('/elfelejtett-jelszo')}
          >
            Elfelejtetted a jelszavad?
          </button>
        </div>

        <Button type="submit" block loading={busy} disabled={status === 'unconfigured'}>
          Belépés
        </Button>

        <div className="auth__divider">vagy</div>

        <Button variant="secondary" block onClick={google} disabled={busy || status === 'unconfigured'}>
          Folytatás Google-fiókkal
        </Button>

        <p className="auth__switch">
          Még nincs fiókod?{' '}
          <button type="button" className="auth__link" onClick={() => navigate('/regisztracio')}>
            Regisztrálj
          </button>
        </p>
      </form>
    </main>
  );
}

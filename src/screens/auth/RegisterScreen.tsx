import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Checkbox, TextField } from '@/components/ui';
import { useAuth } from '@/hooks/AuthProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import { apiConfigured } from '@/lib/api';
import { authErrorMessage } from '@/lib/authErrors';
import {
  STRENGTH_LABEL,
  passwordStrength,
  validateEmail,
  validatePassword,
  validateUsername,
} from '@/lib/validation';
import { FirebaseNotice } from './FirebaseNotice';
import './auth.css';

export function RegisterScreen() {
  const navigate = useNavigate();
  const { registerWithEmail, signInWithGoogle, status } = useAuth();
  const { createProfile } = useProfile();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const strength = passwordStrength(password);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError('');

    const next: Record<string, string> = {};
    const u = validateUsername(username);
    const e = validateEmail(email);
    const p = validatePassword(password);
    if (u) next.username = u;
    if (e) next.email = e;
    if (p) next.password = p;
    if (!terms) next.terms = 'Az elfogadás kötelező.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      const normalized = username.trim().toLowerCase();
      await registerWithEmail({ username: normalized, email: email.trim(), password });

      // A felhasználónév LEFOGLALÁSA szerveroldalon történik, tranzakcióban —
      // enélkül két egyszerre regisztráló ugyanazt a nevet kaphatná meg.
      // Ha ez elbukik (pl. időközben elvitték a nevet), a Firebase-fiók már
      // létezik: a ProfileProvider `missing` állapotba kerül, és a
      // felhasználónév-választó képernyő veszi át.
      if (apiConfigured) await createProfile(normalized);

      navigate('/');
    } catch (error) {
      setFormError(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setFormError('');
    setBusy(true);
    try {
      await signInWithGoogle();
      navigate('/');
    } catch (error) {
      setFormError(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div>
        <h1 className="auth__brand">GRUNDO</h1>
        <p className="auth__tagline">Hozz létre fiókot, és foglald el a városod.</p>
      </div>

      <form className="auth__form" onSubmit={submit} noValidate>
        <FirebaseNotice />
        {formError ? (
          <div className="auth__error" role="alert">
            {formError}
          </div>
        ) : null}

        <TextField
          label="Felhasználónév"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={errors.username}
          hint="3–20 karakter: kisbetű, szám, pont, alulvonás."
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
        />

        <TextField
          label="E-mail-cím"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          autoComplete="email"
          inputMode="email"
        />

        <div>
          <TextField
            label="Jelszó"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            autoComplete="new-password"
          />
          {password && !errors.password ? (
            <div className={`strength strength--${strength}`}>
              <span className="strength__bar">
                <span className="strength__fill" />
              </span>
              <span className="strength__label">{STRENGTH_LABEL[strength]}</span>
            </div>
          ) : null}
        </div>

        <Checkbox checked={terms} onChange={setTerms} error={errors.terms}>
          Elfogadom az <a href="/jogi/aszf">Általános Szerződési Feltételeket</a> és az{' '}
          <a href="/jogi/adatvedelem">Adatvédelmi tájékoztatót</a>.
        </Checkbox>

        <Button type="submit" block loading={busy} disabled={status === 'unconfigured'}>
          Fiók létrehozása
        </Button>

        <div className="auth__divider">vagy</div>

        <Button variant="secondary" block onClick={google} disabled={busy || status === 'unconfigured'}>
          Folytatás Google-fiókkal
        </Button>

        <p className="auth__switch">
          Van már fiókod?{' '}
          <button type="button" className="auth__link" onClick={() => navigate('/belepes')}>
            Lépj be
          </button>
        </p>
      </form>
    </main>
  );
}

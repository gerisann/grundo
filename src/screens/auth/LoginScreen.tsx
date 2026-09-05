import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, TextField } from '@/components/ui';
import { AuthBrand } from './AuthBrand';
import { useAuth } from '@/hooks/AuthProvider';
import { authErrorMessage, isAccountLinkError, isGoogleAccountError } from '@/lib/authErrors';
import { validateEmail } from '@/lib/validation';
import { FirebaseNotice } from './FirebaseNotice';
import './auth.css';

export function LoginScreen() {
  const navigate = useNavigate();
  const { signInWithIdentifier, signInWithGoogle, status } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [linkHint, setLinkHint] = useState(false);
  /** Google-fiókkal regisztrált, de jelszóval próbálkozik. */
  const [googleHint, setGoogleHint] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    setLinkHint(false);

    const next: Record<string, string> = {};
    const value = email.trim();
    /**
     * A mező kétféle bemenetet fogad, ezért az ellenőrzés is kétféle.
     * Csak akkor kérünk szabályos e-mail-címet, ha a beírt szöveg `@`-ot
     * tartalmaz — különben felhasználónévnek tekintjük, és a szerver dönti el,
     * létezik-e. (Itt szándékosan nem ellenőrizzük a névformátumot: a régebbi
     * fiókok neve nem feltétlenül felel meg a mai szabálynak.)
     */
    if (!value) next.email = 'Add meg az e-mail-címed vagy a felhasználóneved.';
    else if (value.includes('@')) {
      const e = validateEmail(value);
      if (e) next.email = e;
    }
    if (!password) next.password = 'Adj meg egy jelszót.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      await signInWithIdentifier(value, password);
      navigate('/');
    } catch (error) {
      /**
       * A Google-fiókos eset NEM sima hibaüzenet.
       *
       * Ehhez a fiókhoz nincs jelszó, tehát az újrapróbálkozás sosem sikerül.
       * A felhasználónak nem azt kell mondani, hogy „hibás adat", hanem hogy
       * merre menjen — ezért kap egy gombot is, nem csak szöveget.
       */
      if (isGoogleAccountError(error)) {
        setGoogleHint(true);
        setFormError('');
      } else {
        setFormError(authErrorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setFormError('');
    setLinkHint(false);
    setGoogleHint(false);
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
        <AuthBrand />
        <p className="auth__tagline">Üdv újra! Készen állsz egy új kalandra?</p>
      </div>

      <form className="auth__form" onSubmit={submit} noValidate>
        <FirebaseNotice />
        {formError ? (
          <div className="auth__error" role="alert">
            {formError}
          </div>
        ) : null}
        {googleHint ? (
          <div className="auth__notice">
            <strong>Szia! Ezt a fiókot Google-fiókkal hoztad létre.</strong>{' '}
            Jelszó nem tartozik hozzá, ezért a lenti <strong>Belépés Google-fiókkal</strong>{' '}
            gombbal tudsz bejelentkezni.
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <Button size="sm" onClick={() => void google()} disabled={busy}>
                Belépés Google-fiókkal
              </Button>
            </div>
          </div>
        ) : null}

        {linkHint ? (
          <div className="auth__notice">
            Lépj be a jelszavaddal, majd a <strong>Beállítások → Bejelentkezési módok</strong>{' '}
            alatt kapcsold össze a Google-fiókoddal. Utána bármelyikkel beléphetsz.
          </div>
        ) : null}

        <TextField
          label="E-mail-cím vagy felhasználónév"
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          // `username`, nem `email`: a jelszókezelők így mindkét alakot
          // felkínálják, és nem erőltetik rá a címformátumot a névre.
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
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

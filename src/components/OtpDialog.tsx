import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import './otp.css';

/**
 * E-mail hitelesítés 6 jegyű kóddal.
 * docs/02-funkcionalis-spec.md → Onboarding, 3. lépés
 */

export interface OtpDialogProps {
  email: string;
  onVerified: () => void;
  onClose: () => void;
}

const LENGTH = 6;

export function OtpDialog({ email, onVerified, onClose }: OtpDialogProps) {
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(''));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const code = digits.join('');
  const complete = code.length === LENGTH;

  // Első betöltéskor küldünk kódot
  useEffect(() => {
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Újraküldési visszaszámláló
  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [wait]);

  async function send() {
    setError('');
    setBusy(true);
    try {
      const result = await api.otpSend();
      if (result.alreadyVerified) {
        onVerified();
        return;
      }
      setWait(result.waitSeconds || 60);
      setNotice(
        result.devCode
          ? `Fejlesztői mód — nincs beállítva e-mail-szolgáltató. A kód: ${result.devCode}`
          : 'Elküldtük a kódot. Nézd meg a levélszemetet is.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nem sikerült elküldeni a kódot.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    setError('');
    setBusy(true);
    try {
      await api.otpVerify(value);
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'A kód nem érvényes.');
      setDigits(Array(LENGTH).fill(''));
      inputs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  function setDigit(index: number, value: string) {
    const clean = value.replace(/\D/g, '');
    if (!clean) {
      const next = [...digits];
      next[index] = '';
      setDigits(next);
      return;
    }

    // Beillesztett teljes kód kezelése
    if (clean.length > 1) {
      const next = clean.slice(0, LENGTH).split('');
      const padded = [...next, ...Array(LENGTH - next.length).fill('')];
      setDigits(padded);
      if (padded.join('').length === LENGTH) void verify(padded.join(''));
      return;
    }

    const next = [...digits];
    next[index] = clean;
    setDigits(next);
    if (index < LENGTH - 1) inputs.current[index + 1]?.focus();
    if (next.join('').length === LENGTH) void verify(next.join(''));
  }

  return (
    <div className="otp__backdrop" role="dialog" aria-modal="true" aria-label="E-mail hitelesítés">
      <div className="otp__sheet">
        <div className="otp__head">
          <h2 className="otp__title">Hitelesítsd az e-mail-címed</h2>
          <button type="button" className="otp__close" aria-label="Bezárás" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="otp__lead">
          Elküldtük a 6 jegyű kódot a <strong>{email}</strong> címre. A kód 15 percig érvényes.
        </p>

        <div className="otp__inputs">
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(el) => {
                inputs.current[index] = el;
              }}
              className="otp__digit"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={LENGTH}
              value={digit}
              aria-label={`${index + 1}. számjegy`}
              onChange={(e) => setDigit(index, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !digits[index] && index > 0) {
                  inputs.current[index - 1]?.focus();
                }
              }}
            />
          ))}
        </div>

        {error ? (
          <p className="otp__error" role="alert">
            {error}
          </p>
        ) : notice ? (
          <p className="otp__notice">{notice}</p>
        ) : null}

        <Button block loading={busy} disabled={!complete} onClick={() => void verify(code)}>
          Hitelesítés
        </Button>

        <button
          type="button"
          className="auth__link otp__resend"
          disabled={wait > 0 || busy}
          onClick={() => void send()}
        >
          {wait > 0 ? `Újraküldés ${wait} mp múlva` : 'Kód újraküldése'}
        </button>
      </div>
    </div>
  );
}

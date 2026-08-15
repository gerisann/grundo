/**
 * Beviteli szabályok — a specifikációból.
 * docs/02-funkcionalis-spec.md → Regisztráció
 */

/** 3–20 karakter, csak a-z 0-9 . _ ; kisbetűsítve egyedi. */
const USERNAME_PATTERN = /^[a-z0-9._]{3,20}$/;

/** Foglalt szavak — ezekre nem lehet regisztrálni. */
const RESERVED = new Set([
  'admin', 'administrator', 'grund', 'grundo', 'support', 'help', 'root',
  'system', 'moderator', 'mod', 'official', 'team', 'api', 'null', 'undefined',
]);

export function validateUsername(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return 'Adj meg egy felhasználónevet.';
  if (value.length < 3) return 'Legalább 3 karakter kell.';
  if (value.length > 20) return 'Legfeljebb 20 karakter lehet.';
  if (!USERNAME_PATTERN.test(value)) {
    return 'Csak kisbetű, szám, pont és alulvonás használható.';
  }
  if (RESERVED.has(value)) return 'Ez a név foglalt.';
  return null;
}

export function validateEmail(raw: string): string | null {
  const value = raw.trim();
  if (!value) return 'Adj meg egy e-mail-címet.';
  // Szándékosan megengedő: a valódi ellenőrzés az OTP-s hitelesítés.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return 'Ez nem érvényes e-mail-cím.';
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return 'Adj meg egy jelszót.';
  if (value.length < 8) return 'Legalább 8 karakter kell.';
  return null;
}

export type PasswordStrength = 'weak' | 'fair' | 'strong';

/** Egyszerű, magyarázható erősségjelző — nem tudományos, de következetes. */
export function passwordStrength(value: string): PasswordStrength {
  if (value.length < 8) return 'weak';
  let score = 0;
  if (value.length >= 12) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value)) score++;
  if (score >= 3) return 'strong';
  if (score >= 2) return 'fair';
  return 'weak';
}

export const STRENGTH_LABEL: Record<PasswordStrength, string> = {
  weak: 'Gyenge',
  fair: 'Megfelelő',
  strong: 'Erős',
};

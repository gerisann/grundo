/**
 * E-mail hitelesítés 6 jegyű kóddal.
 *
 * Tiszta függvények — nincs bennük Firestore és nincs I/O, hogy tesztelhetők
 * legyenek. A tárolást és a küldést a hívó intézi.
 *
 * docs/02-funkcionalis-spec.md → Onboarding, 3. lépés
 *   6 számjegy · 15 perc lejárat · 60 s újraküldési várakozás
 *   max 5 hibás próbálkozás → 15 perc zárolás
 *   Firestore-ban CSAK hash tárolódik
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 15 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LOCK_MS = 15 * 60 * 1000;

export interface OtpRecord {
  hash: string;
  salt: string;
  /** epoch ms */
  expiresAt: number;
  sentAt: number;
  attempts: number;
  lockedUntil?: number;
  email: string;
}

export type OtpVerdict = 'ok' | 'wrong' | 'expired' | 'locked' | 'missing';

/** 6 számjegy, kriptográfiailag erős forrásból. Vezető nulla megengedett. */
export function generateOtp(): string {
  let code = '';
  for (let i = 0; i < OTP_LENGTH; i++) code += randomInt(0, 10).toString();
  return code;
}

export function makeSalt(): string {
  return randomBytes(16).toString('hex');
}

export function hashOtp(code: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

/** Időzítés-független összehasonlítás — a kód rövid, ne szivárogjon karakterenként. */
function equals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function createOtp(email: string, now: number): { code: string; record: OtpRecord } {
  const code = generateOtp();
  const salt = makeSalt();
  return {
    code,
    record: {
      hash: hashOtp(code, salt),
      salt,
      expiresAt: now + OTP_TTL_MS,
      sentAt: now,
      attempts: 0,
      email,
    },
  };
}

export interface VerifyResult {
  verdict: OtpVerdict;
  /** A rekord frissített állapota — a hívó ezt írja vissza. */
  record?: OtpRecord;
  /** Hány próbálkozás maradt (csak `wrong` esetén). */
  attemptsLeft?: number;
}

export function verifyOtp(
  input: string,
  record: OtpRecord | null,
  now: number,
): VerifyResult {
  if (!record) return { verdict: 'missing' };

  if (record.lockedUntil && record.lockedUntil > now) {
    return { verdict: 'locked', record };
  }

  if (record.expiresAt <= now) {
    return { verdict: 'expired', record };
  }

  const normalized = input.replace(/\D/g, '');
  if (normalized.length === OTP_LENGTH && equals(hashOtp(normalized, record.salt), record.hash)) {
    return { verdict: 'ok', record };
  }

  const attempts = record.attempts + 1;
  const locked = attempts >= OTP_MAX_ATTEMPTS;
  return {
    verdict: locked ? 'locked' : 'wrong',
    record: {
      ...record,
      attempts,
      ...(locked ? { lockedUntil: now + OTP_LOCK_MS } : {}),
    },
    attemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - attempts),
  };
}

export interface ResendCheck {
  allowed: boolean;
  /** Hány másodperc múlva kérhető újra. */
  waitSeconds: number;
}

export function canResend(record: OtpRecord | null, now: number): ResendCheck {
  if (!record) return { allowed: true, waitSeconds: 0 };
  if (record.lockedUntil && record.lockedUntil > now) {
    return { allowed: false, waitSeconds: Math.ceil((record.lockedUntil - now) / 1000) };
  }
  const elapsed = now - record.sentAt;
  if (elapsed >= OTP_RESEND_COOLDOWN_MS) return { allowed: true, waitSeconds: 0 };
  return { allowed: false, waitSeconds: Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000) };
}

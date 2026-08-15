import { describe, expect, it } from 'vitest';
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  canResend,
  createOtp,
  generateOtp,
  hashOtp,
  verifyOtp,
} from './otp';

const NOW = Date.UTC(2026, 7, 15, 12, 0, 0);

describe('generateOtp', () => {
  it('mindig 6 számjegy, vezető nullával is', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateOtp();
      expect(code).toMatch(/^\d{6}$/);
      expect(code).toHaveLength(OTP_LENGTH);
    }
  });

  it('nem determinisztikus', () => {
    const codes = new Set(Array.from({ length: 200 }, generateOtp));
    expect(codes.size).toBeGreaterThan(150);
  });
});

describe('hashOtp', () => {
  it('ugyanaz a kód más sóval más hasht ad', () => {
    expect(hashOtp('123456', 'a')).not.toBe(hashOtp('123456', 'b'));
  });

  it('a nyers kód nem nyerhető vissza a hashből', () => {
    const hash = hashOtp('123456', 'salt');
    expect(hash).not.toContain('123456');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('verifyOtp', () => {
  it('elfogadja a helyes kódot', () => {
    const { code, record } = createOtp('a@b.hu', NOW);
    expect(verifyOtp(code, record, NOW + 1000).verdict).toBe('ok');
  });

  it('tűri a szóközöket és kötőjeleket a beírt kódban', () => {
    const { code, record } = createOtp('a@b.hu', NOW);
    const messy = `${code.slice(0, 3)} - ${code.slice(3)}`;
    expect(verifyOtp(messy, record, NOW + 1000).verdict).toBe('ok');
  });

  it('elutasítja a rossz kódot és számolja a próbálkozásokat', () => {
    const { code, record } = createOtp('a@b.hu', NOW);
    const wrong = code === '000000' ? '111111' : '000000';
    const result = verifyOtp(wrong, record, NOW + 1000);
    expect(result.verdict).toBe('wrong');
    expect(result.record?.attempts).toBe(1);
    expect(result.attemptsLeft).toBe(OTP_MAX_ATTEMPTS - 1);
  });

  it('15 perc után lejár', () => {
    const { code, record } = createOtp('a@b.hu', NOW);
    expect(verifyOtp(code, record, NOW + OTP_TTL_MS - 1).verdict).toBe('ok');
    expect(verifyOtp(code, record, NOW + OTP_TTL_MS).verdict).toBe('expired');
  });

  it('5 hibás próbálkozás után zárol', () => {
    const { code, record } = createOtp('a@b.hu', NOW);
    const wrong = code === '000000' ? '111111' : '000000';

    let current = record;
    let verdict = '';
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      const result = verifyOtp(wrong, current, NOW + 1000);
      current = result.record!;
      verdict = result.verdict;
    }
    expect(verdict).toBe('locked');
    expect(current.lockedUntil).toBeGreaterThan(NOW);

    // Zárolás alatt a HELYES kód sem megy át
    expect(verifyOtp(code, current, NOW + 2000).verdict).toBe('locked');
  });

  it('hiányzó rekordot jelez', () => {
    expect(verifyOtp('123456', null, NOW).verdict).toBe('missing');
  });

  it('a rossz hosszúságú bemenetet nem fogadja el', () => {
    const { record } = createOtp('a@b.hu', NOW);
    expect(verifyOtp('12345', record, NOW).verdict).toBe('wrong');
    expect(verifyOtp('1234567', record, NOW).verdict).toBe('wrong');
  });
});

describe('canResend', () => {
  it('nincs korábbi kód → azonnal küldhető', () => {
    expect(canResend(null, NOW).allowed).toBe(true);
  });

  it('60 másodpercen belül nem küldhető újra', () => {
    const { record } = createOtp('a@b.hu', NOW);
    const check = canResend(record, NOW + 20_000);
    expect(check.allowed).toBe(false);
    expect(check.waitSeconds).toBe(40);
  });

  it('60 másodperc után küldhető', () => {
    const { record } = createOtp('a@b.hu', NOW);
    expect(canResend(record, NOW + OTP_RESEND_COOLDOWN_MS).allowed).toBe(true);
  });

  it('zárolás alatt nem küldhető, és a hátralévő időt adja', () => {
    const { record } = createOtp('a@b.hu', NOW);
    const locked = { ...record, lockedUntil: NOW + 300_000 };
    const check = canResend(locked, NOW);
    expect(check.allowed).toBe(false);
    expect(check.waitSeconds).toBe(300);
  });
});

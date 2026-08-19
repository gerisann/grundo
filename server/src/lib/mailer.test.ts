/**
 * Az új regisztrációról szóló belső értesítő.
 *
 * Két dolgot kell őriznie: hogy minden lényeges adat benne legyen, és hogy a
 * FELHASZNÁLÓTÓL érkező szöveg (a felhasználónév) ne kerülhessen nyersen a
 * HTML-be. Ez utóbbi nem elméleti: a felhasználónév az egyetlen mező ebben a
 * levélben, amit idegen ember ad meg.
 */
import { describe, expect, it } from 'vitest';
import { adminNotifyAddress, newAccountEmail, type NewAccountInfo } from './mailer';

const base: NewAccountInfo = {
  uid: 'abc123',
  username: 'futogeri',
  email: 'futo@example.com',
  providers: ['password'],
  emailVerified: false,
  hasPhoto: false,
  timezone: 'Europe/Budapest',
  createdAt: new Date('2026-08-19T10:30:00Z'),
};

describe('newAccountEmail', () => {
  it('a tárgyban ott a felhasználónév', () => {
    expect(newAccountEmail(base).subject).toBe('Új GRUNDO-fiók: futogeri');
  });

  it('minden lényeges adat szerepel a szöveges változatban', () => {
    const { text } = newAccountEmail(base);
    expect(text).toContain('futogeri');
    expect(text).toContain('futo@example.com');
    expect(text).toContain('password');
    expect(text).toContain('abc123');
    expect(text).toContain('Europe/Budapest');
  });

  it('jelzi, ha az e-mail még nincs megerősítve', () => {
    expect(newAccountEmail(base).text).toContain('még nem');
    expect(newAccountEmail({ ...base, emailVerified: true }).text).toContain('igen');
  });

  it('a hiányzó e-mail nem üres sort, hanem jelölést ad', () => {
    expect(newAccountEmail({ ...base, email: '' }).text).toContain('E-mail: —');
  });

  it('a Google-belépés is látszik', () => {
    const mail = newAccountEmail({ ...base, providers: ['google.com', 'password'] });
    expect(mail.text).toContain('google.com, password');
  });

  /**
   * A felhasználónevet a REGISZTRÁLÓ adja meg. Ha nyersen kerülne a HTML-be,
   * egy `<img onerror=…>` alakú név a levelezőmben futna le — a saját
   * postaládám ellen fordítva az értesítőt.
   */
  it('a felhasználónévből nem lehet HTML-t csempészni', () => {
    const mail = newAccountEmail({ ...base, username: '<img src=x onerror=alert(1)>' });
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('&lt;img src=x');
  });

  it('az e-mail-cím is szűrve megy a HTML-be', () => {
    const mail = newAccountEmail({ ...base, email: 'a"><script>b@c.hu' });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});

describe('adminNotifyAddress', () => {
  it('környezeti változó nélkül is van címzett', () => {
    // A beállítás elmaradása nem némíthatja el csendben az értesítést.
    const previous = process.env.ADMIN_NOTIFY_EMAIL;
    delete process.env.ADMIN_NOTIFY_EMAIL;
    expect(adminNotifyAddress()).toBe('gergely.marthon@gmail.com');
    if (previous !== undefined) process.env.ADMIN_NOTIFY_EMAIL = previous;
  });

  it('a környezeti változó felülírja', () => {
    const previous = process.env.ADMIN_NOTIFY_EMAIL;
    process.env.ADMIN_NOTIFY_EMAIL = 'masik@pelda.hu';
    expect(adminNotifyAddress()).toBe('masik@pelda.hu');
    if (previous === undefined) delete process.env.ADMIN_NOTIFY_EMAIL;
    else process.env.ADMIN_NOTIFY_EMAIL = previous;
  });
});

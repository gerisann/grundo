/**
 * E-mail küldés — cserélhető szolgáltatóval.
 *
 * FONTOS: éles környezetben be KELL állítani egy szolgáltatót. Enélkül a
 * hitelesítő kód csak a szervernaplóba kerül, tehát a felhasználó nem kapja
 * meg. Ez fejlesztéshez szándékos, élesben viszont hiba.
 *
 * Környezeti változók:
 *   MAIL_PROVIDER = 'smtp' | 'resend' | 'console'   (alap: console)
 *   MAIL_FROM     pl. "GRUNDO <no-reply@grundo.ultimateteam.hu>"
 *
 *   smtp:    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
 *   resend:  RESEND_API_KEY
 *
 * Az éles beállítás az `smtp`: a saját domain levelezőjén keresztül megy a
 * küldés, tehát nincs harmadik fél a láncban és nem kell külön szolgáltatói
 * fiók. A `resend` ág megmarad tartaléknak — ha egyszer a saját szerver napi
 * küldési korlátja szűk lesz, elég a MAIL_PROVIDER-t átállítani.
 */

import nodemailer from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  readonly name: string;
  send(mail: Mail): Promise<void>;
}

/** Fejlesztői „küldő": a naplóba írja a levelet. Élesben NEM elég. */
const consoleMailer: Mailer = {
  name: 'console',
  async send(mail) {
    // eslint-disable-next-line no-console
    console.warn(
      `[GRUNDO][mail:console] NEM KÜLDTÜNK VALÓDI LEVELET\n  címzett: ${mail.to}\n  tárgy: ${mail.subject}\n  ${mail.text}`,
    );
  },
};

/**
 * Küldés a saját domain levelezőjén keresztül.
 *
 * Két dolgot érdemes tudni a Cloud Runról:
 *
 * 1. A **25-ös port kifelé tiltva van** a Google Cloudon, kivétel nélkül.
 *    Ezért csak az 587 (STARTTLS) vagy a 465 (azonnali TLS) használható.
 *    A `secure` kapcsolót ehhez igazítjuk: 465-nél kezdettől titkosított a
 *    kapcsolat, 587-nél a szerver a beszélgetés közben vált át rá.
 *
 * 2. A konténer bármikor leállhat, ha nincs forgalom, ezért nem tartunk fenn
 *    állandó kapcsolatot: minden levél saját kapcsolatot nyit és zár. Néhány
 *    tized másodperccel lassabb, cserébe nem lehet elhalt kapcsolatba
 *    beleküldeni — ami pont a ritkán küldő szolgáltatások tipikus hibája.
 */
function smtpMailer(from: string): Mailer {
  const host = process.env.SMTP_HOST ?? '';
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER ?? '';
  const pass = process.env.SMTP_PASSWORD ?? '';

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
    // Ha a szolgáltató lassan válaszol, ne akadjon be egy kérés örökre.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return {
    name: 'smtp',
    async send(mail) {
      await transport.sendMail({
        from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        ...(mail.html ? { html: mail.html } : {}),
      });
    },
  };
}

function resendMailer(apiKey: string, from: string): Mailer {
  return {
    name: 'resend',
    async send(mail) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          ...(mail.html ? { html: mail.html } : {}),
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`A levélküldés nem sikerült (${response.status}): ${detail}`);
      }
    },
  };
}

export function createMailer(): Mailer {
  const provider = process.env.MAIL_PROVIDER ?? 'console';
  const from = process.env.MAIL_FROM ?? 'GRUNDO <no-reply@grundo.ultimateteam.hu>';

  if (provider === 'smtp') {
    if (!process.env.SMTP_HOST) {
      // Visszaesés a naplóba: a szolgáltatás elindul, csak a levél nem megy ki.
      // Így egy hiányzó beállítás nem dönti le az egész backendet.
      // eslint-disable-next-line no-console
      console.error('[GRUNDO] MAIL_PROVIDER=smtp, de az SMTP_HOST hiányzik.');
      return consoleMailer;
    }
    return smtpMailer(from);
  }

  if (provider === 'resend') {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      // eslint-disable-next-line no-console
      console.error('[GRUNDO] MAIL_PROVIDER=resend, de a RESEND_API_KEY hiányzik.');
      return consoleMailer;
    }
    return resendMailer(key, from);
  }

  return consoleMailer;
}

export function otpEmail(code: string): Pick<Mail, 'subject' | 'text' | 'html'> {
  return {
    subject: `${code} — a GRUNDO hitelesítő kódod`,
    text:
      `A hitelesítő kódod: ${code}\n\n` +
      'A kód 15 percig érvényes. Ha nem te kérted, hagyd figyelmen kívül ezt a levelet.',
    html:
      `<p>A hitelesítő kódod:</p>` +
      `<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>` +
      `<p>A kód 15 percig érvényes. Ha nem te kérted, hagyd figyelmen kívül ezt a levelet.</p>`,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   Értesítés új regisztrációról
   ═══════════════════════════════════════════════════════════════════ */

export interface NewAccountInfo {
  uid: string;
  username: string;
  email: string;
  /** Melyik belépési móddal jött létre a fiók (jelszó, Google…). */
  providers: string[];
  emailVerified: boolean;
  hasPhoto: boolean;
  timezone: string;
  createdAt: Date;
}

/**
 * Kinek megy az új regisztrációkról szóló értesítő?
 *
 * Környezeti változóból, hogy ne kelljen kódot módosítani, ha változik a
 * címzett — de van alapértelmezés, hogy a beállítás elmaradása se némítsa el
 * csendben az értesítést.
 */
export function adminNotifyAddress(): string {
  return process.env.ADMIN_NOTIFY_EMAIL ?? 'gergely.marthon@gmail.com';
}

/**
 * Az új fiókról szóló belső értesítő.
 *
 * ⚠️ EZ BELSŐ LEVÉL, nem a felhasználónak megy. Ezért szerepelhet benne a uid
 * és a belépési mód — a felhasználónak küldött levelekben ilyen sosem lenne.
 */
export function newAccountEmail(
  info: NewAccountInfo,
): Pick<Mail, 'subject' | 'text' | 'html'> {
  const when = new Intl.DateTimeFormat('hu-HU', {
    timeZone: 'Europe/Budapest',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(info.createdAt);

  const rows: [string, string][] = [
    ['Felhasználónév', info.username],
    ['E-mail', info.email || '—'],
    ['E-mail megerősítve', info.emailVerified ? 'igen' : 'még nem'],
    ['Belépési mód', info.providers.length > 0 ? info.providers.join(', ') : 'ismeretlen'],
    ['Profilkép', info.hasPhoto ? 'van' : 'nincs'],
    ['Időzóna', info.timezone],
    ['Regisztrált', when],
    ['Azonosító', info.uid],
  ];

  return {
    subject: `Új GRUNDO-fiók: ${info.username}`,
    text: rows.map(([label, value]) => `${label}: ${value}`).join('\n'),
    html:
      `<p><strong>Új GRUNDO-fiók jött létre.</strong></p>` +
      `<table cellpadding="6" style="border-collapse:collapse;font-family:system-ui,sans-serif">` +
      rows
        .map(
          ([label, value]) =>
            `<tr><td style="color:#666">${label}</td>` +
            `<td><strong>${escapeHtml(value)}</strong></td></tr>`,
        )
        .join('') +
      `</table>`,
  };
}

export interface UserReportInfo {
  reporterUsername: string;
  reporterEmail: string;
  reporterUid: string;
  targetUsername: string;
  targetUid: string;
  /** A `reports.category` gépi kulcsa. */
  category: string;
  /** Ugyanaz magyarul, ahogy a felhasználó látta a bejelentő lapon. */
  categoryLabel: string;
  branch: string;
  note: string;
  reportId: string;
  createdAt: Date;
}

/**
 * Bejelentés-értesítő — BELSŐ levél a moderációnak.
 *
 * MIÉRT E-MAIL, és nem admin felület? Mert a `reports` kollekcióhoz még
 * nincs admin felület (docs/06 → 3. Moderáció, még nem megírva), és egy
 * bejelentés, amit senki nem lát, semmit nem ér. Az e-mail a legrövidebb út
 * odáig, hogy a bejelentés EMBERHEZ jusson. A Firestore-dokumentum
 * változatlanul megmarad — amikor az admin felület elkészül, az ugyanabból
 * dolgozik majd, és ez a levél kiegészítés marad, nem pótlás.
 *
 * ⚠️ A BEJELENTŐ KILÉTE benne van. Ez belső levél; a bejelentett felé a
 * `firestore.rules` továbbra sem engedi ki (a `reports` olvasása
 * `isAdmin()`-hoz kötött).
 */
export function userReportEmail(
  info: UserReportInfo,
): Pick<Mail, 'subject' | 'text' | 'html'> {
  const when = new Intl.DateTimeFormat('hu-HU', {
    timeZone: 'Europe/Budapest',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(info.createdAt);

  const rows: [string, string][] = [
    ['Bejelentett felhasználó', `${info.targetUsername} (${info.targetUid})`],
    ['Bejelentő', `${info.reporterUsername} (${info.reporterUid})`],
    ['Bejelentő e-mail', info.reporterEmail || '—'],
    ['Ok', `${info.categoryLabel} (${info.category})`],
    ['Moderációs ág', info.branch],
    ['Leírás', info.note || '— (nem adott meg leírást)'],
    ['Beérkezett', when],
    ['Bejelentés azonosítója', info.reportId],
  ];

  return {
    subject: `GRUNDO bejelentés: ${info.targetUsername} — ${info.categoryLabel}`,
    text: rows.map(([label, value]) => `${label}: ${value}`).join('\n'),
    html:
      `<p><strong>Új felhasználói bejelentés érkezett.</strong></p>` +
      `<table cellpadding="6" style="border-collapse:collapse;font-family:system-ui,sans-serif">` +
      rows
        .map(
          ([label, value]) =>
            `<tr><td style="color:#666;vertical-align:top">${label}</td>` +
            `<td><strong>${escapeHtml(value)}</strong></td></tr>`,
        )
        .join('') +
      `</table>`,
  };
}

/** A felhasználónév és az e-mail a felhasználótól jön — nem mehet nyersen HTML-be. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

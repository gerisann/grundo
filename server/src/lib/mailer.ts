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

/**
 * E-mail küldés — cserélhető szolgáltatóval.
 *
 * FONTOS: éles környezetben be KELL állítani egy szolgáltatót. Enélkül a
 * hitelesítő kód csak a szervernaplóba kerül, tehát a felhasználó nem kapja
 * meg. Ez fejlesztéshez szándékos, élesben viszont hiba.
 *
 * Környezeti változók:
 *   MAIL_PROVIDER = 'resend' | 'console'   (alap: console)
 *   RESEND_API_KEY
 *   MAIL_FROM     pl. "GRUNDO <no-reply@grundo.hu>"
 */

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
  const from = process.env.MAIL_FROM ?? 'GRUNDO <no-reply@grundo.hu>';

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

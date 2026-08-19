/**
 * Firebase hibakódok → érthető magyar üzenetek.
 *
 * Nem kozmetika: a nyers `auth/account-exists-with-different-credential`
 * kód a felhasználónak semmit nem mond, és a spec szerint pont ez lesz a
 * leggyakoribb támogatási kérdés, ha nyersen hagyjuk.
 *
 * docs/02-funkcionalis-spec.md → Belépés
 */

const MESSAGES: Record<string, string> = {
  // ── Belépés ────────────────────────────────────────────────────────────
  'auth/invalid-credential': 'Hibás e-mail-cím vagy jelszó.',
  'auth/wrong-password': 'Hibás e-mail-cím vagy jelszó.',
  'auth/user-not-found': 'Nincs fiók ezzel az e-mail-címmel.',
  'auth/invalid-email': 'Ez nem érvényes e-mail-cím.',
  'auth/user-disabled': 'Ez a fiók fel van függesztve. Írj nekünk, ha szerinted tévedés.',
  'auth/too-many-requests':
    'Túl sok próbálkozás. Várj pár percet, vagy állítsd vissza a jelszavad.',

  // ── Regisztráció ───────────────────────────────────────────────────────
  'auth/email-already-in-use':
    'Ezzel az e-mail-címmel már van fiók. Lépj be, vagy állítsd vissza a jelszavad.',
  'auth/weak-password': 'A jelszó túl gyenge. Legalább 8 karakter kell.',
  'auth/operation-not-allowed': 'Ez a bejelentkezési mód jelenleg nem elérhető.',

  // ── Fiókösszevonás — ez a legfontosabb ─────────────────────────────────
  'auth/account-exists-with-different-credential':
    'Ezzel az e-mail-címmel már van fiókod, jelszóval. Lépj be jelszóval, és a ' +
    'Beállításokban összekapcsolhatod a Google-fiókoddal.',
  'auth/credential-already-in-use':
    'Ez a Google-fiók már egy másik GRUNDO-fiókhoz tartozik.',
  'auth/provider-already-linked': 'Ez a bejelentkezési mód már össze van kapcsolva.',

  // ── Google belépés ─────────────────────────────────────────────────────
  'auth/popup-closed-by-user': 'A bejelentkezést megszakítottad.',
  'auth/cancelled-popup-request': 'A bejelentkezést megszakítottad.',
  'auth/popup-blocked':
    'A böngésző blokkolta a bejelentkezési ablakot. Engedélyezd, és próbáld újra.',

  // ── Hálózat ────────────────────────────────────────────────────────────
  'auth/network-request-failed': 'Nincs kapcsolat. Ellenőrizd az internetet.',
};

export function authErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  const known = MESSAGES[code];
  if (known) return known;

  if (error instanceof Error && error.message) return error.message;
  return 'Váratlan hiba történt. Próbáld újra.';
}

/** Igaz, ha a hiba fiókösszevonást igényel — a felület ilyenkor mást ajánl. */
/**
 * Google-fiókos felhasználó próbált jelszóval belépni?
 *
 * Két helyről jöhet ugyanaz a helyzet, ezért mindkettőt ismerjük:
 *   - `use_google` — a szervertől, ha felhasználónévvel próbálkozott;
 *   - `GoogleAccountError` — a klienstől, ha e-maillel (ott a Firebase csak
 *     annyit mond, hogy „hibás adat", és utólag kérdezzük meg a szervert).
 */
export function isGoogleAccountError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  return code === 'use_google';
}

export function isAccountLinkError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  return code === 'auth/account-exists-with-different-credential';
}

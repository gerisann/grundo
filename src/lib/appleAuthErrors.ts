/**
 * A natív Apple Sign-In SDK angol hibaüzeneteiből magyar mondat.
 *
 * A `googleAuthErrors.ts` párja — ugyanaz az ok: a natív réteg
 * (`@capacitor-firebase/authentication`) az `ASAuthorizationError` (iOS)
 * nyers szövegét adja tovább, amit a felhasználó nem tud értelmezni.
 *
 * ⚠️ Ezek a minták — a megszakítás kivételével, amit a hívó `nativeAppleCredential`
 * külön, `/cancel/i`-vel kap el — MÉG NEM éles incidensből származnak (a Google
 * fájl `DEVELOPER_ERROR` mintájával ellentétben), hanem az Apple dokumentált
 * `ASAuthorizationError` kódjaiból. Ha élesben más szöveg jön elő, ide kell
 * felvenni — lásd a `reasons`/`activityAudits`-hoz hasonló, mérésen alapuló
 * bővítést a Google fájlban.
 *
 * @returns a megjelenítendő magyar mondat, vagy `null`, ha nem ismerjük fel a
 *   hibát — ilyenkor a hívó az eredeti hibát dobja tovább.
 */
export function nativeAppleErrorMessage(message: string): string | null {
  // `ASAuthorizationError.Code.notHandled` / `.failed` / `.invalidResponse` —
  // ezt tipikusan a hiányzó "Sign In with Apple" képesség (Apple Developer
  // Portal capability + entitlement) vagy egy Firebase Console-oldali
  // hiányzó Apple-provider okozza, nem a felhasználó hibája.
  if (/not\s*handled|invalid\s*response|failed\b/i.test(message)) {
    return (
      'Az Apple-belépés ebben a telepített változatban nincs helyesen beállítva. ' +
      'Lépj be e-mail-címmel és jelszóval, vagy próbáld a Google-belépést, és jelezd a hibát.'
    );
  }
  if (/missing.*nonce|invalid.*nonce/i.test(message)) {
    return 'Az Apple-belépés váratlan hibába ütközött. Próbáld újra.';
  }
  if (/network|timeout|timed out/i.test(message)) {
    return 'Az Apple-belépés nem érte el a hálózatot. Ellenőrizd a kapcsolatot, majd próbáld újra.';
  }
  return null;
}

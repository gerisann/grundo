/**
 * A natív Google SDK angol hibaüzeneteiből magyar mondat.
 *
 * A natív réteg (`@capacitor-firebase/authentication`) a Google Sign-In / One
 * Tap nyers hibáját adja tovább, például:
 * `During being sign in, failure response from one tap:10: [28444] Developer
 * console is not set up correctly`. Ezt a felhasználó nem tudja értelmezni.
 *
 * A `10` (DEVELOPER_ERROR) az egyetlen eset, ami nem a felhasználón múlik:
 * ilyenkor a futó app csomagneve és aláíró SHA-1 ujjlenyomata nincs felvéve a
 * Firebase Android OAuth kliensébe (lásd `docs/08-android-codemagic.md`,
 * „Mért hibaminta: one tap:10").
 *
 * @returns a megjelenítendő magyar mondat, vagy `null`, ha nem ismerjük fel a
 *   hibát — ilyenkor a hívó az eredeti hibát dobja tovább.
 */
export function nativeGoogleErrorMessage(message: string): string | null {
  if (/developer console|developer_error/i.test(message)) {
    return (
      'A Google-belépés ebben a telepített változatban nincs helyesen beállítva. ' +
      'Lépj be e-mail-címmel és jelszóval, és jelezd a hibát.'
    );
  }
  if (/no credential|credential.*not available/i.test(message)) {
    return (
      'Nem találtunk Google-fiókot a készüléken. Add hozzá a fiókodat a rendszer ' +
      'beállításaiban, vagy lépj be e-mail-címmel és jelszóval.'
    );
  }
  if (/network|timeout|timed out/i.test(message)) {
    return 'A Google-belépés nem érte el a hálózatot. Ellenőrizd a kapcsolatot, majd próbáld újra.';
  }
  return null;
}

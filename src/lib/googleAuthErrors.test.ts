import { describe, expect, it } from 'vitest';
import { nativeGoogleErrorMessage } from './googleAuthErrors';

describe('nativeGoogleErrorMessage', () => {
  it('recognises the DEVELOPER_ERROR one tap failure seen on the release build', () => {
    const raw =
      'During being sign in, failure response from one tap:10: [28444] ' +
      'Developer console is not set up correctly';
    expect(nativeGoogleErrorMessage(raw)).toMatch(/nincs helyesen beállítva/);
  });

  it('recognises the missing Google account case', () => {
    expect(nativeGoogleErrorMessage('No credential available')).toMatch(/Nem találtunk Google-fiókot/);
  });

  it('recognises a network failure', () => {
    expect(nativeGoogleErrorMessage('A network error occurred')).toMatch(/hálózatot/);
  });

  it('returns null for an unknown message so the caller can rethrow the original', () => {
    expect(nativeGoogleErrorMessage('Something entirely different')).toBeNull();
  });
});

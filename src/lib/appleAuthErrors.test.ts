import { describe, expect, it } from 'vitest';
import { nativeAppleErrorMessage } from './appleAuthErrors';

describe('nativeAppleErrorMessage', () => {
  it('recognises a not-handled/failed ASAuthorizationError (missing capability/entitlement)', () => {
    expect(nativeAppleErrorMessage('The operation could not be completed. (com.apple.AuthenticationServices.AuthorizationError error 1000 - failed)')).toMatch(/nincs helyesen beállítva/);
    expect(nativeAppleErrorMessage('Not handled')).toMatch(/nincs helyesen beállítva/);
  });

  it('recognises a missing/invalid nonce', () => {
    expect(nativeAppleErrorMessage('auth/missing-or-invalid-nonce')).toMatch(/váratlan hibába/);
  });

  it('recognises a network failure', () => {
    expect(nativeAppleErrorMessage('A network error occurred')).toMatch(/hálózatot/);
  });

  it('returns null for an unknown message so the caller can rethrow the original', () => {
    expect(nativeAppleErrorMessage('Something entirely different')).toBeNull();
  });
});

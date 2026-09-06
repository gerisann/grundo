import { describe, expect, it } from 'vitest';
import { isAccountLinkError, isAppleAccountError, isGoogleAccountError } from './authErrors';

describe('szociális fiók felismerése', () => {
  it('a use_google kódot Google-fiókként ismeri fel, Apple-ként nem', () => {
    expect(isGoogleAccountError({ code: 'use_google' })).toBe(true);
    expect(isAppleAccountError({ code: 'use_google' })).toBe(false);
  });

  it('a use_apple kódot Apple-fiókként ismeri fel, Google-ként nem', () => {
    expect(isAppleAccountError({ code: 'use_apple' })).toBe(true);
    expect(isGoogleAccountError({ code: 'use_apple' })).toBe(false);
  });

  it('egyéb hibára egyik sem igaz', () => {
    expect(isGoogleAccountError(new Error('bármi'))).toBe(false);
    expect(isAppleAccountError(new Error('bármi'))).toBe(false);
    expect(isAccountLinkError(new Error('bármi'))).toBe(false);
  });

  it('a fiókösszevonási kódot felismeri', () => {
    expect(isAccountLinkError({ code: 'auth/account-exists-with-different-credential' })).toBe(true);
  });
});

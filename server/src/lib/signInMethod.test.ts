/**
 * „Ezzel a fiókkal Google-lel kell belépni" — a felismerés szabálya.
 *
 * A HIBA, amit megelőz: aki Google-fiókkal regisztrált, annak SOSEM volt
 * jelszava. Ha jelszóval próbálkozik, a Firebase csak annyit mond, hogy hibás
 * adat — a felhasználó pedig a világ végezetéig próbálkozhatna, mert nincs
 * olyan jelszó, ami működne. Ezt a falat csak úgy lehet lebontani, ha
 * megmondjuk neki, hogy a Google-gombot keresse.
 *
 * A szabály szándékosan SZŰK: csak akkor igaz, ha van Google-szolgáltató és
 * NINCS jelszó. Aki mindkettővel rendelkezik (összekapcsolta a fiókjait),
 * annak a jelszava működik, tehát nem szabad elterelni.
 */
import { describe, expect, it } from 'vitest';

/** A vizsgált szabály — az `auth.ts` `isGoogleOnly` függvényének a mása. */
function isGoogleOnly(record: { providerData: { providerId: string }[] } | null): boolean {
  if (!record) return false;
  const providers = record.providerData.map((p) => p.providerId);
  return providers.includes('google.com') && !providers.includes('password');
}

const withProviders = (...ids: string[]) => ({
  providerData: ids.map((providerId) => ({ providerId })),
});

describe('isGoogleOnly', () => {
  it('a csak Google-lel regisztrált fiókra igaz', () => {
    expect(isGoogleOnly(withProviders('google.com'))).toBe(true);
  });

  it('a jelszavas fiókra hamis', () => {
    expect(isGoogleOnly(withProviders('password'))).toBe(false);
  });

  it('az ÖSSZEKAPCSOLT fiókra hamis', () => {
    // Akinek van jelszava is, annak a jelszó működik — nem szabad elterelni.
    expect(isGoogleOnly(withProviders('google.com', 'password'))).toBe(false);
    expect(isGoogleOnly(withProviders('password', 'google.com'))).toBe(false);
  });

  it('a nem létező fiókra hamis', () => {
    /**
     * EZ A LÉNYEG A NÉVELLENŐRZÉS ELLEN.
     *
     * A nem létező fiók és a jelszavas fiók UGYANAZT a választ kapja. Így a
     * végpontból nem lehet megtudni, hogy létezik-e egy e-mail-cím — csak azt,
     * hogy „ezzel Google-lel kell belépni", ami önmagában is csak egy létező,
     * Google-fiókos azonosítóra igaz.
     */
    expect(isGoogleOnly(null)).toBe(false);
  });

  it('az ismeretlen szolgáltatóra hamis', () => {
    expect(isGoogleOnly(withProviders('apple.com'))).toBe(false);
    expect(isGoogleOnly(withProviders())).toBe(false);
  });
});

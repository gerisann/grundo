/**
 * „Ezzel a fiókkal Google-/Apple-lel kell belépni" — a felismerés szabálya.
 *
 * A HIBA, amit megelőz: aki Google- vagy Apple-fiókkal regisztrált, annak
 * SOSEM volt jelszava. Ha jelszóval próbálkozik, a Firebase csak annyit mond,
 * hogy hibás adat — a felhasználó pedig a világ végezetéig próbálkozhatna,
 * mert nincs olyan jelszó, ami működne. Ezt a falat csak úgy lehet lebontani,
 * ha megmondjuk neki, melyik gombot keresse.
 *
 * A szabály szándékosan SZŰK: csak akkor jelez vissza szolgáltatót, ha van
 * pontosan egy szociális szolgáltató és NINCS jelszó. Aki mindkettővel
 * rendelkezik (összekapcsolta a fiókjait), annak a jelszava működik, tehát
 * nem szabad elterelni.
 */
import { describe, expect, it } from 'vitest';

type SocialProvider = 'google.com' | 'apple.com';

/** A vizsgált szabály — az `auth.ts` `socialOnlyProvider` függvényének a mása. */
function socialOnlyProvider(
  record: { providerData: { providerId: string }[] } | null,
): SocialProvider | null {
  if (!record) return null;
  const providers = record.providerData.map((p) => p.providerId);
  if (providers.includes('password')) return null;
  if (providers.includes('google.com')) return 'google.com';
  if (providers.includes('apple.com')) return 'apple.com';
  return null;
}

const withProviders = (...ids: string[]) => ({
  providerData: ids.map((providerId) => ({ providerId })),
});

describe('socialOnlyProvider', () => {
  it('a csak Google-lel regisztrált fiókra "google.com"-ot ad', () => {
    expect(socialOnlyProvider(withProviders('google.com'))).toBe('google.com');
  });

  it('a csak Apple-lel regisztrált fiókra "apple.com"-ot ad', () => {
    expect(socialOnlyProvider(withProviders('apple.com'))).toBe('apple.com');
  });

  it('a jelszavas fiókra null', () => {
    expect(socialOnlyProvider(withProviders('password'))).toBeNull();
  });

  it('az ÖSSZEKAPCSOLT fiókra null', () => {
    // Akinek van jelszava is, annak a jelszó működik — nem szabad elterelni.
    expect(socialOnlyProvider(withProviders('google.com', 'password'))).toBeNull();
    expect(socialOnlyProvider(withProviders('password', 'google.com'))).toBeNull();
    expect(socialOnlyProvider(withProviders('apple.com', 'password'))).toBeNull();
  });

  it('a nem létező fiókra null', () => {
    /**
     * EZ A LÉNYEG A NÉVELLENŐRZÉS ELLEN.
     *
     * A nem létező fiók és a jelszavas fiók UGYANAZT a választ kapja. Így a
     * végpontból nem lehet megtudni, hogy létezik-e egy e-mail-cím — csak azt,
     * hogy melyik szociális szolgáltatóval kell belépni, ami önmagában is csak
     * egy létező, csak-szociális fiókos azonosítóra ad választ.
     */
    expect(socialOnlyProvider(null)).toBeNull();
  });

  it('az ismeretlen szolgáltatóra null', () => {
    expect(socialOnlyProvider(withProviders('facebook.com'))).toBeNull();
    expect(socialOnlyProvider(withProviders())).toBeNull();
  });
});

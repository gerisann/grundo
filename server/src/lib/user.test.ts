import { describe, expect, it } from 'vitest';
import { displayUsername, newUserDoc, normalizeUsername, validateUsername } from './user';

describe('validateUsername', () => {
  it('elfogadja a szabályos neveket', () => {
    for (const name of ['geri', 'geri.marthon', 'run_2026', 'abc']) {
      expect(validateUsername(name)).toBeNull();
    }
  });

  it('a kulcs kisbetűs és trimmelt, a megjelenítési alak megőrzi a betűket', () => {
    expect(normalizeUsername('  GeRi  ')).toBe('geri');
    expect(displayUsername('  GeRi  ')).toBe('GeRi');
    expect(validateUsername('  GeRi  ')).toBeNull();
  });

  it('nagybetűs beírás nem ütközik a szabályokkal', () => {
    // A minta kisbetűs mintára illeszkedik, de a vizsgálat a kulcson fut,
    // ezért a „GERI" ugyanúgy szabályos, mint a „geri".
    expect(validateUsername('GERI')).toBeNull();
    expect(validateUsername('Geri.Marthon')).toBeNull();
  });

  it('elutasítja a túl rövidet és túl hosszút', () => {
    expect(validateUsername('ab')).toContain('3 karakter');
    expect(validateUsername('a'.repeat(21))).toContain('20 karakter');
  });

  it('elutasítja a tiltott karaktereket', () => {
    for (const name of ['ge ri', 'geri!', 'geri-x', 'geri@x']) {
      expect(validateUsername(name)).toContain('kisbetű');
    }
  });

  it('elutasítja a foglalt neveket, kis- és nagybetűvel is', () => {
    expect(validateUsername('admin')).toContain('foglalt');
    expect(validateUsername('GRUNDO')).toContain('foglalt');
    expect(validateUsername('Support')).toContain('foglalt');
  });
});

describe('newUserDoc', () => {
  const now = new Date('2026-08-15T12:00:00Z');
  const doc = newUserDoc({ uid: 'u1', username: '  GeRi ', email: 'a@b.hu' }, now);

  it('MEGŐRZI a beírt kis-nagybetűs alakot', () => {
    expect(doc.username).toBe('GeRi');
  });

  it('külön tárolja a kisbetűs egyediségi kulcsot', () => {
    expect(doc.usernameLower).toBe('geri');
  });

  it('a megjelenített név alapból a felhasználónév — a beírt alakban', () => {
    expect(doc.displayName).toBe('GeRi');
  });

  it('a Google-fiók valódi neve NEM kerül át magától', () => {
    // A `displayName` csak akkor lesz más, ha kifejezetten megadjuk.
    const google = newUserDoc(
      { uid: 'u2', username: 'Geri', email: 'a@b.hu', displayName: 'Gergely Márthon' },
      now,
    );
    expect(google.displayName).toBe('Gergely Márthon');
    // …de a regisztráció szándékosan nem ad át displayName-et, tehát:
    expect(doc.displayName).toBe('GeRi');
  });

  it('a privát zóna ALAPBÓL BE van kapcsolva, 200 m-en', () => {
    expect(doc.privacy.hideStart).toBe(true);
    expect(doc.privacy.hideEnd).toBe(true);
    expect(doc.privacy.startRadiusM).toBe(200);
    expect(doc.privacy.endRadiusM).toBe(200);
    expect(doc.privacy.routeRevision).toBe(0);
  });

  it('a bizalmi szint `new` — az első 10 aktivitásra szigorúbb küszöbök', () => {
    expect(doc.trust.level).toBe('new');
    expect(doc.trust.cleanActivities).toBe(0);
  });

  it('nulla játékállapottal indul', () => {
    expect(doc.level).toBe(1);
    expect(doc.gpTotal).toBe(0);
    expect(doc.territoryM2).toEqual({ foot: 0, bike: 0 });
    expect(doc.cellCount).toEqual({ foot: 0, bike: 0 });
    expect(doc.bandaStats.run).toMatchObject({ areaDayM2: 0, areaTotalM2: 0, gpDay: 0, gpTotal: 0 });
  });

  it('nincs Pro, és nem hitelesített e-mail', () => {
    expect(doc.pro.active).toBe(false);
    expect(doc.emailVerified).toBe(false);
  });

  it('a streak egy heti fagyasztással indul', () => {
    expect(doc.streak.freezesLeftThisWeek).toBe(1);
  });
});

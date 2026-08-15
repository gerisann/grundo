import { Placeholder } from '@/components/Placeholder';

/**
 * Profil — Profil · Statisztikák · Útvonalak (küldetés-ajánló) · Edzés · Jelvények.
 *
 * A profilon KÉT haladásjelző fut egymás alatt: felül a GP-szint, alatta a
 * távolság-jelvény ("38,4 / 50 km"). Aki nem érdeklődik a területháború iránt,
 * annak a távlétra adja a haladás érzését.
 */
export function ProfileScreen() {
  return (
    <Placeholder title="Profil" spec="docs/02-funkcionalis-spec.md → Profil">
      Szint, sorozat, statisztikák, jelvények és a beállítások.
    </Placeholder>
  );
}

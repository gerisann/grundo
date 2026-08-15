import { Placeholder } from '@/components/Placeholder';

/**
 * Terület — a hexrács térképen.
 *
 * Teljes képernyős Mapbox, terület-chip, réteg-váltó (gyalogos ⇄ kerékpáros),
 * ranglista (Terület / GP fül, Globális / Lokális), zóna-részletek.
 *
 * Megjelenítés zoom szerint: utcaszinten egyedi hexagonok, kerületszinten
 * aggregált foltok, városszinten zóna-kontúrok.
 */
export function TerritoryScreen() {
  return (
    <Placeholder title="Terület" spec="docs/02-funkcionalis-spec.md → Terület">
      Itt lesz a hexrács térkép, a réteg-váltó és a ranglista.
    </Placeholder>
  );
}

import { Router, type Request, type Response } from 'express';
import { GAMEPLAY } from '../../../src/config/gameplay';
import { playerVisibleTunableGroups } from '../../../src/config/tunables';
import { activeModifiers } from '../../../src/game/modifiers';
import { getGameplaySnapshot } from '../lib/gameplayConfig';
import { getModifiers } from '../lib/modifiers';

/**
 * NYILVÁNOS végpont — a szabálymagyarázó felület adatforrása.
 *
 * Ugyanabból a `TUNABLES` sémából dolgozik, mint az admin szerkesztő, ezért
 * egy átállított szorzó után a magyarázat sem hazudik (docs/06 → 7.
 * Játékkonfiguráció). CSAK a `playerVisible: true` kulcsokat adja vissza —
 * a Trust Score-hoz tartozó kulcsok itt SOHA nem jelenhetnek meg, ezt a
 * séma zárja ki (lásd `src/config/tunables.ts` → `TunableSpec.playerVisible`).
 *
 * Hitelesítés nélkül él, ezért a `server.ts`-ben az `authenticate` middleware
 * ELŐTT kell mountolni, az `/api/auth/login` mintájára.
 */
export const rulesRouter = Router();

function readPath(target: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node === null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[key];
  }, target);
}

rulesRouter.get('/', async (_req: Request, res: Response, next) => {
  try {
    const now = new Date();
    const [snapshot, modifiers] = await Promise.all([
      getGameplaySnapshot(now),
      getModifiers(now),
    ]);

    const groups = playerVisibleTunableGroups().map((group) => ({
      group: group.group,
      items: group.items.map((spec) => ({
        path: spec.path,
        kind: spec.kind,
        unit: spec.unit ?? null,
        label: spec.label,
        help: spec.help,
        value: readPath(snapshot.config, spec.path),
        defaultValue: readPath(GAMEPLAY, spec.path),
        overridden: spec.path in snapshot.applied,
      })),
    }));

    /**
     * Csak a JELENLEG ható akciók — a jövőben induló, még nem kezdődött
     * modifierek itt nem jelennek meg. A játékosnak az számít, mi van most
     * érvényben, nem az admin ütemezése.
     */
    const active = activeModifiers(modifiers, now.getTime()).map((modifier) => ({
      id: modifier.id,
      kind: modifier.kind,
      scope: modifier.scope,
      value: modifier.value,
      reason: modifier.reason,
      from: new Date(modifier.from).toISOString(),
      to: new Date(modifier.to).toISOString(),
    }));

    res.json({
      version: snapshot.version,
      groups,
      activeModifiers: active,
    });
  } catch (error) {
    next(error);
  }
});

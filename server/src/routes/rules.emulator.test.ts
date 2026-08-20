/**
 * A nyilvános szabálymagyarázó végpont VALÓDI Firestore ellen.
 *
 * Amit itt bizonyítani kell: a Trust Score-hoz tartozó kulcsok SOHA nem
 * jelennek meg (6. alapszabály), a `appConfig/gameplay` felülírása látszik a
 * válaszban, és csak a JELENLEG aktív modifierek jönnek — a jövőben induló
 * akció nem.
 *
 * FUTTATÁS (a repo gyökeréből, egyetlen parancs):
 *
 *   npm.cmd run test:emulator
 *
 * Emulátor nélkül a fájl MAGÁTÓL KIMARAD.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { GAMEPLAY } from '../../../src/config/gameplay';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!EMULATOR)('Rules API — valódi Firestore ellen', () => {
  let server: Server;
  let base: string;
  let db: FirebaseFirestore.Firestore;
  let collections: Record<string, string>;

  beforeAll(async () => {
    const firebase = await import('../lib/firebase');
    db = firebase.db;
    collections = firebase.COLLECTIONS as unknown as Record<string, string>;

    const { rulesRouter } = await import('./rules');

    const app = express();
    app.use(express.json());
    app.use('/api/rules', rulesRouter);

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => resolve());
    });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    const { resetGameplayCache } = await import('../lib/gameplayConfig');
    const { resetModifierCache } = await import('../lib/modifiers');
    resetGameplayCache();
    resetModifierCache();

    for (const name of ['appConfig', 'modifiers']) {
      const snap = await db.collection(collections[name]!).get();
      for (const doc of snap.docs) await doc.ref.delete();
    }
  });

  async function call(): Promise<{ status: number; body: any }> {
    const response = await fetch(`${base}/api/rules`);
    return { status: response.status, body: await response.json().catch(() => null) };
  }

  it('nincs hitelesítés, mégis válaszol', async () => {
    expect((await call()).status).toBe(200);
  });

  it('a Trust Score csoport SOHA nem jelenik meg', async () => {
    const { body } = await call();
    const trustGroup = body.groups.find((g: any) => g.group === 'Trust Score');
    expect(trustGroup).toBeUndefined();

    const allPaths = body.groups.flatMap((g: any) => g.items).map((i: any) => i.path);
    expect(allPaths).not.toContain('TRUST_THRESHOLD_ACCEPT');
    expect(allPaths).not.toContain('TRUST_THRESHOLD_REJECT');
    expect(allPaths).not.toContain('TRUST_OBSERVE_ONLY');
    expect(allPaths).not.toContain('TRUST_AUTO_APPROVE_MINUTES');
  });

  it('alapállapotban az alapértékeket adja vissza', async () => {
    const { body } = await call();
    expect(body.version).toBe(0);

    const item = body.groups
      .flatMap((g: any) => g.items)
      .find((i: any) => i.path === 'HOLD_GP_PER_KM2');
    expect(item.value).toBe(GAMEPLAY.HOLD_GP_PER_KM2);
    expect(item.defaultValue).toBe(GAMEPLAY.HOLD_GP_PER_KM2);
    expect(item.overridden).toBe(false);
  });

  it('az appConfig felülírása látszik a válaszban', async () => {
    await db
      .collection(collections.appConfig!)
      .doc('gameplay')
      .set({ version: 3, overrides: { HOLD_GP_PER_KM2: 250 } });
    const { resetGameplayCache } = await import('../lib/gameplayConfig');
    resetGameplayCache();

    const { body } = await call();
    expect(body.version).toBe(3);

    const item = body.groups
      .flatMap((g: any) => g.items)
      .find((i: any) => i.path === 'HOLD_GP_PER_KM2');
    expect(item.value).toBe(250);
    expect(item.overridden).toBe(true);
  });

  it('csak a jelenleg aktív modifier jelenik meg, a jövőbeli nem', async () => {
    const now = Date.now();
    await db.collection(collections.modifiers!).doc('most-fut').set({
      kind: 'gp_multiplier',
      scope: 'global',
      value: 2,
      from: new Date(now - 3_600_000),
      to: new Date(now + 3_600_000),
      reason: 'Teszt akció',
      source: 'manual',
    });
    await db.collection(collections.modifiers!).doc('jovobeli').set({
      kind: 'gp_multiplier',
      scope: 'global',
      value: 3,
      from: new Date(now + 86_400_000),
      to: new Date(now + 2 * 86_400_000),
      reason: 'Még nem kezdődött',
      source: 'manual',
    });
    const { resetModifierCache } = await import('../lib/modifiers');
    resetModifierCache();

    const { body } = await call();
    expect(body.activeModifiers).toHaveLength(1);
    expect(body.activeModifiers[0].reason).toBe('Teszt akció');
    expect(body.activeModifiers[0].value).toBe(2);
  });
});

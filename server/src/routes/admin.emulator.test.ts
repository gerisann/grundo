/**
 * Admin API valódi Firestore ellen.
 *
 * Amit itt bizonyítani kell: a szerepkör-kapu tényleg zár, a hibás érték
 * VISSZAUTASÍTÁSRA kerül (nem csendben eldobásra), a mentés verziót és
 * naplóbejegyzést hagy, és a beállítás valóban eljut a játékmotorig.
 *
 * FUTTATÁS (a repo gyökeréből, egyetlen parancs):
 *
 *   npm.cmd run test:emulator
 *
 * Ez MIND a három emulátoros fájlt lefuttatja, sorosan. A sorosság nem
 * kényelmi kérdés: a három suite ugyanazt az emulált adatbázist használja, és
 * mindegyik takarít a saját `beforeEach`-ében. Párhuzamosan futva egymás alól
 * törlik az adatot, és olyan hibák jönnek, amik külön-külön nem reprodukálhatók
 * (2026-08-19-én így is történt: külön mind a három zöld volt, együtt kilenc
 * teszt bukott).
 *
 * Egyetlen fájl futtatása:
 *
 *   firebase.cmd emulators:exec --only firestore --project demo-grundo "npx vitest run <fájl>"
 *
 * Emulátor nélkül a fájl MAGÁTÓL KIMARAD, tehát a sima `npm test` nem törik el.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { GAMEPLAY } from '../../../src/config/gameplay';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!EMULATOR)('Admin API — valódi Firestore ellen', () => {
  let server: Server;
  let base: string;
  let db: FirebaseFirestore.Firestore;
  let collections: Record<string, string>;
  let currentRole: string | undefined = 'owner';
  let currentUid = 'admin-teszt';

  beforeAll(async () => {
    const firebase = await import('../lib/firebase');
    db = firebase.db;
    collections = firebase.COLLECTIONS as unknown as Record<string, string>;

    const { adminRouter } = await import('./admin');
    const { HttpError } = await import('../lib/errors');

    const app = express();
    app.use(express.json());
    // Hitelesítés helyett: a teszt mondja meg, ki a kérő és mi a szerepköre.
    app.use((req, _res, next) => {
      (req as { uid?: string; role?: string }).uid = currentUid;
      (req as { uid?: string; role?: string }).role = currentRole;
      next();
    });
    app.use('/api/admin', adminRouter);
    app.use(
      (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        if (err instanceof HttpError) {
          return res.status(err.status).json({ code: err.code, message: err.message });
        }
        res.status(500).json({ code: 'internal', message: String(err) });
      },
    );

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
    currentRole = 'owner';
    currentUid = 'admin-teszt';

    const { resetGameplayCache } = await import('../lib/gameplayConfig');
    const { resetModifierCache } = await import('../lib/modifiers');
    resetGameplayCache();
    resetModifierCache();

    for (const name of ['appConfig', 'modifiers', 'adminAudit']) {
      const snap = await db.collection(collections[name]!).get();
      for (const doc of snap.docs) {
        const versions = await doc.ref.collection('versions').get();
        await Promise.all(versions.docs.map((v) => v.ref.delete()));
        await doc.ref.delete();
      }
    }
  });

  async function call(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: any }> {
    const response = await fetch(`${base}/api/admin${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }

  // ── Szerepkör-kapu ──────────────────────────────────────────────────────

  describe('jogosultság', () => {
    it('szerepkör nélkül semmit nem enged', async () => {
      currentRole = undefined;
      expect((await call('/gameplay')).status).toBe(403);
    });

    it('ismeretlen szerepkört sem enged', async () => {
      currentRole = 'felhasznalo';
      expect((await call('/gameplay')).status).toBe(403);
    });

    it('a moderátor OLVASHAT, de nem írhat játékszabályt', async () => {
      currentRole = 'moderator';
      expect((await call('/gameplay')).status).toBe(200);

      const write = await call('/gameplay', { method: 'PUT', body: { overrides: {} } });
      expect(write.status).toBe(403);
    });

    it('a readonly nem hozhat létre akciót', async () => {
      currentRole = 'readonly';
      const created = await call('/modifiers', {
        method: 'POST',
        body: { kind: 'gp_multiplier', scope: 'global', value: 2 },
      });
      expect(created.status).toBe(403);
    });
  });

  // ── Játékkonfiguráció ───────────────────────────────────────────────────

  describe('játékkonfiguráció', () => {
    it('üres állapotban az alapértékeket adja vissza', async () => {
      const { status, body } = await call('/gameplay');

      expect(status).toBe(200);
      expect(body.version).toBe(0);
      expect(body.overrides).toEqual({});
      expect(body.groups.length).toBeGreaterThan(0);

      const base = body.groups
        .flatMap((g: any) => g.items)
        .find((item: any) => item.path === 'HOLD_GP_PER_KM2');
      expect(base.value).toBe(GAMEPLAY.HOLD_GP_PER_KM2);
      expect(base.defaultValue).toBe(GAMEPLAY.HOLD_GP_PER_KM2);
      expect(base.overridden).toBe(false);
    });

    it('mentéskor verziót léptet és naplóz', async () => {
      const saved = await call('/gameplay', {
        method: 'PUT',
        body: { overrides: { HOLD_GP_PER_KM2: 250 }, note: 'teszt' },
      });

      expect(saved.status).toBe(200);
      expect(saved.body.version).toBe(1);
      expect(saved.body.overrides).toEqual({ HOLD_GP_PER_KM2: 250 });

      const versions = await call('/gameplay/versions');
      expect(versions.body.versions).toHaveLength(1);
      expect(versions.body.versions[0]).toMatchObject({ version: 1, note: 'teszt' });

      const audit = await db.collection(collections.adminAudit!).get();
      expect(audit.size).toBe(1);
      expect(audit.docs[0]?.data()).toMatchObject({
        action: 'gameplay_update',
        adminUid: 'admin-teszt',
      });
    });

    /**
     * A futásidejű út szándékosan elnyeli a hibás értéket, hogy egy elrontott
     * dokumentum ne állítsa meg a játékot. A SZERKESZTŐBEN pont fordítva
     * helyes: az adminnak látnia kell, mi nem ment át.
     */
    it('a tartományon kívüli értéket VISSZAUTASÍTJA, nem dobja el csendben', async () => {
      const rejected = await call('/gameplay', {
        method: 'PUT',
        body: { overrides: { SOFT_CAP_RATE: 5 } },
      });

      expect(rejected.status).toBe(400);
      expect(rejected.body.message).toContain('SOFT_CAP_RATE');

      // És nem is mentett semmit.
      expect((await call('/gameplay')).body.version).toBe(0);
    });

    it('a szerkezeti konstansokat nem engedi állítani', async () => {
      const rejected = await call('/gameplay', {
        method: 'PUT',
        body: { overrides: { H3_RESOLUTION: 9 } },
      });
      expect(rejected.status).toBe(400);
      expect(rejected.body.message).toContain('H3_RESOLUTION');
    });

    it('a nem monoton védelmi létrát elutasítja', async () => {
      const rejected = await call('/gameplay', {
        method: 'PUT',
        body: { overrides: { 'DEFENSE_MULTIPLIER.3': 1.2 } },
      });
      expect(rejected.status).toBe(400);
    });

    it('a kihagyott kulcs visszaáll alapértékre', async () => {
      await call('/gameplay', { method: 'PUT', body: { overrides: { STEAL_BONUS: 1 } } });
      const cleared = await call('/gameplay', { method: 'PUT', body: { overrides: {} } });

      expect(cleared.body.overrides).toEqual({});
      const item = cleared.body.groups
        .flatMap((g: any) => g.items)
        .find((i: any) => i.path === 'STEAL_BONUS');
      expect(item.value).toBe(GAMEPLAY.STEAL_BONUS);
    });

    it('a visszaállítás ÚJ verziót ír, nem írja át a történetet', async () => {
      await call('/gameplay', { method: 'PUT', body: { overrides: { STEAL_BONUS: 1 } } });
      await call('/gameplay', { method: 'PUT', body: { overrides: { STEAL_BONUS: 2 } } });

      const back = await call('/gameplay/rollback', { method: 'POST', body: { version: 1 } });
      expect(back.status).toBe(200);
      expect(back.body.version).toBe(3);
      expect(back.body.overrides).toEqual({ STEAL_BONUS: 1 });

      const versions = await call('/gameplay/versions');
      expect(versions.body.versions.map((v: any) => v.version)).toEqual([3, 2, 1]);
    });

    it('nem létező verzióra nem lehet visszaállni', async () => {
      const back = await call('/gameplay/rollback', { method: 'POST', body: { version: 42 } });
      expect(back.status).toBe(404);
    });

    /**
     * A lényeg: a szerkesztő nem önmagában áll, hanem tényleg a JÁTÉKMOTORT
     * állítja. Enélkül lehetne szép felületünk, ami semmit nem csinál.
     */
    it('a mentett érték eljut a játékmotorig', async () => {
      await call('/gameplay', {
        method: 'PUT',
        body: { overrides: { HOLD_GP_PER_KM2: 250 } },
      });

      const { getGameplaySnapshot, resetGameplayCache } = await import('../lib/gameplayConfig');
      resetGameplayCache();
      const snapshot = await getGameplaySnapshot(new Date());

      expect(snapshot.version).toBe(1);
      expect(snapshot.config.HOLD_GP_PER_KM2).toBe(250);

      const { computeHoldBonus } = await import('../../../src/game/scoring');
      expect(computeHoldBonus(1_000_000, 0, snapshot.config)).toBe(250);
    });
  });

  // ── Akciók ──────────────────────────────────────────────────────────────

  describe('akciók', () => {
    const hour = 3_600_000;
    const validBody = (overrides: Record<string, unknown> = {}) => ({
      kind: 'gp_multiplier',
      scope: 'global',
      value: 2,
      reason: 'Teszt akció',
      from: new Date(Date.now() + hour).toISOString(),
      to: new Date(Date.now() + 3 * hour).toISOString(),
      ...overrides,
    });

    it('létrehoz és listáz', async () => {
      const created = await call('/modifiers', { method: 'POST', body: validBody() });
      expect(created.status).toBe(201);

      const list = await call('/modifiers');
      expect(list.body.modifiers).toHaveLength(1);
      expect(list.body.modifiers[0]).toMatchObject({
        kind: 'gp_multiplier',
        state: 'scheduled',
        source: 'manual',
      });
    });

    it('indoklás nélkül nem enged létrehozni', async () => {
      const created = await call('/modifiers', { method: 'POST', body: validBody({ reason: '' }) });
      expect(created.status).toBe(400);
      expect(created.body.code).toBe('missing_reason');
    });

    it('a véget kötelezővé teszi, és a múltba nem engedi', async () => {
      const past = await call('/modifiers', {
        method: 'POST',
        body: validBody({
          from: new Date(Date.now() - 3 * hour).toISOString(),
          to: new Date(Date.now() - hour).toISOString(),
        }),
      });
      expect(past.status).toBe(400);
      expect(past.body.code).toBe('already_expired');
    });

    it('a túl hosszú akciót elutasítja', async () => {
      const long = await call('/modifiers', {
        method: 'POST',
        body: validBody({
          to: new Date(Date.now() + (GAMEPLAY.MODIFIER_MAX_DAYS + 5) * 86_400_000).toISOString(),
        }),
      });
      expect(long.status).toBe(400);
      expect(long.body.code).toBe('too_long');
    });

    it('a plafon fölötti szorzót elutasítja', async () => {
      const big = await call('/modifiers', {
        method: 'POST',
        body: validBody({ value: GAMEPLAY.MODIFIER_MAX_FACTOR + 1 }),
      });
      expect(big.status).toBe(400);
    });

    it('területi akcióhoz cellákat számol', async () => {
      const created = await call('/modifiers', {
        method: 'POST',
        body: validBody({ scope: 'area', area: { lat: 47.4979, lng: 19.0402, radiusKm: 5 } }),
      });
      expect(created.status).toBe(201);

      const list = await call('/modifiers');
      expect(list.body.modifiers[0].areaCellCount).toBeGreaterThan(0);
      expect(list.body.modifiers[0].area).toMatchObject({ radiusKm: 5 });
    });

    it('az elgépelt sugarat megfogja', async () => {
      const huge = await call('/modifiers', {
        method: 'POST',
        body: validBody({ scope: 'area', area: { lat: 47.4979, lng: 19.0402, radiusKm: 500 } }),
      });
      expect(huge.status).toBe(400);
      expect(huge.body.code).toBe('area_too_large');
    });

    it('lezárja, de nem törli', async () => {
      const created = await call('/modifiers', { method: 'POST', body: validBody() });
      const id = created.body.id;

      const cancelled = await call(`/modifiers/${id}/cancel`, { method: 'POST' });
      expect(cancelled.status).toBe(200);

      // A dokumentum megmarad — a főkönyvi bejegyzések hivatkoznak rá.
      const doc = await db.collection(collections.modifiers!).doc(id).get();
      expect(doc.exists).toBe(true);
      expect(doc.data()?.cancelledAt).toBeTruthy();

      // Az alapértelmezett listából viszont eltűnik.
      expect((await call('/modifiers')).body.modifiers).toHaveLength(0);
      expect((await call('/modifiers?expired=1')).body.modifiers).toHaveLength(1);
    });

    it('kétszer nem lehet lezárni', async () => {
      const created = await call('/modifiers', { method: 'POST', body: validBody() });
      await call(`/modifiers/${created.body.id}/cancel`, { method: 'POST' });
      const again = await call(`/modifiers/${created.body.id}/cancel`, { method: 'POST' });
      expect(again.status).toBe(400);
    });

    it('a lezárt akció a játékmotorhoz sem jut el', async () => {
      const created = await call('/modifiers', {
        method: 'POST',
        body: validBody({ from: new Date(Date.now() - hour).toISOString() }),
      });

      const { getModifiers, resetModifierCache } = await import('../lib/modifiers');
      resetModifierCache();
      expect(await getModifiers(new Date())).toHaveLength(1);

      await call(`/modifiers/${created.body.id}/cancel`, { method: 'POST' });
      resetModifierCache();
      expect(await getModifiers(new Date())).toHaveLength(0);
    });
  });

  describe('állapot', () => {
    it('megmondja a szerepkört és az írási jogot', async () => {
      currentRole = 'support';
      const { body } = await call('/status');
      expect(body).toMatchObject({ role: 'support', canWrite: false });

      currentRole = 'admin';
      expect((await call('/status')).body.canWrite).toBe(true);
    });
  });
});

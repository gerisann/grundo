/**
 * Admin API — játékkonfiguráció és időszakos szorzók.
 *
 * A felület a `src/admin/` alatt él, ugyanabban az alkalmazásban, lusta
 * betöltésű darabként. A védelmet viszont NEM a felület adja, hanem ez a
 * réteg: a szerepkör a custom claimből jön, és minden írás naplózódik
 * (`adminAudit`). Admin JS birtokában is minden hívás 403.
 *
 * docs/06-architektura-es-admin.md → Admin felület · 7. Játékkonfiguráció
 */

import { Router } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js';
import { GAMEPLAY } from '../../../src/config/gameplay';
import { resolveGameplay, tunableGroups, TUNABLES } from '../../../src/config/tunables';
import { distanceM } from '../../../src/game/geo';
import type { ModifierKind, ModifierScope } from '../../../src/game/modifiers';
import type { AuthedRequest } from '../../server';
import { APP_CONFIG_DOCS, COLLECTIONS, db } from '../lib/firebase';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { getGameplaySnapshot, resetGameplayCache } from '../lib/gameplayConfig';
import { resetModifierCache } from '../lib/modifiers';

export const adminRouter = Router();

/** Aki egyáltalán beléphet az admin felületre. */
const READ_ROLES = new Set(['owner', 'admin', 'moderator', 'support', 'readonly']);
/** Aki játékszabályt írhat. A moderátor tartalmat kezel, nem balanszot. */
const WRITE_ROLES = new Set(['owner', 'admin']);

const KINDS = new Set<ModifierKind>(['gp_multiplier', 'claim_multiplier', 'hold_multiplier']);
const SCOPES = new Set<ModifierScope>(['global', 'area', 'segment']);

adminRouter.use((req: AuthedRequest, _res, next) => {
  if (!req.role || !READ_ROLES.has(req.role)) {
    return next(forbidden('Az admin felület csak jogosultsággal érhető el.'));
  }
  next();
});

function requireWrite(req: AuthedRequest): void {
  if (!req.role || !WRITE_ROLES.has(req.role)) {
    throw forbidden('A játékszabályok módosítása `owner` vagy `admin` jogosultságot igényel.');
  }
}

/** Naplóbejegyzés minden íráshoz. A napló nélküli admin művelet nem létezik. */
async function audit(
  req: AuthedRequest,
  action: string,
  targetType: string,
  targetId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await db.collection(COLLECTIONS.adminAudit).add({
    adminUid: req.uid ?? null,
    adminRole: req.role ?? null,
    action,
    targetType,
    targetId,
    before: before ?? null,
    after: after ?? null,
    at: FieldValue.serverTimestamp(),
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  Játékkonfiguráció
// ════════════════════════════════════════════════════════════════════════════

const gameplayDoc = () =>
  db.collection(COLLECTIONS.appConfig).doc(APP_CONFIG_DOCS.gameplay);

function readPath(target: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node === null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[key];
  }, target);
}

/**
 * A szerkesztő teljes állapota egyetlen válaszban.
 *
 * A séma is itt jön le, nem a kliensbe fordítva — így egy új hangolható kulcs
 * a szerver telepítésével azonnal megjelenik a felületen, és nem lehet olyan
 * állapot, ahol a kettő eltér egymástól.
 */
async function gameplayState() {
  const snap = await gameplayDoc().get();
  const data = snap.exists
    ? (snap.data() as {
        version?: number;
        overrides?: Record<string, unknown>;
        updatedAt?: Timestamp;
        updatedBy?: string;
        note?: string;
      })
    : undefined;

  const resolved = resolveGameplay(data?.overrides);

  return {
    version: Number.isFinite(data?.version) ? Number(data?.version) : 0,
    updatedAt: data?.updatedAt?.toDate().toISOString() ?? null,
    updatedBy: data?.updatedBy ?? null,
    note: data?.note ?? null,
    overrides: resolved.applied,
    rejected: resolved.rejected,
    groups: tunableGroups().map((group) => ({
      group: group.group,
      items: group.items.map((spec) => ({
        ...spec,
        defaultValue: readPath(GAMEPLAY, spec.path),
        value: readPath(resolved.config, spec.path),
        overridden: spec.path in resolved.applied,
      })),
    })),
  };
}

adminRouter.get('/gameplay', async (_req, res, next) => {
  try {
    res.json(await gameplayState());
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/admin/gameplay
 *
 * A teljes felülírás-halmazt várja, nem különbséget: amit nem küldesz, az
 * visszaáll alapértékre. Így a felület állapota és a tárolt állapot nem tud
 * szétcsúszni — nincs „ezt még nem törölted ki" maradék.
 */
adminRouter.put('/gameplay', async (req: AuthedRequest, res, next) => {
  try {
    requireWrite(req);

    const body = (req.body ?? {}) as { overrides?: unknown; note?: unknown };
    if (body.overrides === null || typeof body.overrides !== 'object') {
      throw badRequest('invalid_overrides', 'A felülírásokat objektumként kell küldeni.');
    }
    const overrides = body.overrides as Record<string, unknown>;
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';

    /**
     * A hibás értéket itt VISSZAUTASÍTJUK, nem csendben eldobjuk.
     *
     * A `resolveGameplay` a futásidejű úton szándékosan elnyeli a rosszat, hogy
     * egy elrontott dokumentum ne állítsa meg a játékot. A szerkesztőben viszont
     * pont fordítva helyes: az adminnak látnia kell, mi nem ment át, különben
     * azt hinné, beállította.
     */
    const resolved = resolveGameplay(overrides);
    if (resolved.rejected.length > 0) {
      throw badRequest(
        'invalid_values',
        'Néhány érték nem érvényes: ' +
          resolved.rejected.map((r) => `${r.path} (${r.reason})`).join('; '),
      );
    }

    const doc = gameplayDoc();
    const saved = await db.runTransaction(async (tx) => {
      const current = await tx.get(doc);
      const before = current.exists ? (current.data() as Record<string, unknown>) : null;
      const version = Number(before?.version ?? 0) + 1;

      const next = {
        version,
        overrides: resolved.applied,
        note,
        updatedAt: Timestamp.now(),
        updatedBy: req.uid ?? null,
      };

      tx.set(doc, next);
      // A verziótörténet append-only: visszavonáskor sem írjuk felül.
      tx.set(doc.collection('versions').doc(String(version)), next);
      return { before, next };
    });

    /**
     * A gyorsítótár ürítése CSAK EZT a példányt érinti.
     *
     * Több Cloud Run példánynál a többi legfeljebb a TTL végéig (60 s) számol a
     * régi értékkel. Ez tudatos csere: egy globális érvénytelenítés
     * (pub/sub vagy közös cache) sokkal több mozgó alkatrész azért, hogy egy
     * balansz-állítás egy perccel hamarabb érjen körbe.
     */
    resetGameplayCache();
    await audit(req, 'gameplay_update', 'appConfig', 'gameplay', saved.before, saved.next);

    res.json(await gameplayState());
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/gameplay/versions', async (_req, res, next) => {
  try {
    const snap = await gameplayDoc()
      .collection('versions')
      .orderBy('version', 'desc')
      .limit(50)
      .get();

    res.json({
      versions: snap.docs.map((doc) => {
        const data = doc.data() as {
          version?: number;
          overrides?: Record<string, unknown>;
          note?: string;
          updatedAt?: Timestamp;
          updatedBy?: string;
        };
        return {
          version: data.version ?? Number(doc.id),
          overrides: data.overrides ?? {},
          note: data.note ?? '',
          updatedAt: data.updatedAt?.toDate().toISOString() ?? null,
          updatedBy: data.updatedBy ?? null,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Visszavonás: a régi felülírás-halmaz ÚJ verzióként íródik vissza.
 *
 * A történetet nem írjuk át, és nem is „lépünk vissza" benne. Így a napló
 * elmondja, hogy volt egy rossz beállítás és mikor vontuk vissza — ez később
 * pont annyira fontos, mint maga az érték.
 */
adminRouter.post('/gameplay/rollback', async (req: AuthedRequest, res, next) => {
  try {
    requireWrite(req);
    const version = Number((req.body ?? {}).version);
    if (!Number.isInteger(version) || version < 1) {
      throw badRequest('invalid_version', 'Érvénytelen verziószám.');
    }

    const source = await gameplayDoc().collection('versions').doc(String(version)).get();
    if (!source.exists) throw notFound('version_missing', 'Ez a verzió nem található.');

    const overrides = (source.data() as { overrides?: Record<string, unknown> }).overrides ?? {};
    const resolved = resolveGameplay(overrides);

    const doc = gameplayDoc();
    const saved = await db.runTransaction(async (tx) => {
      const current = await tx.get(doc);
      const before = current.exists ? (current.data() as Record<string, unknown>) : null;
      const nextVersion = Number(before?.version ?? 0) + 1;
      const next = {
        version: nextVersion,
        overrides: resolved.applied,
        note: `Visszaállítás a(z) ${version}. verzióra.`,
        updatedAt: Timestamp.now(),
        updatedBy: req.uid ?? null,
      };
      tx.set(doc, next);
      tx.set(doc.collection('versions').doc(String(nextVersion)), next);
      return { before, next };
    });

    resetGameplayCache();
    await audit(req, 'gameplay_rollback', 'appConfig', 'gameplay', saved.before, saved.next);

    res.json(await gameplayState());
  } catch (error) {
    next(error);
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  Modifierek
// ════════════════════════════════════════════════════════════════════════════

/**
 * Kör alakú terület → H3 cellák a modifier felbontásán.
 *
 * A `gridDisk` hatszögletű koronát ad, ami kifelé túllóg a körön; ezért a
 * jelölteket a valódi középpont-távolság szerint szűrjük. Így a megadott sugár
 * azt jelenti, amit a felületen írt: kilométert, nem gyűrűszámot.
 */
function areaCellsFor(lat: number, lng: number, radiusKm: number): string[] {
  const center = latLngToCell(lat, lng, GAMEPLAY.MODIFIER_AREA_RES);
  // Két szomszédos cella középpontja ~2,4 km-re van egymástól ezen a szinten.
  const rings = Math.max(1, Math.ceil(radiusKm / 2) + 1);
  const centerPoint = { lat, lng };

  return gridDisk(center, rings).filter((cell) => {
    const [cellLat, cellLng] = cellToLatLng(cell);
    return distanceM(centerPoint, { lat: cellLat, lng: cellLng }) <= radiusKm * 1000;
  });
}

adminRouter.get('/modifiers', async (req, res, next) => {
  try {
    const includeExpired = String(req.query.expired ?? '') === '1';
    const snap = await db
      .collection(COLLECTIONS.modifiers)
      .orderBy('from', 'desc')
      .limit(100)
      .get();

    const now = Date.now();
    const items = snap.docs
      .map((doc) => {
        const data = doc.data() as Record<string, any>;
        const from: Timestamp | undefined = data.from;
        const to: Timestamp | undefined = data.to;
        const fromMs = from?.toMillis?.() ?? 0;
        const toMs = to?.toMillis?.() ?? 0;
        const cancelled = Boolean(data.cancelledAt);

        return {
          id: doc.id,
          kind: data.kind,
          scope: data.scope,
          value: data.value,
          reason: data.reason ?? '',
          source: data.source ?? 'manual',
          from: from?.toDate().toISOString() ?? null,
          to: to?.toDate().toISOString() ?? null,
          areaCellCount: Array.isArray(data.areaCells) ? data.areaCells.length : 0,
          area: data.areaCenter ?? null,
          segment: data.segment ?? null,
          createdBy: data.createdBy ?? null,
          cancelled,
          state: cancelled
            ? ('cancelled' as const)
            : now < fromMs
              ? ('scheduled' as const)
              : now < toMs
                ? ('active' as const)
                : ('expired' as const),
        };
      })
      .filter((item) => includeExpired || (item.state !== 'expired' && item.state !== 'cancelled'));

    res.json({ modifiers: items });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/modifiers', async (req: AuthedRequest, res, next) => {
  try {
    requireWrite(req);
    const body = (req.body ?? {}) as Record<string, any>;

    const kind = String(body.kind ?? '');
    const scope = String(body.scope ?? '');
    if (!KINDS.has(kind as ModifierKind)) throw badRequest('invalid_kind', 'Ismeretlen modifier-fajta.');
    if (!SCOPES.has(scope as ModifierScope)) throw badRequest('invalid_scope', 'Ismeretlen hatókör.');

    const value = Number(body.value);
    if (!Number.isFinite(value) || value < 0 || value > GAMEPLAY.MODIFIER_MAX_FACTOR) {
      throw badRequest(
        'invalid_value',
        `A szorzó 0 és ${GAMEPLAY.MODIFIER_MAX_FACTOR} közötti szám lehet.`,
      );
    }

    const from = new Date(String(body.from ?? ''));
    const to = new Date(String(body.to ?? ''));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw badRequest('invalid_dates', 'A kezdés és a vég időpontja kötelező.');
    }
    if (to.getTime() <= from.getTime()) {
      throw badRequest('invalid_dates', 'A vége nem lehet a kezdés előtt.');
    }
    if (to.getTime() <= Date.now()) {
      throw badRequest('already_expired', 'Ez az akció már lejárt volna. Adj meg jövőbeli véget.');
    }

    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days > GAMEPLAY.MODIFIER_MAX_DAYS) {
      throw badRequest(
        'too_long',
        `Egy akció legfeljebb ${GAMEPLAY.MODIFIER_MAX_DAYS} napig tarthat. Hosszabbat meghosszabbítani kell, nem elfelejteni.`,
      );
    }

    const reason = String(body.reason ?? '').trim().slice(0, 200);
    if (reason.length < 3) {
      // A `reason` a felhasználónak is megjelenik — üresen egy néma szorzó
      // maradna, amit senki nem tud megmagyarázni, három hónappal később sem.
      throw badRequest('missing_reason', 'Adj meg egy rövid indoklást — ez a játékosnak is megjelenik.');
    }

    const record: Record<string, unknown> = {
      kind,
      scope,
      value,
      reason,
      source: 'manual',
      from: Timestamp.fromDate(from),
      to: Timestamp.fromDate(to),
      createdBy: req.uid ?? null,
      createdAt: FieldValue.serverTimestamp(),
    };

    if (scope === 'area') {
      const lat = Number(body.area?.lat);
      const lng = Number(body.area?.lng);
      const radiusKm = Number(body.area?.radiusKm);
      if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
        throw badRequest('invalid_area', 'A terület középpontja érvénytelen.');
      }
      if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
        throw badRequest('invalid_area', 'A sugár pozitív szám kell legyen.');
      }

      const cells = areaCellsFor(lat, lng, radiusKm);
      if (cells.length > GAMEPLAY.MODIFIER_MAX_AREA_CELLS) {
        throw badRequest(
          'area_too_large',
          `Ez a sugár ${cells.length} cellát fedne le, a határ ${GAMEPLAY.MODIFIER_MAX_AREA_CELLS}. Nem elgépelted a kilométert?`,
        );
      }
      record.areaCells = cells;
      record.areaCenter = { lat, lng, radiusKm };
    }

    if (scope === 'segment') {
      const inactiveDays = Number(body.segment?.inactiveDays);
      if (!Number.isInteger(inactiveDays) || inactiveDays < 1) {
        throw badRequest('invalid_segment', 'A szegmenshez egész napszám kell.');
      }
      record.segment = { inactiveDays };
    }

    const created = await db.collection(COLLECTIONS.modifiers).add(record);
    resetModifierCache();

    /**
     * A naplóba a cellalista HELYETT csak a darabszám megy.
     *
     * Két okból nem a `record` másolata: egy 500 elemű cellatömb minden
     * naplóbejegyzést feleslegesen felfújna, a `createdAt` pedig szervermezőt
     * (sentinelt) tartalmaz, amit nem szabad két íráshoz újrahasználni.
     * A hiányzó mezőket sem lehet `undefined`-ként átadni — a Firestore azt
     * kivétellel utasítja el, és a művelet 500-zal hasal el.
     */
    const { areaCells, createdAt, ...auditable } = record;
    void createdAt;
    await audit(req, 'modifier_create', 'modifiers', created.id, null, {
      ...auditable,
      areaCellCount: Array.isArray(areaCells) ? areaCells.length : 0,
    });

    res.status(201).json({ id: created.id });
  } catch (error) {
    next(error);
  }
});

/**
 * Lezárás — nem törlés.
 *
 * A lejárt vagy visszavont akció nyoma megmarad: a `gpLedger` bejegyzések rá
 * hivatkoznak, és utólag meg kell tudni mondani, miért kapott valaki
 * kétszeres pontot egy kedden.
 */
adminRouter.post('/modifiers/:id/cancel', async (req: AuthedRequest, res, next) => {
  try {
    requireWrite(req);
    const id = String(req.params.id ?? '');
    if (!id) throw badRequest('missing_id', 'Hiányzik az akció azonosítója.');
    const ref = db.collection(COLLECTIONS.modifiers).doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw notFound('modifier_missing', 'Ez az akció nem található.');
    if (snap.data()?.cancelledAt) throw badRequest('already_cancelled', 'Ez az akció már le van zárva.');

    await ref.set(
      { cancelledAt: Timestamp.now(), cancelledBy: req.uid ?? null },
      { merge: true },
    );
    resetModifierCache();
    await audit(req, 'modifier_cancel', 'modifiers', ref.id, snap.data() ?? null, null);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  Áttekintés
// ════════════════════════════════════════════════════════════════════════════

/**
 * A felület fejlécéhez: ki vagyok, mit szabad, és mi a rendszer állapota.
 *
 * A `canWrite` NEM védelem, csak a felület udvariassága — a tiltást minden
 * végpont maga is kikényszeríti.
 */
adminRouter.get('/status', async (req: AuthedRequest, res, next) => {
  try {
    const [snapshot, runs] = await Promise.all([
      getGameplaySnapshot(new Date()),
      db.collection(COLLECTIONS.rolloverRuns).orderBy('at', 'desc').limit(1).get(),
    ]);

    const lastRun = runs.docs[0]?.data() as Record<string, any> | undefined;

    res.json({
      role: req.role ?? null,
      canWrite: Boolean(req.role && WRITE_ROLES.has(req.role)),
      configVersion: snapshot.version,
      tunableCount: TUNABLES.length,
      lastRollover: lastRun
        ? {
            at: lastRun.at?.toDate?.().toISOString() ?? null,
            usersProcessed: lastRun.usersProcessed ?? 0,
            holdGpAwarded: lastRun.holdGpAwarded ?? 0,
            errors: lastRun.errors ?? 0,
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
});

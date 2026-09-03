/**
 * A VÁLASZ-TÖMÖRÍTÉS és a CORS `Vary` EGYÜTTÉLÉSE.
 *
 * MIÉRT VAN EZ A TESZT? Mert a `server.ts` CORS-ága `Vary: Origin`-nal
 * FELÜLÍR (`res.setHeader`), nem hozzáfűz — a `compression` viszont a saját
 * `Accept-Encoding` bejegyzését is a `Vary`-be teszi. Ha a kettő rossz
 * sorrendben fut, az egyik némán elveszik, és a válasz VÉGIG helyesnek
 * látszik: a böngésző megkapja a tömörített tartalmat, csak a köztes
 * gyorsítótárak kezdenek rossz változatot kiszolgálni. Ezt kézzel nézve
 * senki nem venné észre.
 *
 * MÉRVE (2026-09-03): a szerver eddig egyáltalán nem tömörített — a Cloud Run
 * nem tömörít a konténer helyett, és a kliens közvetlenül a Cloud Run URL-t
 * hívja, nem Firebase Hosting-rewrite-on át. A bekapcsolás éles adaton 83,7 %
 * megtakarítást ad (757,1 kB → 123,6 kB, `npm run inspect:payload`).
 *
 * ⚠️ EZ A TESZT A `server.ts` MIDDLEWARE-SORRENDJÉT TÜKRÖZI, nem importálja:
 * a `server.ts` importálásakor a Firebase Admin is elindulna, ami éles
 * hitelesítést kérne. Ha a `server.ts`-ben a `compression()` és a CORS-ág
 * sorrendje megváltozik, EZT A FÁJLT IS igazítani kell — különben a teszt
 * továbbra is zöld marad, miközben az éles sorrend már rossz.
 */
import { createServer, type Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { gunzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import compression from 'compression';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** A tömörítés küszöbe 1 kB — a válasznak ezt biztosan túl kell lépnie. */
const BIG_PAYLOAD = { cells: Array.from({ length: 400 }, (_, i) => `8c1e2d4a1b2c${i}ff`) };

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();

  // 1. A tömörítés — ugyanott, ahol a `server.ts`-ben: mindenki előtt.
  app.use(compression());

  // 2. A CORS-ág `Vary` FELÜLÍRÁSSAL — szó szerint úgy, ahogy a `server.ts`.
  app.use((req, res, next) => {
    const origin = req.header('Origin');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    next();
  });

  app.get('/big', (_req, res) => res.json(BIG_PAYLOAD));
  app.get('/tiny', (_req, res) => res.json({ ok: true }));

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe('válasz-tömörítés', () => {
  it('gzip-pel válaszol, ha a kliens kéri', async () => {
    const res = await raw('/big', { 'Accept-Encoding': 'gzip' });

    expect(res.headers['content-encoding']).toBe('gzip');
    // A tömörített törzsnek érdemben kisebbnek kell lennie a nyersnél.
    const rawSize = Buffer.byteLength(JSON.stringify(BIG_PAYLOAD));
    expect(res.body.byteLength).toBeLessThan(rawSize / 2);
    // És vissza kell adnia PONTOSAN az eredetit.
    expect(JSON.parse(gunzipSync(res.body).toString('utf8'))).toEqual(BIG_PAYLOAD);
  });

  it('a `Vary` MINDKETTŐT tartalmazza — ez a CORS-felülírás csapdája', async () => {
    const res = await raw('/big', {
      'Accept-Encoding': 'gzip',
      Origin: 'https://grundo.ai.studio',
    });

    const vary = String(res.headers.vary ?? '');
    expect(vary).toMatch(/Origin/i);
    expect(vary).toMatch(/Accept-Encoding/i);
  });

  it('tömörítetlenül válaszol, ha a kliens nem kéri', async () => {
    const res = await raw('/big', { 'Accept-Encoding': 'identity' });

    expect(res.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(res.body.toString('utf8'))).toEqual(BIG_PAYLOAD);
  });

  it('a küszöb alatti választ nem tömöríti — a fejléc többe kerülne', async () => {
    const res = await raw('/tiny', { 'Accept-Encoding': 'gzip' });

    expect(res.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(res.body.toString('utf8'))).toEqual({ ok: true });
  });
});

/**
 * Nyers HTTP-kérés, mert a `fetch` MAGÁTÓL kibontja a gzipet — és épp a
 * fejlécet meg a tömörített méretet akarjuk mérni, nem a kibontott törzset.
 */
function raw(
  path: string,
  headers: Record<string, string>,
): Promise<{ headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${baseUrl}${path}`, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

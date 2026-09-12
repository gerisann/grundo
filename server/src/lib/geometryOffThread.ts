/**
 * A geometria-számítás futtatása külön szálon, IDŐKORLÁTTAL.
 *
 * A miértet lásd `geometryWorker.ts`. Itt a két gyakorlati kérdés dől el:
 * honnan töltjük be a workert, és mi történik, ha túl sokáig fut.
 */

import { Worker } from 'node:worker_threads';
import type { GeometryJob, GeometryResult } from './geometryWorker';

/**
 * Meddig várunk a geometriára.
 *
 * ⚠️ IDŐKORLÁT, NEM TÁVOLSÁG-KÜSZÖB. Mérve (2026-09-12): egy 42 km-es
 * budapesti kör 11 417 ms, egy 205 km-es Balaton-kör viszont 50 217 ms — a
 * hossz tehát ROSSZ PREDIKTOR, a költséget az alak adja. Ezért nem a kérést
 * tiltjuk méret alapján, hanem a tényleges munkát vágjuk el.
 *
 * ⚠️ A 8 MÁSODPERC KEVÉS VOLT, ÉS ÉLESBEN BUKOTT KI (2026-09-12). A városi
 * tartomány mért 90. percentiliséhez (335 ms) szabtam, csakhogy a tervezés
 * plafonja 100 km légvonal — egy 40 km-es kör zsákmánya rendszeresen elvérzett
 * rajta („nem tudtuk időben kiértékelni”). Helyben mérve egy 42 km-es kör
 * hurokdetektálása 11 417 ms, és a Cloud Run kevesebb CPU-val számol.
 *
 * A 30 s ezt is átengedi. Hogy a várakozás elviselhető legyen, a felület addig
 * a hatszöges betöltőt mutatja, ami az eltelt idő szerint vált szöveget.
 */
const TIMEOUT_MS = 30_000;

/**
 * A worker fájl helye — FEJLESZTÉSBEN ÉS ÉLESBEN MÁS.
 *
 * ⚠️ EZ A TIPIKUS BUKTATÓ. Fejlesztésben `tsx` futtat `.ts` fájlokat, élesben
 * a `dist/` alatt `.js` van (`server/package.json` → `start`). A saját modul
 * kiterjesztéséből tudjuk meg, melyikben vagyunk — így egy helyen dől el, és
 * nem kell környezeti változót találgatni.
 *
 * A `tsx` loader a `process.execArgv`-ben érkezik (`--import .../loader.mjs`);
 * ezt továbbadjuk a workernek, különben a `.ts` fájlt nem tudná betölteni.
 */
function workerEntry(): { url: URL; execArgv: string[] | undefined } {
  const isTypeScript = import.meta.url.endsWith('.ts');
  return {
    url: new URL(isTypeScript ? './geometryWorker.ts' : './geometryWorker.js', import.meta.url),
    execArgv: isTypeScript ? process.execArgv : undefined,
  };
}

export class GeometryTimeout extends Error {
  constructor(public readonly ms: number) {
    super(`A terület kiszámítása ${ms} ms alatt nem fejeződött be.`);
    this.name = 'GeometryTimeout';
  }
}

/**
 * Lefuttatja a geometriát külön szálon.
 *
 * `GeometryTimeout`-ot dob, ha a határidőn belül nem végzett — ilyenkor a
 * szálat MEGÖLJÜK, tehát nem marad hátra pörgő számítás.
 */
export async function computeGeometryOffThread(
  job: GeometryJob,
  timeoutMs = TIMEOUT_MS,
): Promise<GeometryResult> {
  try {
    return await runInWorker(job, timeoutMs);
  } catch (error) {
    /*
      ⚠️ AZ IDŐKORLÁT NEM INDÍTÁSI HIBA — azt tovább kell engedni, különben a
      fő szálon futtatnánk újra pont azt, ami épp túl soknak bizonyult.
    */
    if (error instanceof GeometryTimeout) throw error;

    /*
      A SZÁL NEM INDULT EL. Ilyenkor a fő szálon számolunk — jobb egy lassabb
      válasz, mint egy elbukott terv. Ez NEM csendes: a naplóban látszik, mert
      a fő szálon a számítás megint blokkolja az event loopot, tehát ez
      üzemeltetési hiba, amit javítani kell, nem elfogadott állapot.

      Mikor fordul elő ténylegesen? Ha a worker nem tudja betölteni a modult —
      például teszt-futtatóban, ahol a szálra nem öröklődik a loader. A
      lefordított kódon mérve (`dist/`) a szálindítás 165–246 ms, és hibátlan.
    */
    console.warn(
      `⚠️  A geometria-szál nem indult el (${(error as Error).message}) — ` +
        'a számítás a FŐ SZÁLON fut, ami blokkolja az event loopot.',
    );
    const { computeGeometry } = await import('./geometryWorker');
    return computeGeometry(job);
  }
}

function runInWorker(job: GeometryJob, timeoutMs: number): Promise<GeometryResult> {
  const { url, execArgv } = workerEntry();

  return new Promise<GeometryResult>((resolve, reject) => {
    const worker = new Worker(url, { workerData: job, ...(execArgv ? { execArgv } : {}) });

    const timer = setTimeout(() => {
      /*
        A `terminate()` az egyetlen mód: a számítás szinkron ciklus, nincs
        benne pont, ahol egy „állj” jelzést megnézhetne.
      */
      void worker.terminate();
      reject(new GeometryTimeout(timeoutMs));
    }, timeoutMs);

    worker.once('message', (result: GeometryResult) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    });

    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    worker.once('exit', (code) => {
      clearTimeout(timer);
      /* A 0 és az 1 (terminate) rendben van; minden más valódi hiba. */
      if (code !== 0 && code !== 1) reject(new Error(`A geometria-szál ${code} kóddal állt le.`));
    });
  });
}

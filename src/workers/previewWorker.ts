import { PreviewSession } from '@/lib/previewEngine';
import type { PreviewCommand, PreviewResponse } from './previewProtocol';
import type { OwnershipMap } from '@/types';

/**
 * AZ ÉLŐ ELŐNÉZET WORKERE.
 *
 * A rögzítés közbeni foglalás-előnézet teljes számítása itt fut, a főszálról
 * levéve. A `TrackingScreen` így akkor sem fagy be, amikor a háttérben
 * felgyűlt GPS-minták egyszerre érkeznek meg — a 2026-09-04-i terepi mérésen
 * ez egy **859 ms**-os blokk volt a főszálon
 * (`docs/ai/meres-2026-09-04-terepi-fosszal.md`).
 *
 * MIT NEM CSINÁL: a cellaláncot (a térképre rajzolt nyomot) NEM ez számolja.
 * Az olcsó (a teljes körre 6 ms), és azonnal kell — a főszálon marad, hogy a
 * nyom és a lépéshang ne késsen a worker válaszára.
 *
 * ⚠️ A WORKERBEN NINCS `localStorage`, tehát a `lib/perfMeter.ts` itt
 * VÉGLEG KIKAPCSOLT állapotban indulna. Ezért a mérés nem a mérőmodullal
 * történik: a `PreviewSession` maga adja vissza a fázisidőket, és a főszál
 * könyveli el őket a megszokott `preview.*` kulcsokon. Enélkül a mérő a
 * javítás után nullát mutatna, és a következő terepi mérés semmit nem
 * bizonyítana.
 */

const session = new PreviewSession();
let currentSession = '';

function post(message: PreviewResponse): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<PreviewCommand>) => {
  const command = event.data;

  if (command.kind === 'reset') {
    session.reset();
    currentSession = command.session;
    return;
  }

  /**
   * Egy másik rögzítéshez tartozó üzenet a `reset` ELŐTT is beeshet (a
   * főszálon a `reset` és a `run` két külön esemény). Ilyenkor magunktól
   * váltunk munkamenetet — az eredmény különben az ELŐZŐ futás hurkait
   * keverné az újba.
   */
  if (command.session !== currentSession) {
    session.reset();
    currentSession = command.session;
  }

  if (command.kind === 'ownership') {
    const ownership: OwnershipMap = new Map(command.cells);
    session.setOwnership(ownership);
    return;
  }

  try {
    if (command.replace) session.replacePoints(command.points);
    else session.appendPoints(command.points);
    post({
      kind: 'result',
      session: command.session,
      seq: command.seq,
      output: session.run(command.request),
    });
  } catch (error) {
    post({
      kind: 'failed',
      session: command.session,
      seq: command.seq,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

post({ kind: 'ready' });

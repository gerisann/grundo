import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPerfHistory,
  measurePerf,
  notePerf,
  perfMeterEnabled,
  readPerfHistory,
  readPerfSnapshot,
  recordPerf,
  resetPerfMeter,
  savePerfSnapshot,
  setPerfMeterEnabled,
} from './perfMeter';

function statOf(key: string) {
  return readPerfSnapshot().stats.find((item) => item.key === key) ?? null;
}

// A vitest itt `node` környezetben fut, tehát nincs böngésző `localStorage` —
// a savePerfSnapshot/readPerfHistory ezt igényli (lásd `src/lib/push.test.ts`
// ugyanezt a mintát).
const storageValues = new Map<string, string>();

describe('perfMeter', () => {
  beforeEach(() => {
    storageValues.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storageValues.get(key) ?? null,
        setItem: (key: string, value: string) => storageValues.set(key, value),
        removeItem: (key: string) => storageValues.delete(key),
      },
    });
    setPerfMeterEnabled(false);
    resetPerfMeter();
    clearPerfHistory();
  });

  it('kikapcsolva semmit nem gyűjt', () => {
    expect(perfMeterEnabled()).toBe(false);
    recordPerf('a', 12);
    notePerf('cells', 5);
    const snapshot = readPerfSnapshot();
    expect(snapshot.stats).toHaveLength(0);
    expect(snapshot.notes).toHaveLength(0);
  });

  it('bekapcsolva átlagot, maximumot és darabszámot ad', () => {
    setPerfMeterEnabled(true);
    recordPerf('a', 10);
    recordPerf('a', 20);
    recordPerf('a', 30);

    const stat = statOf('a');
    expect(stat?.count).toBe(3);
    expect(stat?.avgMs).toBeCloseTo(20);
    expect(stat?.maxMs).toBe(30);
    expect(stat?.lastMs).toBe(30);
  });

  it('a maximum a TELJES mérésé, az átlag csak a mozgó ablaké', () => {
    setPerfMeterEnabled(true);
    // Egy korai kiugrás, majd 200 kicsi érték: az ablakból (120) kiesik.
    recordPerf('a', 500);
    for (let index = 0; index < 200; index += 1) recordPerf('a', 10);

    const stat = statOf('a');
    expect(stat?.count).toBe(201);
    // A kiugró érték már nincs az ablakban, tehát az átlagot nem húzza fel…
    expect(stat?.avgMs).toBeCloseTo(10);
    // …de a legrosszabb esetet nem szabad elveszíteni.
    expect(stat?.maxMs).toBe(500);
  });

  it('a p95 az ablak felső széléről jön', () => {
    setPerfMeterEnabled(true);
    for (let index = 0; index < 100; index += 1) recordPerf('a', index);

    const stat = statOf('a');
    expect(stat?.p95Ms).toBe(95);
  });

  it('a measurePerf visszaadja a hívás eredményét és rögzít', () => {
    setPerfMeterEnabled(true);
    const value = measurePerf('a', () => 42);

    expect(value).toBe(42);
    expect(statOf('a')?.count).toBe(1);
  });

  it('a measurePerf kikapcsolva is visszaadja az eredményt', () => {
    expect(measurePerf('a', () => 'ok')).toBe('ok');
    expect(statOf('a')).toBeNull();
  });

  it('kivétel esetén is rögzíti az eltelt időt, és továbbdobja a hibát', () => {
    setPerfMeterEnabled(true);
    expect(() => measurePerf('a', () => {
      throw new Error('boom');
    })).toThrow('boom');
    expect(statOf('a')?.count).toBe(1);
  });

  it('a kikapcsolás üríti a gyűjtött adatot', () => {
    setPerfMeterEnabled(true);
    recordPerf('a', 10);
    setPerfMeterEnabled(false);

    expect(readPerfSnapshot().stats).toHaveLength(0);
  });

  it('a kísérő számok a legutóbbi értéket őrzik', () => {
    setPerfMeterEnabled(true);
    notePerf('cells', 100);
    notePerf('cells', 250);

    expect(readPerfSnapshot().notes).toEqual([['cells', 250]]);
  });

  /**
   * A RÉSZLETES BONTÁS (GRUNDO #37).
   *
   * A 2026-09-04-i terepi mérésen egy 859 ms-os blokkot találtunk, de hogy az
   * a háttérből visszatéréskor keletkezett, azt csak KÖVETKEZTETNI lehetett.
   * Ezek az esetek azt rögzítik, hogy a mérő ezt már megméri.
   */
  describe('láthatóság szerinti bontás', () => {
    it('a futásokat előtér és háttér szerint külön számolja', () => {
      setPerfMeterEnabled(true);
      recordPerf('preview.total', 10, { startedVisibility: 'visible' });
      recordPerf('preview.total', 20, { startedVisibility: 'visible' });

      const stat = statOf('preview.total')!;
      // `document` nélkül a mérő mindent előtérnek lát — ez a helyes alapeset.
      expect(stat.visibleCount).toBe(2);
      expect(stat.visibleTotalMs).toBe(30);
      expect(stat.visibleMaxMs).toBe(20);
      expect(stat.hiddenCount).toBe(0);
    });

    it('a HÁTTÉRBŐL VISSZATÉRŐ futást külön jelöli', () => {
      setPerfMeterEnabled(true);
      recordPerf('preview.total', 12, { startedVisibility: 'visible' });
      // Rejtve indult, láthatóan ért véget: ez a torlódás, ez fagyasztott.
      recordPerf('preview.total', 859, { startedVisibility: 'hidden' });

      const stat = statOf('preview.total')!;
      expect(stat.resumedCount).toBe(1);
      expect(stat.resumedMaxMs).toBe(859);
      expect(stat.resumedTotalMs).toBe(859);
    });

    it('a teljes összeget is tartja, nem csak a mozgó ablakot', () => {
      setPerfMeterEnabled(true);
      for (let i = 0; i < 200; i += 1) recordPerf('preview.total', 5);

      const stat = statOf('preview.total')!;
      expect(stat.count).toBe(200);
      expect(stat.totalMs).toBe(1000);
      // Az átlag továbbra is az utolsó 120 mintáé.
      expect(stat.avgMs).toBe(5);
    });
  });

  describe('nevezetes futások és percenkénti bontás', () => {
    it('a legdrágább futásokat körülménnyel együtt őrzi meg', () => {
      setPerfMeterEnabled(true);
      notePerf('cells', 518);
      notePerf('loops', 10);
      recordPerf('preview.total', 3);
      recordPerf('preview.total', 859, { startedVisibility: 'hidden' });

      const worst = readPerfSnapshot().events[0]!;
      expect(worst.ms).toBe(859);
      expect(worst.key).toBe('preview.total');
      expect(worst.startedVisibility).toBe('hidden');
      expect(worst.endedVisibility).toBe('visible');
      // A kísérőszámok a futás pillanatából — enélkül az ms értelmezhetetlen.
      expect(worst.notes.cells).toBe(518);
      expect(worst.notes.loops).toBe(10);
    });

    it('kulcsonként legfeljebb nyolc nevezetes futást tart', () => {
      setPerfMeterEnabled(true);
      for (let i = 1; i <= 30; i += 1) recordPerf('preview.total', i);

      const events = readPerfSnapshot().events;
      expect(events).toHaveLength(8);
      // A legnagyobbak maradnak, csökkenő sorrendben.
      expect(events[0]!.ms).toBe(30);
      expect(events[7]!.ms).toBe(23);
    });

    it('percenkénti sorokat ad, futásszámmal és maximummal', () => {
      setPerfMeterEnabled(true);
      recordPerf('preview.total', 10);
      recordPerf('preview.total', 40);

      const buckets = readPerfSnapshot().buckets.filter((item) => item.key === 'preview.total');
      expect(buckets).toHaveLength(1);
      expect(buckets[0]!.minute).toBe(0);
      expect(buckets[0]!.runs).toBe(2);
      expect(buckets[0]!.totalMs).toBe(50);
      expect(buckets[0]!.maxMs).toBe(40);
    });

    it('a nullázás a nevezetes futásokat és a perc-sorokat is üríti', () => {
      setPerfMeterEnabled(true);
      recordPerf('preview.total', 42);
      expect(readPerfSnapshot().events.length).toBeGreaterThan(0);

      resetPerfMeter();
      const snapshot = readPerfSnapshot();
      expect(snapshot.events).toHaveLength(0);
      expect(snapshot.buckets).toHaveLength(0);
      expect(snapshot.startedAt).toBe(0);
    });
  });

  describe('előzmény (savePerfSnapshot / readPerfHistory)', () => {
    it('mérés nélkül nincs mit menteni', () => {
      setPerfMeterEnabled(true);
      expect(savePerfSnapshot()).toBeNull();
      expect(readPerfHistory()).toHaveLength(0);
    });

    it('elmenti a pillanatnyi mérést, legújabb elöl', () => {
      setPerfMeterEnabled(true);
      recordPerf('a', 10);
      const first = savePerfSnapshot();
      recordPerf('a', 20);
      const second = savePerfSnapshot();

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      const history = readPerfHistory();
      expect(history).toHaveLength(2);
      expect(history[0]?.id).toBe(second?.id);
      expect(history[0]?.stats.find((stat) => stat.key === 'a')?.count).toBe(2);
      expect(history[1]?.stats.find((stat) => stat.key === 'a')?.count).toBe(1);
    });

    it('a törlés üríti az előzményt', () => {
      setPerfMeterEnabled(true);
      recordPerf('a', 10);
      savePerfSnapshot();
      expect(readPerfHistory()).toHaveLength(1);

      clearPerfHistory();
      expect(readPerfHistory()).toHaveLength(0);
    });

    it('a mentett bejegyzés hordozza a mentés pillanatát és a platformot', () => {
      setPerfMeterEnabled(true);
      recordPerf('a', 10);
      const entry = savePerfSnapshot();

      expect(entry?.at).toBeGreaterThan(0);
      expect(typeof entry?.platform).toBe('string');
    });
  });
});

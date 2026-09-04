import { beforeEach, describe, expect, it } from 'vitest';
import {
  measurePerf,
  notePerf,
  perfMeterEnabled,
  readPerfSnapshot,
  recordPerf,
  resetPerfMeter,
  setPerfMeterEnabled,
} from './perfMeter';

function statOf(key: string) {
  return readPerfSnapshot().stats.find((item) => item.key === key) ?? null;
}

describe('perfMeter', () => {
  beforeEach(() => {
    setPerfMeterEnabled(false);
    resetPerfMeter();
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
});

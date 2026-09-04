import { describe, expect, it } from 'vitest';
import type { PositionSample } from '@/tracking/types';
import { buildGpx } from './gpxExport';

const samples: PositionSample[] = [
  { lat: 47.5, lng: 19.05, t: 1_000, accuracy: 5 },
  { lat: 47.5001, lng: 19.0501, t: 2_000, accuracy: 5, elevation: 112.4 },
];

describe('buildGpx', () => {
  it('emits one trkpt per sample, in order', () => {
    const gpx = buildGpx(samples, 'Teszt útvonal');
    expect(gpx.match(/<trkpt/g)).toHaveLength(2);
    const firstIndex = gpx.indexOf('lat="47.5000000"');
    const secondIndex = gpx.indexOf('lat="47.5001000"');
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });

  it('includes elevation only when present', () => {
    const gpx = buildGpx(samples, 'x');
    expect(gpx.match(/<ele>/g)).toHaveLength(1);
  });

  it('escapes the track name', () => {
    const gpx = buildGpx(samples, '<script>&"\'');
    expect(gpx).toContain('&lt;script&gt;&amp;&quot;&apos;');
  });

  it('produces valid, strictly increasing ISO timestamps', () => {
    const gpx = buildGpx(samples, 'x');
    const times = [...gpx.matchAll(/<time>([^<]+)<\/time>/g)].map((m) => Date.parse(m[1]!));
    expect(times).toEqual([1_000, 2_000]);
  });
});

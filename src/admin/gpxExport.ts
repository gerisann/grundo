import type { PositionSample } from '@/tracking/types';

/**
 * A LAB szimulált mintáiból GPX fájlt épít, amit egy Android hamis-helyadat
 * app (fejlesztői beállítások → hamis helyadat app) le tud játszani.
 *
 * Így a valódi GRUNDO app, a valódi natív rögzítővel fut valódi eszközön —
 * a `FusedLocationProviderClient` a mock providertől kapja a fixeket,
 * ugyanúgy, mint egy igazi GPS-chipnél, tehát a lezárt képernyős
 * háttérszolgáltatás is ténylegesen azt csinálja, amit élesben tenne. Csak a
 * jel forrása reprodukálható. Lásd `docs/08-android-codemagic.md` terepteszt.
 */
export function buildGpx(samples: readonly PositionSample[], name: string): string {
  const trkpts = samples
    .map((sample) => {
      const ele = sample.elevation !== undefined
        ? `<ele>${sample.elevation.toFixed(1)}</ele>`
        : '';
      return `      <trkpt lat="${sample.lat.toFixed(7)}" lon="${sample.lng.toFixed(7)}">${ele}<time>${new Date(sample.t).toISOString()}</time></trkpt>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GRUNDO LAB" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function downloadGpx(samples: readonly PositionSample[], name: string): void {
  const gpx = buildGpx(samples, name);
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sanitizeFileName(name)}.gpx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'grundo-lab-route';
}

function escapeXml(value: string): string {
  const map: Record<string, string> = {
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  };
  return value.replace(/[<>&'"]/g, (ch) => map[ch] ?? ch);
}

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BandaPostContent, formatBandaTimestamp } from './bandaContent';

describe('formatBandaTimestamp', () => {
  const now = new Date(2026, 9, 10, 14, 30).getTime();

  it('most, perc, óra és nap relatív alakot ad', () => {
    expect(formatBandaTimestamp(now - 30_000, now)).toBe('most');
    expect(formatBandaTimestamp(now - 15 * 60_000, now)).toBe('15 perce');
    expect(formatBandaTimestamp(now - 3 * 3_600_000, now)).toBe('3 órája');
    expect(formatBandaTimestamp(now - 2 * 86_400_000, now)).toBe('2 napja');
  });

  it('egy héttől teljes helyi dátumot ír', () => {
    const createdAt = new Date(2026, 9, 1, 13, 23).getTime();
    expect(formatBandaTimestamp(createdAt, now)).toBe('2026.10.01. 13:23');
  });
});

describe('BandaPostContent', () => {
  it('a támogatott formázást elemekké alakítja, nyers HTML-t nem futtat', () => {
    const html = renderToStaticMarkup(
      <BandaPostContent
        format="markdown-v1"
        text={'**Félkövér** _dőlt_ ++aláhúzott++\n- egy\n- kettő\n> idézet\n[GRUNDO](https://grundo.hu) <script>'}
      />,
    );
    expect(html).toContain('<strong>Félkövér</strong>');
    expect(html).toContain('<em>dőlt</em>');
    expect(html).toContain('<u>aláhúzott</u>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('href="https://grundo.hu"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

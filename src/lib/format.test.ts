import { describe, expect, it } from 'vitest';
import { activityTitle } from './format';

describe('activityTitle', () => {
  const start = new Date(2026, 8, 4, 9).getTime();
  const ended = new Date(2026, 8, 5, 20).getTime();
  it('keeps the time-of-day title at exactly eight hours', () => {
    expect(activityTitle('ride', start, 8 * 3600, ended)).toBe('Reggeli bringázás');
  });
  it('uses the ending day above eight hours, across midnight', () => {
    expect(activityTitle('ride', start, 8 * 3600 + 1, ended)).toBe('Szombati bringázás');
  });
  it.each(['Vasárnapi', 'Hétfői', 'Keddi', 'Szerdai', 'Csütörtöki', 'Pénteki', 'Szombati'])(
    'inflects the weekday as %s', (day) => {
      const index = ['Vasárnapi', 'Hétfői', 'Keddi', 'Szerdai', 'Csütörtöki', 'Pénteki', 'Szombati'].indexOf(day);
      expect(activityTitle('walk', start, 9 * 3600, new Date(2026, 8, 6 + index).getTime())).toBe(`${day} séta`);
    },
  );
});

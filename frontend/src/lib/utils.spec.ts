import { describe, expect, it } from 'vitest';
import { formatCountdown, formatEnum, formatKm, formatPrice, isClosingSoon, joinSpecs } from './utils';

describe('formatPrice', () => {
  it('renders whole Canadian dollars without cents', () => {
    expect(formatPrice(38900)).toMatch(/38,900/);
    expect(formatPrice(38900)).not.toMatch(/\.00/);
  });
});

describe('formatKm', () => {
  it('groups thousands and appends the unit', () => {
    expect(formatKm(41200)).toBe('41,200 km');
  });
});

describe('formatEnum', () => {
  it('sentence-cases a screaming-snake enum', () => {
    expect(formatEnum('SEDAN')).toBe('Sedan');
    expect(formatEnum('CERTIFIED_PRE_OWNED')).toBe('Certified pre-owned');
  });

  it('keeps acronyms uppercase instead of title-casing them', () => {
    expect(formatEnum('SUV')).toBe('SUV');
    expect(formatEnum('AWD')).toBe('AWD');
    expect(formatEnum('CVT')).toBe('CVT');
  });

  it('uses the conventional shorthand for four-wheel drive', () => {
    expect(formatEnum('FOUR_WHEEL_DRIVE')).toBe('4WD');
  });
});

describe('formatCountdown', () => {
  it('is coarse above an hour and precise below it', () => {
    expect(formatCountdown(2 * 86400 + 4 * 3600)).toBe('2d 04h');
    expect(formatCountdown(3 * 3600 + 12 * 60)).toBe('3h 12m');
    expect(formatCountdown(90)).toBe('1m 30s');
    expect(formatCountdown(45)).toBe('45s');
  });

  it('reports a closed auction rather than negative time', () => {
    expect(formatCountdown(0)).toBe('Ended');
    expect(formatCountdown(-10)).toBe('Ended');
  });
});

describe('isClosingSoon', () => {
  it('flags the final fifteen minutes, but not an auction already ended', () => {
    expect(isClosingSoon(14 * 60)).toBe(true);
    expect(isClosingSoon(20 * 60)).toBe(false);
    expect(isClosingSoon(0)).toBe(false);
  });
});

describe('joinSpecs', () => {
  it('drops empty parts so the separator never dangles', () => {
    expect(joinSpecs('41,200 km', null, 'Automatic', undefined)).toBe('41,200 km · Automatic');
  });
});

import { describe, expect, it } from 'vitest';
import { formatEnum, formatKm, formatPrice, formatRelativeTime, joinSpecs } from './format';

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

  it('hyphenates compounds that read badly as separate words', () => {
    expect(formatEnum('PLUG_IN_HYBRID')).toBe('Plug-in hybrid');
    expect(formatEnum('DUAL_CLUTCH')).toBe('Dual-clutch');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-30T12:00:00Z');

  it('describes recent timestamps relatively', () => {
    expect(formatRelativeTime('2026-07-30T11:58:00Z', now)).toBe('2 minutes ago');
    expect(formatRelativeTime('2026-07-30T09:00:00Z', now)).toBe('3 hours ago');
    expect(formatRelativeTime('2026-07-28T12:00:00Z', now)).toBe('2 days ago');
  });

  it('uses the singular form for exactly one unit', () => {
    expect(formatRelativeTime('2026-07-30T11:00:00Z', now)).toBe('1 hour ago');
  });

  it('falls back to an absolute date beyond a week', () => {
    // "17 days ago" is less useful than the date itself.
    expect(formatRelativeTime('2026-07-13T12:00:00Z', now)).toMatch(/2026/);
  });
});

describe('joinSpecs', () => {
  it('drops empty parts so the separator never dangles', () => {
    expect(joinSpecs('41,200 km', null, 'Automatic', undefined)).toBe('41,200 km · Automatic');
  });
});

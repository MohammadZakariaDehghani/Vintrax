import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  centsInput,
  isoDate,
  money,
  percent,
  qs,
  rangeParams,
  sourceHref,
} from './accounting';

describe('accounting helpers', () => {
  it('formats cents the way statements print them', () => {
    expect(money(123_456)).toBe('$1,234.56');
    expect(money(-5)).toBe('($0.05)');
    expect(money(null)).toBe('—');
    expect(centsInput(2_250_000)).toBe('22500.00');
    expect(percent(1906)).toBe('19.06%');
  });

  it('shows a date without a time zone moving the day', () => {
    expect(isoDate('2026-04-01')).toBe('Apr 1, 2026');
    expect(addDaysIso('2026-03-31', 1)).toBe('2026-04-01');
    expect(addDaysIso('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('leaves empty filters out of a query string', () => {
    expect(qs({ preset: 'THIS_MONTH', q: '', vendorId: undefined, page: 2 })).toBe(
      '?preset=THIS_MONTH&page=2',
    );
    expect(qs({})).toBe('');
    expect(rangeParams({ preset: 'CUSTOM', from: '2026-01-01', to: '2026-01-31' })).toEqual({
      preset: 'CUSTOM',
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect(rangeParams({ preset: 'YEAR_TO_DATE', from: 'x', to: 'y' })).toEqual({
      preset: 'YEAR_TO_DATE',
    });
  });

  it('links a ledger entry to its source document', () => {
    expect(sourceHref('VehicleSale', 'abc')).toBe('/dealer/accounting/sales/abc');
    expect(sourceHref('VendorBill', 'b1')).toBe('/dealer/accounting/payables?bill=b1');
    expect(sourceHref(null, null)).toBeNull();
    expect(sourceHref('Unknown', 'x')).toBeNull();
  });
});

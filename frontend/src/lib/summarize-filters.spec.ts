import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, type VehicleFilters } from '@/lib/search-params';
import { summarizeFilters } from './summarize-filters';

function filters(overrides: Partial<VehicleFilters> = {}): VehicleFilters {
  return { ...EMPTY_FILTERS, ...overrides };
}

describe('summarizeFilters', () => {
  it('falls back to a plain label when nothing distinguishes the search', () => {
    expect(summarizeFilters(filters())).toBe('Your last search');
  });

  it('leads with the search text', () => {
    expect(summarizeFilters(filters({ q: 'hybrid wagon' }))).toBe('“hybrid wagon”');
  });

  it('combines make and model', () => {
    expect(summarizeFilters(filters({ make: 'Toyota', model: 'RAV4' }))).toBe('Toyota RAV4');
  });

  it('turns body types into their plural labels', () => {
    expect(summarizeFilters(filters({ bodyType: ['SUV', 'TRUCK'] }))).toBe('SUVs, Trucks');
  });

  it('prefers a city over a province when both are set', () => {
    expect(summarizeFilters(filters({ city: 'Ottawa', province: 'ON' }))).toBe('Ottawa');
  });

  it('names the province in full when no city is set', () => {
    expect(summarizeFilters(filters({ province: 'ON' }))).toBe('Ontario');
  });

  it('formats a maximum price with a thousands separator', () => {
    expect(summarizeFilters(filters({ maxPrice: '30000' }))).toBe('Under $30,000');
  });

  it('falls back to a minimum price when there is no maximum', () => {
    expect(summarizeFilters(filters({ minPrice: '15000' }))).toBe('From $15,000');
  });

  it('joins several fields in a fixed order', () => {
    const summary = summarizeFilters(
      filters({ make: 'Honda', bodyType: ['SUV'], province: 'BC', maxPrice: '25000' }),
    );

    expect(summary).toBe('Honda · SUVs · British Columbia · Under $25,000');
  });
});

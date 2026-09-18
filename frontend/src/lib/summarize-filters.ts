import {
  BODY_TYPE_PLURAL_LABELS,
  PROVINCE_LABELS,
  type BodyType,
  type Province,
} from '@vintrax/shared';
import type { VehicleFilters } from '@/lib/search-params';

function isBodyType(value: string): value is BodyType {
  return value in BODY_TYPE_PLURAL_LABELS;
}

function isProvince(value: string): value is Province {
  return value in PROVINCE_LABELS;
}

/**
 * A short, human-readable label for a saved search — "Continue where you left
 * off: SUVs · Ontario · Under $30,000" rather than the query string itself.
 *
 * Picks a handful of the fields most likely to say what someone was actually
 * looking for, in the order a shopper would say them aloud. It does not aim
 * to describe every active filter — `countActiveFilters` already does that
 * for the "clear filters" count — only enough to make the saved search
 * recognisable at a glance.
 */
export function summarizeFilters(filters: VehicleFilters): string {
  const parts: string[] = [];

  if (filters.q) parts.push(`“${filters.q}”`);
  if (filters.make) parts.push(filters.model ? `${filters.make} ${filters.model}` : filters.make);
  if (filters.bodyType.length > 0) {
    parts.push(
      filters.bodyType
        .map((value) => (isBodyType(value) ? BODY_TYPE_PLURAL_LABELS[value] : value))
        .join(', '),
    );
  }
  if (filters.city) parts.push(filters.city);
  else if (filters.province) {
    parts.push(isProvince(filters.province) ? PROVINCE_LABELS[filters.province] : filters.province);
  }
  if (filters.maxPrice) parts.push(`Under $${Number(filters.maxPrice).toLocaleString('en-CA')}`);
  else if (filters.minPrice) {
    parts.push(`From $${Number(filters.minPrice).toLocaleString('en-CA')}`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'Your last search';
}

import { LISTING_SORTS, type ListingSort } from '@atlas/shared';

/**
 * The browse page keeps all filter state in the URL so a search is shareable,
 * survives reload, and works with the browser's back button. These helpers are
 * the single place that translates between URLSearchParams and filter objects.
 */
export interface ListingFilters {
  q?: string;
  make?: string;
  model?: string;
  minYear?: string;
  maxYear?: string;
  minPrice?: string;
  maxPrice?: string;
  maxMileageKm?: string;
  bodyType: string[];
  fuelType: string[];
  transmission: string[];
  drivetrain: string[];
  condition: string[];
  province?: string;
  city?: string;
  sellerType?: string;
  sort: ListingSort;
  page: number;
}

const MULTI_KEYS = ['bodyType', 'fuelType', 'transmission', 'drivetrain', 'condition'] as const;
const SINGLE_KEYS = [
  'q',
  'make',
  'model',
  'minYear',
  'maxYear',
  'minPrice',
  'maxPrice',
  'maxMileageKm',
  'province',
  'city',
  'sellerType',
] as const;

const isSort = (value: string | null): value is ListingSort =>
  value !== null && (LISTING_SORTS as readonly string[]).includes(value);

export function parseFilters(params: URLSearchParams): ListingFilters {
  const filters: ListingFilters = {
    bodyType: [],
    fuelType: [],
    transmission: [],
    drivetrain: [],
    condition: [],
    sort: isSort(params.get('sort')) ? (params.get('sort') as ListingSort) : 'RELEVANCE',
    page: Math.max(1, Number(params.get('page') ?? '1') || 1),
  };

  for (const key of SINGLE_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }

  for (const key of MULTI_KEYS) {
    const value = params.get(key);
    filters[key] = value ? value.split(',').filter(Boolean) : [];
  }

  return filters;
}

export function filtersToParams(filters: ListingFilters): URLSearchParams {
  const params = new URLSearchParams();

  for (const key of SINGLE_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }

  for (const key of MULTI_KEYS) {
    const value = filters[key];
    if (value.length) params.set(key, value.join(','));
  }

  if (filters.sort !== 'RELEVANCE') params.set('sort', filters.sort);
  // Page 1 is the default, so leaving it out keeps shared URLs clean.
  if (filters.page > 1) params.set('page', String(filters.page));

  return params;
}

/** Query string sent to the API, which additionally needs the page size. */
export function filtersToApiQuery(filters: ListingFilters, pageSize: number): string {
  const params = filtersToParams(filters);
  params.set('page', String(filters.page));
  params.set('pageSize', String(pageSize));
  return params.toString();
}

export function toggleInArray(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

/** Number of active filters, for the "clear filters" affordance. */
export function countActiveFilters(filters: ListingFilters): number {
  let count = 0;
  for (const key of SINGLE_KEYS) if (filters[key]) count += 1;
  for (const key of MULTI_KEYS) count += filters[key].length;
  return count;
}

export const EMPTY_FILTERS: ListingFilters = {
  bodyType: [],
  fuelType: [],
  transmission: [],
  drivetrain: [],
  condition: [],
  sort: 'RELEVANCE',
  page: 1,
};

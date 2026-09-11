import { LISTING_SORTS, type ListingSort } from '@vintrax/shared';

/**
 * Browse-page filter state lives in the URL, so a search is shareable, survives
 * reload, and works with the browser back button. These helpers are the single
 * place that translates between URLSearchParams and a filter object.
 */
export interface VehicleFilters {
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
  saleChannel: string[];
  province?: string;
  city?: string;
  sellerType?: string;
  inspectedOnly?: string;
  sort: ListingSort;
  page: number;
}

const MULTI_KEYS = [
  'bodyType',
  'fuelType',
  'transmission',
  'drivetrain',
  'condition',
  'saleChannel',
] as const;

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
  'inspectedOnly',
] as const;

const isSort = (value: string | null): value is ListingSort =>
  value !== null && (LISTING_SORTS as readonly string[]).includes(value);

export const EMPTY_FILTERS: VehicleFilters = {
  bodyType: [],
  fuelType: [],
  transmission: [],
  drivetrain: [],
  condition: [],
  saleChannel: [],
  sort: 'RELEVANCE',
  page: 1,
};

export function parseFilters(params: URLSearchParams): VehicleFilters {
  const filters: VehicleFilters = {
    ...EMPTY_FILTERS,
    bodyType: [],
    fuelType: [],
    transmission: [],
    drivetrain: [],
    condition: [],
    saleChannel: [],
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

export function filtersToParams(filters: VehicleFilters): URLSearchParams {
  const params = new URLSearchParams();

  for (const key of SINGLE_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }

  for (const key of MULTI_KEYS) {
    if (filters[key].length) params.set(key, filters[key].join(','));
  }

  // Defaults are omitted so shared URLs stay short.
  if (filters.sort !== 'RELEVANCE') params.set('sort', filters.sort);
  if (filters.page > 1) params.set('page', String(filters.page));

  return params;
}

/** Query string sent to the API, which additionally needs the page size. */
export function filtersToApiQuery(filters: VehicleFilters, pageSize: number): string {
  const params = filtersToParams(filters);
  params.set('page', String(filters.page));
  params.set('pageSize', String(pageSize));
  return params.toString();
}

export function toggleInArray(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

/** Number of active filters, for the "clear filters" affordance. */
export function countActiveFilters(filters: VehicleFilters): number {
  let count = 0;
  for (const key of SINGLE_KEYS) if (filters[key]) count += 1;
  for (const key of MULTI_KEYS) count += filters[key].length;
  return count;
}

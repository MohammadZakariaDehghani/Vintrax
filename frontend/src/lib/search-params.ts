/**
 * URL ⇄ filter translation lives in `@vintrax/client` so a filtered search means
 * the same thing in both applications. Re-exported here for `@/lib/search-params`
 * callers.
 */
export {
  EMPTY_FILTERS,
  countActiveFilters,
  filtersToApiQuery,
  filtersToParams,
  parseFilters,
  toggleInArray,
  type VehicleFilters,
} from '@vintrax/client';

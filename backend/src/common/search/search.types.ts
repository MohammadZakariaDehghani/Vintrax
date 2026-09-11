import type { SearchVehiclesQuery, VehicleSearchResponse } from '@vintrax/shared';

/**
 * Contract every search backend implements.
 *
 * Two implementations exist: PostgreSQL full-text search, which needs no extra
 * infrastructure and is the default, and OpenSearch for deployments that want a
 * dedicated cluster. Callers never know which one answered.
 */
export interface SearchProvider {
  readonly name: 'postgres' | 'opensearch';

  search(query: SearchVehiclesQuery, viewerId?: string): Promise<VehicleSearchResponse>;

  /** Upserts a vehicle into the index. A no-op for the PostgreSQL provider. */
  indexVehicle(vehicleId: string): Promise<void>;

  /** Removes a vehicle from the index. A no-op for the PostgreSQL provider. */
  removeVehicle(vehicleId: string): Promise<void>;

  /** Rebuilds the index from the database. A no-op for the PostgreSQL provider. */
  reindexAll(): Promise<{ indexed: number }>;

  /** Whether the backend is reachable, for the health endpoint. */
  isHealthy(): Promise<boolean>;
}

export const SEARCH_PROVIDER = Symbol('SEARCH_PROVIDER');

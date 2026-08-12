import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';
import type { SearchVehiclesQuery, VehicleSearchResponse } from '@atlas/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toVehicleSummary, vehicleSummarySelect } from '../../modules/vehicles/vehicles.mapper';
import type { Env } from '../../config/env';
import type { SearchProvider } from './search.types';
import { PostgresSearchProvider } from './postgres-search.provider';

/** Documents indexed per bulk request during a full reindex. */
const REINDEX_BATCH_SIZE = 500;

/**
 * Search backed by OpenSearch (or Elasticsearch — the APIs used here are
 * compatible).
 *
 * OpenSearch answers the query and returns ids and facet counts; the page is
 * then hydrated from PostgreSQL. That keeps the database the single source of
 * truth and means a stale index degrades relevance rather than serving wrong
 * prices or sold vehicles.
 *
 * If the cluster is unreachable the provider falls back to PostgreSQL search
 * rather than failing the request.
 */
@Injectable()
export class OpenSearchProvider implements SearchProvider, OnModuleInit {
  readonly name = 'opensearch' as const;
  private readonly logger = new Logger(OpenSearchProvider.name);
  private readonly client: Client;
  private readonly index: string;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly fallback: PostgresSearchProvider,
  ) {
    const node = this.config.get('OPENSEARCH_NODE', { infer: true })!;
    const username = this.config.get('OPENSEARCH_USERNAME', { infer: true });
    const password = this.config.get('OPENSEARCH_PASSWORD', { infer: true });

    this.client = new Client({
      node,
      ...(username && password ? { auth: { username, password } } : {}),
    });
    this.index = this.config.get('OPENSEARCH_INDEX', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureIndex();
    } catch (error) {
      this.logger.warn(
        `OpenSearch unavailable at startup, falling back to PostgreSQL search: ${String(error)}`,
      );
    }
  }

  async search(query: SearchVehiclesQuery, viewerId?: string): Promise<VehicleSearchResponse> {
    const startedAt = Date.now();

    try {
      const response = await this.client.search({
        index: this.index,
        body: {
          query: this.buildQuery(query),
          sort: this.buildSort(query.sort),
          from: (query.page - 1) * query.pageSize,
          size: query.pageSize,
          track_total_hits: true,
          aggs: {
            makes: { terms: { field: 'make.keyword', size: 15 } },
            bodyTypes: { terms: { field: 'bodyType', size: 20 } },
            fuelTypes: { terms: { field: 'fuelType', size: 20 } },
            provinces: { terms: { field: 'province', size: 20 } },
            priceRange: { stats: { field: 'priceCad' } },
          },
        },
      });

      const body = response.body as OpenSearchResponseBody;
      const ids = body.hits.hits.map((hit) => hit._id);
      const total =
        typeof body.hits.total === 'number' ? body.hits.total : (body.hits.total?.value ?? 0);

      // Hydrate from PostgreSQL so prices and status are never stale.
      const rows = await this.prisma.vehicle.findMany({
        where: { id: { in: ids } },
        select: vehicleSummarySelect,
      });
      const ordered = ids
        .map((id) => rows.find((row) => row.id === id))
        .filter((row): row is (typeof rows)[number] => Boolean(row));

      const favouritedIds = await this.favouritedIds(
        viewerId,
        ordered.map((row) => row.id),
      );

      const buckets = body.aggregations;
      return {
        items: ordered.map((row) => toVehicleSummary(row, favouritedIds)),
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        facets: {
          makes: (buckets?.makes.buckets ?? []).map((b) => ({ value: b.key, count: b.doc_count })),
          bodyTypes: (buckets?.bodyTypes.buckets ?? []).map((b) => ({
            value: b.key as never,
            count: b.doc_count,
          })),
          fuelTypes: (buckets?.fuelTypes.buckets ?? []).map((b) => ({
            value: b.key as never,
            count: b.doc_count,
          })),
          provinces: (buckets?.provinces.buckets ?? []).map((b) => ({
            value: b.key as never,
            count: b.doc_count,
          })),
          priceRange:
            buckets?.priceRange && buckets.priceRange.count > 0
              ? { min: Math.floor(buckets.priceRange.min), max: Math.ceil(buckets.priceRange.max) }
              : null,
        },
        provider: this.name,
        tookMs: Date.now() - startedAt,
      };
    } catch (error) {
      this.logger.error(`OpenSearch query failed, serving from PostgreSQL: ${String(error)}`);
      return this.fallback.search(query, viewerId);
    }
  }

  async indexVehicle(vehicleId: string): Promise<void> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: {
        id: true,
        title: true,
        description: true,
        make: true,
        model: true,
        trim: true,
        year: true,
        priceCad: true,
        mileageKm: true,
        condition: true,
        bodyType: true,
        fuelType: true,
        transmission: true,
        drivetrain: true,
        province: true,
        city: true,
        status: true,
        saleChannel: true,
        features: true,
        exteriorColour: true,
        publishedAt: true,
        createdAt: true,
        seller: { select: { role: true } },
      },
    });

    // Removing rather than skipping keeps unpublished vehicles out of the index.
    if (!vehicle || !['ACTIVE', 'IN_AUCTION'].includes(vehicle.status)) {
      await this.removeVehicle(vehicleId);
      return;
    }

    try {
      await this.client.index({
        index: this.index,
        id: vehicle.id,
        body: { ...vehicle, sellerRole: vehicle.seller.role, seller: undefined },
        refresh: true,
      });
    } catch (error) {
      this.logger.warn(`Failed to index vehicle ${vehicleId}: ${String(error)}`);
    }
  }

  async removeVehicle(vehicleId: string): Promise<void> {
    try {
      await this.client.delete({ index: this.index, id: vehicleId, refresh: true });
    } catch {
      // A document that was never indexed is not an error worth surfacing.
    }
  }

  async reindexAll(): Promise<{ indexed: number }> {
    await this.ensureIndex();

    let indexed = 0;
    let cursor: string | undefined;

    for (;;) {
      const batch = await this.prisma.vehicle.findMany({
        where: { status: { in: ['ACTIVE', 'IN_AUCTION'] } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: REINDEX_BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (batch.length === 0) break;

      for (const row of batch) {
        await this.indexVehicle(row.id);
        indexed += 1;
      }
      cursor = batch[batch.length - 1]!.id;
    }

    this.logger.log(`Reindexed ${indexed} vehicles`);
    return { indexed };
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  private async ensureIndex(): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.index });
    if (exists.body) return;

    await this.client.indices.create({
      index: this.index,
      body: {
        mappings: {
          properties: {
            title: { type: 'text', analyzer: 'english', boost: 3 },
            description: { type: 'text', analyzer: 'english' },
            make: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            model: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            trim: { type: 'text' },
            features: { type: 'keyword' },
            exteriorColour: { type: 'text' },
            year: { type: 'integer' },
            priceCad: { type: 'integer' },
            mileageKm: { type: 'integer' },
            condition: { type: 'keyword' },
            bodyType: { type: 'keyword' },
            fuelType: { type: 'keyword' },
            transmission: { type: 'keyword' },
            drivetrain: { type: 'keyword' },
            province: { type: 'keyword' },
            city: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            status: { type: 'keyword' },
            saleChannel: { type: 'keyword' },
            sellerRole: { type: 'keyword' },
            publishedAt: { type: 'date' },
            createdAt: { type: 'date' },
          },
        },
      },
    });
    this.logger.log(`Created OpenSearch index ${this.index}`);
  }

  private buildQuery(query: SearchVehiclesQuery): Record<string, unknown> {
    const filter: Record<string, unknown>[] = [
      { terms: { status: ['ACTIVE', 'IN_AUCTION'] } },
    ];
    const must: Record<string, unknown>[] = [];

    if (query.q) {
      must.push({
        multi_match: {
          query: query.q,
          fields: ['title^3', 'make^3', 'model^3', 'trim^2', 'exteriorColour^2', 'description'],
          // Tolerates one or two typos depending on term length.
          fuzziness: 'AUTO',
          operator: 'and',
        },
      });
    }

    if (query.make) filter.push({ term: { 'make.keyword': query.make } });
    if (query.model) filter.push({ match: { model: query.model } });
    if (query.province) filter.push({ term: { province: query.province } });
    if (query.city) filter.push({ match: { city: query.city } });
    if (query.bodyType) filter.push({ terms: { bodyType: query.bodyType } });
    if (query.fuelType) filter.push({ terms: { fuelType: query.fuelType } });
    if (query.transmission) filter.push({ terms: { transmission: query.transmission } });
    if (query.drivetrain) filter.push({ terms: { drivetrain: query.drivetrain } });
    if (query.condition) filter.push({ terms: { condition: query.condition } });
    if (query.saleChannel) filter.push({ terms: { saleChannel: query.saleChannel } });
    if (query.sellerType) filter.push({ term: { sellerRole: query.sellerType } });

    const range: Record<string, Record<string, number>> = {};
    if (query.minYear !== undefined) range['year'] = { ...range['year'], gte: query.minYear };
    if (query.maxYear !== undefined) range['year'] = { ...range['year'], lte: query.maxYear };
    if (query.minPrice !== undefined)
      range['priceCad'] = { ...range['priceCad'], gte: query.minPrice };
    if (query.maxPrice !== undefined)
      range['priceCad'] = { ...range['priceCad'], lte: query.maxPrice };
    if (query.maxMileageKm !== undefined) range['mileageKm'] = { lte: query.maxMileageKm };

    for (const [field, bounds] of Object.entries(range)) {
      filter.push({ range: { [field]: bounds } });
    }

    return { bool: { must: must.length ? must : [{ match_all: {} }], filter } };
  }

  private buildSort(sort: SearchVehiclesQuery['sort']): unknown[] {
    switch (sort) {
      case 'PRICE_ASC':
        return [{ priceCad: 'asc' }, { _id: 'asc' }];
      case 'PRICE_DESC':
        return [{ priceCad: 'desc' }, { _id: 'asc' }];
      case 'MILEAGE_ASC':
        return [{ mileageKm: 'asc' }, { _id: 'asc' }];
      case 'YEAR_DESC':
        return [{ year: 'desc' }, { _id: 'asc' }];
      case 'NEWEST':
        return [{ publishedAt: 'desc' }, { _id: 'asc' }];
      case 'RELEVANCE':
      default:
        return ['_score', { publishedAt: 'desc' }, { _id: 'asc' }];
    }
  }

  private async favouritedIds(
    viewerId: string | undefined,
    vehicleIds: string[],
  ): Promise<ReadonlySet<string>> {
    if (!viewerId || vehicleIds.length === 0) return new Set();
    const rows = await this.prisma.favourite.findMany({
      where: { userId: viewerId, vehicleId: { in: vehicleIds } },
      select: { vehicleId: true },
    });
    return new Set(rows.map((row) => row.vehicleId));
  }
}

interface OpenSearchBucket {
  key: string;
  doc_count: number;
}

interface OpenSearchResponseBody {
  hits: {
    total: number | { value: number };
    hits: Array<{ _id: string }>;
  };
  aggregations?: {
    makes: { buckets: OpenSearchBucket[] };
    bodyTypes: { buckets: OpenSearchBucket[] };
    fuelTypes: { buckets: OpenSearchBucket[] };
    provinces: { buckets: OpenSearchBucket[] };
    priceRange: { count: number; min: number; max: number };
  };
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../../config/env';

/**
 * Redis connection plus a small typed cache API.
 *
 * Every method degrades gracefully: if Redis is unreachable, reads miss and
 * writes are dropped rather than failing the request. Caching is an
 * optimisation, and losing it should never take the platform down.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private available = false;
  private readonly defaultTtl: number;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.defaultTtl = this.config.get('CACHE_TTL_SECONDS', { infer: true });
  }

  onModuleInit(): void {
    const url = this.config.get('REDIS_URL', { infer: true });

    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      // Give up reconnecting after a few attempts rather than logging forever.
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2_000)),
    });

    this.client.on('error', (error: Error) => {
      if (this.available) {
        this.logger.warn(`Redis connection lost: ${error.message}`);
      }
      this.available = false;
    });

    this.client.on('ready', () => {
      this.available = true;
      this.logger.log('Connected to Redis');
    });

    void this.client.connect().catch((error: Error) => {
      this.logger.warn(
        `Redis unavailable, continuing without cache: ${error.message}. ` +
          'Caching and rate-limit sharing are disabled.',
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }

  /** The raw client, for consumers such as BullMQ that manage their own usage. */
  get connection(): Redis | null {
    return this.client;
  }

  get isAvailable(): boolean {
    return this.available;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.available || !this.client) return null;
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.logger.debug(`Cache read failed for ${key}: ${String(error)}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    if (!this.available || !this.client) return;
    try {
      const ttl = ttlSeconds ?? this.defaultTtl;
      const payload = JSON.stringify(value);
      if (ttl > 0) await this.client.set(key, payload, 'EX', ttl);
      else await this.client.set(key, payload);
    } catch (error) {
      this.logger.debug(`Cache write failed for ${key}: ${String(error)}`);
    }
  }

  /**
   * Increments a counter, starting its expiry on the first increment, and
   * returns the new value — or null when Redis is unavailable, so a counter
   * used as a limit fails open rather than locking everyone out.
   */
  async increment(key: string, ttlSeconds: number): Promise<number | null> {
    if (!this.available || !this.client) return null;
    try {
      const [[, count]] = (await this.client
        .multi()
        .incr(key)
        .expire(key, ttlSeconds, 'NX')
        .exec()) as [[Error | null, number], [Error | null, number]];
      return count;
    } catch (error) {
      this.logger.debug(`Counter increment failed for ${key}: ${String(error)}`);
      return null;
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.available || !this.client || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch (error) {
      this.logger.debug(`Cache delete failed: ${String(error)}`);
    }
  }

  /**
   * Invalidates every key matching a glob. Uses SCAN rather than KEYS so it does
   * not block the Redis event loop on a large keyspace.
   */
  async delByPattern(pattern: string): Promise<void> {
    if (!this.available || !this.client) return;
    try {
      let cursor = '0';
      do {
        const [next, found] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (found.length) await this.client.del(...found);
      } while (cursor !== '0');
    } catch (error) {
      this.logger.debug(`Cache pattern delete failed for ${pattern}: ${String(error)}`);
    }
  }

  /** Read-through cache helper. Falls straight through when Redis is down. */
  async remember<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  /**
   * Best-effort distributed lock. Returns a release function, or null when the
   * lock is already held. Used to keep scheduled auction settlement from running
   * on several instances at once.
   */
  async acquireLock(key: string, ttlSeconds: number): Promise<(() => Promise<void>) | null> {
    if (!this.available || !this.client) {
      // Without Redis there is only one instance worth speaking of, so proceed.
      return async () => undefined;
    }
    try {
      const token = `${process.pid}-${Date.now()}`;
      const acquired = await this.client.set(key, token, 'EX', ttlSeconds, 'NX');
      if (!acquired) return null;

      return async () => {
        // Only release a lock we still own, so a slow holder cannot free another
        // instance's lock after its own has expired.
        const current = await this.client?.get(key);
        if (current === token) await this.client?.del(key);
      };
    } catch {
      return async () => undefined;
    }
  }
}

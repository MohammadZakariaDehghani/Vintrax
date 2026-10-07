import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type ConnectionOptions, type Processor } from 'bullmq';
import type { Env } from '../../config/env';

/** Named queues. Adding one means adding a case here and a worker registration. */
export const QUEUE_NAMES = {
  notifications: 'notifications',
  search: 'search-indexing',
  auctions: 'auction-lifecycle',
  email: 'email',
  /** Platform events the CRM turns into leads, timeline entries and tickets. */
  crm: 'crm',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface EnqueueOptions {
  /** Delay in milliseconds before the job becomes available. */
  delayMs?: number;
  /** Stable id, so enqueuing the same logical job twice runs it once. */
  jobId?: string;
  attempts?: number;
}

/**
 * Background job dispatch.
 *
 * Two drivers: BullMQ over Redis for real deployments, and an inline driver
 * that runs the handler immediately in-process. Inline keeps development and CI
 * working without a broker, and makes job behaviour deterministic in tests.
 *
 * Handlers must be idempotent either way — BullMQ retries on failure, and a
 * delayed job can outlive the process that scheduled it.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly driver: 'redis' | 'inline';
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers: Worker[] = [];
  private readonly inlineHandlers = new Map<QueueName, Processor>();

  constructor(private readonly config: ConfigService<Env, true>) {
    this.driver = this.config.get('QUEUE_DRIVER', { infer: true });
  }

  onModuleInit(): void {
    this.logger.log(`Queue driver: ${this.driver}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close().catch(() => undefined)));
    await Promise.all(
      [...this.queues.values()].map((queue) => queue.close().catch(() => undefined)),
    );
  }

  /** Registers the processor for a queue. Called once per queue at startup. */
  registerWorker(name: QueueName, processor: Processor): void {
    if (this.driver === 'inline') {
      this.inlineHandlers.set(name, processor);
      return;
    }

    const worker = new Worker(name, processor, {
      connection: this.connectionOptions(),
      concurrency: 5,
    });

    worker.on('failed', (job, error) => {
      this.logger.error(`Job ${name}:${job?.id ?? '?'} failed: ${error.message}`);
    });

    this.workers.push(worker);
    this.logger.log(`Worker registered for queue "${name}"`);
  }

  async enqueue<T extends object>(
    name: QueueName,
    jobName: string,
    payload: T,
    options: EnqueueOptions = {},
  ): Promise<void> {
    if (this.driver === 'inline') {
      const handler = this.inlineHandlers.get(name);
      if (!handler) {
        this.logger.warn(`No inline handler registered for queue "${name}"`);
        return;
      }
      try {
        // Only the fields a processor realistically reads are provided; the
        // inline driver is a convenience, not a full BullMQ emulation.
        await handler({ name: jobName, data: payload, id: options.jobId } as never, '' as never);
      } catch (error) {
        this.logger.error(`Inline job ${name}:${jobName} failed: ${String(error)}`);
      }
      return;
    }

    const queue = this.getQueue(name);
    await queue.add(jobName, payload, {
      delay: options.delayMs,
      jobId: options.jobId,
      attempts: options.attempts ?? 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 5_000 },
    });
  }

  /** Cancels a delayed job, e.g. when an auction's close time is extended. */
  async cancel(name: QueueName, jobId: string): Promise<void> {
    if (this.driver === 'inline') return;
    try {
      const job = await this.getQueue(name).getJob(jobId);
      await job?.remove();
    } catch (error) {
      this.logger.debug(`Failed to cancel job ${name}:${jobId}: ${String(error)}`);
    }
  }

  private getQueue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connectionOptions() });
      this.queues.set(name, queue);
    }
    return queue;
  }

  private connectionOptions(): ConnectionOptions {
    const url = new URL(this.config.get('REDIS_URL', { infer: true }));
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.password ? { password: url.password } : {}),
      // BullMQ requires this to be null so blocking commands are not cut short.
      maxRetriesPerRequest: null,
    };
  }
}

import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { QUEUE_NAMES, QueueService } from '../../../common/queue/queue.service';

export type CrmEventJob =
  | { name: 'message'; data: { messageId: string } }
  | { name: 'finance'; data: { applicationId: string } }
  | { name: 'deposit'; data: { depositId: string } }
  | { name: 'sale'; data: { saleId: string } }
  | { name: 'contact'; data: { contactMessageId: string } };

/**
 * How the rest of Vintrax tells the CRM something happened — a buyer
 * messaged a dealer, applied for financing, paid a deposit, bought a car, or
 * wrote in through the Contact page. Each call only enqueues a job on the
 * platform queue (QUEUE_NAMES.crm); the CRM's worker does the work. A CRM
 * problem therefore never fails the action that reported it.
 *
 * Global and optional for its callers, so modules (and their tests) that
 * construct services by hand need not know about the CRM.
 */
@Injectable()
export class CrmEvents {
  private readonly logger = new Logger(CrmEvents.name);

  constructor(private readonly queue: QueueService) {}

  messageSent(messageId: string): void {
    this.emit({ name: 'message', data: { messageId } }, `crm-message-${messageId}`);
  }

  financeApplicationSubmitted(applicationId: string): void {
    this.emit({ name: 'finance', data: { applicationId } }, `crm-finance-${applicationId}`);
  }

  depositReceived(depositId: string): void {
    this.emit({ name: 'deposit', data: { depositId } }, `crm-deposit-${depositId}`);
  }

  salePosted(saleId: string): void {
    this.emit({ name: 'sale', data: { saleId } }, `crm-sale-${saleId}`);
  }

  contactMessageReceived(contactMessageId: string): void {
    this.emit({ name: 'contact', data: { contactMessageId } }, `crm-contact-${contactMessageId}`);
  }

  private emit(job: CrmEventJob, jobId: string): void {
    this.queue
      .enqueue(QUEUE_NAMES.crm, job.name, job.data, { jobId, attempts: 5 })
      .catch((error: unknown) =>
        this.logger.warn(`Could not enqueue CRM ${job.name} event: ${String(error)}`),
      );
  }
}

@Global()
@Module({
  providers: [CrmEvents],
  exports: [CrmEvents],
})
export class CrmEventsModule {}

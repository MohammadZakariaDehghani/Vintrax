import { Injectable, Logger } from '@nestjs/common';
import type { AutomationTrigger } from '@vintrax/shared';

/**
 * Things that happen in the CRM which other parts of it react to: automation
 * triggers (a lead was created, a deal was won) and the events that stop a
 * running sequence (the customer replied, unsubscribed, the address bounced).
 *
 * Services publish; the automation engine subscribes. This keeps the lead,
 * email and ticket services free of a dependency on the engine, which itself
 * depends on them to act.
 */
export type CrmSignalType =
  | AutomationTrigger
  | 'CUSTOMER_REPLIED'
  | 'UNSUBSCRIBED'
  | 'EMAIL_INVALID'
  | 'TICKET_CLOSED'
  | 'TICKET_USER_REPLIED';

export interface CrmSignal {
  type: CrmSignalType;
  scope: 'DEALER' | 'SUPPORT';
  dealerId?: string | null;
  leadId?: string | null;
  ticketId?: string | null;
  appointmentId?: string | null;
  /** For LEAD_STATUS_CHANGED: the new status key. */
  statusKey?: string | null;
  /** For UNSUBSCRIBED / EMAIL_INVALID: the address, to stop every lead using it. */
  email?: string | null;
}

type Handler = (signal: CrmSignal) => Promise<void>;

@Injectable()
export class CrmBus {
  private readonly logger = new Logger(CrmBus.name);
  private readonly handlers: Handler[] = [];

  subscribe(handler: Handler): void {
    this.handlers.push(handler);
  }

  /**
   * Delivers a signal to every subscriber. A failing subscriber is logged and
   * never fails the action that published the signal.
   */
  async publish(signal: CrmSignal): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(signal);
      } catch (error) {
        this.logger.error(`CRM signal ${signal.type} failed: ${String(error)}`);
      }
    }
  }
}

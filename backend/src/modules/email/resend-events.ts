import type { ProviderEventStatus } from '../../common/mail/mail.service';

/**
 * Translates a verified Resend webhook event into what Vintrax records
 * (D-068): a status for the platform email log, an event for the CRM outbox,
 * and whether the address must be suppressed. Pure, so it is tested alone.
 *
 * Opens and clicks are not taken from Resend: the CRM measures its own (and
 * only for CRM email), and platform email is not tracked at all.
 */

export interface ResendWebhookEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    bounce?: { type?: string; subType?: string; message?: string };
    failed?: { reason?: string };
    suppressed?: { type?: string; message?: string };
  };
}

export interface MappedEvent {
  providerMessageId: string;
  occurredAt: Date;
  platform: { status: ProviderEventStatus; detail: string | null } | null;
  crm: {
    type: 'DELIVERED' | 'BOUNCED' | 'COMPLAINED';
    detail: string | null;
    permanent?: boolean;
  } | null;
  suppress: 'HARD_BOUNCE' | 'COMPLAINT' | null;
}

/** Provider detail text may quote the address; it is replaced before storing. */
export function scrubDetail(text: string | undefined | null): string | null {
  if (!text) return null;
  return text
    .replace(/[^\s<>()"']+@[^\s<>()"']+/g, '[address]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

export function mapResendEvent(event: ResendWebhookEvent): MappedEvent | null {
  const id = event.data?.email_id;
  if (!id || !event.type?.startsWith('email.')) return null;
  const parsed = event.created_at ? new Date(event.created_at) : new Date();
  const occurredAt = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const base = { providerMessageId: id, occurredAt };

  switch (event.type) {
    case 'email.sent':
      return { ...base, platform: { status: 'ACCEPTED', detail: null }, crm: null, suppress: null };
    case 'email.delivered':
      return {
        ...base,
        platform: { status: 'DELIVERED', detail: null },
        crm: { type: 'DELIVERED', detail: null },
        suppress: null,
      };
    case 'email.delivery_delayed':
      return {
        ...base,
        platform: { status: 'DELAYED', detail: 'The receiving server deferred delivery' },
        crm: null,
        suppress: null,
      };
    case 'email.bounced': {
      const permanent = (event.data?.bounce?.type ?? '').toLowerCase() === 'permanent';
      const detail = scrubDetail(
        [event.data?.bounce?.type, event.data?.bounce?.subType, event.data?.bounce?.message]
          .filter(Boolean)
          .join(' — '),
      );
      return {
        ...base,
        platform: permanent
          ? { status: 'BOUNCED', detail }
          : { status: 'DELAYED', detail: `Soft bounce: ${detail ?? ''}`.trim() },
        crm: { type: 'BOUNCED', detail, permanent },
        suppress: permanent ? 'HARD_BOUNCE' : null,
      };
    }
    case 'email.complained':
      return {
        ...base,
        platform: { status: 'COMPLAINED', detail: 'The recipient marked it as spam' },
        crm: { type: 'COMPLAINED', detail: 'Marked as spam' },
        suppress: 'COMPLAINT',
      };
    case 'email.failed': {
      const detail = scrubDetail(event.data?.failed?.reason) ?? 'Resend could not send it';
      return {
        ...base,
        platform: { status: 'FAILED', detail },
        crm: { type: 'BOUNCED', detail: `Failed: ${detail}`, permanent: false },
        suppress: null,
      };
    }
    case 'email.suppressed': {
      const complaint = (event.data?.suppressed?.type ?? '').toLowerCase().includes('complaint');
      const detail = `Suppressed by Resend: ${scrubDetail(event.data?.suppressed?.message) ?? 'the address is on its suppression list'}`;
      return {
        ...base,
        platform: { status: 'FAILED', detail },
        crm: { type: 'BOUNCED', detail, permanent: true },
        suppress: complaint ? 'COMPLAINT' : 'HARD_BOUNCE',
      };
    }
    default:
      return null;
  }
}

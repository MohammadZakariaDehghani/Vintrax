import { mapResendEvent, scrubDetail } from './resend-events';

/**
 * How a verified Resend event is turned into delivery state. Pinned: only a
 * delivery event marks a message delivered; a permanent bounce and a
 * complaint suppress the address, a soft bounce does not; provider detail is
 * stored without the recipient's address; and events Vintrax does not track
 * (opens, clicks, contacts, domains) are ignored.
 */

const at = '2026-10-13T12:00:00.000Z';

describe('mapping Resend webhook events', () => {
  it('marks delivered only on email.delivered, for the platform log and the CRM', () => {
    const sent = mapResendEvent({ type: 'email.sent', created_at: at, data: { email_id: 'em_1' } });
    expect(sent?.platform?.status).toBe('ACCEPTED');
    expect(sent?.crm).toBeNull();
    const delivered = mapResendEvent({ type: 'email.delivered', created_at: at, data: { email_id: 'em_1' } });
    expect(delivered).toMatchObject({
      providerMessageId: 'em_1',
      platform: { status: 'DELIVERED' },
      crm: { type: 'DELIVERED' },
      suppress: null,
    });
    expect(delivered?.occurredAt.toISOString()).toBe(at);
  });

  it('suppresses a permanent bounce, and only notes a soft one', () => {
    const hard = mapResendEvent({
      type: 'email.bounced',
      data: { email_id: 'em_1', bounce: { type: 'Permanent', subType: 'General', message: 'No such user dana@example.test' } },
    });
    expect(hard).toMatchObject({
      platform: { status: 'BOUNCED' },
      crm: { type: 'BOUNCED', permanent: true },
      suppress: 'HARD_BOUNCE',
    });
    expect(hard?.platform?.detail).not.toContain('dana@example.test');

    const soft = mapResendEvent({
      type: 'email.bounced',
      data: { email_id: 'em_1', bounce: { type: 'Transient', subType: 'MailboxFull', message: 'full' } },
    });
    expect(soft).toMatchObject({ platform: { status: 'DELAYED' }, crm: { permanent: false }, suppress: null });
  });

  it('suppresses an address that complained', () => {
    expect(mapResendEvent({ type: 'email.complained', data: { email_id: 'em_1' } })).toMatchObject({
      platform: { status: 'COMPLAINED' },
      crm: { type: 'COMPLAINED' },
      suppress: 'COMPLAINT',
    });
  });

  it('records a failure and a provider-side suppression', () => {
    expect(
      mapResendEvent({ type: 'email.failed', data: { email_id: 'em_1', failed: { reason: 'domain not verified' } } }),
    ).toMatchObject({ platform: { status: 'FAILED', detail: 'domain not verified' }, suppress: null });
    expect(
      mapResendEvent({ type: 'email.suppressed', data: { email_id: 'em_1', suppressed: { type: 'complaint', message: 'x' } } }),
    ).toMatchObject({ platform: { status: 'FAILED' }, suppress: 'COMPLAINT' });
  });

  it('ignores events it does not track', () => {
    for (const type of ['email.opened', 'email.clicked', 'contact.created', 'domain.updated']) {
      expect(mapResendEvent({ type, data: { email_id: 'em_1' } })).toBeNull();
    }
    expect(mapResendEvent({ type: 'email.delivered', data: {} })).toBeNull();
  });

  it('scrubs addresses out of provider detail and bounds its length', () => {
    expect(scrubDetail('550 <dana@example.test> unknown')).toBe('550 <[address]> unknown');
    expect(scrubDetail('x'.repeat(1000))!.length).toBe(300);
    expect(scrubDetail(undefined)).toBeNull();
  });
});

import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { closeTestPrisma, describeDb, testPrisma } from '../../modules/accounting/testing/harness';
import { MailService } from './mail.service';
import { TransportError, type ResendTransport, type TransportMessage } from './resend.transport';

/**
 * The platform email log and outbox over a real database (D-068), with a
 * stand-in Resend transport: nothing is sent anywhere.
 *
 * Pinned: a message carrying a single-use link is never stored; one
 * idempotency key, one email; a transient failure is retried with backoff and
 * a permanent one is not; switched-off and suppressed mail is recorded and not
 * sent, but security mail always goes; the sweep recovers what a stopped
 * process left behind; delivery events never move a message backwards; an
 * administrator's retry cannot change what is sent; one alert an hour.
 */

jest.setTimeout(30_000);

describeDb('platform email over a real database', () => {
  const prisma = testPrisma();
  const run = randomUUID().slice(0, 8);
  let counter = 0;
  const address = (label: string) => `${label}-${run}-${(counter += 1)}@example.test`;
  const token = () => randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');

  function transport(...outcomes: Array<'ok' | 'transient' | 'permanent' | number>) {
    const calls: TransportMessage[] = [];
    let i = 0;
    const send = jest.fn(async (message: TransportMessage) => {
      calls.push(message);
      const outcome = outcomes[Math.min(i, outcomes.length - 1)] ?? 'ok';
      i += 1;
      if (typeof outcome === 'number') {
        await new Promise((resolve) => setTimeout(resolve, outcome));
        return { messageId: `em_${randomUUID()}` };
      }
      if (outcome === 'transient') throw new TransportError('try later', false, 'internal_server_error');
      if (outcome === 'permanent') throw new TransportError('bad address', true, 'validation_error');
      return { messageId: `em_${randomUUID()}` };
    });
    return { send, calls, stub: { send } as unknown as ResendTransport };
  }

  function mailer(overrides: Record<string, unknown> = {}, stub?: ResendTransport) {
    return new MailService(
      new ConfigService({
        NODE_ENV: 'development',
        MAIL_DRIVER: stub ? 'resend' : 'log',
        MAIL_FROM: 'Vintrax <noreply@vintrax.test>',
        APP_URL: 'https://vintrax.test',
        MAIL_ADMIN_TO: [],
        MAIL_NOTIFICATIONS_ENABLED: true,
        MAIL_MARKETING_ENABLED: true,
        MAIL_MAX_ATTEMPTS: 3,
        MAIL_ALERT_FAILURE_THRESHOLD: 1000,
        ...overrides,
      }) as never,
      prisma,
      stub,
    );
  }

  afterAll(async () => {
    await closeTestPrisma();
  });

  it('records a secret-link email without its variables, and an ordinary one with them', async () => {
    const mail = mailer();
    const resetId = await mail.sendTemplate('auth.password-reset', address('reset'), {
      firstName: 'Dana',
      token: token(),
    });
    const changedId = await mail.sendTemplate('auth.password-changed', address('changed'), {
      firstName: 'Dana',
      via: 'settings',
    });
    const reset = await prisma.emailMessage.findUniqueOrThrow({ where: { id: resetId! } });
    const changed = await prisma.emailMessage.findUniqueOrThrow({ where: { id: changedId! } });
    expect(reset).toMatchObject({ status: 'ACCEPTED', provider: 'log', category: 'SECURITY', payload: null });
    expect(JSON.stringify(reset)).not.toMatch(/token/i);
    expect(changed.payload).toMatchObject({ vars: { firstName: 'Dana', via: 'settings' } });
  });

  it('sends one email per idempotency key', async () => {
    const mail = mailer();
    const key = `test:${run}:once`;
    const to = address('once');
    const first = await mail.sendTemplate('auth.password-changed', to, { firstName: 'D', via: 'reset' }, { idempotencyKey: key });
    const second = await mail.sendTemplate('auth.password-changed', to, { firstName: 'D', via: 'reset' }, { idempotencyKey: key });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await prisma.emailMessage.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it('sends through Resend with the row key as the provider idempotency key, and records the provider id', async () => {
    const t = transport('ok');
    const mail = mailer({}, t.stub);
    const id = await mail.sendTemplate('auth.password-changed', address('resend'), { firstName: 'D', via: 'settings' });
    await mail.flush();
    const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: id! } });
    expect(row).toMatchObject({ status: 'ACCEPTED', provider: 'resend', attempts: 1 });
    expect(row.providerMessageId).toMatch(/^em_/);
    expect(t.calls[0]!.idempotencyKey).toBe(row.idempotencyKey);
    expect(t.calls[0]!.html).toContain('<!doctype html>');
  });

  it('does not make the request wait for the provider', async () => {
    const t = transport(800);
    const mail = mailer({}, t.stub);
    const started = Date.now();
    await mail.sendPasswordReset(address('slow'), token(), 'Dana');
    expect(Date.now() - started).toBeLessThan(600);
    await mail.flush();
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure with backoff and then succeeds', async () => {
    const t = transport('transient', 'ok');
    const mail = mailer({}, t.stub);
    const id = await mail.sendTemplate('auth.password-changed', address('flaky'), { firstName: 'D', via: 'settings' });
    await mail.flush();
    const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: id! } });
    expect(row).toMatchObject({ status: 'ACCEPTED', attempts: 2, lastError: null });
    expect(t.send).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permanent refusal', async () => {
    const t = transport('permanent');
    const mail = mailer({}, t.stub);
    const id = await mail.sendTemplate('auth.password-changed', address('refused'), { firstName: 'D', via: 'settings' });
    await mail.flush();
    const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: id! } });
    expect(row).toMatchObject({ status: 'FAILED', attempts: 1, lastErrorCode: 'validation_error' });
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured number of attempts', async () => {
    const t = transport('transient');
    const mail = mailer({ MAIL_MAX_ATTEMPTS: 2 }, t.stub);
    const id = await mail.sendTemplate('auth.password-changed', address('down'), { firstName: 'D', via: 'settings' });
    await mail.flush();
    const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: id! } });
    expect(row).toMatchObject({ status: 'FAILED', attempts: 2 });
    expect(row.failedAt).not.toBeNull();
  });

  it('records but does not send switched-off notifications — and still sends security mail', async () => {
    const t = transport('ok');
    const mail = mailer({ MAIL_NOTIFICATIONS_ENABLED: false }, t.stub);
    const skipped = await mail.sendTemplate('notification.generic', address('off'), {
      firstName: 'D',
      title: 'New message',
      body: 'Hi',
      link: null,
    });
    await mail.sendPasswordReset(address('sec'), token(), 'D');
    await mail.flush();
    expect(await prisma.emailMessage.findUniqueOrThrow({ where: { id: skipped! } })).toMatchObject({
      status: 'SKIPPED',
    });
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it('does not send notifications to a suppressed address, but still sends security mail', async () => {
    const t = transport('ok');
    const mail = mailer({}, t.stub);
    const to = address('bounced');
    await mail.suppress(to, 'HARD_BOUNCE', 'test');
    const notice = await mail.sendTemplate('notification.generic', to, { firstName: 'D', title: 'T', body: 'B', link: null });
    await mail.sendPasswordReset(to, token(), 'D');
    await mail.flush();
    expect(await prisma.emailMessage.findUniqueOrThrow({ where: { id: notice! } })).toMatchObject({
      status: 'SUPPRESSED',
    });
    expect(t.calls.map((c) => c.subject)).toEqual(['Reset your Vintrax password']);
  });

  it('has the sweep re-send a stored message whose sender stopped, and give up on a secret one', async () => {
    const t = transport('ok');
    const mail = mailer({}, t.stub);
    const past = new Date(Date.now() - 60 * 60_000);
    const ordinary = await prisma.emailMessage.create({
      data: {
        category: 'SECURITY',
        templateKey: 'auth.password-changed',
        toEmail: address('stranded'),
        subject: 'Your Vintrax password was changed',
        status: 'SENDING',
        attempts: 1,
        lockedUntil: past,
        nextAttemptAt: past,
        idempotencyKey: `test:${run}:stranded`,
        payload: { vars: { firstName: 'D', via: 'reset' }, replyTo: null },
      },
    });
    const secret = await prisma.emailMessage.create({
      data: {
        category: 'SECURITY',
        templateKey: 'auth.password-reset',
        toEmail: address('stranded-secret'),
        subject: 'Reset your Vintrax password',
        status: 'SENDING',
        attempts: 1,
        lockedUntil: past,
        nextAttemptAt: past,
        idempotencyKey: `test:${run}:stranded-secret`,
      },
    });
    await mail.sweep();
    await mail.flush();
    expect(await prisma.emailMessage.findUniqueOrThrow({ where: { id: ordinary.id } })).toMatchObject({
      status: 'ACCEPTED',
      attempts: 2,
    });
    expect(await prisma.emailMessage.findUniqueOrThrow({ where: { id: secret.id } })).toMatchObject({
      status: 'FAILED',
      lastErrorCode: 'interrupted',
    });
  });

  it('never moves a message backwards when delivery events arrive out of order', async () => {
    const t = transport('ok');
    const mail = mailer({}, t.stub);
    const id = await mail.sendTemplate('auth.password-changed', address('events'), { firstName: 'D', via: 'settings' });
    await mail.flush();
    const { providerMessageId } = await prisma.emailMessage.findUniqueOrThrow({ where: { id: id! } });
    const at = new Date();
    await mail.applyProviderEvent({ providerMessageId: providerMessageId!, status: 'COMPLAINED', occurredAt: at });
    await mail.applyProviderEvent({ providerMessageId: providerMessageId!, status: 'DELIVERED', occurredAt: at });
    const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: id! } });
    expect(row.status).toBe('COMPLAINED');
    expect(row.deliveredAt).not.toBeNull();
    expect(row.complainedAt).not.toBeNull();
    expect(await mail.applyProviderEvent({ providerMessageId: 'em_unknown', status: 'DELIVERED', occurredAt: at })).toBe(false);
  });

  it('lets an administrator retry only a failed message without a secret link, unchanged', async () => {
    const t = transport('permanent');
    const mail = mailer({}, t.stub);
    const ordinary = await mail.sendTemplate('auth.password-changed', address('retry'), { firstName: 'D', via: 'settings' });
    const secret = await mail.sendTemplate('auth.verify-email', address('retry-secret'), { firstName: 'D', token: token() });
    await mail.flush();
    expect(await mail.retry(secret!)).toBe('not_retryable');
    expect(await mail.retry(ordinary!)).toBe('queued');
    expect(await mail.retry(ordinary!)).toBe('not_retryable'); // already queued
    expect(await mail.retry(randomUUID())).toBe('not_found');
    expect(await prisma.emailMessage.findUniqueOrThrow({ where: { id: ordinary! } })).toMatchObject({
      status: 'QUEUED',
      attempts: 0,
    });
  });

  it('sends each administrator one alert per key per hour', async () => {
    const admins = [address('admin-a'), address('admin-b')];
    const mail = mailer({ MAIL_ADMIN_TO: admins });
    const alert = { key: `test-${run}`, severity: 'info' as const, title: 'Hello', summary: 'Something happened' };
    await mail.alertAdmins(alert);
    await mail.alertAdmins(alert);
    expect(await prisma.emailMessage.count({ where: { toEmail: { in: admins }, templateKey: 'admin.alert' } })).toBe(2);
  });

  it('counts by status and category for the dashboard', async () => {
    const stats = await mailer().stats(new Date(Date.now() - 60 * 60_000));
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.byCategory.SECURITY).toBeGreaterThan(0);
    expect(stats.driver).toBe('log');
  });
});

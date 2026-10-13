import { createHmac, randomBytes } from 'node:crypto';
import { ResendTransport, TransportError, verifyResendWebhook } from './resend.transport';

/**
 * The Resend transport, against a stand-in client — no request leaves the
 * test. Pinned: the idempotency key reaches the API; a refusal that will fail
 * the same way again is permanent and anything else is retried; and a webhook
 * is believed only with a valid, fresh signature over the exact bytes.
 */

type SendResult =
  | { data: { id: string }; error: null; headers: Record<string, string> | null }
  | {
      data: null;
      error: { name: string; message: string; statusCode: number | null };
      headers: Record<string, string> | null;
    };

function fakeClient(result: SendResult | Error) {
  const send = jest.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { send, client: { emails: { send } } as never };
}

const message = {
  from: 'Vintrax <noreply@vintrax.ca>',
  to: 'dana@example.test',
  subject: 'Hello',
  text: 'Hello',
  html: '<p>Hello</p>',
  idempotencyKey: 'auth.verify-email:123',
};

describe('the Resend transport', () => {
  it('sends with the idempotency key and returns the provider id', async () => {
    const { send, client } = fakeClient({ data: { id: 'em_1' }, error: null, headers: null });
    const transport = new ResendTransport('re_test', 100, client);
    await expect(transport.send(message)).resolves.toEqual({ messageId: 'em_1' });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'dana@example.test', subject: 'Hello' }),
      { idempotencyKey: 'auth.verify-email:123' },
    );
  });

  it('treats a validation error or an unverified sender as permanent', async () => {
    for (const name of ['validation_error', 'invalid_from_address', 'invalid_api_key']) {
      const { client } = fakeClient({
        data: null,
        error: { name, message: 'no', statusCode: 422 },
        headers: null,
      });
      const error = await new ResendTransport('re_test', 100, client).send(message).catch((e) => e);
      expect(error).toBeInstanceOf(TransportError);
      expect(error).toMatchObject({ permanent: true, code: name });
    }
  });

  it('retries a rate limit after the time Resend gave', async () => {
    const { client } = fakeClient({
      data: null,
      error: { name: 'rate_limit_exceeded', message: 'slow down', statusCode: 429 },
      headers: { 'retry-after': '2' },
    });
    const error = await new ResendTransport('re_test', 100, client).send(message).catch((e) => e);
    expect(error).toMatchObject({ permanent: false, code: 'rate_limit_exceeded', retryAfterMs: 2000 });
  });

  it('retries a server error and a network failure', async () => {
    const server = fakeClient({
      data: null,
      error: { name: 'internal_server_error', message: 'oops', statusCode: 500 },
      headers: null,
    });
    await expect(new ResendTransport('re_test', 100, server.client).send(message)).rejects.toMatchObject({
      permanent: false,
    });
    const network = fakeClient(new Error('ECONNRESET'));
    await expect(new ResendTransport('re_test', 100, network.client).send(message)).rejects.toMatchObject({
      permanent: false,
      code: 'network',
    });
  });

  it('holds a quota error back for at least an hour rather than hammering the API', async () => {
    const { client } = fakeClient({
      data: null,
      error: { name: 'daily_quota_exceeded', message: 'quota', statusCode: 429 },
      headers: null,
    });
    const error = await new ResendTransport('re_test', 100, client).send(message).catch((e) => e);
    expect(error.permanent).toBe(false);
    expect(error.retryAfterMs).toBeGreaterThanOrEqual(60 * 60_000);
  });

  it('spaces requests to stay under the configured rate', async () => {
    const { client } = fakeClient({ data: { id: 'em' }, error: null, headers: null });
    const transport = new ResendTransport('re_test', 10, client); // 100 ms apart
    const started = Date.now();
    await Promise.all([transport.send(message), transport.send(message), transport.send(message)]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
  });
});

describe('Resend webhook verification', () => {
  const key = randomBytes(24);
  const secret = `whsec_${key.toString('base64')}`;

  /** Signs as Resend does (Standard Webhooks: HMAC-SHA256 over id.timestamp.body). */
  function sign(body: string, id = 'msg_1', at = Math.floor(Date.now() / 1000)) {
    const signature = createHmac('sha256', key).update(`${id}.${at}.${body}`).digest('base64');
    return { id, timestamp: String(at), signature: `v1,${signature}` };
  }

  const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_1' } });

  it('accepts a correctly signed, fresh delivery and returns the parsed event', () => {
    expect(verifyResendWebhook(body, sign(body), secret)).toMatchObject({ type: 'email.delivered' });
  });

  it('refuses a body changed after signing', () => {
    const headers = sign(body);
    expect(() => verifyResendWebhook(body.replace('delivered', 'bounced'), headers, secret)).toThrow();
  });

  it('refuses the wrong secret', () => {
    const other = `whsec_${randomBytes(24).toString('base64')}`;
    expect(() => verifyResendWebhook(body, sign(body), other)).toThrow();
  });

  it('refuses a replay of an old delivery', () => {
    const old = sign(body, 'msg_1', Math.floor(Date.now() / 1000) - 60 * 60);
    expect(() => verifyResendWebhook(body, old, secret)).toThrow();
  });
});

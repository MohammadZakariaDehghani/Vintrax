import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from '@/lib/api-client';
import { messageForNonJson } from '@vintrax/client';

/**
 * An error page from a proxy in front of the API is HTML, not JSON. The
 * first promo video upload surfaced it as `Unexpected token '<'`; it must read
 * as what actually happened.
 */
describe('a response that is not JSON', () => {
  afterEach(() => vi.unstubAllGlobals());

  function respond(status: number, body: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': 'text/html' } })),
    );
  }

  it('turns an Nginx 413 page into a plain explanation', async () => {
    respond(413, '<html><head><title>413 Request Entity Too Large</title></head></html>');
    const error = await apiRequest('/uploads/x', { method: 'POST' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(413);
    expect((error as ApiError).message).toMatch(/larger than the server accepts/);
    expect((error as ApiError).message).not.toMatch(/Unexpected token|JSON/);
  });

  it('turns a gateway timeout page into a plain explanation', async () => {
    respond(504, '<html><h1>504 Gateway Time-out</h1></html>');
    await expect(apiRequest('/x')).rejects.toThrow(/took too long/);
  });

  it('still reads the API’s own JSON errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'Nope' }), { status: 400 })),
    );
    await expect(apiRequest('/x')).rejects.toThrow('Nope');
  });

  it('has a message for every kind of status', () => {
    expect(messageForNonJson(200)).toMatch(/unexpected response/);
    expect(messageForNonJson(500)).toMatch(/status 500/);
  });
});

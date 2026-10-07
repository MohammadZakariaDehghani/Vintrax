import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Open and click tracking, and the unsubscribe link. Each email carries an
 * opaque random token (never the lead's id). A click goes through
 * /api/crm/t/c/<token>?u=<url>&s=<signature>; the signature binds the URL to
 * the email, so the redirect cannot be used to send people anywhere else.
 */

export function newTrackingToken(): string {
  return randomBytes(18).toString('base64url');
}

export function signLink(secret: string, token: string, url: string): string {
  return createHmac('sha256', secret).update(`${token}\n${url}`).digest('base64url').slice(0, 32);
}

export function verifyLink(secret: string, token: string, url: string, signature: string): boolean {
  const expected = Buffer.from(signLink(secret, token, url));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Routes every http(s) link in the HTML through the click tracker. */
export function trackLinks(html: string, base: string, secret: string, token: string): string {
  return html.replace(
    /<a\s([^>]*?)href="(https?:\/\/[^"]+)"/gi,
    (_match, before: string, href: string) => {
      const url = href.replace(/&amp;/g, '&');
      const tracked = `${base}/api/crm/t/c/${token}?u=${encodeURIComponent(url)}&s=${signLink(secret, token, url)}`;
      return `<a ${before}href="${tracked.replace(/&/g, '&amp;')}"`;
    },
  );
}

export function openPixel(base: string, token: string): string {
  return `<img src="${base}/api/crm/t/o/${token}.gif" width="1" height="1" alt="" style="display:none">`;
}

export function unsubscribeUrl(appUrl: string, token: string): string {
  return `${appUrl}/unsubscribe?t=${encodeURIComponent(token)}`;
}

/** A transparent 1×1 GIF. */
export const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

import { EMAIL_TEMPLATES, appPathOrNull, renderTemplate, type EmailTemplateKey } from './catalog';
import { escapeHtml } from './layout';

/**
 * The platform's email templates (D-068). What is pinned: every template
 * renders an HTML and a plain-text part; data cannot become markup; links come
 * only from APP_URL; bad variables are refused rather than half-rendered; and
 * the templates carrying a single-use link say so, so they are never stored.
 */

const APP = 'https://vintrax.test';
const TOKEN = 'a'.repeat(64);

const SAMPLES: { [K in EmailTemplateKey]: Parameters<typeof renderTemplate<K>>[1] } = {
  'auth.verify-email': { firstName: 'Dana', token: TOKEN },
  'auth.password-reset': { firstName: 'Dana', token: TOKEN },
  'auth.password-changed': { firstName: 'Dana', via: 'settings' },
  'auth.email-changed': { firstName: 'Dana', newEmail: 'new@example.test' },
  'account.created': { firstName: 'Dana', email: 'dana@example.test' },
  'account.status-changed': { firstName: 'Dana', status: 'SUSPENDED' },
  'notification.generic': { firstName: 'Dana', title: 'New message', body: 'Hello', link: '/messages' },
  'finance.application': {
    applicantName: 'Sam Driver',
    applicantEmail: 'sam@example.test',
    applicantPhone: '514 555 0100',
    preferredContact: 'EMAIL',
    vehicleTitle: '2021 Honda Civic',
    vehiclePriceCad: 24995,
    applicationPath: '/dealer/finance/abc',
  },
  'auction.outbid': {
    firstName: 'Dana',
    vehicleTitle: '2019 Ford F-150',
    auctionId: '7b1f5a1e-6d1f-4a60-9b77-3a3c2d2e1f00',
    currentBidCad: 31000,
  },
  'contact.message': {
    name: 'Sam',
    email: 'sam@example.test',
    phone: null,
    subject: 'Hello',
    message: 'Is it available?',
  },
  'admin.alert': {
    severity: 'warning',
    title: 'Email delivery failures',
    summary: '12 failed',
    link: '/admin/emails',
    occurredAt: '2026-10-13T12:00:00.000Z',
  },
};

describe('the email template catalogue', () => {
  it.each(Object.keys(EMAIL_TEMPLATES) as EmailTemplateKey[])(
    '%s renders a subject, an HTML part and a plain-text part',
    (key) => {
      const out = renderTemplate(key, SAMPLES[key] as never, APP);
      expect(out.subject.length).toBeGreaterThan(5);
      expect(out.subject).not.toMatch(/[\r\n]/);
      expect(out.html).toContain('<!doctype html>');
      expect(out.html).not.toMatch(/<script/i);
      expect(out.text).toContain('— Vintrax');
      expect(out.text).not.toMatch(/<\/?(p|a|div|table|tr|td|h1|br|img)\b/i);
    },
  );

  it('escapes every value, so a name or message cannot become markup', () => {
    const hostile = '<img src=x onerror=alert(1)>"&\'';
    const out = renderTemplate(
      'notification.generic',
      { firstName: hostile, title: hostile, body: hostile, link: null },
      APP,
    );
    expect(out.html).not.toContain('<img');
    expect(out.html).toContain(escapeHtml(hostile));
    // The text part is for clients that show text; it is not interpreted.
    expect(out.text).toContain(hostile);
  });

  it('builds links from APP_URL and fixed paths only', () => {
    const reset = renderTemplate('auth.password-reset', { firstName: 'Dana', token: TOKEN }, APP);
    expect(reset.html).toContain(`${APP}/reset-password?token=${TOKEN}`);
    const verify = renderTemplate('auth.verify-email', { firstName: 'Dana', token: TOKEN }, APP);
    expect(verify.text).toContain(`${APP}/verify-email?token=${TOKEN}`);
  });

  it('refuses a full or protocol-relative URL where an app path belongs', () => {
    for (const link of ['https://evil.example/x', '//evil.example/x', 'javascript:alert(1)']) {
      expect(() =>
        renderTemplate('notification.generic', { firstName: 'D', title: 'T', body: 'B', link }, APP),
      ).toThrow();
      expect(appPathOrNull(link)).toBeNull();
    }
    expect(appPathOrNull('/dealer/crm/leads/1')).toBe('/dealer/crm/leads/1');
  });

  it('refuses missing or malformed variables instead of sending a half-rendered email', () => {
    expect(() => renderTemplate('auth.password-reset', { firstName: '', token: TOKEN }, APP)).toThrow();
    expect(() => renderTemplate('auth.password-reset', { firstName: 'D', token: 'short' }, APP)).toThrow();
    expect(() =>
      renderTemplate('auth.email-changed', { firstName: 'D', newEmail: 'not-an-email' }, APP),
    ).toThrow();
  });

  it('marks exactly the single-use-link templates as secret, so they are never stored', () => {
    const secret = Object.entries(EMAIL_TEMPLATES)
      .filter(([, template]) => template.secret)
      .map(([key]) => key)
      .sort();
    expect(secret).toEqual(['auth.password-reset', 'auth.verify-email']);
  });

  it('never puts a password in an email — even the account-created notice asks them to choose one', () => {
    const out = renderTemplate('account.created', { firstName: 'Dana', email: 'dana@example.test' }, APP);
    expect(out.text).toContain(`${APP}/forgot-password`);
    expect(out.text.toLowerCase()).toContain('no password is ever sent by email');
  });

  it('keeps security mail on and lets notifications and alerts be switched off', () => {
    expect(EMAIL_TEMPLATES['auth.password-reset'].category).toBe('SECURITY');
    expect(EMAIL_TEMPLATES['auth.password-changed'].category).toBe('SECURITY');
    expect(EMAIL_TEMPLATES['notification.generic'].category).toBe('NOTIFICATION');
    expect(EMAIL_TEMPLATES['admin.alert'].category).toBe('ADMIN');
  });
});

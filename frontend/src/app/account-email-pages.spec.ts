import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DICTIONARIES } from '@/i18n/dictionary';
import { LocaleProvider } from '@/i18n/provider';

/**
 * The pages the account emails link to (issue #46): forgot password, reset
 * password and verify email. Before them, the links in the verification and
 * reset emails led nowhere. Rendered as the server first renders them; the
 * round trips to the API are exercised against a running stack.
 */

let search = '';
// The logo is a next/image with a static import, which only Next's bundler resolves.
vi.mock('@/components/logo', () => ({ Logo: () => null }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { default: ForgotPasswordPage } = await import('./forgot-password/page');
const { default: ResetPasswordPage } = await import('./reset-password/page');
const { default: VerifyEmailPage } = await import('./verify-email/page');

function render(page: () => ReactElement, query = ''): string {
  search = query;
  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      // The children go in the third argument; the cast only tells the types so.
      { initialLocale: 'en' } as Parameters<typeof LocaleProvider>[0],
      createElement(page),
    ),
  );
}

afterEach(() => {
  search = '';
});

describe('the account email pages', () => {
  it('asks for an email address to send a reset link to, with a way back', () => {
    const html = render(ForgotPasswordPage);
    expect(html).toContain('Reset your password');
    expect(html).toContain('type="email"');
    expect(html).toContain('href="/login"');
  });

  it('asks for a new password when the reset link carries a token', () => {
    const html = render(ResetPasswordPage, `token=${'a'.repeat(64)}`);
    expect(html).toContain('Choose a new password');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('href="/forgot-password"');
  });

  it('says a reset link without its token is incomplete, rather than showing a form that cannot work', () => {
    const html = render(ResetPasswordPage);
    expect(html).toContain(DICTIONARIES.en.auth.missingToken);
    expect(html).not.toContain('type="password"');
  });

  it('confirms the address from the link, and fails plainly without a token', () => {
    expect(render(VerifyEmailPage, `token=${'b'.repeat(64)}`)).toContain(
      DICTIONARIES.en.auth.verifying,
    );
    expect(render(VerifyEmailPage)).toContain(DICTIONARIES.en.auth.verifyFailed);
  });

  it('has every new string in English and French', () => {
    const keys = [
      'forgotLink',
      'forgotTitle',
      'forgotSent',
      'resetTitle',
      'resetDone',
      'missingToken',
      'verifyDone',
      'verifyFailed',
    ] as const;
    for (const locale of ['en', 'fr'] as const) {
      for (const key of keys) expect(DICTIONARIES[locale].auth[key].length).toBeGreaterThan(5);
    }
    expect(DICTIONARIES.fr.auth.forgotTitle).not.toBe(DICTIONARIES.en.auth.forgotTitle);
  });
});

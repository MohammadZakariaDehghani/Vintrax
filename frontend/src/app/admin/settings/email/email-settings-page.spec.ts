import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

/**
 * Admin → Settings → Email in the browser (D-069). The server enforces
 * `settings:manage` on every route; the page also refuses to show the form to
 * anyone without it, so an admin who is not a super admin sees why rather than
 * a form that would fail.
 */

let allowed = false;
vi.mock('@/store/auth-store', () => ({ useHasPermission: () => allowed }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: unknown }) => children,
}));
vi.mock('@/components/admin-nav', () => ({ AdminNav: () => null }));

const { default: Page } = await import('./page');

function render(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Page)));
}

describe('the email settings page', () => {
  it('shows an admin who is not a super admin why there is no form', () => {
    allowed = false;
    const html = render();
    expect(html).toContain('Super admins only');
    expect(html).not.toContain('id="apiKey"');
  });

  it('loads the settings for a super admin rather than rendering a form from nothing', () => {
    allowed = true;
    expect(render()).toContain('Loading email settings');
  });
});

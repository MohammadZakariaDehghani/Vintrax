import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@vintrax/client';
import { ErrorAlert } from '@/components/ui';

function alert(error: unknown): string {
  return renderToStaticMarkup(createElement(ErrorAlert, { error }));
}

describe('ErrorAlert', () => {
  it('shows only the message for a wrong password, with no reference', () => {
    const html = alert(new ApiError(401, 'Invalid email or password', {}, 'req-123'));
    expect(html).toContain('Invalid email or password');
    expect(html).not.toContain('Reference');
    expect(html).not.toContain('req-123');
  });

  it('keeps the reference for a server fault, where support needs it', () => {
    const html = alert(new ApiError(500, 'Something went wrong', {}, 'req-456'));
    expect(html).toContain('Reference: req-456');
  });
});

describe('dealer inventory bulk actions', () => {
  const page = readFileSync('src/app/dealer/inventory/page.tsx', 'utf8');

  it('offers Unpublish, moving the selection back to draft', () => {
    expect(page).toContain('Unpublish');
    expect(page).toMatch(/status: 'DRAFT'/);
  });

  it('offers Delete to dealers, not only administrators', () => {
    expect(page).toContain('Yes, delete');
    expect(page).not.toMatch(/useIsAdmin|isAdmin \?/);
  });
});

describe('popular makes', () => {
  it('draws each make as a larger logo, without a card around it', () => {
    const home = readFileSync('src/app/page.tsx', 'utf8');
    expect(home).toMatch(/<BrandLogo[\s\S]{0,120}className="h-12 w-12/);
    const link = home.slice(home.indexOf('href={`/vehicles?make='));
    expect(link.slice(0, link.indexOf('>'))).not.toMatch(/border border-border|bg-card/);
  });
});

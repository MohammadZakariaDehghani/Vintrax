import { describe, expect, it } from 'vitest';
import type { Permission, PublicUser } from '@vintrax/shared';
import { postLoginRedirect } from './post-login-redirect';

function user(permissions: Permission[] = []): PublicUser {
  return {
    id: 'u1',
    email: 'a@example.com',
    firstName: 'A',
    lastName: 'User',
    displayName: 'A User',
    role: 'BUYER',
    status: 'ACTIVE',
    emailVerified: true,
    username: 'buyer',
    phone: null,
    postalCode: null,
    province: null,
    city: null,
    avatarUrl: null,
    dealer: null,
    permissions,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('postLoginRedirect', () => {
  /**
   * The bug this exists for: signing out of the dealer inventory screen and
   * back in as a buyer landed on that same screen, because the browser still
   * carried `?next=/dealer/inventory` from the earlier redirect.
   */
  it('sends an account with no vehicle:write permission home instead of into the dealer screens', () => {
    expect(postLoginRedirect('/dealer/inventory', user())).toBe('/');
    expect(postLoginRedirect('/dealer/inventory/new', user(['user:read']))).toBe('/');
  });

  it('honours a dealer destination for an account that holds vehicle:write', () => {
    expect(postLoginRedirect('/dealer/inventory', user(['vehicle:write']))).toBe(
      '/dealer/inventory',
    );
  });

  it('honours an ordinary destination for any signed-in account', () => {
    expect(postLoginRedirect('/account/bids', user())).toBe('/account/bids');
    expect(postLoginRedirect('/saved', user())).toBe('/saved');
  });

  it('refuses to redirect off the site', () => {
    expect(postLoginRedirect('https://evil.example.com', user(['vehicle:write']))).toBe('/');
    expect(postLoginRedirect('//evil.example.com', user(['vehicle:write']))).toBe('/');
  });
});

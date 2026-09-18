import { describe, expect, it } from 'vitest';
import type { PublicUser, UserRole } from '@vintrax/shared';
import { postLoginRedirect } from './post-login-redirect';

function user(role: UserRole): PublicUser {
  return {
    id: 'u1',
    email: 'a@example.com',
    firstName: 'A',
    lastName: 'User',
    displayName: 'A User',
    role,
    status: 'ACTIVE',
    emailVerified: true,
    phone: null,
    province: null,
    city: null,
    avatarUrl: null,
    dealer: null,
    permissions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('postLoginRedirect', () => {
  /**
   * The bug this exists for: signing out of an admin screen and back in as a
   * different account landed on that same admin URL, because the browser
   * still carried `?from=/admin/...` from the earlier redirect.
   */
  it('sends a non-admin home instead of into an admin page', () => {
    expect(postLoginRedirect('/admin/dashboard', user('DEALER'))).toBe('/');
    expect(postLoginRedirect('/admin/users', user('BUYER'))).toBe('/');
  });

  it('honours an admin destination for an admin account', () => {
    expect(postLoginRedirect('/admin/dashboard', user('ADMIN'))).toBe('/admin/dashboard');
    expect(postLoginRedirect('/admin/dashboard', user('SUPER_ADMIN'))).toBe('/admin/dashboard');
  });

  it('sends a buyer home instead of into a seller-only page', () => {
    expect(postLoginRedirect('/dealer/dashboard', user('BUYER'))).toBe('/');
    expect(postLoginRedirect('/auctions/new', user('BUYER'))).toBe('/');
  });

  it('honours a seller-only destination for a seller, dealer or admin account', () => {
    expect(postLoginRedirect('/dealer/dashboard', user('SELLER'))).toBe('/dealer/dashboard');
    expect(postLoginRedirect('/dealer/dashboard', user('DEALER'))).toBe('/dealer/dashboard');
    expect(postLoginRedirect('/auctions/new', user('ADMIN'))).toBe('/auctions/new');
  });

  it('honours an ordinary destination for any signed-in account', () => {
    expect(postLoginRedirect('/dashboard/favorites', user('BUYER'))).toBe('/dashboard/favorites');
    expect(postLoginRedirect('/vehicles/some-car', user('BUYER'))).toBe('/vehicles/some-car');
  });

  it('refuses to redirect off the site', () => {
    expect(postLoginRedirect('https://evil.example.com', user('ADMIN'))).toBe('/');
    expect(postLoginRedirect('//evil.example.com', user('ADMIN'))).toBe('/');
  });
});

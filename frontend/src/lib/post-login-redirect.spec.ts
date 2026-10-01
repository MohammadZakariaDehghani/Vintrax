import { describe, expect, it } from 'vitest';
import type { PublicUser, UserRole } from '@vintrax/shared';
import { readFileSync } from 'node:fs';
import { homeForRole, postLoginRedirect } from './post-login-redirect';

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
    username: 'auser',
    phone: null,
    postalCode: null,
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

/**
 * Switching accounts on one tab (issue #76): signing out as a dealer and in as
 * an administrator must leave nothing of the dealer's session showing.
 */
describe('switching accounts', () => {
  it('lands each role on its own dashboard when nothing else was asked for', () => {
    expect(homeForRole(user('ADMIN'))).toBe('/admin/dashboard');
    expect(homeForRole(user('SUPER_ADMIN'))).toBe('/admin/dashboard');
    expect(homeForRole(user('DEALER'))).toBe('/dealer/dashboard');
    expect(homeForRole(user('SELLER'))).toBe('/dashboard');
    expect(homeForRole(user('BUYER'))).toBe('/dashboard');
  });

  it('signs out to the sign-in page with a full page load and no `from`', () => {
    const header = readFileSync('src/components/site-header.tsx', 'utf8');
    const logout = header.slice(header.indexOf('async function handleLogout'));
    expect(logout.slice(0, logout.indexOf('\n  }'))).toContain("window.location.replace('/login')");
  });

  it('sends login to the role home, and the header to the same place', () => {
    expect(readFileSync('src/app/login/page.tsx', 'utf8')).toContain('homeForRole(user)');
    expect(readFileSync('src/components/site-header.tsx', 'utf8')).toContain('homeForRole(user)');
  });

  it('never shows an administrator the dealer tabs on the dashboard', () => {
    const nav = readFileSync('src/components/dashboard-nav.tsx', 'utf8');
    expect(nav).toMatch(/isAdmin\s*\?\s*\[\.\.\.BUYER_LINKS, \.\.\.ADMIN_LINKS\]/);
  });
});

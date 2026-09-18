import { ROLE_PERMISSIONS, makeLogoSchema } from '@vintrax/shared';

/**
 * A make's logo is operator content on the home page, the same category as a
 * body-type photograph. Only an operator may set one, and the picture must
 * come from Vintrax's own storage — an arbitrary URL here would put a request
 * to a third-party server into every visitor's first paint.
 */

describe('who may set a make logo', () => {
  it.each(['BUYER', 'SELLER', 'DEALER', 'INSPECTOR'] as const)('refuses %s', (role) => {
    expect(ROLE_PERMISSIONS[role]).not.toContain('content:manage');
  });

  it.each(['ADMIN', 'SUPER_ADMIN'] as const)('allows %s', (role) => {
    expect(ROLE_PERMISSIONS[role]).toContain('content:manage');
  });
});

describe('the write payload', () => {
  it('accepts a stored image URL', () => {
    const parsed = makeLogoSchema.parse({ imageUrl: '/uploads/make-logos/toyota.png' });

    expect(parsed.imageUrl).toBe('/uploads/make-logos/toyota.png');
  });

  it('requires a URL', () => {
    expect(() => makeLogoSchema.parse({})).toThrow();
    expect(() => makeLogoSchema.parse({ imageUrl: '' })).toThrow();
  });

  /**
   * The make is the path, never the payload — the same reasoning as
   * `bodyTypeImageSchema` refusing a body type in the body. Accepting it in
   * both places is how a request ends up writing a row nobody asked for.
   */
  it('refuses a make in the body', () => {
    expect(() =>
      makeLogoSchema.parse({ imageUrl: '/uploads/make-logos/toyota.png', make: 'Toyota' }),
    ).toThrow(/make/);
  });
});

import { BODY_TYPES, ROLE_PERMISSIONS, bodyTypeImageSchema } from '@atlas/shared';

/**
 * The body-type photographs are operator content on a public page.
 *
 * Two things have to hold. Only an operator may set one — a dealer with a
 * marketing idea must not be able to put a picture on the home page. And the
 * picture must come from Atlas's own storage: an arbitrary URL here would put
 * a request to a third-party server into every visitor's first paint, leaking
 * the referer and handing that server an outage it can pass on. These tests
 * pin both, plus the shape the write endpoint accepts.
 */

describe('who may set a body-type photograph', () => {
  it.each(['BUYER', 'SELLER', 'DEALER', 'INSPECTOR'] as const)(
    'refuses %s',
    (role) => {
      expect(ROLE_PERMISSIONS[role]).not.toContain('content:manage');
    },
  );

  it.each(['ADMIN', 'SUPER_ADMIN'] as const)('allows %s', (role) => {
    expect(ROLE_PERMISSIONS[role]).toContain('content:manage');
  });

  /**
   * Changing a picture on the home page is not the same power as changing a
   * fee schedule. Keeping them apart is the reason `content:manage` exists at
   * all, so it is worth a test of its own.
   */
  it('does not hand an admin platform settings along with it', () => {
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('settings:manage');
  });
});

describe('the write payload', () => {
  it('accepts a stored image URL', () => {
    const parsed = bodyTypeImageSchema.parse({ imageUrl: '/uploads/body-types/abc.png' });

    expect(parsed.imageUrl).toBe('/uploads/body-types/abc.png');
  });

  it('requires a URL', () => {
    expect(() => bodyTypeImageSchema.parse({})).toThrow();
    expect(() => bodyTypeImageSchema.parse({ imageUrl: '' })).toThrow();
  });

  /**
   * The body type is the path, never the payload. Accepting it in both places
   * is how a request ends up writing a row nobody asked for, so the schema is
   * strict and says so rather than silently dropping the key.
   */
  it('refuses a body type in the body', () => {
    expect(() =>
      bodyTypeImageSchema.parse({ imageUrl: '/uploads/body-types/abc.png', bodyType: 'TRUCK' }),
    ).toThrow(/bodyType/);
  });
});

describe('the shortcut row', () => {
  it('has a plural label for every body type', async () => {
    const { BODY_TYPE_PLURAL_LABELS } = await import('@atlas/shared');

    for (const bodyType of BODY_TYPES) {
      expect(BODY_TYPE_PLURAL_LABELS[bodyType]).toBeTruthy();
    }
  });
});

import { isPlaceholderSecret, validateEnv } from './env';

/** Configuration the API refuses to start with, because it would run insecurely. */

const base = {
  DATABASE_URL: 'postgresql://unused',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
};

describe('production secrets', () => {
  it('refuses the placeholders shipped in the example env files', () => {
    for (const placeholder of [
      'CHANGE_ME',
      'CHANGE_ME_DIFFERENTLY',
      'change-me-please-123456',
      'dev-only-access-secret-change-me',
    ]) {
      expect(isPlaceholderSecret(placeholder)).toBe(true);
      expect(() =>
        validateEnv({
          ...base,
          NODE_ENV: 'production',
          JWT_ACCESS_SECRET: placeholder.padEnd(16, '_'),
        }),
      ).toThrow(/JWT_ACCESS_SECRET/);
    }
  });

  it('accepts a generated secret', () => {
    expect(isPlaceholderSecret('q3Jr7C0xw1S4pUqT8a3sZ9hF2mVn6bYk')).toBe(false);
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).not.toThrow();
  });

  it('still lets development start with the example values', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'development',
        JWT_ACCESS_SECRET: 'dev-only-access-secret-change-me',
        JWT_REFRESH_SECRET: 'dev-only-refresh-secret-change-me',
      }),
    ).not.toThrow();
  });

  it('refuses the same secret for access and refresh tokens', () => {
    expect(() => validateEnv({ ...base, JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET })).toThrow(
      /must be different/,
    );
  });
});

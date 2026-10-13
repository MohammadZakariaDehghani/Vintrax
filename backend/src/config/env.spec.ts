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

describe('CRM settings', () => {
  it('treats the empty values in the example env files as unset', () => {
    const env = validateEnv({
      ...base,
      NODE_ENV: 'development',
      CRM_WEBHOOK_SECRET: '',
      SUPPORT_REPLY_TO: ' ',
    });
    expect(env.CRM_WEBHOOK_SECRET).toBeUndefined();
    expect(env.SUPPORT_REPLY_TO).toBeUndefined();
    expect(env.CRM_SCHEDULER_ENABLED).toBe(true);
    expect(env.CRM_EMAIL_MAX_ATTEMPTS).toBe(5);
  });

  it('refuses a short webhook secret and a reply-to that is not an address', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'development', CRM_WEBHOOK_SECRET: 'short' }),
    ).toThrow(/CRM_WEBHOOK_SECRET/);
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'development', SUPPORT_REPLY_TO: 'support' }),
    ).toThrow(/SUPPORT_REPLY_TO/);
  });
});

describe('email configuration (D-068)', () => {
  const dev = { ...base, NODE_ENV: 'development' };

  it('needs a Resend API key to use the Resend driver', () => {
    expect(() => validateEnv({ ...dev, MAIL_DRIVER: 'resend' })).toThrow(/RESEND_API_KEY/);
    expect(() =>
      validateEnv({ ...dev, MAIL_DRIVER: 'resend', RESEND_API_KEY: 'not-a-key' }),
    ).toThrow(/RESEND_API_KEY/);
    expect(() =>
      validateEnv({
        ...dev,
        MAIL_DRIVER: 'resend',
        RESEND_API_KEY: 're_123456789',
        MAIL_FROM: 'Vintrax <noreply@vintrax.ca>',
      }),
    ).not.toThrow();
  });

  it('never lets a test run send real email', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'test', MAIL_DRIVER: 'resend', RESEND_API_KEY: 're_1' }),
    ).toThrow(/NODE_ENV=test only allows MAIL_DRIVER=log/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'test' })).not.toThrow();
  });

  it('still starts an existing deployment whose sender is a placeholder, with the old drivers', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', MAIL_FROM: 'Vintrax <no-reply@localhost>' }),
    ).not.toThrow();
  });

  it('refuses a placeholder sending domain with Resend', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        MAIL_DRIVER: 'resend',
        RESEND_API_KEY: 're_123456789',
        MAIL_FROM: 'Vintrax <no-reply@vintrax.local>',
      }),
    ).toThrow(/MAIL_FROM/);
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        MAIL_DRIVER: 'resend',
        RESEND_API_KEY: 're_123456789',
        MAIL_FROM: 'Vintrax <noreply@vintrax.ca>',
      }),
    ).not.toThrow();
  });

  it('validates the sender, the reply-to and the admin list', () => {
    expect(() => validateEnv({ ...dev, MAIL_FROM: 'Vintrax <not an address>' })).toThrow(/MAIL_FROM/);
    expect(() => validateEnv({ ...dev, MAIL_REPLY_TO: 'support' })).toThrow(/MAIL_REPLY_TO/);
    expect(() => validateEnv({ ...dev, MAIL_ADMIN_TO: 'ops@vintrax.ca, nope' })).toThrow(
      /MAIL_ADMIN_TO/,
    );
    const env = validateEnv({ ...dev, MAIL_ADMIN_TO: ' Ops@Vintrax.ca , admin@vintrax.ca ' });
    expect(env.MAIL_ADMIN_TO).toEqual(['ops@vintrax.ca', 'admin@vintrax.ca']);
  });

  it('only accepts the whsec_ signing secret for the webhook', () => {
    expect(() => validateEnv({ ...dev, RESEND_WEBHOOK_SECRET: 'plain-secret' })).toThrow(
      /RESEND_WEBHOOK_SECRET/,
    );
    expect(() => validateEnv({ ...dev, RESEND_WEBHOOK_SECRET: 'whsec_abc' })).not.toThrow();
  });

  it('defaults to sending notifications and marketing, as before', () => {
    const env = validateEnv(dev);
    expect(env.MAIL_DRIVER).toBe('log');
    expect(env.MAIL_NOTIFICATIONS_ENABLED).toBe(true);
    expect(env.MAIL_MARKETING_ENABLED).toBe(true);
    expect(env.MAIL_ADMIN_TO).toEqual([]);
  });
});

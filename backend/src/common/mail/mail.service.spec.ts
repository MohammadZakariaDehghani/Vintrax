import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

/**
 * The log driver prints mail to the server log. Verification and reset emails
 * carry single-use links that sign the reader in as the account holder, so a
 * production log must never contain them.
 */

function mailer(nodeEnv: 'development' | 'production') {
  return new MailService(
    new ConfigService({
      NODE_ENV: nodeEnv,
      MAIL_DRIVER: 'log',
      MAIL_FROM: 'Vintrax <no-reply@vintrax.test>',
      APP_URL: 'https://vintrax.test',
    }) as never,
  );
}

function captureLogs(): { text: () => string; restore: () => void } {
  const lines: string[] = [];
  const spies = (['log', 'warn', 'error', 'debug'] as const).map((level) =>
    jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    }),
  );
  return { text: () => lines.join('\n'), restore: () => spies.forEach((spy) => spy.mockRestore()) };
}

describe('the log mail driver', () => {
  it('prints the whole message in development, so reset and verify flows can be tested', async () => {
    const logs = captureLogs();
    await mailer('development').sendPasswordReset('dana@example.test', 'SECRET-TOKEN-0123456789abcdef', 'Dana');
    const text = logs.text();
    logs.restore();
    expect(text).toContain('reset-password?token=SECRET-TOKEN-0123456789abcdef');
  });

  it('prints neither the link, the token nor the address in production', async () => {
    const logs = captureLogs();
    const mail = mailer('production');
    await mail.sendPasswordReset('dana@example.test', 'SECRET-TOKEN-0123456789abcdef', 'Dana');
    await mail.sendEmailVerification('dana@example.test', 'VERIFY-TOKEN-0123456789abcdef', 'Dana');
    const text = logs.text();
    logs.restore();

    expect(text).not.toContain('SECRET-TOKEN-0123456789abcdef');
    expect(text).not.toContain('VERIFY-TOKEN-0123456789abcdef');
    expect(text).not.toContain('dana@example.test');
    // It does say that nothing was sent, and why.
    expect(text).toContain('MAIL_DRIVER=log');
  });
});

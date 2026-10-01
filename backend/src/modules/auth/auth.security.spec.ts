import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

// bcryptjs's exports are not configurable, so spyOn cannot wrap them; a
// pass-through mock records which hash each compare was given.
jest.mock('bcryptjs', () => {
  const actual = jest.requireActual<typeof import('bcryptjs')>('bcryptjs');
  return {
    ...actual,
    compare: jest.fn((password: string, hash: string) => actual.compare(password, hash)),
  };
});

/**
 * The sign-in and password-reset paths, over an in-memory stand-in for the
 * Prisma calls they make and for Redis. What is pinned here is behaviour an
 * attacker would probe: how long a wrong email takes, how many guesses one
 * account allows, and whether a reset link works more than once.
 */

const PASSWORD = 'correct horse battery staple';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'BUYER' | 'DEALER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  emailVerified: boolean;
  passwordHash: string;
}

interface TokenRow {
  id: string;
  userId: string;
  type: 'PASSWORD_RESET' | 'EMAIL_VERIFICATION';
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

type Where = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const gt = (expected as { gt?: Date }).gt;
      if (gt) return actual instanceof Date && actual.getTime() > gt.getTime();
    }
    return actual === expected;
  });
}

class FakeDatabase {
  users = new Map<string, UserRow>();
  tokens: TokenRow[] = [];
  refreshTokens: { userId: string; revokedAt: Date | null }[] = [];

  user = {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
      [...this.users.values()].find((u) =>
        where.id ? u.id === where.id : u.email === where.email,
      ) ?? null,
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const row = this.users.get(where.id);
      if (!row) throw new Error('not found');
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
      const row = { ...this.users.get(where.id)!, ...data };
      this.users.set(where.id, row);
      return row;
    },
  };

  authToken = {
    create: async ({ data }: { data: Omit<TokenRow, 'id' | 'consumedAt'> }) => {
      const row = { ...data, id: `t${this.tokens.length + 1}`, consumedAt: null };
      this.tokens.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { tokenHash: string } }) =>
      this.tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
    updateMany: async ({ where, data }: { where: Where; data: Partial<TokenRow> }) => {
      const hits = this.tokens.filter((t) => matches(t as never, where));
      for (const t of hits) Object.assign(t, data);
      return { count: hits.length };
    },
  };

  refreshToken = {
    create: async ({ data }: { data: { userId: string } }) => {
      this.refreshTokens.push({ userId: data.userId, revokedAt: null });
    },
    updateMany: async ({ where, data }: { where: Where; data: { revokedAt: Date } }) => {
      const hits = this.refreshTokens.filter((t) => matches(t as never, where));
      for (const t of hits) Object.assign(t, data);
      return { count: hits.length };
    },
  };

  /** Runs the callback serially, as Postgres serialises the row-level claim. */
  private queue: Promise<unknown> = Promise.resolve();
  $transaction = async <T>(work: (tx: this) => Promise<T>): Promise<T> => {
    const run = this.queue.then(() => work(this));
    this.queue = run.catch(() => undefined);
    return run;
  };
}

class FakeRedis {
  store = new Map<string, number>();
  async get<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T | undefined) ?? null;
  }
  async increment(key: string): Promise<number> {
    const next = (this.store.get(key) ?? 0) + 1;
    this.store.set(key, next);
    return next;
  }
  async del(...keys: string[]): Promise<void> {
    for (const key of keys) this.store.delete(key);
  }
}

const config = new ConfigService({
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
});

async function setup() {
  const db = new FakeDatabase();
  const redis = new FakeRedis();
  const mail = {
    sendPasswordReset: jest.fn(),
    sendEmailVerification: jest.fn(),
    send: jest.fn(),
  };
  const auth = new AuthService(
    db as never,
    new JwtService({}),
    config as never,
    { getPublicUser: async (id: string) => ({ id }) } as never,
    mail as never,
    { record: async () => undefined } as never,
    redis as never,
  );
  db.users.set('u1', {
    id: 'u1',
    email: 'dealer@example.test',
    firstName: 'Dana',
    lastName: 'Lee',
    role: 'DEALER',
    status: 'ACTIVE',
    emailVerified: true,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
  });
  return { auth, db, redis, mail };
}

describe('signing in', () => {
  it('compares an unknown email against a real bcrypt hash, so it takes as long as a wrong password', async () => {
    const { auth } = await setup();
    const compare = bcrypt.compare as unknown as jest.Mock;
    compare.mockClear();

    await expect(
      auth.login({ email: 'nobody@example.test', password: 'guess' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const hashUsed = compare.mock.calls[0]![1] as string;
    // A malformed hash makes bcrypt return at once; a well-formed one costs a full compare.
    expect(hashUsed).toMatch(/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/);
  });

  it('locks an account after 10 wrong passwords, whatever address they come from', async () => {
    const { auth } = await setup();
    for (let attempt = 0; attempt < 10; attempt++) {
      await expect(
        auth.login({ email: 'dealer@example.test', password: `wrong ${attempt}` }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    // The right password no longer helps until the window passes.
    const locked = auth.login({ email: 'dealer@example.test', password: PASSWORD });
    await expect(locked).rejects.toBeInstanceOf(HttpException);
    await expect(locked).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('forgets earlier failures after a successful sign-in', async () => {
    const { auth, redis } = await setup();
    for (let attempt = 0; attempt < 9; attempt++) {
      await auth.login({ email: 'dealer@example.test', password: 'wrong' }).catch(() => undefined);
    }
    await expect(
      auth.login({ email: 'dealer@example.test', password: PASSWORD }),
    ).resolves.toHaveProperty('accessToken');
    expect(redis.store.size).toBe(0);
  });

  it('does not keep the email address in Redis in the clear', async () => {
    const { auth, redis } = await setup();
    await auth.login({ email: 'dealer@example.test', password: 'wrong' }).catch(() => undefined);
    expect([...redis.store.keys()].join()).not.toContain('dealer@example.test');
  });
});

describe('resetting a password', () => {
  async function requestLink() {
    const context = await setup();
    await context.auth.requestPasswordReset('dealer@example.test');
    const token = context.mail.sendPasswordReset.mock.calls.at(-1)![1] as string;
    return { ...context, token };
  }

  it('stores only a digest of the link token', async () => {
    const { db, token } = await requestLink();
    expect(db.tokens[0]!.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(db.tokens)).not.toContain(token);
  });

  it('works once, even when the same link is submitted twice at the same moment', async () => {
    const { auth, token } = await requestLink();
    const results = await Promise.allSettled([
      auth.resetPassword({ token, password: 'first new password 1!' }),
      auth.resetPassword({ token, password: 'second new password 2!' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('only the newest link works once another has been requested', async () => {
    const { auth, mail, token: first } = await requestLink();
    await auth.requestPasswordReset('dealer@example.test');
    const second = mail.sendPasswordReset.mock.calls.at(-1)![1] as string;

    await expect(
      auth.resetPassword({ token: first, password: 'a new password 1!' }),
    ).rejects.toThrow(/invalid or has expired/);
    await expect(
      auth.resetPassword({ token: second, password: 'a new password 1!' }),
    ).resolves.toBeUndefined();
  });

  it('signs out every existing session', async () => {
    const { auth, db, token } = await requestLink();
    await auth.login({ email: 'dealer@example.test', password: PASSWORD });
    expect(db.refreshTokens.every((t) => t.revokedAt === null)).toBe(true);

    await auth.resetPassword({ token, password: 'a new password 1!' });
    expect(db.refreshTokens.every((t) => t.revokedAt !== null)).toBe(true);
  });

  it('says nothing about whether an address has an account', async () => {
    const { auth, mail } = await setup();
    await expect(auth.requestPasswordReset('nobody@example.test')).resolves.toBeUndefined();
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });
});

describe('an access token for an account that has since changed', () => {
  async function validate(status: UserRow['status']) {
    const { db } = await setup();
    db.users.get('u1')!.status = status;
    const strategy = new JwtStrategy(
      config as never,
      {
        user: {
          findUnique: async () => ({ ...db.users.get('u1')!, dealer: { id: 'd1' } }),
        },
      } as never,
    );
    return strategy.validate({ sub: 'u1', email: 'dealer@example.test', role: 'DEALER' });
  }

  it('is accepted while the account is active', async () => {
    await expect(validate('ACTIVE')).resolves.toMatchObject({ id: 'u1', dealerId: 'd1' });
  });

  it('stops working the moment the account is suspended, on every route', async () => {
    await expect(validate('SUSPENDED')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('stops working once the account is deactivated', async () => {
    await expect(validate('DEACTIVATED')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('changing the sign-in email', () => {
  const user = { id: 'u1', email: 'dealer@example.test', firstName: 'Dana' } as never;

  it('needs the current password, so a stolen session alone cannot take the account', async () => {
    const { auth, db } = await setup();
    await expect(
      auth.changeEmail(user, { email: 'new@example.test', currentPassword: 'guess' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.users.get('u1')!.email).toBe('dealer@example.test');
  });

  it('refuses an address another account already uses', async () => {
    const { auth, db } = await setup();
    db.users.set('u2', { ...db.users.get('u1')!, id: 'u2', email: 'taken@example.test' });
    await expect(
      auth.changeEmail(user, { email: 'taken@example.test', currentPassword: PASSWORD }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('moves the account, asks for the new address to be verified, and tells the old one', async () => {
    const { auth, db, mail } = await setup();
    await auth.changeEmail(user, { email: 'new@example.test', currentPassword: PASSWORD });
    expect(db.users.get('u1')).toMatchObject({ email: 'new@example.test', emailVerified: false });
    expect(mail.sendEmailVerification).toHaveBeenCalledWith(
      'new@example.test',
      expect.any(String),
      'Dana',
    );
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'dealer@example.test' }));
  });
});

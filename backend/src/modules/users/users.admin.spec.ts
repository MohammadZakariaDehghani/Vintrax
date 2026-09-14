import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { assignableRoles, canAdministerUser, canAssignRole } from '@vintrax/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { UsersService } from './users.service';

/**
 * Administration of accounts, which is the one place in this codebase where a
 * bug hands someone else's authority away.
 *
 * These exercise the decisions rather than the plumbing: who may assign which
 * role, who may act on whom, and the three ways an administrator could lock the
 * platform out of itself. The Prisma client is a stub, because none of that is
 * a question about the database.
 */

function actor(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'actor-1',
    email: 'admin@vintrax.test',
    firstName: 'Ada',
    lastName: 'Admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    emailVerified: true,
    dealerId: null,
    ...overrides,
  };
}

/** A UsersService wired to a stub, with only the reads these paths make. */
function service(
  target: { id?: string; role?: string; dealer?: { id: string } | null } | null,
  options: { emailTaken?: boolean; otherSuperAdmins?: number } = {},
) {
  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id?: string; email?: string } }) => {
        if (where.email) return Promise.resolve(options.emailTaken ? { id: 'someone' } : null);
        return Promise.resolve(target);
      }),
      count: jest.fn(() => Promise.resolve(options.otherSuperAdmins ?? 1)),
      create: jest.fn((_args: unknown) => Promise.resolve({ id: 'new-user' })),
      update: jest.fn((_args: unknown) => Promise.resolve({})),
    },
    dealer: { findUnique: jest.fn(() => Promise.resolve(null)) },
    // These two are called to *build* the array handed to $transaction, so the
    // stub needs them even though nothing is executed.
    refreshToken: { updateMany: jest.fn((args: unknown) => args) },
    authToken: { updateMany: jest.fn((args: unknown) => args) },
    $transaction: jest.fn(() => Promise.resolve([])),
  };
  const audit = { record: jest.fn((_entry: unknown) => Promise.resolve()) };
  const users = new UsersService(prisma as never, audit as never);
  // The happy paths end by re-reading the account, which is not what is under
  // test here.
  jest.spyOn(users, 'getPublicUser').mockResolvedValue({ id: 'new-user' } as never);
  return { users, prisma, audit };
}

const NEW_USER = {
  email: 'new@vintrax.test',
  password: 'a-long-enough-password',
  firstName: 'New',
  lastName: 'Person',
  emailVerified: true,
} as const;

describe('assignableRoles', () => {
  it('lets a super admin assign anything, including another super admin', () => {
    expect(assignableRoles('SUPER_ADMIN')).toContain('SUPER_ADMIN');
    expect(assignableRoles('SUPER_ADMIN')).toContain('ADMIN');
    expect(assignableRoles('SUPER_ADMIN')).toContain('BUYER');
  });

  it('stops an admin minting a peer or a superior', () => {
    expect(canAssignRole('ADMIN', 'ADMIN')).toBe(false);
    expect(canAssignRole('ADMIN', 'SUPER_ADMIN')).toBe(false);
  });

  it('still lets an admin create the ordinary roles', () => {
    // The reason the rule is not "roles whose permissions you already hold":
    // ADMIN has no bid:place, and a subset rule would block creating a buyer.
    for (const role of ['BUYER', 'SELLER', 'DEALER', 'INSPECTOR'] as const) {
      expect(canAssignRole('ADMIN', role)).toBe(true);
    }
  });

  it('gives no one else any assignment power at all', () => {
    for (const role of ['BUYER', 'SELLER', 'DEALER', 'INSPECTOR'] as const) {
      expect(assignableRoles(role)).toHaveLength(0);
    }
  });
});

describe('canAdministerUser', () => {
  it('stops an admin acting on another administrator', () => {
    expect(canAdministerUser('ADMIN', 'ADMIN')).toBe(false);
    expect(canAdministerUser('ADMIN', 'SUPER_ADMIN')).toBe(false);
    expect(canAdministerUser('ADMIN', 'BUYER')).toBe(true);
  });

  it('lets a super admin act on anyone', () => {
    expect(canAdministerUser('SUPER_ADMIN', 'SUPER_ADMIN')).toBe(true);
  });
});

describe('createUser', () => {
  it('refuses an admin creating a super admin', async () => {
    const { users, prisma } = service(null);

    await expect(
      users.createUser({ ...NEW_USER, role: 'SUPER_ADMIN' }, actor()),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Refused before anything was written, not after.
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('refuses an admin creating another admin', async () => {
    const { users } = service(null);

    await expect(users.createUser({ ...NEW_USER, role: 'ADMIN' }, actor())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets a super admin create an admin', async () => {
    const { users, prisma } = service(null);

    await users.createUser({ ...NEW_USER, role: 'ADMIN' }, actor({ role: 'SUPER_ADMIN' }));

    expect(prisma.user.create).toHaveBeenCalled();
  });

  it('hashes the password rather than storing it', async () => {
    const { users, prisma } = service(null);

    await users.createUser({ ...NEW_USER, role: 'BUYER' }, actor());

    const written = prisma.user.create.mock.calls[0]![0] as {
      data: { passwordHash: string; password?: string };
    };
    expect(written.data.password).toBeUndefined();
    expect(written.data.passwordHash).not.toContain(NEW_USER.password);
    // bcrypt at the cost the auth service uses.
    expect(written.data.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('rejects an email that is already taken', async () => {
    const { users } = service(null, { emailTaken: true });

    await expect(users.createUser({ ...NEW_USER, role: 'BUYER' }, actor())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('creates the dealership alongside a dealer account', async () => {
    const { users, prisma } = service(null);

    await users.createUser(
      { ...NEW_USER, role: 'DEALER', dealershipName: 'North Shore Motors' },
      actor(),
    );

    const written = prisma.user.create.mock.calls[0]![0] as {
      data: { dealer?: { create: { name: string; slug: string } } };
    };
    expect(written.data.dealer?.create.name).toBe('North Shore Motors');
    expect(written.data.dealer?.create.slug).toBe('north-shore-motors');
  });
});

describe('updateRole', () => {
  it("refuses to change the caller's own role", async () => {
    const { users, prisma } = service({ id: 'actor-1', role: 'ADMIN' });

    await expect(
      users.updateRole('actor-1', { role: 'SUPER_ADMIN' }, actor({ role: 'SUPER_ADMIN' })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses an admin promoting somebody to super admin', async () => {
    const { users } = service({ id: 'target', role: 'BUYER', dealer: null });

    await expect(
      users.updateRole('target', { role: 'SUPER_ADMIN' }, actor()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('hides another administrator behind a 404 rather than a 403', async () => {
    const { users } = service({ id: 'target', role: 'ADMIN', dealer: null });

    // Refusing with 403 would confirm the account exists and is an admin.
    await expect(users.updateRole('target', { role: 'BUYER' }, actor())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses to demote the last active super admin', async () => {
    const { users } = service(
      { id: 'target', role: 'SUPER_ADMIN', dealer: null },
      { otherSuperAdmins: 0 },
    );

    await expect(
      users.updateRole('target', { role: 'ADMIN' }, actor({ role: 'SUPER_ADMIN' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows demoting a super admin while another one remains', async () => {
    const { users, prisma } = service(
      { id: 'target', role: 'SUPER_ADMIN', dealer: null },
      { otherSuperAdmins: 1 },
    );

    await users.updateRole('target', { role: 'ADMIN' }, actor({ role: 'SUPER_ADMIN' }));

    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('refuses to promote into DEALER when there is no dealership', async () => {
    const { users } = service({ id: 'target', role: 'BUYER', dealer: null });

    await expect(users.updateRole('target', { role: 'DEALER' }, actor())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('setPassword', () => {
  const NEW_PASSWORD = 'a-new-long-password';

  it('refuses to set the caller\'s own password', async () => {
    const { users, prisma } = service({ id: 'actor-1', role: 'SUPER_ADMIN' });

    // Otherwise this endpoint is a way around the current-password check that
    // PATCH /auth/password exists to enforce.
    await expect(
      users.setPassword('actor-1', { password: NEW_PASSWORD }, actor({ role: 'SUPER_ADMIN' })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('hides another administrator behind a 404 rather than a 403', async () => {
    const { users, prisma } = service({ id: 'target', role: 'ADMIN' });

    // An admin resetting a peer's password would be a one-request takeover.
    await expect(
      users.setPassword('target', { password: NEW_PASSWORD }, actor()),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses an admin reaching a super admin's account", async () => {
    const { users } = service({ id: 'target', role: 'SUPER_ADMIN' });

    await expect(
      users.setPassword('target', { password: NEW_PASSWORD }, actor()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s on an account that does not exist', async () => {
    const { users } = service(null);

    await expect(
      users.setPassword('missing', { password: NEW_PASSWORD }, actor()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stores a bcrypt hash at the cost the auth service uses', async () => {
    const { users, prisma } = service({ id: 'target', role: 'BUYER' });

    await users.setPassword('target', { password: NEW_PASSWORD }, actor());

    const written = prisma.user.update.mock.calls[0]![0] as {
      where: { id: string };
      data: { passwordHash: string; password?: string };
    };
    expect(written.where.id).toBe('target');
    expect(written.data.password).toBeUndefined();
    expect(written.data.passwordHash).not.toContain(NEW_PASSWORD);
    expect(written.data.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('ends the account\'s live sessions', async () => {
    const { users, prisma } = service({ id: 'target', role: 'BUYER' });

    await users.setPassword('target', { password: NEW_PASSWORD }, actor());

    // Leaving an intruder's refresh token working defeats the reset.
    const revoked = prisma.refreshToken.updateMany.mock.calls[0]![0] as {
      where: { userId: string; revokedAt: null };
      data: { revokedAt: Date };
    };
    expect(revoked.where.userId).toBe('target');
    expect(revoked.where.revokedAt).toBeNull();
    expect(revoked.data.revokedAt).toBeInstanceOf(Date);
  });

  it('consumes any outstanding password-reset link', async () => {
    const { users, prisma } = service({ id: 'target', role: 'BUYER' });

    await users.setPassword('target', { password: NEW_PASSWORD }, actor());

    // A link mailed before this would otherwise overwrite what was just set.
    const consumed = prisma.authToken.updateMany.mock.calls[0]![0] as {
      where: { userId: string; type: string; consumedAt: null };
      data: { consumedAt: Date };
    };
    expect(consumed.where).toMatchObject({
      userId: 'target',
      type: 'PASSWORD_RESET',
      consumedAt: null,
    });
    expect(consumed.data.consumedAt).toBeInstanceOf(Date);
  });

  it('records the reason in the audit trail and never the password', async () => {
    const { users, audit } = service({ id: 'target', role: 'BUYER' });

    await users.setPassword(
      'target',
      { password: NEW_PASSWORD, reason: 'Lost access to their mailbox' },
      actor(),
    );

    const entry = audit.record.mock.calls[0]![0] as {
      action: string;
      actorId: string;
      entityId: string;
      metadata: { reason: string | null };
    };
    expect(entry.action).toBe('user.password_set_by_admin');
    expect(entry.actorId).toBe('actor-1');
    expect(entry.entityId).toBe('target');
    expect(entry.metadata.reason).toBe('Lost access to their mailbox');
    expect(JSON.stringify(entry)).not.toContain(NEW_PASSWORD);
  });
});

describe('updateStatus', () => {
  it('refuses to let an administrator suspend themselves', async () => {
    const { users, prisma } = service({ id: 'actor-1', role: 'ADMIN' });

    await expect(
      users.updateStatus('actor-1', { status: 'SUSPENDED' }, actor({ role: 'SUPER_ADMIN' })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

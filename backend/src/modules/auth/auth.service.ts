import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type {
  AuthResponse,
  AuthTokens,
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from '@vintrax/shared';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { AuditService } from '../../common/audit/audit.service';
import type {
  AccessTokenPayload,
  AuthUser,
  RefreshTokenPayload,
} from '../../common/auth/auth-user';
import type { Env } from '../../config/env';
import { UsersService } from '../users/users.service';

const BCRYPT_ROUNDS = 12;
const EMAIL_VERIFICATION_TTL_HOURS = 24;
const PASSWORD_RESET_TTL_MINUTES = 60;

/** A bcrypt hash of an impossible password, for constant-time login failure. */
const DUMMY_HASH = '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';

export interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async register(input: RegisterInput, context: RequestContext = {}): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        // Accounts start ACTIVE but unverified; verification gates the actions
        // that carry financial consequence rather than sign-in itself.
        status: 'ACTIVE',
        phone: input.phone ?? null,
        province: input.province ?? null,
        city: input.city ?? null,
        // A dealer account without its dealership is a meaningless half-state,
        // so both rows are created in one write.
        ...(input.role === 'DEALER' && input.dealershipName
          ? {
              dealer: {
                create: {
                  name: input.dealershipName,
                  slug: await this.users.uniqueDealerSlug(input.dealershipName),
                  businessNumber: input.businessNumber ?? null,
                  licenceNumber: input.licenceNumber ?? null,
                  province: input.province ?? null,
                  city: input.city ?? null,
                },
              },
            }
          : {}),
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });

    await this.issueEmailVerification(user.id, user.email, user.firstName);

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.register',
      entityType: 'User',
      entityId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { role: input.role },
    });

    const tokens = await this.issueTokens(user.id, user.email, user.role, context);
    return { ...tokens, user: await this.users.getPublicUser(user.id) };
  }

  async login(input: LoginInput, context: RequestContext = {}): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        passwordHash: true,
      },
    });

    // Compare against a dummy hash when the user is missing, so a bad email and
    // a bad password take about the same time to answer.
    const passwordMatches = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status === 'SUSPENDED') {
      throw new UnauthorizedException('This account is suspended. Contact support.');
    }
    if (user.status === 'DEACTIVATED') {
      throw new UnauthorizedException('This account has been deactivated');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const tokens = await this.issueTokens(user.id, user.email, user.role, context);
    return { ...tokens, user: await this.users.getPublicUser(user.id) };
  }

  /**
   * Rotates a refresh token: the presented one is revoked and a fresh pair
   * issued. Reusing an already-revoked token revokes the whole family, which
   * turns a stolen token into a detectable, self-limiting event.
   */
  async refresh(refreshToken: string, context: RequestContext = {}): Promise<AuthResponse> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, revokedAt: true, expiresAt: true },
    });

    if (!stored) throw new UnauthorizedException('Invalid or expired refresh token');

    if (stored.revokedAt) {
      this.logger.warn(
        `Replay of a revoked refresh token for user ${stored.userId}; revoking all sessions`,
      );
      await this.revokeAllForUser(stored.userId);
      await this.audit.record({
        actorId: stored.userId,
        actorEmail: null,
        action: 'auth.refresh_token_replay',
        entityType: 'User',
        entityId: stored.userId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedException('Refresh token has already been used');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, status: true },
    });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    if (user.status === 'DEACTIVATED' || user.status === 'SUSPENDED') {
      throw new UnauthorizedException('This account is not active');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(user.id, user.email, user.role, context);
    return { ...tokens, user: await this.users.getPublicUser(user.id) };
  }

  /** Revokes the presented refresh token. Unknown tokens succeed silently. */
  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(user: AuthUser, input: ChangePasswordInput): Promise<void> {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });

    const matches = await bcrypt.compare(input.currentPassword, record.passwordHash);
    if (!matches) throw new BadRequestException('Current password is incorrect');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS) },
    });

    // Changing a password ends every other session — that is the point of it.
    await this.revokeAllForUser(user.id);

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.password_changed',
      entityType: 'User',
      entityId: user.id,
    });
  }

  /**
   * Starts a password reset. Always resolves, whether or not the address is
   * registered, so this endpoint cannot be used to enumerate accounts.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, firstName: true },
    });
    if (!user) return;

    const { token, tokenHash } = this.generateToken();

    await this.prisma.authToken.create({
      data: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
      },
    });

    await this.mail.sendPasswordReset(user.email, token, user.firstName);
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const tokenHash = this.hashToken(input.token);
    const record = await this.prisma.authToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, type: true, expiresAt: true, consumedAt: true },
    });

    if (
      !record ||
      record.type !== 'PASSWORD_RESET' ||
      record.consumedAt ||
      record.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException('This reset link is invalid or has expired');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS) },
      }),
      this.prisma.authToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      // Anyone holding a session from before the reset loses it.
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      actorId: record.userId,
      actorEmail: null,
      action: 'auth.password_reset',
      entityType: 'User',
      entityId: record.userId,
    });
  }

  async verifyEmail(token: string): Promise<void> {
    const tokenHash = this.hashToken(token);
    const record = await this.prisma.authToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, type: true, expiresAt: true, consumedAt: true },
    });

    if (
      !record ||
      record.type !== 'EMAIL_VERIFICATION' ||
      record.consumedAt ||
      record.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException('This verification link is invalid or has expired');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerified: true, emailVerifiedAt: new Date() },
      }),
      this.prisma.authToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
    ]);
  }

  async resendVerification(user: AuthUser): Promise<void> {
    if (user.emailVerified) throw new BadRequestException('This email is already verified');
    await this.issueEmailVerification(user.id, user.email, user.firstName);
  }

  private async issueEmailVerification(
    userId: string,
    email: string,
    firstName: string,
  ): Promise<void> {
    // Supersede any outstanding verification so only the newest link works.
    await this.prisma.authToken.updateMany({
      where: { userId, type: 'EMAIL_VERIFICATION', consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const { token, tokenHash } = this.generateToken();
    await this.prisma.authToken.create({
      data: {
        userId,
        type: 'EMAIL_VERIFICATION',
        tokenHash,
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000),
      },
    });

    await this.mail.sendEmailVerification(email, token, firstName);
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    userId: string,
    email: string,
    role: AuthUser['role'],
    context: RequestContext,
  ): Promise<AuthTokens> {
    const accessPayload: AccessTokenPayload = { sub: userId, email, role };
    const accessTtl = this.config.get('JWT_ACCESS_TTL', { infer: true });

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      // @nestjs/jwt types this as a literal duration union; the value is a
      // validated env string, so the cast is at the boundary, not in the schema.
      expiresIn: accessTtl as unknown as number,
    });

    const refreshPayload: RefreshTokenPayload = { sub: userId, jti: randomUUID() };
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_REFRESH_TTL', { infer: true }) as unknown as number,
    });

    const decoded = this.jwt.decode(refreshToken) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
    });

    const accessDecoded = this.jwt.decode(accessToken) as { exp?: number } | null;
    const expiresIn = accessDecoded?.exp
      ? Math.max(0, accessDecoded.exp - Math.floor(Date.now() / 1000))
      : 900;

    return { accessToken, refreshToken, expiresIn };
  }

  /** Returns the raw token for the user and the digest to store. */
  private generateToken(): { token: string; tokenHash: string } {
    const token = randomBytes(48).toString('base64url');
    return { token, tokenHash: this.hashToken(token) };
  }

  /**
   * SHA-256 rather than bcrypt: these tokens are already high-entropy random,
   * and an unsalted digest is what makes the stored value directly queryable.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

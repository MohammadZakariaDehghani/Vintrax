import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthResponse, AuthTokens, LoginInput, RegisterInput } from '@atlas/shared';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import type {
  AccessTokenPayload,
  AuthUser,
  RefreshTokenPayload,
} from '../../common/auth/auth-user';
import type { Env } from '../../config/env';
import { UsersService } from '../users/users.service';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly users: UsersService,
  ) {}

  async register(input: RegisterInput): Promise<AuthResponse> {
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
        displayName: input.displayName,
        role: input.role,
        phone: input.phone ?? null,
        province: input.province ?? null,
        city: input.city ?? null,
        // A dealer account is meaningless without its dealership, so both rows
        // are created in one transaction by nesting the write.
        ...(input.role === 'DEALER' && input.dealershipName
          ? { dealership: { create: { name: input.dealershipName } } }
          : {}),
      },
      select: { id: true, email: true, displayName: true, role: true },
    });

    const tokens = await this.issueTokens(user);
    return { ...tokens, user: await this.users.getPublicUser(user.id) };
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true, displayName: true, role: true, passwordHash: true },
    });

    // Compare against a dummy hash when the user is missing so that a bad email
    // and a bad password take about the same time to answer.
    const passwordMatches = await bcrypt.compare(
      input.password,
      user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin',
    );

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.issueTokens({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    });
    return { ...tokens, user: await this.users.getPublicUser(user.id) };
  }

  /**
   * Rotates a refresh token: the presented token is revoked and a fresh pair is
   * issued. Reusing an already-revoked token revokes the whole family, which
   * turns a stolen token into a detectable, self-limiting event.
   */
  async refresh(refreshToken: string): Promise<AuthResponse> {
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
      throw new UnauthorizedException('Refresh token has already been used');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, displayName: true, role: true },
    });
    if (!user) throw new UnauthorizedException('Account no longer exists');

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(user);
    return { ...tokens, user: await this.users.getPublicUser(user.id) };
  }

  /** Revokes the presented refresh token. Unknown tokens succeed silently. */
  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(user: AuthUser): Promise<AuthTokens> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    });

    const refreshPayload: RefreshTokenPayload = { sub: user.id, jti: randomUUID() };
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_REFRESH_TTL', { infer: true }),
    });

    // Persist only a digest: a database leak then yields nothing replayable.
    const decoded = this.jwt.decode(refreshToken) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: this.hashToken(refreshToken), expiresAt },
    });

    return { accessToken, refreshToken };
  }

  /**
   * SHA-256 rather than bcrypt: the token is already high-entropy random, and an
   * unsalted digest is what makes the stored value directly queryable.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

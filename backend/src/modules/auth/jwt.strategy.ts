import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AccessTokenPayload, AuthUser } from '../../common/auth/auth-user';
import type { Env } from '../../config/env';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Tokens are only ever signed with HS256 (JwtModule's default); refusing
      // every other algorithm closes off algorithm-confusion attacks.
      algorithms: ['HS256'],
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  /**
   * Re-reads the user on every request so a deleted account, a suspension, or a
   * role change takes effect immediately rather than lingering until the token
   * expires. Costs one indexed lookup.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        emailVerified: true,
        dealer: { select: { id: true } },
      },
    });

    if (!user) throw new UnauthorizedException('Account no longer exists');
    if (user.status === 'DEACTIVATED') {
      throw new UnauthorizedException('This account has been deactivated');
    }
    // Suspension revokes refresh tokens, but an access token already issued
    // would otherwise keep working on routes that ask for no permission (the
    // profile, favourites, …) until it expired. A 401 makes the client try to
    // refresh, which fails, and it signs out. Public routes are unaffected:
    // JwtAuthGuard treats them as anonymous.
    if (user.status === 'SUSPENDED') {
      throw new UnauthorizedException('This account is suspended');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
      dealerId: user.dealer?.id ?? null,
    };
  }
}

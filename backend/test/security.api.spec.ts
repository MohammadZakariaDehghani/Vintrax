import { Controller, Get, type INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import type { AuthUser } from '../src/common/auth/auth-user';
import { CurrentUser, Public, RequirePermissions, Roles } from '../src/common/decorators';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { parseCorsOrigins } from '../src/config/env';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { UsersService } from '../src/modules/users/users.service';

/**
 * The request pipeline an attacker actually meets: the global guards in the
 * order AppModule installs them (JWT → permissions → throttle), the real JWT
 * strategy, the auth controller's validation and throttles, and the CORS
 * policy from main.ts. Only the database and the auth service are stand-ins.
 */

const ACCESS_SECRET = 'test-access-secret-at-least-32-characters';
const ALLOWED_ORIGIN = 'https://vintrax.example';

type Status = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
const users = new Map<string, { role: string; status: Status }>([
  ['buyer', { role: 'BUYER', status: 'ACTIVE' }],
  ['dealer', { role: 'DEALER', status: 'ACTIVE' }],
  ['admin', { role: 'ADMIN', status: 'ACTIVE' }],
  ['suspended', { role: 'DEALER', status: 'SUSPENDED' }],
]);

@Controller('probe')
class ProbeController {
  @Public()
  @Get('open')
  open(@CurrentUser() user?: AuthUser) {
    return { viewer: user?.id ?? null };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return { id: user.id };
  }

  @Get('admin')
  @RequirePermissions('user:manage')
  admin() {
    return { ok: true };
  }

  @Get('dealer')
  @Roles('DEALER')
  dealer() {
    return { ok: true };
  }
}

describe('the API request pipeline', () => {
  let app: INestApplication;
  const jwt = new JwtService({});
  const sign = (sub: string, options: Record<string, unknown> = {}) =>
    jwt.sign(
      { sub, email: `${sub}@example.test`, role: users.get(sub)?.role ?? 'BUYER' },
      {
        secret: ACCESS_SECRET,
        expiresIn: '5m',
        ...options,
      },
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [() => ({ JWT_ACCESS_SECRET: ACCESS_SECRET })],
        }),
        PassportModule,
        JwtModule.register({}),
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
      ],
      controllers: [ProbeController, AuthController],
      providers: [
        JwtStrategy,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: async ({ where }: { where: { id: string } }) => {
                const row = users.get(where.id);
                return row
                  ? {
                      id: where.id,
                      email: `${where.id}@example.test`,
                      firstName: 'Test',
                      lastName: 'User',
                      emailVerified: true,
                      dealer: null,
                      ...row,
                    }
                  : null;
              },
            },
          },
        },
        {
          provide: AuthService,
          useValue: {
            login: async () => {
              throw new UnauthorizedException('Invalid email or password');
            },
            register: async (input: unknown) => ({ registered: input }),
          },
        },
        { provide: UsersService, useValue: {} },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableCors({ origin: parseCorsOrigins(`${ALLOWED_ORIGIN}, `), credentials: true });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, token?: string) => {
    const req = request(app.getHttpServer()).get(`/api/probe/${path}`);
    return token ? req.set('authorization', `Bearer ${token}`) : req;
  };

  describe('authentication', () => {
    it('refuses a protected route without a token', async () => {
      await get('me').expect(401);
    });

    it('accepts a valid HS256 token', async () => {
      await get('me', sign('buyer')).expect(200, { id: 'buyer' });
    });

    it('refuses a token signed with another secret', async () => {
      await get('me', jwt.sign({ sub: 'admin' }, { secret: 'someone-elses-secret-value' })).expect(
        401,
      );
    });

    it('refuses an unsigned token (alg "none")', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(
        JSON.stringify({ sub: 'admin', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 60 }),
      ).toString('base64url');
      await get('me', `${header}.${body}.`).expect(401);
    });

    it('refuses the right secret under any algorithm but HS256', async () => {
      await get('me', sign('buyer', { algorithm: 'HS512' })).expect(401);
    });

    it('refuses an expired token', async () => {
      await get('me', sign('buyer', { expiresIn: -10 })).expect(401);
    });

    it('refuses a token for an account suspended after it was issued', async () => {
      await get('me', sign('suspended')).expect(401);
    });

    it('treats a bad token on a public route as an anonymous visitor, not an error', async () => {
      await get('open', 'not-a-token').expect(200, { viewer: null });
      await get('open', sign('dealer')).expect(200, { viewer: 'dealer' });
    });
  });

  describe('authorisation', () => {
    it('keeps administrator routes from buyers and dealers', async () => {
      await get('admin', sign('buyer')).expect(403);
      await get('admin', sign('dealer')).expect(403);
      await get('admin', sign('admin')).expect(200);
    });

    it('keeps dealer routes from buyers', async () => {
      await get('dealer', sign('buyer')).expect(403);
      await get('dealer', sign('dealer')).expect(200);
    });

    it('takes the role from the database, not from the token', async () => {
      // A buyer's token claiming ADMIN is still a buyer: the strategy re-reads the account.
      const forged = jwt.sign(
        { sub: 'buyer', email: 'buyer@example.test', role: 'ADMIN' },
        { secret: ACCESS_SECRET, expiresIn: '5m' },
      );
      await get('admin', forged).expect(403);
    });
  });

  describe('registration', () => {
    it('does not let anyone register as an administrator', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .set('x-forwarded-for', '203.0.113.50')
        .send({
          email: 'new@example.test',
          password: 'a long enough password 1!',
          firstName: 'New',
          lastName: 'Person',
          role: 'ADMIN',
        })
        .expect(400);
    });
  });

  describe('rate limiting', () => {
    it('allows 10 sign-in attempts a minute from one address, then answers 429', async () => {
      const attempt = () =>
        request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: 'dealer@example.test', password: 'wrong password' });
      for (let i = 0; i < 10; i++) await attempt().expect(401);
      const limited = await attempt().expect(429);
      expect(limited.headers['retry-after']).toBeDefined();
    });
  });

  describe('CORS', () => {
    it('lets the configured site call the API with credentials', async () => {
      const response = await get('open').set('origin', ALLOWED_ORIGIN).expect(200);
      expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('gives any other site no permission to read the response', async () => {
      const response = await get('open').set('origin', 'https://evil.example').expect(200);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('does not approve a preflight from another site', async () => {
      const response = await request(app.getHttpServer())
        .options('/api/probe/me')
        .set('origin', 'https://evil.example')
        .set('access-control-request-method', 'GET')
        .set('access-control-request-headers', 'authorization');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});

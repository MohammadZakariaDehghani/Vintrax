import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type AuthResponse,
  type PublicUser,
  loginSchema,
  refreshSchema,
  registerSchema,
} from '@atlas/shared';
import { CurrentUser, Public } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  // Credential endpoints get a tighter budget than the global default.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Create an account and receive a token pair' })
  register(@Body(zodBody(registerSchema)) body: unknown): Promise<AuthResponse> {
    return this.auth.register(body as Parameters<AuthService['register']>[0]);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange credentials for a token pair' })
  login(@Body(zodBody(loginSchema)) body: unknown): Promise<AuthResponse> {
    return this.auth.login(body as Parameters<AuthService['login']>[0]);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token for a new token pair' })
  refresh(@Body(zodBody(refreshSchema)) body: { refreshToken: string }): Promise<AuthResponse> {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  async logout(@Body(zodBody(refreshSchema)) body: { refreshToken: string }): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @ApiOperation({ summary: 'Return the authenticated user' })
  me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.users.getPublicUser(user.id);
  }
}

import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type AuthResponse,
  type ChangePasswordInput,
  type LoginInput,
  type PublicUser,
  type RegisterInput,
  type ResetPasswordInput,
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@atlas/shared';
import type { Request } from 'express';
import { ClientIp, CurrentUser, Public } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

/** Credential endpoints get a tighter budget than the global default. */
const CREDENTIAL_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Throttle(CREDENTIAL_THROTTLE)
  @Post('register')
  @ApiOperation({ summary: 'Create an account and receive a token pair' })
  register(
    @Body(zodBody(registerSchema)) body: RegisterInput,
    @ClientIp() ipAddress: string,
    @Req() request: Request,
  ): Promise<AuthResponse> {
    return this.auth.register(body, {
      ipAddress,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Public()
  @Throttle(CREDENTIAL_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange credentials for a token pair' })
  login(
    @Body(zodBody(loginSchema)) body: LoginInput,
    @ClientIp() ipAddress: string,
    @Req() request: Request,
  ): Promise<AuthResponse> {
    return this.auth.login(body, {
      ipAddress,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token for a new token pair' })
  refresh(
    @Body(zodBody(refreshSchema)) body: { refreshToken: string },
    @ClientIp() ipAddress: string,
  ): Promise<AuthResponse> {
    return this.auth.refresh(body.refreshToken, { ipAddress });
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

  @Patch('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change the password, ending all other sessions' })
  async changePassword(
    @Body(zodBody(changePasswordSchema)) body: ChangePasswordInput,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.auth.changePassword(user, body);
  }

  @Public()
  @Throttle(CREDENTIAL_THROTTLE)
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start a password reset',
    description:
      'Always returns 202 whether or not the address is registered, so this endpoint cannot be used to enumerate accounts.',
  })
  async forgotPassword(
    @Body(zodBody(requestPasswordResetSchema)) body: { email: string },
  ): Promise<{ message: string }> {
    await this.auth.requestPasswordReset(body.email);
    return { message: 'If that address has an account, a reset link is on its way.' };
  }

  @Public()
  @Throttle(CREDENTIAL_THROTTLE)
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Complete a password reset' })
  async resetPassword(
    @Body(zodBody(resetPasswordSchema)) body: ResetPasswordInput,
  ): Promise<void> {
    await this.auth.resetPassword(body);
  }

  @Public()
  @Post('email/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirm an email address' })
  async verifyEmail(@Body(zodBody(verifyEmailSchema)) body: { token: string }): Promise<void> {
    await this.auth.verifyEmail(body.token);
  }

  @Throttle(CREDENTIAL_THROTTLE)
  @Post('email/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send a fresh verification email' })
  async resendVerification(@CurrentUser() user: AuthUser): Promise<{ message: string }> {
    await this.auth.resendVerification(user);
    return { message: 'Verification email sent.' };
  }
}

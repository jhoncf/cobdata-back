import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public, CurrentUser, AllowMustReset, Audit } from '../common/decorators';
import { AuthenticatedUser } from '../common/interfaces';
import { AuthService } from './auth.service';
import { RateLimitService } from './services/rate-limit.service';
import { TokenService, REFRESH_TOKEN_COOKIE_NAME } from './services/token.service';
import { ActivateDto } from './dto/activate.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { SessionResponseDto } from './dto/session-response.dto';

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly rateLimitService: RateLimitService,
    private readonly tokenService: TokenService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'AUTH_LOGIN_SUCCESS', resourceType: 'Auth' })
  @ApiOperation({ summary: 'User login', description: 'Authenticate with email and password to receive JWT tokens' })
  @ApiResponse({ status: 200, description: 'Login successful, returns access token' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  @ApiResponse({ status: 429, description: 'Too many login attempts' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const email = dto.email.toLowerCase();

    // 1. Check rate limit — if already blocked, return 429 immediately
    const rateLimitCheck = await this.rateLimitService.isBlocked(email);
    if (rateLimitCheck.blocked) {
      this.logger.warn(`Rate limit triggered for email: ${email}`);
      res.status(HttpStatus.TOO_MANY_REQUESTS).json({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many login attempts. Please try again later.',
        retryAfterSeconds: rateLimitCheck.retryAfterSeconds,
      });
      return undefined as any;
    }

    try {
      // 2. Attempt login
      const userAgent = req.headers['user-agent'] || undefined;
      const ipAddress =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        undefined;

      const result = await this.authService.login(dto, userAgent, ipAddress);

      // 3. Login successful — reset rate limit counter
      await this.rateLimitService.reset(email);

      // 4. Set refresh token in HttpOnly cookie
      const cookieOptions = this.tokenService.getRefreshTokenCookieOptions();
      res.cookie(REFRESH_TOKEN_COOKIE_NAME, result.refreshToken, cookieOptions);

      // 5. Return access token in response body
      return { accessToken: result.accessToken };
    } catch (error) {
      // 6. Login failed — increment rate limit counter
      if (error instanceof UnauthorizedException) {
        const incrementResult = await this.rateLimitService.checkAndIncrement(email);

        // If incrementing pushed us over the limit, return 429
        if (incrementResult.blocked) {
          this.logger.warn(
            `Rate limit triggered for email: ${email} (after failed attempt)`,
          );
          res.status(HttpStatus.TOO_MANY_REQUESTS).json({
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Too many login attempts. Please try again later.',
            retryAfterSeconds: incrementResult.retryAfterSeconds,
          });
          return undefined as any;
        }

        // Otherwise return generic 401
        throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
      }

      // Re-throw unexpected errors
      throw error;
    }
  }

  @Public()
  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate account', description: 'Activate a user account using the invitation token and set a password' })
  @ApiResponse({ status: 200, description: 'Account activated successfully' })
  @ApiResponse({ status: 410, description: 'Token expired or already used' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async activate(@Body() dto: ActivateDto): Promise<{ message: string }> {
    await this.authService.activate(dto);
    return { message: 'Account activated successfully' };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token', description: 'Rotate refresh token and issue a new access token via HttpOnly cookie' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    // 1. Read refresh token from cookie
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];

    // 2. If missing or empty → 401
    if (!refreshToken) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // 3. Call authService.refresh(refreshToken)
    const result = await this.authService.refresh(refreshToken);

    // 4. Set new refresh token cookie
    const cookieOptions = this.tokenService.getRefreshTokenCookieOptions();
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, result.refreshToken, cookieOptions);

    // 5. Return new access token in response body
    return { accessToken: result.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'AUTH_LOGOUT', resourceType: 'Auth' })
  @ApiOperation({ summary: 'Logout', description: 'Invalidate the current session and clear refresh token cookie' })
  @ApiResponse({ status: 204, description: 'Logged out successfully' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // 1. Read refresh token from cookie
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];

    // 2. If token present, attempt to revoke the session
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    // 3. Clear the refresh token cookie
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, this.tokenService.getClearCookieOptions());
  }

  @ApiBearerAuth('bearer')
  @AllowMustReset()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'AUTH_PASSWORD_CHANGE', resourceType: 'Auth' })
  @ApiOperation({ summary: 'Change password', description: 'Change the current user password (also allowed for mustResetPassword users)' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized or incorrect current password' })
  @ApiResponse({ status: 422, description: 'Validation error (password complexity)' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.changePassword(user.id, user.sessionId, dto);
    return { message: 'Password changed successfully' };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request password reset', description: 'Send a password reset email (always returns 202 to avoid email enumeration)' })
  @ApiResponse({ status: 202, description: 'Reset email sent if the account exists' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.authService.forgotPassword(dto.email);
    return { message: 'If the email exists, a reset link has been sent' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password', description: 'Set a new password using the reset token received via email' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 410, description: 'Token expired or already used' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.authService.resetPassword(dto);
    return { message: 'Password reset successfully' };
  }

  @ApiBearerAuth('bearer')
  @Get('me')
  @ApiOperation({ summary: 'Get current user info', description: 'Returns current user profile, role and scopes' })
  @ApiResponse({ status: 200, description: 'Current user information' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@CurrentUser() user: AuthenticatedUser): Promise<MeResponseDto> {
    return this.authService.getMe(user.id);
  }

  @ApiBearerAuth('bearer')
  @Get('sessions')
  @ApiOperation({ summary: 'List active sessions', description: 'Returns all active sessions for the current user' })
  @ApiResponse({ status: 200, description: 'List of active sessions' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getSessions(@CurrentUser() user: AuthenticatedUser): Promise<SessionResponseDto[]> {
    return this.authService.getSessions(user.id, user.sessionId);
  }

  @ApiBearerAuth('bearer')
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a session', description: 'Invalidate a specific session by ID (cannot revoke current session)' })
  @ApiResponse({ status: 204, description: 'Session revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Cannot revoke current session' })
  async revokeSession(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.authService.revokeSession(user.id, sessionId, user.sessionId);
  }

  @ApiBearerAuth('bearer')
  @Delete('sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke all other sessions', description: 'Invalidate all sessions except the current one' })
  @ApiResponse({ status: 204, description: 'All other sessions revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async revokeAllSessions(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.revokeAllSessions(user.id, user.sessionId);
  }
}

import {
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
  ConflictException,
  NotFoundException,
  GoneException,
  Logger,
} from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './services/password.service';
import { PasswordResetService } from './services/password-reset.service';
import { SessionService } from './services/session.service';
import { TokenService } from './services/token.service';
import { ActivateDto } from './dto/activate.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { EmailService } from '../common/email';

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid or expired refresh token';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly passwordResetService: PasswordResetService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Authenticate a user by email and password.
   * Creates a session and returns tokens.
   * Throws UnauthorizedException with a generic message for all failure cases.
   * If user has mustResetPassword=true, issues a restricted token.
   */
  async login(
    dto: LoginDto,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<LoginResult> {
    // Find user by email (case-insensitive)
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    // User not found — generic 401
    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    // User is inactive — generic 401
    if (!user.isActive) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    // User has no password set (pending invite activation)
    if (!user.passwordHash) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    // Verify password
    const isPasswordValid = await this.passwordService.verify(
      user.passwordHash,
      dto.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    // Generate refresh token
    const { token: refreshToken, hash: refreshTokenHash } =
      this.tokenService.generateRefreshToken();

    // Create session (expires in 7 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const session = await this.sessionService.create({
      userId: user.id,
      refreshTokenHash,
      userAgent,
      ipAddress,
      expiresAt,
    });

    // Generate access token — include mustResetPassword flag if user must reset
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      accountId: user.accountId,
      role: user.role,
      sessionId: session.id,
      mustResetPassword: user.mustResetPassword || undefined,
    });

    this.logger.log(`User ${user.id} logged in successfully`);

    return { accessToken, refreshToken };
  }

  /**
   * Refresh an access token using a valid refresh token.
   * Implements refresh token rotation with reuse detection.
   *
   * Flow:
   * 1. Hash incoming refresh token
   * 2. Find session by hash
   * 3. If session is revoked → reuse detection: invalidate entire token family
   * 4. If session is expired → 401
   * 5. Generate new refresh token, rotate session
   * 6. Generate new access token
   * 7. Return new token pair
   */
  async refresh(refreshTokenFromCookie: string): Promise<LoginResult> {
    // 1. Hash the incoming refresh token
    const incomingHash = this.tokenService.hashRefreshToken(refreshTokenFromCookie);

    // 2. Find session by refreshTokenHash
    const session = await this.sessionService.findByRefreshTokenHash(incomingHash);

    if (!session) {
      // Token not recognized (could be already rotated = reuse attempt on unknown token)
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    // 3. Check if session is revoked → REUSE DETECTION
    if (session.isRevoked) {
      // This token was already used and the session was revoked.
      // This means someone is replaying a previously-used token.
      // Invalidate the entire token family for security.
      this.logger.warn(
        `Refresh token reuse detected for token family: ${session.tokenFamily}. Invalidating family.`,
      );
      await this.sessionService.revokeByTokenFamily(session.tokenFamily);
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    // 4. Check if session is expired
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    // 5. Load user to get current role/accountId
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });

    if (!user || !user.isActive) {
      // User was deactivated between token issuance and refresh
      await this.sessionService.revoke(session.id);
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    // 6. Generate new refresh token
    const { token: newRefreshToken, hash: newRefreshTokenHash } =
      this.tokenService.generateRefreshToken();

    // 7. Rotate: update session with new hash + lastUsedAt
    await this.sessionService.rotateToken(session.id, newRefreshTokenHash);

    // 8. Generate new access token — preserve mustResetPassword flag
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      accountId: user.accountId,
      role: user.role,
      sessionId: session.id,
      mustResetPassword: user.mustResetPassword || undefined,
    });

    this.logger.log(`Token refreshed for user ${user.id}`);

    return { accessToken, refreshToken: newRefreshToken };
  }

  /**
   * Logout: revoke the session associated with the given refresh token.
   * Silently succeeds if token is not found or session is already revoked.
   */
  async logout(refreshTokenFromCookie: string): Promise<void> {
    // 1. Hash the refresh token
    const hash = this.tokenService.hashRefreshToken(refreshTokenFromCookie);

    // 2. Find session by hash
    const session = await this.sessionService.findByRefreshTokenHash(hash);

    // 3. If session found and not already revoked → revoke it
    if (session && !session.isRevoked) {
      await this.sessionService.revoke(session.id);
      this.logger.log(`Session ${session.id} revoked (logout)`);
    }
  }

  /**
   * Activate a user account via invite token.
   * Validates token (not expired, not already used), validates password complexity,
   * sets password hash, activates user, and marks invite as ACCEPTED.
   * (Requirements 4.2, 4.3)
   */
  async activate(dto: ActivateDto): Promise<void> {
    // 1. Find invite by token
    const invite = await this.prisma.invite.findUnique({
      where: { token: dto.token },
    });

    // 2. If not found or expired or already accepted → 410 Gone
    if (!invite || invite.status !== 'PENDING' || invite.expiresAt < new Date()) {
      throw new GoneException('Invite link is no longer valid');
    }

    // 3. Validate password complexity
    const complexityError = this.passwordService.validateComplexity(dto.password);
    if (complexityError) {
      throw new UnprocessableEntityException(complexityError);
    }

    // 4. Hash password
    const passwordHash = await this.passwordService.hash(dto.password);

    // 5. Activate user: set passwordHash, isActive=true
    await this.prisma.user.update({
      where: { id: invite.userId },
      data: { passwordHash, isActive: true },
    });

    // 6. Mark invite as ACCEPTED
    await this.prisma.invite.update({
      where: { id: invite.id },
      data: { status: 'ACCEPTED' },
    });

    this.logger.log(`User ${invite.userId} activated via invite ${invite.id}`);
  }

  /**
   * Change password for the authenticated user.
   * Verifies current password, validates new password complexity,
   * updates hash, clears mustResetPassword flag, and invalidates
   * all sessions except the current one.
   */
  async changePassword(userId: string, sessionId: string, dto: ChangePasswordDto): Promise<void> {
    // 1. Find user by ID
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 2. Verify current password
    const isValid = await this.passwordService.verify(user.passwordHash, dto.currentPassword);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 3. Validate new password complexity
    const complexityError = this.passwordService.validateComplexity(dto.newPassword);
    if (complexityError) {
      throw new UnprocessableEntityException(complexityError);
    }

    // 4. Hash new password
    const newHash = await this.passwordService.hash(dto.newPassword);

    // 5. Update password in DB and clear mustResetPassword flag
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash, mustResetPassword: false },
    });

    // 6. Invalidate all sessions except current
    await this.sessionService.revokeAllExcept(userId, sessionId);

    this.logger.log(`Password changed for user ${userId}`);
  }

  /**
   * Forgot password: generate a reset token and store it in Redis.
   * ALWAYS returns silently to avoid leaking whether an email exists.
   * (Requirement 5.3)
   */
  async forgotPassword(email: string): Promise<void> {
    // 1. Find user by email (case-insensitive)
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // 2. If user exists and is active, generate reset token and store hash in Redis
    if (user && user.isActive) {
      const token = randomBytes(32).toString('base64url');
      const hash = createHash('sha256').update(token).digest('hex');

      // Store in Redis: key=`password-reset:${hash}`, value=user.id, TTL=3600 (1 hour)
      await this.passwordResetService.store(hash, user.id, 3600);

      try {
        await this.emailService.sendPasswordReset(user.email, token);
      } catch (error) {
        // Preserve the non-enumerating contract of this endpoint.
        this.logger.error(
          `Unable to send password reset email for user ${user.id}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    // 3. ALWAYS return silently — never reveal if email exists
  }

  /**
   * Reset password using a valid reset token.
   * Validates token, updates password hash, invalidates token, revokes ALL sessions.
   * (Requirements 5.4, 5.5)
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    // 1. Hash the token to look up in Redis
    const hash = createHash('sha256').update(dto.token).digest('hex');

    // 2. Look up userId from Redis via PasswordResetService
    const userId = await this.passwordResetService.get(hash);

    // 3. If not found (expired or already used) → HTTP 410 Gone
    if (!userId) {
      throw new GoneException('Reset link is no longer valid');
    }

    // 4. Validate new password complexity
    const complexityError = this.passwordService.validateComplexity(dto.newPassword);
    if (complexityError) {
      throw new UnprocessableEntityException(complexityError);
    }

    // 5. Hash new password
    const newHash = await this.passwordService.hash(dto.newPassword);

    // 6. Update user password + clear mustResetPassword flag
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash, mustResetPassword: false },
    });

    // 7. Invalidate the token (delete from Redis) — single-use
    await this.passwordResetService.delete(hash);

    // 8. Revoke ALL sessions for this user (user must log in again)
    await this.sessionService.revokeAll(userId);

    this.logger.log(`Password reset completed for user ${userId}`);
  }

  /**
   * Get current user profile from database.
   * Returns fresh data (not from JWT) so front-end always sees latest permissions.
   */
  async getMe(userId: string): Promise<MeResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        scopes: { select: { walletId: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      scopes: user.role === 'VIEWER' ? user.scopes.map((s) => s.walletId) : [],
    };
  }

  /**
   * List active sessions for a user, marking the current session.
   */
  async getSessions(userId: string, currentSessionId: string): Promise<SessionResponseDto[]> {
    const sessions = await this.sessionService.listActive(userId);
    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      isCurrent: s.id === currentSessionId,
    }));
  }

  /**
   * Revoke a specific session by ID.
   * If the sessionId is the current session, throw ConflictException (409).
   * If the session is not found or belongs to another user, throw NotFoundException (404).
   */
  async revokeSession(userId: string, sessionId: string, currentSessionId: string): Promise<void> {
    if (sessionId === currentSessionId) {
      throw new ConflictException('Cannot revoke current session. Use POST /auth/logout instead.');
    }

    const session = await this.sessionService.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Session not found');
    }

    await this.sessionService.revoke(sessionId);
  }

  /**
   * Revoke all sessions for a user except the current one.
   */
  async revokeAllSessions(userId: string, currentSessionId: string): Promise<void> {
    await this.sessionService.revokeAllExcept(userId, currentSessionId);
  }
}

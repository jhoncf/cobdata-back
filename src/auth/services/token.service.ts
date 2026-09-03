import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash } from 'crypto';

export const REFRESH_TOKEN_COOKIE_NAME = 'cobdata_refresh_token';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Generate an AccessToken JWT with ONLY the specified payload fields.
   * The JwtModule is already configured with secret + expiresIn from env.
   * Resulting JWT contains: sub, accountId, role, sessionId, iat, exp.
   * For restricted tokens (mustResetPassword=true), the field is included.
   */
  generateAccessToken(payload: {
    sub: string;
    accountId: string;
    creditorId?: string | null;
    role: string;
    sessionId: string;
    mustResetPassword?: boolean;
  }): string {
    // Only include mustResetPassword in the JWT if it's true
    const jwtPayload: Record<string, unknown> = {
      sub: payload.sub,
      accountId: payload.accountId,
      role: payload.role,
      sessionId: payload.sessionId,
    };

    if (payload.creditorId) jwtPayload.creditorId = payload.creditorId;

    if (payload.mustResetPassword) {
      jwtPayload.mustResetPassword = true;
    }

    return this.jwtService.sign(jwtPayload);
  }

  /**
   * Generate an opaque RefreshToken (random bytes, base64url encoded).
   * Also returns the SHA-256 hash to store in the Session table.
   */
  generateRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    return { token, hash };
  }

  /**
   * Hash a refresh token for comparison during validation.
   */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Get cookie options for the refresh token cookie.
   * HttpOnly, Secure, SameSite based on NODE_ENV.
   */
  getRefreshTokenCookieOptions(): {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    path: string;
    maxAge: number;
  } {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const isProduction = nodeEnv === 'production';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    };
  }

  /**
   * Get cookie options for clearing the refresh token cookie on logout.
   */
  getClearCookieOptions(): {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    path: string;
  } {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const isProduction = nodeEnv === 'production';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/api/auth',
    };
  }
}

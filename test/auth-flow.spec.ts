import { UnauthorizedException } from '@nestjs/common';
import { AuthService, LoginResult } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { PasswordResetService } from '../src/auth/services/password-reset.service';
import { SessionService } from '../src/auth/services/session.service';
import { TokenService } from '../src/auth/services/token.service';

/**
 * Integration Test: Auth Flow (Login → Refresh → Logout)
 *
 * **Validates: Requirements 1.1, 2.1, 2.3**
 *
 * Tests the complete authentication flow using mocked Prisma + Redis:
 * - Login with valid credentials → returns accessToken + refreshToken
 * - Refresh with valid token → returns new accessToken + rotated refreshToken
 * - Logout → session revoked
 * - Login → Refresh → Refresh → Logout chain works end-to-end
 */
describe('Integration: Auth Flow (Login → Refresh → Logout)', () => {
  let authService: AuthService;
  let mockPrisma: {
    user: { findUnique: jest.Mock };
    session: { create: jest.Mock; findFirst: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  };
  let mockPasswordService: { verify: jest.Mock; hash: jest.Mock; validateComplexity: jest.Mock };
  let mockPasswordResetService: { store: jest.Mock; get: jest.Mock; delete: jest.Mock };
  let mockSessionService: {
    create: jest.Mock;
    findByRefreshTokenHash: jest.Mock;
    rotateToken: jest.Mock;
    revoke: jest.Mock;
    revokeByTokenFamily: jest.Mock;
    revokeAllExcept: jest.Mock;
    revokeAll: jest.Mock;
    listActive: jest.Mock;
    findById: jest.Mock;
  };
  let mockTokenService: {
    generateAccessToken: jest.Mock;
    generateRefreshToken: jest.Mock;
    hashRefreshToken: jest.Mock;
    getRefreshTokenCookieOptions: jest.Mock;
    getClearCookieOptions: jest.Mock;
  };

  const mockUser = {
    id: 'user-uuid-1',
    accountId: 'account-uuid-1',
    email: 'admin@cobdata.com',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$hash',
    role: 'ADMIN',
    isActive: true,
    mustResetPassword: false,
  };

  beforeEach(() => {
    mockPrisma = {
      user: { findUnique: jest.fn() },
      session: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    mockPasswordService = {
      verify: jest.fn(),
      hash: jest.fn(),
      validateComplexity: jest.fn(),
    };

    mockPasswordResetService = {
      store: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
    };

    mockSessionService = {
      create: jest.fn(),
      findByRefreshTokenHash: jest.fn(),
      rotateToken: jest.fn(),
      revoke: jest.fn(),
      revokeByTokenFamily: jest.fn(),
      revokeAllExcept: jest.fn(),
      revokeAll: jest.fn(),
      listActive: jest.fn(),
      findById: jest.fn(),
    };

    mockTokenService = {
      generateAccessToken: jest.fn(),
      generateRefreshToken: jest.fn(),
      hashRefreshToken: jest.fn(),
      getRefreshTokenCookieOptions: jest.fn(),
      getClearCookieOptions: jest.fn(),
    };

    authService = new AuthService(
      mockPrisma as unknown as PrismaService,
      mockPasswordService as unknown as PasswordService,
      mockPasswordResetService as unknown as PasswordResetService,
      mockSessionService as unknown as SessionService,
      mockTokenService as unknown as TokenService,
    );
  });

  describe('Login with valid credentials', () => {
    it('should return accessToken and refreshToken on successful login', async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPasswordService.verify.mockResolvedValue(true);
      mockTokenService.generateRefreshToken.mockReturnValue({
        token: 'refresh-token-opaque',
        hash: 'refresh-token-hash-sha256',
      });
      mockSessionService.create.mockResolvedValue({
        id: 'session-uuid-1',
        userId: mockUser.id,
        tokenFamily: 'family-uuid-1',
        refreshTokenHash: 'refresh-token-hash-sha256',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      });
      mockTokenService.generateAccessToken.mockReturnValue('jwt-access-token');

      // Act
      const result: LoginResult = await authService.login(
        { email: 'admin@cobdata.com', password: 'SecurePass1' },
        'Mozilla/5.0',
        '127.0.0.1',
      );

      // Assert
      expect(result.accessToken).toBe('jwt-access-token');
      expect(result.refreshToken).toBe('refresh-token-opaque');
      expect(mockSessionService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUser.id,
          refreshTokenHash: 'refresh-token-hash-sha256',
          userAgent: 'Mozilla/5.0',
          ipAddress: '127.0.0.1',
        }),
      );
      expect(mockTokenService.generateAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: mockUser.id,
          accountId: mockUser.accountId,
          role: mockUser.role,
          sessionId: 'session-uuid-1',
        }),
      );
    });

    it('should throw UnauthorizedException for invalid credentials', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPasswordService.verify.mockResolvedValue(false);

      await expect(
        authService.login({ email: 'admin@cobdata.com', password: 'WrongPass1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for inactive user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, isActive: false });

      await expect(
        authService.login({ email: 'admin@cobdata.com', password: 'SecurePass1' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Refresh with valid token', () => {
    it('should return new accessToken and rotated refreshToken', async () => {
      const existingSession = {
        id: 'session-uuid-1',
        userId: mockUser.id,
        tokenFamily: 'family-uuid-1',
        refreshTokenHash: 'old-hash',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        lastUsedAt: new Date(),
      };

      // Arrange
      mockTokenService.hashRefreshToken.mockReturnValue('old-hash');
      mockSessionService.findByRefreshTokenHash.mockResolvedValue(existingSession);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockTokenService.generateRefreshToken.mockReturnValue({
        token: 'new-refresh-token',
        hash: 'new-refresh-hash',
      });
      mockSessionService.rotateToken.mockResolvedValue(undefined);
      mockTokenService.generateAccessToken.mockReturnValue('new-access-token');

      // Act
      const result = await authService.refresh('old-refresh-token');

      // Assert
      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(mockSessionService.rotateToken).toHaveBeenCalledWith('session-uuid-1', 'new-refresh-hash');
    });

    it('should throw UnauthorizedException for expired session', async () => {
      const expiredSession = {
        id: 'session-uuid-1',
        userId: mockUser.id,
        tokenFamily: 'family-uuid-1',
        refreshTokenHash: 'hash',
        isRevoked: false,
        expiresAt: new Date(Date.now() - 1000), // expired
        createdAt: new Date(),
      };

      mockTokenService.hashRefreshToken.mockReturnValue('hash');
      mockSessionService.findByRefreshTokenHash.mockResolvedValue(expiredSession);

      await expect(authService.refresh('expired-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for unknown token', async () => {
      mockTokenService.hashRefreshToken.mockReturnValue('unknown-hash');
      mockSessionService.findByRefreshTokenHash.mockResolvedValue(null);

      await expect(authService.refresh('unknown-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Logout', () => {
    it('should revoke session when valid refresh token provided', async () => {
      const activeSession = {
        id: 'session-uuid-1',
        userId: mockUser.id,
        tokenFamily: 'family-uuid-1',
        refreshTokenHash: 'hash',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      mockTokenService.hashRefreshToken.mockReturnValue('hash');
      mockSessionService.findByRefreshTokenHash.mockResolvedValue(activeSession);
      mockSessionService.revoke.mockResolvedValue(undefined);

      // Act
      await authService.logout('valid-refresh-token');

      // Assert
      expect(mockSessionService.revoke).toHaveBeenCalledWith('session-uuid-1');
    });

    it('should silently succeed when token is not found', async () => {
      mockTokenService.hashRefreshToken.mockReturnValue('unknown-hash');
      mockSessionService.findByRefreshTokenHash.mockResolvedValue(null);

      // Should not throw
      await expect(authService.logout('unknown-token')).resolves.toBeUndefined();
    });

    it('should silently succeed when session is already revoked', async () => {
      const revokedSession = {
        id: 'session-uuid-1',
        userId: mockUser.id,
        isRevoked: true,
      };

      mockTokenService.hashRefreshToken.mockReturnValue('hash');
      mockSessionService.findByRefreshTokenHash.mockResolvedValue(revokedSession);

      // Should not throw and should NOT call revoke again
      await expect(authService.logout('revoked-token')).resolves.toBeUndefined();
      expect(mockSessionService.revoke).not.toHaveBeenCalled();
    });
  });

  describe('Full flow: Login → Refresh → Refresh → Logout', () => {
    it('should complete the full session lifecycle', async () => {
      // Step 1: Login
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPasswordService.verify.mockResolvedValue(true);
      mockTokenService.generateRefreshToken.mockReturnValueOnce({
        token: 'refresh-token-1',
        hash: 'hash-1',
      });
      mockSessionService.create.mockResolvedValue({
        id: 'session-1',
        userId: mockUser.id,
        tokenFamily: 'family-1',
        refreshTokenHash: 'hash-1',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      });
      mockTokenService.generateAccessToken.mockReturnValueOnce('access-1');

      const loginResult = await authService.login(
        { email: 'admin@cobdata.com', password: 'SecurePass1' },
      );
      expect(loginResult.accessToken).toBe('access-1');
      expect(loginResult.refreshToken).toBe('refresh-token-1');

      // Step 2: First Refresh
      mockTokenService.hashRefreshToken.mockReturnValueOnce('hash-1');
      mockSessionService.findByRefreshTokenHash.mockResolvedValueOnce({
        id: 'session-1',
        userId: mockUser.id,
        tokenFamily: 'family-1',
        refreshTokenHash: 'hash-1',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        lastUsedAt: new Date(),
      });
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);
      mockTokenService.generateRefreshToken.mockReturnValueOnce({
        token: 'refresh-token-2',
        hash: 'hash-2',
      });
      mockSessionService.rotateToken.mockResolvedValueOnce(undefined);
      mockTokenService.generateAccessToken.mockReturnValueOnce('access-2');

      const refresh1Result = await authService.refresh('refresh-token-1');
      expect(refresh1Result.accessToken).toBe('access-2');
      expect(refresh1Result.refreshToken).toBe('refresh-token-2');
      expect(mockSessionService.rotateToken).toHaveBeenCalledWith('session-1', 'hash-2');

      // Step 3: Second Refresh
      mockTokenService.hashRefreshToken.mockReturnValueOnce('hash-2');
      mockSessionService.findByRefreshTokenHash.mockResolvedValueOnce({
        id: 'session-1',
        userId: mockUser.id,
        tokenFamily: 'family-1',
        refreshTokenHash: 'hash-2',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        lastUsedAt: new Date(),
      });
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);
      mockTokenService.generateRefreshToken.mockReturnValueOnce({
        token: 'refresh-token-3',
        hash: 'hash-3',
      });
      mockSessionService.rotateToken.mockResolvedValueOnce(undefined);
      mockTokenService.generateAccessToken.mockReturnValueOnce('access-3');

      const refresh2Result = await authService.refresh('refresh-token-2');
      expect(refresh2Result.accessToken).toBe('access-3');
      expect(refresh2Result.refreshToken).toBe('refresh-token-3');

      // Step 4: Logout
      mockTokenService.hashRefreshToken.mockReturnValueOnce('hash-3');
      mockSessionService.findByRefreshTokenHash.mockResolvedValueOnce({
        id: 'session-1',
        userId: mockUser.id,
        tokenFamily: 'family-1',
        refreshTokenHash: 'hash-3',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      mockSessionService.revoke.mockResolvedValueOnce(undefined);

      await authService.logout('refresh-token-3');
      expect(mockSessionService.revoke).toHaveBeenCalledWith('session-1');
    });
  });
});

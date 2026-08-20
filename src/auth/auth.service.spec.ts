// @ts-nocheck
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, UnprocessableEntityException, GoneException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './services/password.service';
import { PasswordResetService } from './services/password-reset.service';
import { SessionService } from './services/session.service';
import { TokenService } from './services/token.service';
import { EmailService } from '../common/email';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let passwordResetService: PasswordResetService;
  let sessionService: SessionService;
  let tokenService: TokenService;

  const mockUser = {
    id: 'user-uuid-1',
    accountId: 'account-uuid-1',
    email: 'user@example.com',
    passwordHash: 'hashed-password',
    name: 'Test User',
    role: 'ADMIN',
    isActive: true,
    mustResetPassword: false,
    twoFactorSecret: null,
    twoFactorEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSession = {
    id: 'session-uuid-1',
    userId: 'user-uuid-1',
    tokenFamily: 'family-uuid-1',
    refreshTokenHash: 'hash-value',
    userAgent: 'Mozilla/5.0',
    ipAddress: '127.0.0.1',
    isRevoked: false,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    lastUsedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            invite: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: PasswordService,
          useValue: {
            verify: jest.fn(),
            validateComplexity: jest.fn(),
            hash: jest.fn(),
          },
        },
        {
          provide: PasswordResetService,
          useValue: {
            store: jest.fn(),
            get: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: SessionService,
          useValue: {
            create: jest.fn(),
            findByRefreshTokenHash: jest.fn(),
            findById: jest.fn(),
            listActive: jest.fn(),
            rotateToken: jest.fn(),
            revoke: jest.fn(),
            revokeByTokenFamily: jest.fn(),
            revokeAllExcept: jest.fn(),
            revokeAll: jest.fn(),
          },
        },
        {
          provide: TokenService,
          useValue: {
            generateAccessToken: jest.fn().mockReturnValue('mock-access-token'),
            generateRefreshToken: jest.fn().mockReturnValue({
              token: 'mock-refresh-token',
              hash: 'mock-token-hash',
            }),
            hashRefreshToken: jest.fn().mockReturnValue('hashed-incoming-token'),
          },
        },
        {
          provide: EmailService,
          useValue: {
            sendPasswordReset: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    passwordService = module.get<PasswordService>(PasswordService);
    passwordResetService = module.get<PasswordResetService>(PasswordResetService);
    sessionService = module.get<SessionService>(SessionService);
    tokenService = module.get<TokenService>(TokenService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    const loginDto = { email: 'user@example.com', password: 'ValidPass1' };

    it('should return accessToken and refreshToken on successful login', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (passwordService.verify as jest.Mock).mockResolvedValue(true);
      (sessionService.create as jest.Mock).mockResolvedValue(mockSession);

      const result = await service.login(loginDto, 'Mozilla/5.0', '127.0.0.1');

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user is inactive', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (passwordService.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should search for user with lowercase email', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const uppercaseDto = { email: 'USER@EXAMPLE.COM', password: 'pass' };
      try {
        await service.login(uppercaseDto);
      } catch {}

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
      });
    });
  });

  describe('activate', () => {
    const mockInvite = {
      id: 'invite-uuid-1',
      userId: 'user-uuid-1',
      token: 'valid-invite-token',
      role: 'OPERATIONAL',
      scopes: null,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72h from now
      createdAt: new Date(),
    };

    it('should activate user and mark invite as ACCEPTED with valid token and password', async () => {
      (prisma.invite.findUnique as jest.Mock).mockResolvedValue(mockInvite);
      (passwordService.validateComplexity as jest.Mock).mockReturnValue(null);
      (passwordService.hash as jest.Mock).mockResolvedValue('argon2-hashed-password');
      (prisma.user.update as jest.Mock).mockResolvedValue(mockUser);
      (prisma.invite.update as jest.Mock).mockResolvedValue({ ...mockInvite, status: 'ACCEPTED' });

      await service.activate({ token: 'valid-invite-token', password: 'StrongPass1' });

      // Verify user was activated
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { passwordHash: 'argon2-hashed-password', isActive: true },
      });

      // Verify invite was marked ACCEPTED
      expect(prisma.invite.update).toHaveBeenCalledWith({
        where: { id: 'invite-uuid-1' },
        data: { status: 'ACCEPTED' },
      });
    });

    it('should throw GoneException (410) when token is not found', async () => {
      (prisma.invite.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.activate({ token: 'nonexistent-token', password: 'StrongPass1' }),
      ).rejects.toThrow(GoneException);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.invite.update).not.toHaveBeenCalled();
    });

    it('should throw GoneException (410) when token is expired', async () => {
      const expiredInvite = {
        ...mockInvite,
        expiresAt: new Date(Date.now() - 1000), // 1 second in the past
      };
      (prisma.invite.findUnique as jest.Mock).mockResolvedValue(expiredInvite);

      await expect(
        service.activate({ token: 'expired-token', password: 'StrongPass1' }),
      ).rejects.toThrow(GoneException);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.invite.update).not.toHaveBeenCalled();
    });

    it('should throw GoneException (410) when invite is already ACCEPTED', async () => {
      const usedInvite = { ...mockInvite, status: 'ACCEPTED' };
      (prisma.invite.findUnique as jest.Mock).mockResolvedValue(usedInvite);

      await expect(
        service.activate({ token: 'used-token', password: 'StrongPass1' }),
      ).rejects.toThrow(GoneException);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.invite.update).not.toHaveBeenCalled();
    });

    it('should throw UnprocessableEntityException (422) when password is weak', async () => {
      (prisma.invite.findUnique as jest.Mock).mockResolvedValue(mockInvite);
      (passwordService.validateComplexity as jest.Mock).mockReturnValue(
        'Password must be at least 8 characters long',
      );

      await expect(
        service.activate({ token: 'valid-invite-token', password: 'weak' }),
      ).rejects.toThrow(UnprocessableEntityException);

      // User should NOT be activated on password failure
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.invite.update).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('should not throw and return void when email exists', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(service.forgotPassword('user@example.com')).resolves.toBeUndefined();
    });

    it('should not throw and return void when email does NOT exist', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.forgotPassword('nonexistent@example.com')).resolves.toBeUndefined();
    });

    it('should store a reset token when user exists and is active', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await service.forgotPassword('user@example.com');

      expect(passwordResetService.store).toHaveBeenCalledWith(
        expect.any(String), // SHA-256 hash
        mockUser.id,
        3600, // 1 hour TTL
      );
    });

    it('should NOT store a reset token when user does not exist', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await service.forgotPassword('nonexistent@example.com');

      expect(passwordResetService.store).not.toHaveBeenCalled();
    });

    it('should NOT store a reset token when user is inactive', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await service.forgotPassword('inactive@example.com');

      expect(passwordResetService.store).not.toHaveBeenCalled();
    });

    it('should search for user with lowercase email', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await service.forgotPassword('USER@EXAMPLE.COM');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
      });
    });

    it('should store token with 1-hour TTL (3600 seconds)', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await service.forgotPassword('user@example.com');

      expect(passwordResetService.store).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        3600,
      );
    });
  });

  describe('resetPassword', () => {
    const validDto = { token: 'valid-reset-token-base64url', newPassword: 'NewSecure1' };

    it('should update password, delete token, and revoke all sessions on valid token + valid password', async () => {
      (passwordResetService.get as jest.Mock).mockResolvedValue('user-uuid-1');
      (passwordService.validateComplexity as jest.Mock).mockReturnValue(null);
      (passwordService.hash as jest.Mock).mockResolvedValue('new-argon2-hash');
      (prisma.user.update as jest.Mock).mockResolvedValue(mockUser);
      (passwordResetService.delete as jest.Mock).mockResolvedValue(undefined);
      (sessionService.revokeAll as jest.Mock).mockResolvedValue(undefined);

      await service.resetPassword(validDto);

      // Verify password was updated
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { passwordHash: 'new-argon2-hash', mustResetPassword: false },
      });

      // Verify token was deleted (single-use)
      expect(passwordResetService.delete).toHaveBeenCalledWith(expect.any(String));

      // Verify ALL sessions were revoked
      expect(sessionService.revokeAll).toHaveBeenCalledWith('user-uuid-1');
    });

    it('should throw GoneException (410) when token is not found (expired or used)', async () => {
      (passwordResetService.get as jest.Mock).mockResolvedValue(null);

      await expect(service.resetPassword(validDto)).rejects.toThrow(GoneException);

      // Verify no password update occurred
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(sessionService.revokeAll).not.toHaveBeenCalled();
    });

    it('should throw UnprocessableEntityException (422) when password is weak', async () => {
      const weakDto = { token: 'valid-reset-token', newPassword: 'weak' };
      (passwordResetService.get as jest.Mock).mockResolvedValue('user-uuid-1');
      (passwordService.validateComplexity as jest.Mock).mockReturnValue(
        'Password must be at least 8 characters long',
      );

      await expect(service.resetPassword(weakDto)).rejects.toThrow(
        UnprocessableEntityException,
      );

      // Token should NOT be consumed on password validation failure
      expect(passwordResetService.delete).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('should hash the token with SHA-256 before looking up in Redis', async () => {
      (passwordResetService.get as jest.Mock).mockResolvedValue(null);

      try {
        await service.resetPassword(validDto);
      } catch {}

      // The get method should receive a SHA-256 hash, not the raw token
      expect(passwordResetService.get).toHaveBeenCalledWith(expect.any(String));
      const calledWith = (passwordResetService.get as jest.Mock).mock.calls[0][0];
      // SHA-256 hex string is 64 characters
      expect(calledWith).toHaveLength(64);
      expect(calledWith).not.toBe(validDto.token);
    });

    it('should ensure token is single-use (second call with same token returns 410)', async () => {
      // First call: token is valid
      (passwordResetService.get as jest.Mock).mockResolvedValueOnce('user-uuid-1');
      (passwordService.validateComplexity as jest.Mock).mockReturnValue(null);
      (passwordService.hash as jest.Mock).mockResolvedValue('new-hash');
      (prisma.user.update as jest.Mock).mockResolvedValue(mockUser);

      await service.resetPassword(validDto);

      // After first call, token was deleted. Second call: token not found
      (passwordResetService.get as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.resetPassword(validDto)).rejects.toThrow(GoneException);
    });
  });

  describe('refresh', () => {
    const validRefreshToken = 'valid-refresh-token-base64url';

    it('should return new accessToken and refreshToken on valid refresh', async () => {
      (tokenService.hashRefreshToken as jest.Mock).mockReturnValue('hashed-incoming-token');
      (sessionService.findByRefreshTokenHash as jest.Mock).mockResolvedValue(mockSession);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.refresh(validRefreshToken);

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
    });

    it('should throw UnauthorizedException when token is not recognized', async () => {
      (tokenService.hashRefreshToken as jest.Mock).mockReturnValue('unknown-hash');
      (sessionService.findByRefreshTokenHash as jest.Mock).mockResolvedValue(null);

      await expect(service.refresh(validRefreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should invalidate token family and throw when session is revoked (reuse detection)', async () => {
      const revokedSession = { ...mockSession, isRevoked: true };
      (tokenService.hashRefreshToken as jest.Mock).mockReturnValue('hashed-incoming-token');
      (sessionService.findByRefreshTokenHash as jest.Mock).mockResolvedValue(revokedSession);

      await expect(service.refresh(validRefreshToken)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(sessionService.revokeByTokenFamily).toHaveBeenCalledWith(
        revokedSession.tokenFamily,
      );
    });

    it('should throw UnauthorizedException when session is expired', async () => {
      const expiredSession = {
        ...mockSession,
        expiresAt: new Date(Date.now() - 1000),
      };
      (tokenService.hashRefreshToken as jest.Mock).mockReturnValue('hashed-incoming-token');
      (sessionService.findByRefreshTokenHash as jest.Mock).mockResolvedValue(expiredSession);

      await expect(service.refresh(validRefreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    const refreshToken = 'valid-refresh-token';

    it('should revoke session when found and not already revoked', async () => {
      (tokenService.hashRefreshToken as jest.Mock).mockReturnValue('hashed-token');
      (sessionService.findByRefreshTokenHash as jest.Mock).mockResolvedValue(mockSession);

      await service.logout(refreshToken);

      expect(sessionService.revoke).toHaveBeenCalledWith(mockSession.id);
    });

    it('should silently succeed when session is not found', async () => {
      (tokenService.hashRefreshToken as jest.Mock).mockReturnValue('hashed-token');
      (sessionService.findByRefreshTokenHash as jest.Mock).mockResolvedValue(null);

      await expect(service.logout(refreshToken)).resolves.toBeUndefined();
      expect(sessionService.revoke).not.toHaveBeenCalled();
    });
  });

  describe('getMe', () => {
    it('should return user id, email, role, and empty scopes for ADMIN', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-uuid-1',
        email: 'admin@example.com',
        role: 'ADMIN',
        scopes: [{ walletId: 'wallet-1' }],
      });

      const result = await service.getMe('user-uuid-1');

      expect(result).toEqual({
        id: 'user-uuid-1',
        email: 'admin@example.com',
        role: 'ADMIN',
        scopes: [],
      });
    });

    it('should return walletIds in scopes for VIEWER', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-uuid-3',
        email: 'viewer@example.com',
        role: 'VIEWER',
        scopes: [{ walletId: 'wallet-1' }, { walletId: 'wallet-2' }],
      });

      const result = await service.getMe('user-uuid-3');

      expect(result).toEqual({
        id: 'user-uuid-3',
        email: 'viewer@example.com',
        role: 'VIEWER',
        scopes: ['wallet-1', 'wallet-2'],
      });
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getMe('nonexistent-id')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getSessions', () => {
    const mockSessions = [
      {
        id: 'session-uuid-1',
        userId: 'user-uuid-1',
        tokenFamily: 'family-1',
        refreshTokenHash: 'hash-1',
        userAgent: 'Mozilla/5.0 Chrome',
        ipAddress: '192.168.1.1',
        isRevoked: false,
        createdAt: new Date('2024-01-01'),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        lastUsedAt: new Date(),
      },
      {
        id: 'session-uuid-2',
        userId: 'user-uuid-1',
        tokenFamily: 'family-2',
        refreshTokenHash: 'hash-2',
        userAgent: 'Mozilla/5.0 Firefox',
        ipAddress: '10.0.0.1',
        isRevoked: false,
        createdAt: new Date('2024-01-02'),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        lastUsedAt: new Date(),
      },
    ];

    it('should return list of sessions with isCurrent flag', async () => {
      (sessionService.listActive as jest.Mock).mockResolvedValue(mockSessions);

      const result = await service.getSessions('user-uuid-1', 'session-uuid-1');

      expect(result).toHaveLength(2);
      expect(result[0].isCurrent).toBe(true);
      expect(result[1].isCurrent).toBe(false);
    });
  });

  describe('revokeSession', () => {
    it('should throw ConflictException when trying to revoke current session', async () => {
      await expect(
        service.revokeSession('user-uuid-1', 'current-session-id', 'current-session-id'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when session is not found', async () => {
      (sessionService.findById as jest.Mock).mockResolvedValue(null);

      await expect(
        service.revokeSession('user-uuid-1', 'nonexistent-session', 'current-session-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should revoke the session when valid and not current', async () => {
      (sessionService.findById as jest.Mock).mockResolvedValue({
        ...mockSession,
        id: 'other-session-id',
        userId: 'user-uuid-1',
      });

      await service.revokeSession('user-uuid-1', 'other-session-id', 'current-session-id');

      expect(sessionService.revoke).toHaveBeenCalledWith('other-session-id');
    });
  });

  describe('revokeAllSessions', () => {
    it('should call sessionService.revokeAllExcept with userId and currentSessionId', async () => {
      await service.revokeAllSessions('user-uuid-1', 'current-session-id');

      expect(sessionService.revokeAllExcept).toHaveBeenCalledWith(
        'user-uuid-1',
        'current-session-id',
      );
    });
  });
});

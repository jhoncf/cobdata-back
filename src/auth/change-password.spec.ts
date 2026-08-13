// @ts-nocheck
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './services/password.service';
import { SessionService } from './services/session.service';
import { TokenService } from './services/token.service';

describe('AuthService - changePassword', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let sessionService: SessionService;

  const mockUser = {
    id: 'user-uuid-1',
    accountId: 'account-uuid-1',
    email: 'user@example.com',
    passwordHash: 'hashed-old-password',
    name: 'Test User',
    role: 'ADMIN',
    isActive: true,
    mustResetPassword: false,
    twoFactorSecret: null,
    twoFactorEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
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
          },
        },
        {
          provide: PasswordService,
          useValue: {
            verify: jest.fn(),
            hash: jest.fn(),
            validateComplexity: jest.fn(),
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
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    passwordService = module.get<PasswordService>(PasswordService);
    sessionService = module.get<SessionService>(SessionService);
  });

  const changePasswordDto = {
    currentPassword: 'OldPass123',
    newPassword: 'NewPass456',
  };

  it('should successfully change password when current password is correct and new password is valid', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (passwordService.verify as jest.Mock).mockResolvedValue(true);
    (passwordService.validateComplexity as jest.Mock).mockReturnValue(null);
    (passwordService.hash as jest.Mock).mockResolvedValue('hashed-new-password');
    (prisma.user.update as jest.Mock).mockResolvedValue({ ...mockUser, passwordHash: 'hashed-new-password' });

    await service.changePassword('user-uuid-1', 'session-uuid-1', changePasswordDto);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-uuid-1' },
      data: { passwordHash: 'hashed-new-password', mustResetPassword: false },
    });
  });

  it('should invalidate all sessions except the current one on success', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (passwordService.verify as jest.Mock).mockResolvedValue(true);
    (passwordService.validateComplexity as jest.Mock).mockReturnValue(null);
    (passwordService.hash as jest.Mock).mockResolvedValue('hashed-new-password');
    (prisma.user.update as jest.Mock).mockResolvedValue(mockUser);

    await service.changePassword('user-uuid-1', 'session-uuid-1', changePasswordDto);

    expect(sessionService.revokeAllExcept).toHaveBeenCalledWith('user-uuid-1', 'session-uuid-1');
  });

  it('should clear mustResetPassword flag on success', async () => {
    const userWithMustReset = { ...mockUser, mustResetPassword: true };
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(userWithMustReset);
    (passwordService.verify as jest.Mock).mockResolvedValue(true);
    (passwordService.validateComplexity as jest.Mock).mockReturnValue(null);
    (passwordService.hash as jest.Mock).mockResolvedValue('hashed-new-password');
    (prisma.user.update as jest.Mock).mockResolvedValue(mockUser);

    await service.changePassword('user-uuid-1', 'session-uuid-1', changePasswordDto);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-uuid-1' },
      data: expect.objectContaining({ mustResetPassword: false }),
    });
  });

  it('should throw UnauthorizedException when current password is wrong', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (passwordService.verify as jest.Mock).mockResolvedValue(false);

    await expect(
      service.changePassword('user-uuid-1', 'session-uuid-1', changePasswordDto),
    ).rejects.toThrow(UnauthorizedException);

    await expect(
      service.changePassword('user-uuid-1', 'session-uuid-1', changePasswordDto),
    ).rejects.toThrow('Invalid credentials');
  });

  it('should throw UnauthorizedException when user is not found', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.changePassword('user-uuid-1', 'session-uuid-1', changePasswordDto),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when user has no password hash', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...mockUser, passwordHash: null });

    await expect(
      service.changePassword('user-uuid-1', 'session-uuid-1', changePasswordDto),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnprocessableEntityException when new password does not meet complexity', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (passwordService.verify as jest.Mock).mockResolvedValue(true);
    (passwordService.validateComplexity as jest.Mock).mockReturnValue(
      'Password must be at least 8 characters long',
    );

    await expect(
      service.changePassword('user-uuid-1', 'session-uuid-1', {
        currentPassword: 'OldPass123',
        newPassword: 'short',
      }),
    ).rejects.toThrow(UnprocessableEntityException);

    await expect(
      service.changePassword('user-uuid-1', 'session-uuid-1', {
        currentPassword: 'OldPass123',
        newPassword: 'short',
      }),
    ).rejects.toThrow('Password must be at least 8 characters long');
  });

  it('should not update password or revoke sessions when current password is wrong', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (passwordService.verify as jest.Mock).mockResolvedValue(false);

    try {
      await service.changePassword('user-uuid-1', 'session-uuid-1', changePasswordDto);
    } catch {}

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(sessionService.revokeAllExcept).not.toHaveBeenCalled();
  });

  it('should not update password or revoke sessions when new password fails complexity', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (passwordService.verify as jest.Mock).mockResolvedValue(true);
    (passwordService.validateComplexity as jest.Mock).mockReturnValue('Password too weak');

    try {
      await service.changePassword('user-uuid-1', 'session-uuid-1', changePasswordDto);
    } catch {}

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(sessionService.revokeAllExcept).not.toHaveBeenCalled();
  });

  it('should use generic error message for wrong current password (same as login)', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (passwordService.verify as jest.Mock).mockResolvedValue(false);

    try {
      await service.changePassword('user-uuid-1', 'session-uuid-1', changePasswordDto);
    } catch (e: any) {
      expect(e).toBeInstanceOf(UnauthorizedException);
      expect(e.message).toBe('Invalid credentials');
    }
  });
});

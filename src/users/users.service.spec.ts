import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/services/session.service';
import { Role } from '@prisma/client';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: jest.Mocked<PrismaService>;
  let sessionService: jest.Mocked<SessionService>;

  const mockTransaction = jest.fn();

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    invite: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    userScope: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: mockTransaction,
  };

  const mockSessionService = {
    revokeAll: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: SessionService,
          useValue: mockSessionService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get(PrismaService);
    sessionService = module.get(SessionService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('invite', () => {
    const accountId = 'account-uuid-123';
    const baseDto = {
      email: 'newuser@example.com',
      role: Role.OPERATIONAL,
    };

    it('should create a new user and invite when email does not exist', async () => {
      const createdUser = {
        id: 'user-uuid-1',
        accountId,
        email: 'newuser@example.com',
        role: Role.OPERATIONAL,
        isActive: false,
        passwordHash: null,
        name: null,
        mustResetPassword: false,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(createdUser);
      mockPrismaService.invite.create.mockResolvedValue({});

      const result = await service.invite(baseDto, accountId);

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'newuser@example.com' },
      });
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          accountId,
          email: 'newuser@example.com',
          role: Role.OPERATIONAL,
          isActive: false,
        },
      });
      expect(mockPrismaService.invite.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-uuid-1',
            role: Role.OPERATIONAL,
          }),
        }),
      );
      expect(result).toEqual({
        id: 'user-uuid-1',
        email: 'newuser@example.com',
        role: Role.OPERATIONAL,
        status: 'PENDING',
      });
    });

    it('should throw ConflictException if email belongs to an active user', async () => {
      const activeUser = {
        id: 'user-uuid-2',
        accountId,
        email: 'active@example.com',
        role: Role.ADMIN,
        isActive: true,
        passwordHash: 'hash',
        name: 'Active User',
        mustResetPassword: false,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(activeUser);

      await expect(
        service.invite({ email: 'active@example.com', role: Role.OPERATIONAL }, accountId),
      ).rejects.toThrow(ConflictException);

      expect(mockPrismaService.user.create).not.toHaveBeenCalled();
      expect(mockPrismaService.invite.create).not.toHaveBeenCalled();
    });

    it('should reuse existing inactive user and update role', async () => {
      const inactiveUser = {
        id: 'user-uuid-3',
        accountId,
        email: 'inactive@example.com',
        role: Role.VIEWER,
        isActive: false,
        passwordHash: null,
        name: null,
        mustResetPassword: false,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedUser = { ...inactiveUser, role: Role.ADMIN };

      mockPrismaService.user.findUnique.mockResolvedValue(inactiveUser);
      mockPrismaService.user.update.mockResolvedValue(updatedUser);
      mockPrismaService.invite.create.mockResolvedValue({});

      const result = await service.invite(
        { email: 'inactive@example.com', role: Role.ADMIN },
        accountId,
      );

      expect(mockPrismaService.user.create).not.toHaveBeenCalled();
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-3' },
        data: { role: Role.ADMIN },
      });
      expect(result).toEqual({
        id: 'user-uuid-3',
        email: 'inactive@example.com',
        role: Role.ADMIN,
        status: 'PENDING',
      });
    });

    it('should normalize email to lowercase', async () => {
      const createdUser = {
        id: 'user-uuid-4',
        accountId,
        email: 'uppercase@example.com',
        role: Role.OPERATIONAL,
        isActive: false,
        passwordHash: null,
        name: null,
        mustResetPassword: false,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(createdUser);
      mockPrismaService.invite.create.mockResolvedValue({});

      await service.invite(
        { email: 'UpperCase@Example.COM', role: Role.OPERATIONAL },
        accountId,
      );

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'uppercase@example.com' },
      });
    });

    it('should create invite with 72h expiration', async () => {
      const createdUser = {
        id: 'user-uuid-5',
        accountId,
        email: 'test@example.com',
        role: Role.OPERATIONAL,
        isActive: false,
        passwordHash: null,
        name: null,
        mustResetPassword: false,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(createdUser);
      mockPrismaService.invite.create.mockResolvedValue({});

      const now = Date.now();
      await service.invite(baseDto, accountId);

      const inviteCall = mockPrismaService.invite.create.mock.calls[0][0];
      const expiresAt = inviteCall.data.expiresAt as Date;
      const diffHours = (expiresAt.getTime() - now) / (1000 * 60 * 60);

      expect(diffHours).toBeGreaterThan(71.9);
      expect(diffHours).toBeLessThan(72.1);
    });

    it('should create UserScope records for VIEWER role with scopes', async () => {
      const createdUser = {
        id: 'user-uuid-6',
        accountId,
        email: 'viewer@example.com',
        role: Role.VIEWER,
        isActive: false,
        passwordHash: null,
        name: null,
        mustResetPassword: false,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(createdUser);
      mockPrismaService.invite.create.mockResolvedValue({});
      mockPrismaService.userScope.createMany.mockResolvedValue({ count: 2 });

      const scopes = ['wallet-id-1', 'wallet-id-2'];
      await service.invite(
        { email: 'viewer@example.com', role: Role.VIEWER, scopes },
        accountId,
      );

      expect(mockPrismaService.userScope.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 'user-uuid-6', walletId: 'wallet-id-1' },
          { userId: 'user-uuid-6', walletId: 'wallet-id-2' },
        ],
        skipDuplicates: true,
      });
    });
  });

  describe('list', () => {
    it('should return paginated list of users with computed status', async () => {
      const users = [
        {
          id: 'user-1',
          email: 'admin@test.com',
          name: 'Admin',
          role: Role.ADMIN,
          isActive: true,
          passwordHash: 'hashed',
          createdAt: new Date(),
          updatedAt: new Date(),
          scopes: [],
        },
        {
          id: 'user-2',
          email: 'pending@test.com',
          name: null,
          role: Role.OPERATIONAL,
          isActive: false,
          passwordHash: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          scopes: [],
        },
      ];

      mockPrismaService.user.findMany.mockResolvedValue(users);
      mockPrismaService.user.count.mockResolvedValue(2);

      const result = await service.list({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].status).toBe('ACTIVE');
      expect(result.data[1].status).toBe('PENDING');
      expect(result.data[0]).not.toHaveProperty('passwordHash');
    });
  });

  describe('update', () => {
    it('should throw NotFoundException when user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.update('non-existent-id', { role: Role.OPERATIONAL }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when deactivating the last active ADMIN', async () => {
      const lastAdmin = {
        id: 'admin-1',
        email: 'admin@test.com',
        name: 'Admin',
        role: Role.ADMIN,
        isActive: true,
        passwordHash: 'hashed',
        createdAt: new Date(),
        updatedAt: new Date(),
        scopes: [],
      };

      mockPrismaService.user.findUnique.mockResolvedValue(lastAdmin);
      mockPrismaService.user.count.mockResolvedValue(0);

      await expect(
        service.update('admin-1', { isActive: false }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('resendInvite', () => {
    it('should resend invite for a PENDING user', async () => {
      const pendingUser = {
        id: 'user-pending-1',
        accountId: 'account-1',
        email: 'pending@example.com',
        role: Role.OPERATIONAL,
        isActive: false,
        passwordHash: null,
        name: null,
        mustResetPassword: false,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(pendingUser);
      mockPrismaService.invite.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.invite.create.mockResolvedValue({});

      const result = await service.resendInvite('user-pending-1');

      expect(result).toEqual({
        message: 'Invite resent successfully',
        userId: 'user-pending-1',
        email: 'pending@example.com',
      });

      // Should invalidate old invites
      expect(mockPrismaService.invite.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-pending-1', status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });

      // Should create new invite with 72h expiry
      expect(mockPrismaService.invite.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-pending-1',
            role: Role.OPERATIONAL,
          }),
        }),
      );

      const inviteCall = mockPrismaService.invite.create.mock.calls[0][0];
      const expiresAt = inviteCall.data.expiresAt as Date;
      const diffHours = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(71.9);
      expect(diffHours).toBeLessThan(72.1);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.resendInvite('non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException for ACTIVE user (non-PENDING)', async () => {
      const activeUser = {
        id: 'user-active-1',
        accountId: 'account-1',
        email: 'active@example.com',
        role: Role.ADMIN,
        isActive: true,
        passwordHash: 'hashed-password',
        name: 'Active User',
        mustResetPassword: false,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(activeUser);

      await expect(
        service.resendInvite('user-active-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException for INACTIVE user (non-PENDING)', async () => {
      const inactiveUser = {
        id: 'user-inactive-1',
        accountId: 'account-1',
        email: 'inactive@example.com',
        role: Role.OPERATIONAL,
        isActive: false,
        passwordHash: 'hashed-password',
        name: 'Inactive User',
        mustResetPassword: false,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(inactiveUser);

      await expect(
        service.resendInvite('user-inactive-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('forceReset', () => {
    it('should force reset for an active user', async () => {
      const activeUser = {
        id: 'user-active-1',
        accountId: 'account-1',
        email: 'active@example.com',
        role: Role.OPERATIONAL,
        isActive: true,
        passwordHash: 'hashed-password',
        name: 'Active User',
        mustResetPassword: false,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(activeUser);
      mockPrismaService.user.update.mockResolvedValue({
        ...activeUser,
        mustResetPassword: true,
      });
      mockSessionService.revokeAll.mockResolvedValue(undefined);

      const result = await service.forceReset('user-active-1');

      expect(result).toEqual({
        message: 'Password reset forced successfully',
        userId: 'user-active-1',
        email: 'active@example.com',
      });

      // Should set mustResetPassword = true
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-active-1' },
        data: { mustResetPassword: true },
      });

      // Should revoke ALL sessions
      expect(mockSessionService.revokeAll).toHaveBeenCalledWith('user-active-1');
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.forceReset('non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException for inactive user', async () => {
      const inactiveUser = {
        id: 'user-inactive-1',
        accountId: 'account-1',
        email: 'inactive@example.com',
        role: Role.OPERATIONAL,
        isActive: false,
        passwordHash: 'hashed-password',
        name: 'Inactive User',
        mustResetPassword: false,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(inactiveUser);

      await expect(
        service.forceReset('user-inactive-1'),
      ).rejects.toThrow(ConflictException);

      expect(mockPrismaService.user.update).not.toHaveBeenCalled();
      expect(mockSessionService.revokeAll).not.toHaveBeenCalled();
    });

    it('should revoke all sessions when force resetting', async () => {
      const activeUser = {
        id: 'user-multi-session',
        accountId: 'account-1',
        email: 'multi@example.com',
        role: Role.ADMIN,
        isActive: true,
        passwordHash: 'hashed-password',
        name: 'Multi Session User',
        mustResetPassword: false,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(activeUser);
      mockPrismaService.user.update.mockResolvedValue({
        ...activeUser,
        mustResetPassword: true,
      });
      mockSessionService.revokeAll.mockResolvedValue(undefined);

      await service.forceReset('user-multi-session');

      expect(mockSessionService.revokeAll).toHaveBeenCalledWith('user-multi-session');
      expect(mockSessionService.revokeAll).toHaveBeenCalledTimes(1);
    });
  });
});

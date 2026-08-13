import { Test, TestingModule } from '@nestjs/testing';
import { SessionService } from './session.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('SessionService', () => {
  let service: SessionService;
  let prisma: PrismaService;

  const mockPrismaService = {
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should call prisma.session.create with correct data', async () => {
      const data = {
        userId: 'user-uuid-1',
        refreshTokenHash: 'abc123hash',
        userAgent: 'Mozilla/5.0',
        ipAddress: '192.168.1.1',
        expiresAt: new Date('2025-01-15T00:00:00Z'),
      };

      const expectedSession = {
        id: 'session-uuid-1',
        tokenFamily: 'family-uuid-1',
        isRevoked: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        ...data,
      };

      mockPrismaService.session.create.mockResolvedValue(expectedSession);

      const result = await service.create(data);

      expect(mockPrismaService.session.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(expectedSession);
    });

    it('should create session without optional fields', async () => {
      const data = {
        userId: 'user-uuid-1',
        refreshTokenHash: 'abc123hash',
        expiresAt: new Date('2025-01-15T00:00:00Z'),
      };

      const expectedSession = {
        id: 'session-uuid-1',
        tokenFamily: 'family-uuid-1',
        isRevoked: false,
        userAgent: null,
        ipAddress: null,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        ...data,
      };

      mockPrismaService.session.create.mockResolvedValue(expectedSession);

      const result = await service.create(data);

      expect(mockPrismaService.session.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(expectedSession);
    });
  });

  describe('findByTokenFamily', () => {
    it('should return session when found', async () => {
      const session = {
        id: 'session-uuid-1',
        userId: 'user-uuid-1',
        tokenFamily: 'family-uuid-1',
        refreshTokenHash: 'hash123',
        isRevoked: false,
        createdAt: new Date(),
        expiresAt: new Date(),
        lastUsedAt: new Date(),
      };

      mockPrismaService.session.findUnique.mockResolvedValue(session);

      const result = await service.findByTokenFamily('family-uuid-1');

      expect(mockPrismaService.session.findUnique).toHaveBeenCalledWith({
        where: { tokenFamily: 'family-uuid-1' },
      });
      expect(result).toEqual(session);
    });

    it('should return null when not found', async () => {
      mockPrismaService.session.findUnique.mockResolvedValue(null);

      const result = await service.findByTokenFamily('nonexistent-family');

      expect(mockPrismaService.session.findUnique).toHaveBeenCalledWith({
        where: { tokenFamily: 'nonexistent-family' },
      });
      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should return session when found', async () => {
      const session = {
        id: 'session-uuid-1',
        userId: 'user-uuid-1',
        tokenFamily: 'family-uuid-1',
        refreshTokenHash: 'hash123',
        isRevoked: false,
        createdAt: new Date(),
        expiresAt: new Date(),
        lastUsedAt: new Date(),
      };

      mockPrismaService.session.findUnique.mockResolvedValue(session);

      const result = await service.findById('session-uuid-1');

      expect(mockPrismaService.session.findUnique).toHaveBeenCalledWith({
        where: { id: 'session-uuid-1' },
      });
      expect(result).toEqual(session);
    });

    it('should return null when not found', async () => {
      mockPrismaService.session.findUnique.mockResolvedValue(null);

      const result = await service.findById('nonexistent-id');

      expect(mockPrismaService.session.findUnique).toHaveBeenCalledWith({
        where: { id: 'nonexistent-id' },
      });
      expect(result).toBeNull();
    });
  });

  describe('rotateToken', () => {
    it('should update hash and lastUsedAt', async () => {
      mockPrismaService.session.update.mockResolvedValue({});

      const beforeCall = new Date();
      await service.rotateToken('session-uuid-1', 'new-hash-value');
      const afterCall = new Date();

      expect(mockPrismaService.session.update).toHaveBeenCalledTimes(1);

      const callArgs = mockPrismaService.session.update.mock.calls[0][0];
      expect(callArgs.where).toEqual({ id: 'session-uuid-1' });
      expect(callArgs.data.refreshTokenHash).toBe('new-hash-value');
      expect(callArgs.data.lastUsedAt).toBeInstanceOf(Date);
      expect(callArgs.data.lastUsedAt.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(callArgs.data.lastUsedAt.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });
  });

  describe('listActive', () => {
    it('should filter by userId, isRevoked=false, and expiresAt > now', async () => {
      const sessions = [
        { id: 'session-1', userId: 'user-1', isRevoked: false },
        { id: 'session-2', userId: 'user-1', isRevoked: false },
      ];

      mockPrismaService.session.findMany.mockResolvedValue(sessions);

      const beforeCall = new Date();
      const result = await service.listActive('user-1');
      const afterCall = new Date();

      expect(mockPrismaService.session.findMany).toHaveBeenCalledTimes(1);

      const callArgs = mockPrismaService.session.findMany.mock.calls[0][0];
      expect(callArgs.where.userId).toBe('user-1');
      expect(callArgs.where.isRevoked).toBe(false);
      expect(callArgs.where.expiresAt.gt).toBeInstanceOf(Date);
      expect(callArgs.where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(callArgs.where.expiresAt.gt.getTime()).toBeLessThanOrEqual(afterCall.getTime());
      expect(callArgs.orderBy).toEqual({ createdAt: 'desc' });
      expect(result).toEqual(sessions);
    });

    it('should return empty array when no active sessions exist', async () => {
      mockPrismaService.session.findMany.mockResolvedValue([]);

      const result = await service.listActive('user-no-sessions');

      expect(result).toEqual([]);
    });
  });

  describe('revoke', () => {
    it('should set isRevoked=true for a single session', async () => {
      mockPrismaService.session.update.mockResolvedValue({});

      await service.revoke('session-uuid-1');

      expect(mockPrismaService.session.update).toHaveBeenCalledWith({
        where: { id: 'session-uuid-1' },
        data: { isRevoked: true },
      });
    });
  });

  describe('revokeAllExcept', () => {
    it('should revoke all non-revoked sessions except the specified one', async () => {
      mockPrismaService.session.updateMany.mockResolvedValue({ count: 3 });

      await service.revokeAllExcept('user-uuid-1', 'keep-session-id');

      expect(mockPrismaService.session.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-uuid-1',
          id: { not: 'keep-session-id' },
          isRevoked: false,
        },
        data: { isRevoked: true },
      });
    });
  });

  describe('revokeByTokenFamily', () => {
    it('should revoke all non-revoked sessions with the same tokenFamily', async () => {
      mockPrismaService.session.updateMany.mockResolvedValue({ count: 1 });

      await service.revokeByTokenFamily('family-uuid-1');

      expect(mockPrismaService.session.updateMany).toHaveBeenCalledWith({
        where: { tokenFamily: 'family-uuid-1', isRevoked: false },
        data: { isRevoked: true },
      });
    });
  });

  describe('revokeAll', () => {
    it('should revoke all non-revoked sessions for a userId', async () => {
      mockPrismaService.session.updateMany.mockResolvedValue({ count: 5 });

      await service.revokeAll('user-uuid-1');

      expect(mockPrismaService.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1', isRevoked: false },
        data: { isRevoked: true },
      });
    });
  });
});

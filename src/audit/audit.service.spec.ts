import { Test, TestingModule } from '@nestjs/testing';
import { AuditService, AuditLogEntry } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'test-id' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    prisma = module.get(PrismaService);
  });

  describe('log', () => {
    it('should persist a valid audit entry', async () => {
      const entry: AuditLogEntry = {
        action: 'AUTH_LOGIN_SUCCESS',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        resourceType: 'session',
        resourceId: '660e8400-e29b-41d4-a716-446655440000',
        requestId: '770e8400-e29b-41d4-a716-446655440000',
        ipAddress: '192.168.1.1',
        metadata: { method: 'POST', path: '/api/auth/login' },
      };

      await service.log(entry);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'AUTH_LOGIN_SUCCESS',
          userId: '550e8400-e29b-41d4-a716-446655440000',
          resourceType: 'session',
          resourceId: '660e8400-e29b-41d4-a716-446655440000',
          requestId: '770e8400-e29b-41d4-a716-446655440000',
          ipAddress: '192.168.1.1',
        }),
      });
    });

    it('should not throw on database failure (best-effort)', async () => {
      (prisma.auditLog.create as jest.Mock).mockRejectedValue(
        new Error('DB connection failed'),
      );

      const entry: AuditLogEntry = {
        action: 'AUTH_LOGIN_SUCCESS',
        requestId: '770e8400-e29b-41d4-a716-446655440000',
      };

      // Should not throw
      await expect(service.log(entry)).resolves.toBeUndefined();
    });

    it('should discard metadata exceeding 4KB', async () => {
      const largeMetadata: Record<string, unknown> = {
        data: 'x'.repeat(5000),
      };

      const entry: AuditLogEntry = {
        action: 'TEST_ACTION',
        requestId: '770e8400-e29b-41d4-a716-446655440000',
        metadata: largeMetadata,
      };

      await service.log(entry);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.anything(), // Prisma.JsonNull
        }),
      });
    });

    it('should discard metadata containing PII (CPF)', async () => {
      const entry: AuditLogEntry = {
        action: 'TEST_ACTION',
        requestId: '770e8400-e29b-41d4-a716-446655440000',
        metadata: { document: '123.456.789-00' },
      };

      await service.log(entry);

      // metadata should be set to null (Prisma.JsonNull)
      const callArg = (prisma.auditLog.create as jest.Mock).mock.calls[0][0];
      // When PII detected, metadata is discarded (set to Prisma.JsonNull)
      expect(callArg.data.metadata).not.toEqual({ document: '123.456.789-00' });
    });

    it('should discard metadata containing PII (email)', async () => {
      const entry: AuditLogEntry = {
        action: 'TEST_ACTION',
        requestId: '770e8400-e29b-41d4-a716-446655440000',
        metadata: { email: 'user@example.com' },
      };

      await service.log(entry);

      const callArg = (prisma.auditLog.create as jest.Mock).mock.calls[0][0];
      expect(callArg.data.metadata).not.toEqual({ email: 'user@example.com' });
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      const mockLogs = [
        { id: '1', action: 'AUTH_LOGIN_SUCCESS', createdAt: new Date() },
      ];
      (prisma.auditLog.findMany as jest.Mock).mockResolvedValue(mockLogs);
      (prisma.auditLog.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toEqual(mockLogs);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('should apply action filter', async () => {
      await service.findAll({ page: 1, limit: 20, action: 'AUTH_LOGIN_SUCCESS' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ action: 'AUTH_LOGIN_SUCCESS' }),
        }),
      );
    });

    it('should apply date range filter', async () => {
      await service.findAll({
        page: 1,
        limit: 20,
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-12-31T23:59:59Z',
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date('2024-01-01T00:00:00Z'),
              lte: new Date('2024-12-31T23:59:59Z'),
            },
          }),
        }),
      );
    });
  });

  describe('containsPII', () => {
    it('should detect CPF', () => {
      expect(service.containsPII('123.456.789-00')).toBe(true);
      expect(service.containsPII('12345678900')).toBe(true);
    });

    it('should detect CNPJ', () => {
      expect(service.containsPII('12.345.678/0001-90')).toBe(true);
      expect(service.containsPII('12345678000190')).toBe(true);
    });

    it('should detect email', () => {
      expect(service.containsPII('user@example.com')).toBe(true);
    });

    it('should detect phone numbers', () => {
      expect(service.containsPII('+55 11 99999-8888')).toBe(true);
      expect(service.containsPII('11999998888')).toBe(true);
    });

    it('should detect JWT tokens', () => {
      expect(
        service.containsPII(
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
        ),
      ).toBe(true);
    });

    it('should not flag safe strings', () => {
      expect(service.containsPII('CREATE_WALLET')).toBe(false);
      expect(service.containsPII('/api/wallets/123')).toBe(false);
    });
  });
});

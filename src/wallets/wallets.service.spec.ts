import { Test, TestingModule } from '@nestjs/testing';
import { WalletsService, WalletSummary } from './wallets.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';

describe('WalletsService', () => {
  let service: WalletsService;
  let prisma: any;

  const mockAccountId = 'account-uuid-1';
  const mockCreditorId = 'creditor-uuid-1';
  const mockWalletId = 'wallet-uuid-1';

  const mockWallet = {
    id: mockWalletId,
    accountId: mockAccountId,
    creditorId: mockCreditorId,
    name: 'Test Wallet',
    status: 'ACTIVE',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      creditor: {
        findFirst: jest.fn(),
      },
      wallet: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      contract: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WalletsService>(WalletsService);
  });

  describe('create', () => {
    it('should create a wallet when creditor exists', async () => {
      prisma.creditor.findFirst.mockResolvedValue({ id: mockCreditorId });
      prisma.wallet.create.mockResolvedValue(mockWallet);

      const result = await service.create(mockCreditorId, { name: 'Test Wallet' }, mockAccountId);

      expect(result).toEqual(mockWallet);
      expect(prisma.wallet.create).toHaveBeenCalledWith({
        data: {
          accountId: mockAccountId,
          creditorId: mockCreditorId,
          name: 'Test Wallet',
          status: 'ACTIVE',
        },
      });
    });

    it('should throw NotFoundException when creditor does not exist', async () => {
      prisma.creditor.findFirst.mockResolvedValue(null);

      await expect(
        service.create(mockCreditorId, { name: 'Test' }, mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when creditor is soft-deleted', async () => {
      prisma.creditor.findFirst.mockResolvedValue(null); // findFirst with deletedAt: null returns null

      await expect(
        service.create(mockCreditorId, { name: 'Test' }, mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('should return paginated wallets', async () => {
      prisma.wallet.findMany.mockResolvedValue([mockWallet]);
      prisma.wallet.count.mockResolvedValue(1);

      const result = await service.list({ page: 1, limit: 20 }, mockAccountId);

      expect(result.data).toEqual([mockWallet]);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('should filter by search (name substring)', async () => {
      prisma.wallet.findMany.mockResolvedValue([]);
      prisma.wallet.count.mockResolvedValue(0);

      await service.list({ page: 1, limit: 20, search: 'Test' }, mockAccountId);

      expect(prisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: { contains: 'Test', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('should filter by userScopes for VIEWER', async () => {
      const scopes = ['wallet-1', 'wallet-2'];
      prisma.wallet.findMany.mockResolvedValue([]);
      prisma.wallet.count.mockResolvedValue(0);

      await service.list({ page: 1, limit: 20 }, mockAccountId, scopes);

      expect(prisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: scopes },
          }),
        }),
      );
    });

    it('should return empty list when VIEWER has empty scopes', async () => {
      prisma.wallet.findMany.mockResolvedValue([]);
      prisma.wallet.count.mockResolvedValue(0);

      const result = await service.list({ page: 1, limit: 20 }, mockAccountId, []);

      expect(result.data).toEqual([]);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: [] },
          }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return wallet with summary', async () => {
      prisma.wallet.findFirst.mockResolvedValue(mockWallet);
      prisma.contract.findMany.mockResolvedValue([
        { providerStatus: 'PENDING', originalValue: 100.5 },
        { providerStatus: 'PENDING', originalValue: 200.0 },
        { providerStatus: 'REGISTERED', originalValue: 50.0 },
      ]);

      const result = await service.findById(mockWalletId, mockAccountId);

      expect(result.id).toBe(mockWalletId);
      expect(result.summary.totalContracts).toBe(3);
      expect(result.summary.contractsByStatus).toEqual({
        PENDING: 2,
        REGISTERED: 1,
      });
      expect(result.summary.totalValue).toBeCloseTo(350.5);
    });

    it('should throw NotFoundException when wallet not found', async () => {
      prisma.wallet.findFirst.mockResolvedValue(null);

      await expect(
        service.findById('nonexistent', mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when VIEWER wallet is out of scope', async () => {
      prisma.wallet.findFirst.mockResolvedValue(mockWallet);

      await expect(
        service.findById(mockWalletId, mockAccountId, ['other-wallet-id']),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow access when VIEWER wallet is in scope', async () => {
      prisma.wallet.findFirst.mockResolvedValue(mockWallet);
      prisma.contract.findMany.mockResolvedValue([]);

      const result = await service.findById(mockWalletId, mockAccountId, [mockWalletId]);

      expect(result.id).toBe(mockWalletId);
      expect(result.summary.totalContracts).toBe(0);
    });
  });

  describe('update', () => {
    it('should update wallet name', async () => {
      prisma.wallet.findFirst.mockResolvedValue(mockWallet);
      prisma.wallet.update.mockResolvedValue({ ...mockWallet, name: 'Updated Name' });

      const result = await service.update(mockWalletId, { name: 'Updated Name' }, mockAccountId);

      expect(result.name).toBe('Updated Name');
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: mockWalletId },
        data: { name: 'Updated Name' },
      });
    });

    it('should update wallet status to INACTIVE', async () => {
      prisma.wallet.findFirst.mockResolvedValue(mockWallet);
      prisma.wallet.update.mockResolvedValue({ ...mockWallet, status: 'INACTIVE' });

      const result = await service.update(mockWalletId, { status: 'INACTIVE' }, mockAccountId);

      expect(result.status).toBe('INACTIVE');
    });

    it('should throw NotFoundException when wallet not found', async () => {
      prisma.wallet.findFirst.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { name: 'Test' }, mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('should soft-delete wallet when no contracts exist', async () => {
      prisma.wallet.findFirst.mockResolvedValue(mockWallet);
      prisma.contract.count.mockResolvedValue(0);
      prisma.wallet.update.mockResolvedValue({ ...mockWallet, deletedAt: new Date() });

      await service.softDelete(mockWalletId, mockAccountId);

      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: mockWalletId },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should throw ConflictException when wallet has contracts', async () => {
      prisma.wallet.findFirst.mockResolvedValue(mockWallet);
      prisma.contract.count.mockResolvedValue(5);

      await expect(
        service.softDelete(mockWalletId, mockAccountId),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when wallet not found', async () => {
      prisma.wallet.findFirst.mockResolvedValue(null);

      await expect(
        service.softDelete('nonexistent', mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getWalletSummary', () => {
    it('should compute summary with contracts grouped by status', async () => {
      prisma.contract.findMany.mockResolvedValue([
        { providerStatus: 'PENDING', originalValue: 1000 },
        { providerStatus: 'PENDING', originalValue: 500 },
        { providerStatus: 'SENT', originalValue: 750 },
        { providerStatus: 'REGISTERED', originalValue: 300 },
      ]);

      const summary = await service.getWalletSummary(mockWalletId);

      expect(summary.totalContracts).toBe(4);
      expect(summary.contractsByStatus).toEqual({
        PENDING: 2,
        SENT: 1,
        REGISTERED: 1,
      });
      expect(summary.totalValue).toBe(2550);
    });

    it('should return zero summary when no contracts', async () => {
      prisma.contract.findMany.mockResolvedValue([]);

      const summary = await service.getWalletSummary(mockWalletId);

      expect(summary.totalContracts).toBe(0);
      expect(summary.contractsByStatus).toEqual({});
      expect(summary.totalValue).toBe(0);
    });
  });
});

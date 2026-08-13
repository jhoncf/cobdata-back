import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WalletMappingsService } from './wallet-mappings.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WalletMappingsService', () => {
  let service: WalletMappingsService;
  let prisma: any;

  const mockAccountId = 'account-uuid-1';
  const mockProviderId = 'provider-uuid-1';

  beforeEach(async () => {
    prisma = {
      provider: {
        findFirst: jest.fn(),
      },
      wallet: {
        findFirst: jest.fn(),
      },
      walletMapping: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletMappingsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WalletMappingsService>(WalletMappingsService);
  });

  describe('create', () => {
    it('should create a wallet mapping when wallet is valid', async () => {
      prisma.provider.findFirst.mockResolvedValue({ id: mockProviderId });
      prisma.wallet.findFirst.mockResolvedValue({
        id: 'wallet-1',
        status: 'ACTIVE',
      });
      prisma.walletMapping.findUnique.mockResolvedValue(null);
      prisma.walletMapping.create.mockResolvedValue({
        id: 'mapping-1',
        providerId: mockProviderId,
        walletId: 'wallet-1',
        externalWalletId: 'ext-wallet-123',
      });

      const result = await service.create(
        mockProviderId,
        { walletId: 'wallet-1', externalWalletId: 'ext-wallet-123' },
        mockAccountId,
      );

      expect(result.id).toBe('mapping-1');
      expect(result.externalWalletId).toBe('ext-wallet-123');
    });

    it('should throw 404 if provider not found', async () => {
      prisma.provider.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          'nonexistent',
          { walletId: 'wallet-1', externalWalletId: 'ext-123' },
          mockAccountId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw 422 if wallet not found or soft-deleted', async () => {
      prisma.provider.findFirst.mockResolvedValue({ id: mockProviderId });
      prisma.wallet.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          mockProviderId,
          { walletId: 'deleted-wallet', externalWalletId: 'ext-123' },
          mockAccountId,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw 422 if wallet is INACTIVE', async () => {
      prisma.provider.findFirst.mockResolvedValue({ id: mockProviderId });
      prisma.wallet.findFirst.mockResolvedValue({
        id: 'wallet-1',
        status: 'INACTIVE',
      });

      await expect(
        service.create(
          mockProviderId,
          { walletId: 'wallet-1', externalWalletId: 'ext-123' },
          mockAccountId,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw 409 if mapping already exists for this wallet', async () => {
      prisma.provider.findFirst.mockResolvedValue({ id: mockProviderId });
      prisma.wallet.findFirst.mockResolvedValue({
        id: 'wallet-1',
        status: 'ACTIVE',
      });
      prisma.walletMapping.findUnique.mockResolvedValue({
        id: 'existing-mapping',
      });

      await expect(
        service.create(
          mockProviderId,
          { walletId: 'wallet-1', externalWalletId: 'ext-123' },
          mockAccountId,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('list', () => {
    it('should return wallet mappings for a provider', async () => {
      prisma.provider.findFirst.mockResolvedValue({ id: mockProviderId });
      prisma.walletMapping.findMany.mockResolvedValue([
        {
          id: 'mapping-1',
          providerId: mockProviderId,
          walletId: 'wallet-1',
          externalWalletId: 'ext-1',
        },
        {
          id: 'mapping-2',
          providerId: mockProviderId,
          walletId: 'wallet-2',
          externalWalletId: 'ext-2',
        },
      ]);

      const result = await service.list(mockProviderId, mockAccountId);

      expect(result).toHaveLength(2);
    });

    it('should throw 404 if provider not found', async () => {
      prisma.provider.findFirst.mockResolvedValue(null);

      await expect(
        service.list('nonexistent', mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('should delete a wallet mapping', async () => {
      prisma.provider.findFirst.mockResolvedValue({ id: mockProviderId });
      prisma.walletMapping.findFirst.mockResolvedValue({
        id: 'mapping-1',
        providerId: mockProviderId,
      });
      prisma.walletMapping.delete.mockResolvedValue({});

      await expect(
        service.delete(mockProviderId, 'mapping-1', mockAccountId),
      ).resolves.toBeUndefined();

      expect(prisma.walletMapping.delete).toHaveBeenCalledWith({
        where: { id: 'mapping-1' },
      });
    });

    it('should throw 404 if provider not found', async () => {
      prisma.provider.findFirst.mockResolvedValue(null);

      await expect(
        service.delete('nonexistent', 'mapping-1', mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw 404 if mapping not found', async () => {
      prisma.provider.findFirst.mockResolvedValue({ id: mockProviderId });
      prisma.walletMapping.findFirst.mockResolvedValue(null);

      await expect(
        service.delete(mockProviderId, 'nonexistent', mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

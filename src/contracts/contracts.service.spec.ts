import { Test, TestingModule } from '@nestjs/testing';
import { ContractsService } from './contracts.service';
import { DeduplicationService } from './deduplication.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  UnprocessableEntityException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { ListContractsQueryDto } from './dto/list-contracts-query.dto';
import { DebtType } from '@prisma/client';

describe('ContractsService', () => {
  let service: ContractsService;
  let prisma: any;
  let deduplicationService: DeduplicationService;

  const mockAccountId = '11111111-1111-1111-1111-111111111111';
  const mockWalletId = '22222222-2222-2222-2222-222222222222';
  const mockCreditorId = '33333333-3333-3333-3333-333333333333';

  const baseDto: CreateContractDto = {
    walletId: mockWalletId,
    debtorDocument: '12345678901',
    contractNumber: 'CTR-001',
    debtType: DebtType.COMMERCIAL,
    occurrenceDate: '2024-01-15',
    dueDate: '2024-02-15',
    originalValue: 1000.0,
    updatedValue: 1000.0,
  };

  const mockWallet = {
    id: mockWalletId,
    accountId: mockAccountId,
    creditorId: mockCreditorId,
    name: 'Test Wallet',
    status: 'ACTIVE',
    deletedAt: null,
  };

  beforeEach(async () => {
    prisma = {
      wallet: {
        findFirst: jest.fn(),
      },
      contract: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        DeduplicationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
    deduplicationService = module.get<DeduplicationService>(DeduplicationService);
  });

  describe('createOrUpdate', () => {
    it('should create a new contract when no dedup match exists', async () => {
      prisma.wallet.findFirst.mockResolvedValue(mockWallet);
      prisma.contract.findUnique.mockResolvedValue(null);

      const expectedContract = {
        id: 'new-contract-id',
        ...baseDto,
        accountId: mockAccountId,
        serasaStatus: 'PENDING',
        status: 'ACTIVE',
      };
      prisma.contract.create.mockResolvedValue(expectedContract);

      const result = await service.createOrUpdate(baseDto, mockAccountId);

      expect(result.serasaStatus).toBe('PENDING');
      expect(result.status).toBe('ACTIVE');
      expect(prisma.contract.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountId: mockAccountId,
            walletId: mockWalletId,
            serasaStatus: 'PENDING',
            status: 'ACTIVE',
            debtorDocument: '12345678901',
            contractNumber: 'CTR-001',
            debtType: DebtType.COMMERCIAL,
            originalValue: 1000.0,
          }),
        }),
      );
    });

    it('should upsert when dedup key exists in same wallet', async () => {
      prisma.wallet.findFirst.mockResolvedValue(mockWallet);

      const existingContract = {
        id: 'existing-contract-id',
        walletId: mockWalletId,
        debtorDocument: '12345678901',
        contractNumber: 'CTR-001',
      };
      prisma.contract.findUnique.mockResolvedValue(existingContract);

      const updatedContract = { ...existingContract, originalValue: 2000.0 };
      prisma.contract.update.mockResolvedValue(updatedContract);

      const dto: CreateContractDto = { ...baseDto, originalValue: 2000.0 };
      const result = await service.createOrUpdate(dto, mockAccountId);

      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'existing-contract-id' },
        }),
      );
      expect(result).toEqual(updatedContract);
    });

    it('should return 409 when dedup key exists in different wallet', async () => {
      prisma.wallet.findFirst.mockResolvedValue(mockWallet);

      const existingContract = {
        id: 'existing-contract-id',
        walletId: 'different-wallet-id',
      };
      prisma.contract.findUnique.mockResolvedValue(existingContract);

      await expect(
        service.createOrUpdate(baseDto, mockAccountId),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw 422 when wallet not found', async () => {
      prisma.wallet.findFirst.mockResolvedValue(null);

      await expect(
        service.createOrUpdate(baseDto, mockAccountId),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw 422 when wallet is INACTIVE', async () => {
      prisma.wallet.findFirst.mockResolvedValue({ ...mockWallet, status: 'INACTIVE' });

      await expect(
        service.createOrUpdate(baseDto, mockAccountId),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw 422 when occurrenceDate is in the future', async () => {
      prisma.wallet.findFirst.mockResolvedValue(mockWallet);

      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      const futureDto: CreateContractDto = {
        ...baseDto,
        occurrenceDate: futureDate.toISOString(),
      };

      await expect(
        service.createOrUpdate(futureDto, mockAccountId),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw 422 when updatedValue < originalValue', async () => {
      prisma.wallet.findFirst.mockResolvedValue(mockWallet);

      const dto: CreateContractDto = {
        ...baseDto,
        originalValue: 1000.0,
        updatedValue: 500.0,
      };

      await expect(
        service.createOrUpdate(dto, mockAccountId),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('list', () => {
    const listQuery: ListContractsQueryDto = { page: 1, limit: 20 };

    it('should return paginated contracts', async () => {
      const contracts = [
        { id: 'c1', debtorDocument: '12345678901', walletId: mockWalletId },
        { id: 'c2', debtorDocument: '98765432100', walletId: mockWalletId },
      ];
      prisma.contract.findMany.mockResolvedValue(contracts);
      prisma.contract.count.mockResolvedValue(2);

      const result = await service.list(listQuery, mockAccountId, 'ADMIN');

      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });
    });

    it('should mask document for VIEWER role', async () => {
      const contracts = [
        { id: 'c1', debtorDocument: '12345678901', walletId: mockWalletId },
      ];
      prisma.contract.findMany.mockResolvedValue(contracts);
      prisma.contract.count.mockResolvedValue(1);

      const result = await service.list(
        listQuery,
        mockAccountId,
        'VIEWER',
        [mockWalletId],
      );

      expect(result.data[0].debtorDocument).toBe('***8901');
    });

    it('should show full document for ADMIN', async () => {
      const contracts = [
        { id: 'c1', debtorDocument: '12345678901', walletId: mockWalletId },
      ];
      prisma.contract.findMany.mockResolvedValue(contracts);
      prisma.contract.count.mockResolvedValue(1);

      const result = await service.list(listQuery, mockAccountId, 'ADMIN');

      expect(result.data[0].debtorDocument).toBe('12345678901');
    });

    it('should show full document for OPERATIONAL', async () => {
      const contracts = [
        { id: 'c1', debtorDocument: '12345678901', walletId: mockWalletId },
      ];
      prisma.contract.findMany.mockResolvedValue(contracts);
      prisma.contract.count.mockResolvedValue(1);

      const result = await service.list(listQuery, mockAccountId, 'OPERATIONAL');

      expect(result.data[0].debtorDocument).toBe('12345678901');
    });

    it('should return empty list for VIEWER with no scopes', async () => {
      const result = await service.list(listQuery, mockAccountId, 'VIEWER', []);

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    it('should return empty list with zeroed pagination when no results', async () => {
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.contract.count.mockResolvedValue(0);

      const result = await service.list(listQuery, mockAccountId, 'ADMIN');

      expect(result.data).toEqual([]);
      expect(result.meta).toEqual({ total: 0, page: 1, limit: 20, totalPages: 0 });
    });

    it('should filter by walletId', async () => {
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.contract.count.mockResolvedValue(0);

      await service.list(
        { ...listQuery, walletId: mockWalletId },
        mockAccountId,
        'ADMIN',
      );

      expect(prisma.contract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ walletId: mockWalletId }),
        }),
      );
    });

    it('should filter by debtorDocument using hash', async () => {
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.contract.count.mockResolvedValue(0);

      await service.list(
        { ...listQuery, debtorDocument: '12345678901' },
        mockAccountId,
        'ADMIN',
      );

      const expectedHash = deduplicationService.sha256('12345678901');
      expect(prisma.contract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ debtorDocumentHash: expectedHash }),
        }),
      );
    });
  });

  describe('update', () => {
    const mockContract = {
      id: 'contract-id',
      accountId: mockAccountId,
      walletId: mockWalletId,
      serasaStatus: 'PENDING',
      status: 'ACTIVE',
      deletedAt: null,
    };

    it('should update contract when serasaStatus is PENDING', async () => {
      prisma.contract.findFirst.mockResolvedValue(mockContract);
      prisma.contract.update.mockResolvedValue({ ...mockContract, originalValue: 2000 });

      const dto: UpdateContractDto = { originalValue: 2000 };
      const result = await service.update('contract-id', dto, mockAccountId);

      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'contract-id' },
        data: { originalValue: 2000 },
      });
    });

    it('should update contract when serasaStatus is FAILED', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        ...mockContract,
        serasaStatus: 'FAILED',
      });
      prisma.contract.update.mockResolvedValue(mockContract);

      const dto: UpdateContractDto = { originalValue: 2000 };
      await expect(
        service.update('contract-id', dto, mockAccountId),
      ).resolves.toBeDefined();
    });

    it('should update contract when serasaStatus is REMOVED', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        ...mockContract,
        serasaStatus: 'REMOVED',
      });
      prisma.contract.update.mockResolvedValue(mockContract);

      const dto: UpdateContractDto = { originalValue: 2000 };
      await expect(
        service.update('contract-id', dto, mockAccountId),
      ).resolves.toBeDefined();
    });

    it('should throw 409 when serasaStatus is REGISTERED', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        ...mockContract,
        serasaStatus: 'REGISTERED',
      });

      const dto: UpdateContractDto = { originalValue: 2000 };
      await expect(
        service.update('contract-id', dto, mockAccountId),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw 409 when serasaStatus is SENT', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        ...mockContract,
        serasaStatus: 'SENT',
      });

      const dto: UpdateContractDto = { originalValue: 2000 };
      await expect(
        service.update('contract-id', dto, mockAccountId),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw 409 when serasaStatus is REMOVING', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        ...mockContract,
        serasaStatus: 'REMOVING',
      });

      const dto: UpdateContractDto = { originalValue: 2000 };
      await expect(
        service.update('contract-id', dto, mockAccountId),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw 404 when contract not found', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);

      const dto: UpdateContractDto = { originalValue: 2000 };
      await expect(
        service.update('nonexistent-id', dto, mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should allow transition ACTIVE -> SUSPENDED', async () => {
      prisma.contract.findFirst.mockResolvedValue(mockContract);
      prisma.contract.update.mockResolvedValue({
        ...mockContract,
        status: 'SUSPENDED',
      });

      const dto: UpdateContractDto = { status: 'SUSPENDED' as any };
      await expect(
        service.update('contract-id', dto, mockAccountId),
      ).resolves.toBeDefined();
    });

    it('should allow transition ACTIVE -> CANCELLED', async () => {
      prisma.contract.findFirst.mockResolvedValue(mockContract);
      prisma.contract.update.mockResolvedValue({
        ...mockContract,
        status: 'CANCELLED',
      });

      const dto: UpdateContractDto = { status: 'CANCELLED' as any };
      await expect(
        service.update('contract-id', dto, mockAccountId),
      ).resolves.toBeDefined();
    });

    it('should allow transition SUSPENDED -> ACTIVE', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        ...mockContract,
        status: 'SUSPENDED',
      });
      prisma.contract.update.mockResolvedValue({
        ...mockContract,
        status: 'ACTIVE',
      });

      const dto: UpdateContractDto = { status: 'ACTIVE' as any };
      await expect(
        service.update('contract-id', dto, mockAccountId),
      ).resolves.toBeDefined();
    });

    it('should allow transition SUSPENDED -> CANCELLED', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        ...mockContract,
        status: 'SUSPENDED',
      });
      prisma.contract.update.mockResolvedValue({
        ...mockContract,
        status: 'CANCELLED',
      });

      const dto: UpdateContractDto = { status: 'CANCELLED' as any };
      await expect(
        service.update('contract-id', dto, mockAccountId),
      ).resolves.toBeDefined();
    });

    it('should reject transition CANCELLED -> ACTIVE', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        ...mockContract,
        status: 'CANCELLED',
      });

      const dto: UpdateContractDto = { status: 'ACTIVE' as any };
      await expect(
        service.update('contract-id', dto, mockAccountId),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject transition CANCELLED -> SUSPENDED', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        ...mockContract,
        status: 'CANCELLED',
      });

      const dto: UpdateContractDto = { status: 'SUSPENDED' as any };
      await expect(
        service.update('contract-id', dto, mockAccountId),
      ).rejects.toThrow(ConflictException);
    });

    it('should validate walletId destination exists and is ACTIVE', async () => {
      const newWalletId = '44444444-4444-4444-4444-444444444444';
      prisma.contract.findFirst.mockResolvedValue(mockContract);
      prisma.wallet.findFirst.mockResolvedValue({
        id: newWalletId,
        status: 'ACTIVE',
        deletedAt: null,
      });
      prisma.contract.update.mockResolvedValue({
        ...mockContract,
        walletId: newWalletId,
      });

      const dto: UpdateContractDto = { walletId: newWalletId };
      await expect(
        service.update('contract-id', dto, mockAccountId),
      ).resolves.toBeDefined();
    });

    it('should throw 422 when destination wallet not found', async () => {
      const newWalletId = '44444444-4444-4444-4444-444444444444';
      prisma.contract.findFirst.mockResolvedValue(mockContract);
      prisma.wallet.findFirst.mockResolvedValue(null);

      const dto: UpdateContractDto = { walletId: newWalletId };
      await expect(
        service.update('contract-id', dto, mockAccountId),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw 422 when destination wallet is INACTIVE', async () => {
      const newWalletId = '44444444-4444-4444-4444-444444444444';
      prisma.contract.findFirst.mockResolvedValue(mockContract);
      prisma.wallet.findFirst.mockResolvedValue({
        id: newWalletId,
        status: 'INACTIVE',
        deletedAt: null,
      });

      const dto: UpdateContractDto = { walletId: newWalletId };
      await expect(
        service.update('contract-id', dto, mockAccountId),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should preserve fields not in body (partial update)', async () => {
      prisma.contract.findFirst.mockResolvedValue(mockContract);
      prisma.contract.update.mockResolvedValue(mockContract);

      const dto: UpdateContractDto = { originalValue: 5000 };
      await service.update('contract-id', dto, mockAccountId);

      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'contract-id' },
        data: { originalValue: 5000 },
      });
    });

    it('should not update serasaStatus even if passed in body', async () => {
      prisma.contract.findFirst.mockResolvedValue(mockContract);
      prisma.contract.update.mockResolvedValue(mockContract);

      // Force a serasaStatus in the dto (simulating bad input)
      const dto: any = { originalValue: 5000, serasaStatus: 'REGISTERED' };
      await service.update('contract-id', dto, mockAccountId);

      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'contract-id' },
        data: { originalValue: 5000 },
      });
    });
  });

  describe('softDelete', () => {
    const mockContract = {
      id: 'contract-id',
      accountId: mockAccountId,
      walletId: mockWalletId,
      serasaStatus: 'PENDING',
      status: 'ACTIVE',
      deletedAt: null,
    };

    it('should soft-delete when serasaStatus is PENDING', async () => {
      prisma.contract.findFirst.mockResolvedValue(mockContract);
      prisma.contract.update.mockResolvedValue({
        ...mockContract,
        deletedAt: new Date(),
      });

      const result = await service.softDelete('contract-id', mockAccountId);

      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'contract-id' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result.deletedAt).toBeDefined();
    });

    it('should soft-delete when serasaStatus is FAILED', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        ...mockContract,
        serasaStatus: 'FAILED',
      });
      prisma.contract.update.mockResolvedValue({
        ...mockContract,
        deletedAt: new Date(),
      });

      await expect(
        service.softDelete('contract-id', mockAccountId),
      ).resolves.toBeDefined();
    });

    it('should soft-delete when serasaStatus is REMOVED', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        ...mockContract,
        serasaStatus: 'REMOVED',
      });
      prisma.contract.update.mockResolvedValue({
        ...mockContract,
        deletedAt: new Date(),
      });

      await expect(
        service.softDelete('contract-id', mockAccountId),
      ).resolves.toBeDefined();
    });

    it('should throw 409 when serasaStatus is REGISTERED', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        ...mockContract,
        serasaStatus: 'REGISTERED',
      });

      await expect(
        service.softDelete('contract-id', mockAccountId),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw 409 when serasaStatus is SENT', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        ...mockContract,
        serasaStatus: 'SENT',
      });

      await expect(
        service.softDelete('contract-id', mockAccountId),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw 404 when contract not found', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);

      await expect(
        service.softDelete('nonexistent-id', mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('maskDocument', () => {
    it('should mask document showing only last 4 characters', () => {
      expect(service.maskDocument('12345678901')).toBe('***8901');
    });

    it('should mask CNPJ showing only last 4 characters', () => {
      expect(service.maskDocument('12345678000199')).toBe('***0199');
    });

    it('should return short documents as-is', () => {
      expect(service.maskDocument('1234')).toBe('1234');
    });

    it('should handle empty string', () => {
      expect(service.maskDocument('')).toBe('');
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { OperationsService } from '../operations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUES } from '../../common/constants/queues';
import { UnprocessableEntityException, NotFoundException, ConflictException } from '@nestjs/common';

describe('OperationsService', () => {
  let service: OperationsService;
  let prisma: any;
  let queue: any;

  beforeEach(async () => {
    prisma = {
      wallet: { findFirst: jest.fn() },
      walletMapping: { findFirst: jest.fn() },
      contract: { findMany: jest.fn() },
      providerOperation: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      providerOperationItem: {
        createMany: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((fn) => fn(prisma)),
    };

    queue = {
      add: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OperationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken(QUEUES.PROVIDER_OPERATION), useValue: queue },
      ],
    }).compile();

    service = module.get<OperationsService>(OperationsService);
  });

  describe('create', () => {
    it('should throw UnprocessableEntityException when wallet not found', async () => {
      prisma.wallet.findFirst.mockResolvedValue(null);

      await expect(
        service.create({
          walletId: 'non-existent',
          action: 'CREATE_OR_UPDATE',
          userId: 'user-1',
          accountId: 'acc-1',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw UnprocessableEntityException when no wallet mapping exists', async () => {
      prisma.wallet.findFirst.mockResolvedValue({ id: 'w1', accountId: 'acc-1' });
      prisma.walletMapping.findFirst.mockResolvedValue(null);

      await expect(
        service.create({
          walletId: 'w1',
          action: 'CREATE_OR_UPDATE',
          userId: 'user-1',
          accountId: 'acc-1',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw UnprocessableEntityException when no eligible contracts', async () => {
      prisma.wallet.findFirst.mockResolvedValue({ id: 'w1', accountId: 'acc-1' });
      prisma.walletMapping.findFirst.mockResolvedValue({
        providerId: 'prov-1',
        provider: { id: 'prov-1' },
      });
      prisma.contract.findMany.mockResolvedValue([]);

      await expect(
        service.create({
          walletId: 'w1',
          action: 'CREATE_OR_UPDATE',
          userId: 'user-1',
          accountId: 'acc-1',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should create operation and schedule batch jobs', async () => {
      prisma.wallet.findFirst.mockResolvedValue({ id: 'w1', accountId: 'acc-1' });
      prisma.walletMapping.findFirst.mockResolvedValue({
        providerId: 'prov-1',
        provider: { id: 'prov-1' },
      });

      const contracts = Array.from({ length: 2500 }, (_, i) => ({
        id: `contract-${i}`,
        debtorDocument: '12345678901',
        contractNumber: `CN-${i}`,
      }));
      prisma.contract.findMany.mockResolvedValue(contracts);

      prisma.providerOperation.create.mockResolvedValue({
        id: 'op-1',
        status: 'PENDING',
        action: 'CREATE_OR_UPDATE',
        totalItems: 2500,
        createdAt: new Date(),
      });
      prisma.providerOperationItem.createMany.mockResolvedValue({ count: 2500 });

      const result = await service.create({
        walletId: 'w1',
        action: 'CREATE_OR_UPDATE',
        userId: 'user-1',
        accountId: 'acc-1',
      });

      expect(result.totalItems).toBe(2500);
      expect(result.totalBatches).toBe(3); // ceil(2500/1000) = 3
      expect(queue.add).toHaveBeenCalledTimes(3);
    });
  });

  describe('cancel', () => {
    it('should throw NotFoundException when operation not found', async () => {
      prisma.providerOperation.findFirst.mockResolvedValue(null);

      await expect(
        service.cancel('non-existent', 'acc-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when operation is not PENDING', async () => {
      prisma.providerOperation.findFirst.mockResolvedValue({
        id: 'op-1',
        status: 'PROCESSING',
      });

      await expect(
        service.cancel('op-1', 'acc-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should cancel a PENDING operation', async () => {
      prisma.providerOperation.findFirst.mockResolvedValue({
        id: 'op-1',
        status: 'PENDING',
      });
      prisma.providerOperationItem.updateMany.mockResolvedValue({ count: 5 });
      prisma.providerOperation.update.mockResolvedValue({
        id: 'op-1',
        status: 'CANCELLED',
      });

      const result = await service.cancel('op-1', 'acc-1');
      expect(result.status).toBe('CANCELLED');
    });
  });

  describe('getEligibleStatuses', () => {
    it('should return PENDING and FAILED for CREATE_OR_UPDATE', () => {
      const statuses = service.getEligibleStatuses('CREATE_OR_UPDATE');
      expect(statuses).toContain('PENDING');
      expect(statuses).toContain('FAILED');
      expect(statuses).toHaveLength(2);
    });

    it('should return REGISTERED and UPDATED for REMOVE', () => {
      const statuses = service.getEligibleStatuses('REMOVE');
      expect(statuses).toContain('REGISTERED');
      expect(statuses).toContain('UPDATED');
      expect(statuses).toHaveLength(2);
    });
  });
});

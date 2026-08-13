import { Test, TestingModule } from '@nestjs/testing';
import { ImportsService } from '../imports.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUES } from '../../common/constants/queues';
import { NotFoundException, ConflictException } from '@nestjs/common';

describe('ImportsService - confirm', () => {
  let service: ImportsService;
  let prisma: any;
  let applicationQueue: any;

  beforeEach(async () => {
    prisma = {
      importBatch: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    applicationQueue = {
      add: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: {} },
        {
          provide: getQueueToken(QUEUES.IMPORT_VALIDATION),
          useValue: { add: jest.fn() },
        },
        {
          provide: getQueueToken(QUEUES.IMPORT_APPLICATION),
          useValue: applicationQueue,
        },
      ],
    }).compile();

    service = module.get<ImportsService>(ImportsService);
  });

  const accountId = 'account-1';
  const batchId = 'batch-1';

  describe('confirm from VALIDATED', () => {
    it('should set status to APPLYING and schedule application job', async () => {
      prisma.importBatch.findFirst.mockResolvedValue({
        id: batchId,
        accountId,
        status: 'VALIDATED',
      });
      prisma.importBatch.update.mockResolvedValue({
        id: batchId,
        status: 'APPLYING',
      });

      const result = await service.confirm(batchId, accountId);

      expect(result).toEqual({ id: batchId, status: 'APPLYING' });
      expect(prisma.importBatch.update).toHaveBeenCalledWith({
        where: { id: batchId },
        data: { status: 'APPLYING' },
      });
      expect(applicationQueue.add).toHaveBeenCalledWith(
        'apply',
        { batchId },
        { attempts: 3, backoff: { type: 'exponential', delay: 10000 } },
      );
    });
  });

  describe('confirm from VALIDATED_WITH_ERRORS', () => {
    it('should set status to APPLYING and schedule application job', async () => {
      prisma.importBatch.findFirst.mockResolvedValue({
        id: batchId,
        accountId,
        status: 'VALIDATED_WITH_ERRORS',
      });
      prisma.importBatch.update.mockResolvedValue({
        id: batchId,
        status: 'APPLYING',
      });

      const result = await service.confirm(batchId, accountId);

      expect(result).toEqual({ id: batchId, status: 'APPLYING' });
      expect(applicationQueue.add).toHaveBeenCalled();
    });
  });

  describe('idempotent behavior', () => {
    it('should return current state if already APPLYING', async () => {
      prisma.importBatch.findFirst.mockResolvedValue({
        id: batchId,
        accountId,
        status: 'APPLYING',
      });

      const result = await service.confirm(batchId, accountId);

      expect(result).toEqual({ id: batchId, status: 'APPLYING' });
      expect(prisma.importBatch.update).not.toHaveBeenCalled();
      expect(applicationQueue.add).not.toHaveBeenCalled();
    });

    it('should return current state if already APPLIED', async () => {
      prisma.importBatch.findFirst.mockResolvedValue({
        id: batchId,
        accountId,
        status: 'APPLIED',
      });

      const result = await service.confirm(batchId, accountId);

      expect(result).toEqual({ id: batchId, status: 'APPLIED' });
      expect(prisma.importBatch.update).not.toHaveBeenCalled();
      expect(applicationQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('conflict statuses', () => {
    const conflictStatuses = [
      'PENDING_VALIDATION',
      'VALIDATING',
      'CANCELLED',
      'FAILED',
      'VALIDATION_FAILED',
    ];

    conflictStatuses.forEach((status) => {
      it(`should throw ConflictException for status ${status}`, async () => {
        prisma.importBatch.findFirst.mockResolvedValue({
          id: batchId,
          accountId,
          status,
        });

        await expect(service.confirm(batchId, accountId)).rejects.toThrow(
          ConflictException,
        );
        expect(prisma.importBatch.update).not.toHaveBeenCalled();
        expect(applicationQueue.add).not.toHaveBeenCalled();
      });
    });
  });

  describe('not found', () => {
    it('should throw NotFoundException if batch does not exist', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(null);

      await expect(service.confirm(batchId, accountId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

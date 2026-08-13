import { Test, TestingModule } from '@nestjs/testing';
import { ImportsService } from './imports.service';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUES } from '../common/constants/queues';
import {
  UnprocessableEntityException,
  PayloadTooLargeException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

describe('ImportsService', () => {
  let service: ImportsService;
  let prisma: any;
  let storageService: any;
  let validationQueue: any;
  let applicationQueue: any;

  beforeEach(async () => {
    prisma = {
      wallet: { findFirst: jest.fn() },
      importBatch: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      importBatchError: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    storageService = {
      upload: jest.fn().mockResolvedValue('imports/test-key.csv'),
    };

    validationQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };
    applicationQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-2' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storageService },
        { provide: getQueueToken(QUEUES.IMPORT_VALIDATION), useValue: validationQueue },
        { provide: getQueueToken(QUEUES.IMPORT_APPLICATION), useValue: applicationQueue },
      ],
    }).compile();

    service = module.get<ImportsService>(ImportsService);
  });

  describe('upload', () => {
    const baseParams = {
      walletId: 'wallet-uuid',
      columnMapping: { debtorDocument: 'cpf', contractNumber: 'numero' },
      userId: 'user-uuid',
      accountId: 'account-uuid',
    };

    const validCsvBuffer = Buffer.from(
      'cpf,numero,tipo,data,valor\n12345678901,C001,COMMERCIAL,2023-01-01,100.00\n12345678902,C002,BANKING,2023-02-01,200.00',
    );

    const createFile = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File => ({
      fieldname: 'file',
      originalname: 'import.csv',
      encoding: '7bit',
      mimetype: 'text/csv',
      size: 1024,
      buffer: validCsvBuffer,
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
      ...overrides,
    });

    it('should reject when no file is provided', async () => {
      await expect(
        service.upload({ ...baseParams, file: null as any }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should reject file exceeding 100MB', async () => {
      const largeFile = createFile({ size: 101 * 1024 * 1024 });
      await expect(
        service.upload({ ...baseParams, file: largeFile }),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('should reject invalid file extension', async () => {
      const badFile = createFile({ originalname: 'data.txt' });
      await expect(
        service.upload({ ...baseParams, file: badFile }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should reject .json extension', async () => {
      const badFile = createFile({ originalname: 'data.json' });
      await expect(
        service.upload({ ...baseParams, file: badFile }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should accept .csv extension', async () => {
      prisma.wallet.findFirst.mockResolvedValue({
        id: 'wallet-uuid',
        status: 'ACTIVE',
      });
      prisma.importBatch.create.mockResolvedValue({
        id: 'batch-uuid',
        status: 'PENDING_VALIDATION',
        totalLines: 2,
      });

      const file = createFile();
      const result = await service.upload({ ...baseParams, file });

      expect(result.status).toBe('PENDING_VALIDATION');
      expect(result.totalLines).toBe(2);
    });

    it('should accept .xlsx extension', async () => {
      prisma.wallet.findFirst.mockResolvedValue({
        id: 'wallet-uuid',
        status: 'ACTIVE',
      });
      prisma.importBatch.create.mockResolvedValue({
        id: 'batch-uuid',
        status: 'PENDING_VALIDATION',
        totalLines: 1,
      });

      const file = createFile({ originalname: 'data.xlsx' });
      const result = await service.upload({ ...baseParams, file });

      expect(result.status).toBe('PENDING_VALIDATION');
    });

    it('should reject when wallet not found', async () => {
      prisma.wallet.findFirst.mockResolvedValue(null);

      const file = createFile();
      await expect(
        service.upload({ ...baseParams, file }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should reject when wallet is INACTIVE', async () => {
      prisma.wallet.findFirst.mockResolvedValue({
        id: 'wallet-uuid',
        status: 'INACTIVE',
      });

      const file = createFile();
      await expect(
        service.upload({ ...baseParams, file }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should reject CSV file with only header (0 data lines)', async () => {
      const headerOnly = Buffer.from('cpf,numero,tipo,data,valor\n');
      const file = createFile({ buffer: headerOnly });

      prisma.wallet.findFirst.mockResolvedValue({
        id: 'wallet-uuid',
        status: 'ACTIVE',
      });

      await expect(
        service.upload({ ...baseParams, file }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should upload file to S3 and create batch', async () => {
      prisma.wallet.findFirst.mockResolvedValue({
        id: 'wallet-uuid',
        status: 'ACTIVE',
      });
      prisma.importBatch.create.mockResolvedValue({
        id: 'batch-uuid',
        status: 'PENDING_VALIDATION',
        totalLines: 2,
      });

      const file = createFile();
      const result = await service.upload({ ...baseParams, file });

      expect(storageService.upload).toHaveBeenCalledTimes(1);
      expect(prisma.importBatch.create).toHaveBeenCalledTimes(1);
      expect(validationQueue.add).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('batch-uuid');
    });

    it('should schedule BullMQ validation job after creation', async () => {
      prisma.wallet.findFirst.mockResolvedValue({
        id: 'wallet-uuid',
        status: 'ACTIVE',
      });
      prisma.importBatch.create.mockResolvedValue({
        id: 'batch-uuid',
        status: 'PENDING_VALIDATION',
        totalLines: 2,
      });

      const file = createFile();
      await service.upload({ ...baseParams, file });

      expect(validationQueue.add).toHaveBeenCalledWith(
        'validate',
        { batchId: 'batch-uuid' },
        { attempts: 1 },
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated list of import batches', async () => {
      prisma.importBatch.findMany.mockResolvedValue([
        { id: 'batch-1', status: 'VALIDATED', totalLines: 10 },
      ]);
      prisma.importBatch.count.mockResolvedValue(1);

      const result = await service.findAll(
        { page: 1, limit: 20 },
        'account-uuid',
      );

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should filter by walletId', async () => {
      prisma.importBatch.findMany.mockResolvedValue([]);
      prisma.importBatch.count.mockResolvedValue(0);

      await service.findAll(
        { page: 1, limit: 20, walletId: 'wallet-1' },
        'account-uuid',
      );

      expect(prisma.importBatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ walletId: 'wallet-1' }),
        }),
      );
    });

    it('should filter by status', async () => {
      prisma.importBatch.findMany.mockResolvedValue([]);
      prisma.importBatch.count.mockResolvedValue(0);

      await service.findAll(
        { page: 1, limit: 20, status: 'VALIDATED' },
        'account-uuid',
      );

      expect(prisma.importBatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'VALIDATED' }),
        }),
      );
    });

    it('should scope-filter for VIEWER users', async () => {
      prisma.importBatch.findMany.mockResolvedValue([]);
      prisma.importBatch.count.mockResolvedValue(0);

      await service.findAll(
        { page: 1, limit: 20 },
        'account-uuid',
        ['wallet-1', 'wallet-2'],
      );

      expect(prisma.importBatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            walletId: { in: ['wallet-1', 'wallet-2'] },
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return batch details', async () => {
      prisma.importBatch.findFirst.mockResolvedValue({
        id: 'batch-1',
        status: 'VALIDATED',
        wallet: { id: 'w-1', name: 'Wallet 1', creditorId: 'c-1' },
      });

      const result = await service.findOne('batch-1', 'account-uuid');
      expect(result.id).toBe('batch-1');
    });

    it('should throw NotFoundException when batch not found', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('nonexistent', 'account-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findErrors', () => {
    it('should return paginated errors', async () => {
      prisma.importBatch.findFirst.mockResolvedValue({ id: 'batch-1' });
      prisma.importBatchError.findMany.mockResolvedValue([
        { lineNumber: 2, errorCode: 'REQUIRED_FIELD', fieldName: 'debtorDocument', message: 'Campo obrigatório', fieldValue: null },
      ]);
      prisma.importBatchError.count.mockResolvedValue(1);

      const result = await service.findErrors('batch-1', { page: 1, limit: 50 }, 'account-uuid');
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should throw NotFoundException when batch not found', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(null);

      await expect(
        service.findErrors('nonexistent', { page: 1, limit: 50 }, 'account-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancel', () => {
    it('should cancel a PENDING_VALIDATION batch', async () => {
      prisma.importBatch.findFirst.mockResolvedValue({
        id: 'batch-1',
        status: 'PENDING_VALIDATION',
      });
      prisma.importBatch.update.mockResolvedValue({
        id: 'batch-1',
        status: 'CANCELLED',
      });

      const result = await service.cancel('batch-1', 'account-uuid');
      expect(result.status).toBe('CANCELLED');
    });

    it('should cancel a VALIDATING batch', async () => {
      prisma.importBatch.findFirst.mockResolvedValue({
        id: 'batch-1',
        status: 'VALIDATING',
      });
      prisma.importBatch.update.mockResolvedValue({
        id: 'batch-1',
        status: 'CANCELLED',
      });

      const result = await service.cancel('batch-1', 'account-uuid');
      expect(result.status).toBe('CANCELLED');
    });

    it('should cancel a VALIDATED batch', async () => {
      prisma.importBatch.findFirst.mockResolvedValue({
        id: 'batch-1',
        status: 'VALIDATED',
      });
      prisma.importBatch.update.mockResolvedValue({
        id: 'batch-1',
        status: 'CANCELLED',
      });

      const result = await service.cancel('batch-1', 'account-uuid');
      expect(result.status).toBe('CANCELLED');
    });

    it('should cancel a VALIDATED_WITH_ERRORS batch', async () => {
      prisma.importBatch.findFirst.mockResolvedValue({
        id: 'batch-1',
        status: 'VALIDATED_WITH_ERRORS',
      });
      prisma.importBatch.update.mockResolvedValue({
        id: 'batch-1',
        status: 'CANCELLED',
      });

      const result = await service.cancel('batch-1', 'account-uuid');
      expect(result.status).toBe('CANCELLED');
    });

    it('should reject cancelling APPLYING batch with 409', async () => {
      prisma.importBatch.findFirst.mockResolvedValue({
        id: 'batch-1',
        status: 'APPLYING',
      });

      await expect(
        service.cancel('batch-1', 'account-uuid'),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject cancelling APPLIED batch with 409', async () => {
      prisma.importBatch.findFirst.mockResolvedValue({
        id: 'batch-1',
        status: 'APPLIED',
      });

      await expect(
        service.cancel('batch-1', 'account-uuid'),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject cancelling FAILED batch with 409', async () => {
      prisma.importBatch.findFirst.mockResolvedValue({
        id: 'batch-1',
        status: 'FAILED',
      });

      await expect(
        service.cancel('batch-1', 'account-uuid'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when batch not found', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(null);

      await expect(
        service.cancel('nonexistent', 'account-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('countLines', () => {
    it('should count CSV lines excluding header', async () => {
      const buffer = Buffer.from('h1,h2\nv1,v2\nv3,v4\n');
      await expect(service.countLines(buffer, '.csv')).resolves.toBe(2);
    });

    it('should return 0 for CSV with only header', async () => {
      const buffer = Buffer.from('h1,h2\n');
      await expect(service.countLines(buffer, '.csv')).resolves.toBe(0);
    });

    it('should return 0 for empty CSV', async () => {
      const buffer = Buffer.from('');
      await expect(service.countLines(buffer, '.csv')).resolves.toBe(0);
    });

    it('should handle CSV without trailing newline', async () => {
      const buffer = Buffer.from('h1,h2\nv1,v2');
      await expect(service.countLines(buffer, '.csv')).resolves.toBe(1);
    });

    it('should count XLSX rows excluding the header', async () => {
      const worksheet = XLSX.utils.aoa_to_sheet([['number', 'document'], ['C001', '123'], ['C002', '456']]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Contracts');
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      await expect(service.countLines(buffer, '.xlsx')).resolves.toBe(2);
    });
  });
});

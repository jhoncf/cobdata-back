import { Test, TestingModule } from '@nestjs/testing';
import { ApplicationProcessor } from '../processors/application.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { DeduplicationService } from '../../contracts/deduplication.service';
import { Readable } from 'stream';
import { Decimal } from '@prisma/client/runtime/library';

describe('ApplicationProcessor', () => {
  let processor: ApplicationProcessor;
  let prisma: any;
  let storageService: any;
  let deduplicationService: DeduplicationService;

  const batchId = 'batch-123';
  const accountId = 'account-1';
  const walletId = 'wallet-1';
  const creditorId = 'creditor-1';

  function createCsvContent(lines: string[]): string {
    const header =
      'debtorDocument,contractNumber,debtType,occurrenceDate,originalValue,updatedValue,debtOrigin';
    return [header, ...lines].join('\n');
  }

  beforeEach(async () => {
    const txMock = {
      contract: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    prisma = {
      importBatch: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((fn) => fn(txMock)),
      _tx: txMock,
    };

    storageService = {
      download: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storageService },
        DeduplicationService,
      ],
    }).compile();

    processor = module.get<ApplicationProcessor>(ApplicationProcessor);
    deduplicationService = module.get<DeduplicationService>(DeduplicationService);
  });

  function mockBatch() {
    prisma.importBatch.findUnique.mockResolvedValue({
      id: batchId,
      accountId,
      walletId,
      fileUrl: 'imports/test.csv',
      columnMapping: {
        debtorDocument: 'debtorDocument',
        contractNumber: 'contractNumber',
        debtType: 'debtType',
        occurrenceDate: 'occurrenceDate',
        originalValue: 'originalValue',
        updatedValue: 'updatedValue',
        debtOrigin: 'debtOrigin',
      },
      wallet: { id: walletId, creditorId },
    });
  }

  function mockFileContent(content: string) {
    const readable = Readable.from([Buffer.from(content)]);
    storageService.download.mockResolvedValue(readable);
  }

  it('should CREATE a new contract when no match exists', async () => {
    mockBatch();
    const csv = createCsvContent([
      '12345678901,CTR001,COMMERCIAL,2024-01-15,1500.00,,',
    ]);
    mockFileContent(csv);
    prisma._tx.contract.findUnique.mockResolvedValue(null);

    const job = {
      data: { batchId },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any;

    await processor.process(job);

    expect(prisma._tx.contract.create).toHaveBeenCalledTimes(1);
    expect(prisma.importBatch.update).toHaveBeenCalledWith({
      where: { id: batchId },
      data: {
        createdCount: 1,
        updatedCount: 0,
        ignoredCount: 0,
        status: 'APPLIED',
      },
    });
  });

  it('should UPDATE an existing contract when values differ', async () => {
    mockBatch();
    const csv = createCsvContent([
      '12345678901,CTR001,COMMERCIAL,2024-01-15,2000.00,,',
    ]);
    mockFileContent(csv);

    prisma._tx.contract.findUnique.mockResolvedValue({
      id: 'contract-1',
      walletId,
      debtType: 'COMMERCIAL',
      occurrenceDate: new Date('2024-01-15'),
      originalValue: new Decimal('1500.00'),
      updatedValue: null,
      debtOrigin: null,
      status: 'ACTIVE',
      deletedAt: null,
    });

    const job = {
      data: { batchId },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any;

    await processor.process(job);

    expect(prisma._tx.contract.update).toHaveBeenCalledTimes(1);
    expect(prisma.importBatch.update).toHaveBeenCalledWith({
      where: { id: batchId },
      data: {
        createdCount: 0,
        updatedCount: 1,
        ignoredCount: 0,
        status: 'APPLIED',
      },
    });
  });

  it('should IGNORE when values are identical', async () => {
    mockBatch();
    const csv = createCsvContent([
      '12345678901,CTR001,COMMERCIAL,2024-01-15,1500.00,,',
    ]);
    mockFileContent(csv);

    prisma._tx.contract.findUnique.mockResolvedValue({
      id: 'contract-1',
      walletId,
      debtType: 'COMMERCIAL',
      occurrenceDate: new Date('2024-01-15'),
      originalValue: new Decimal('1500.00'),
      updatedValue: null,
      debtOrigin: null,
      status: 'ACTIVE',
      deletedAt: null,
    });

    const job = {
      data: { batchId },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any;

    await processor.process(job);

    expect(prisma._tx.contract.create).not.toHaveBeenCalled();
    expect(prisma._tx.contract.update).not.toHaveBeenCalled();
    expect(prisma.importBatch.update).toHaveBeenCalledWith({
      where: { id: batchId },
      data: {
        createdCount: 0,
        updatedCount: 0,
        ignoredCount: 1,
        status: 'APPLIED',
      },
    });
  });

  it('should reactivate SUSPENDED contracts on update', async () => {
    mockBatch();
    const csv = createCsvContent([
      '12345678901,CTR001,COMMERCIAL,2024-01-15,2000.00,,',
    ]);
    mockFileContent(csv);

    prisma._tx.contract.findUnique.mockResolvedValue({
      id: 'contract-1',
      walletId,
      debtType: 'COMMERCIAL',
      occurrenceDate: new Date('2024-01-15'),
      originalValue: new Decimal('1500.00'),
      updatedValue: null,
      debtOrigin: null,
      status: 'SUSPENDED',
      deletedAt: null,
    });

    const job = {
      data: { batchId },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any;

    await processor.process(job);

    expect(prisma._tx.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
  });

  it('should reactivate CANCELLED contracts on update', async () => {
    mockBatch();
    const csv = createCsvContent([
      '12345678901,CTR001,BANKING,2024-02-20,3000.00,,',
    ]);
    mockFileContent(csv);

    prisma._tx.contract.findUnique.mockResolvedValue({
      id: 'contract-2',
      walletId,
      debtType: 'COMMERCIAL',
      occurrenceDate: new Date('2024-01-15'),
      originalValue: new Decimal('1500.00'),
      updatedValue: null,
      debtOrigin: null,
      status: 'CANCELLED',
      deletedAt: null,
    });

    const job = {
      data: { batchId },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any;

    await processor.process(job);

    expect(prisma._tx.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
  });

  it('should set FAILED status when retries exhausted', async () => {
    mockBatch();
    storageService.download.mockRejectedValue(new Error('S3 failure'));

    const job = {
      data: { batchId },
      attemptsMade: 2,
      opts: { attempts: 3 },
    } as any;

    await expect(processor.process(job)).rejects.toThrow('S3 failure');

    expect(prisma.importBatch.update).toHaveBeenCalledWith({
      where: { id: batchId },
      data: { status: 'FAILED' },
    });
  });
});

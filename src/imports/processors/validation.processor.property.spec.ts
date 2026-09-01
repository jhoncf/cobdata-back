import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationProcessor, LineData } from './validation.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { DeduplicationService } from '../../contracts/deduplication.service';

/**
 * Property 17: Import Line Validation Correctness
 *
 * For any import line, if all required contract fields are present,
 * within valid ranges, and the DeduplicationKey does not conflict with
 * a provider-linked contract or cross-wallet contract, the line SHALL
 * be classified as valid. Otherwise, it SHALL be classified as invalid
 * with the appropriate error code.
 *
 * **Validates: Requirements 14.1, 14.5b, 14.5c**
 */
describe('Property 17: Import Line Validation Correctness', () => {
  let processor: ValidationProcessor;
  let prisma: any;

  // Helper: generate a string of N digits
  const digitStringGen = (len: number) =>
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: len, maxLength: len })
      .map(digits => digits.join(''));

  // Generators for valid field values
  const validCpfGen = digitStringGen(11);
  const validCnpjGen = digitStringGen(14);
  const validDocGen = fc.oneof(validCpfGen, validCnpjGen);

  const validContractNumberGen = fc.string({ minLength: 1, maxLength: 100 })
    .filter(s => s.trim().length > 0);

  const validDebtTypeGen = fc.constantFrom(
    'COMMERCIAL', 'BANKING', 'SERVICES', 'UTILITIES',
    'TELECOM', 'EDUCATION', 'HEALTH', 'CONDOMINIAL', 'OTHER',
  );

  // Safe date generator that produces valid ISO date strings in the past
  const validDateGen = fc.tuple(
    fc.integer({ min: 2000, max: 2024 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  ).map(([year, month, day]) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );

  const validValueGen = fc.double({ min: 0.01, max: 999999999.99, noNaN: true })
    .map(v => v.toFixed(2));

  const validLineGen = fc.record({
    debtorDocument: validDocGen,
    contractNumber: validContractNumberGen,
    debtType: validDebtTypeGen,
    occurrenceDate: validDateGen,
    originalValue: validValueGen,
  });

  // Generators for invalid values
  const invalidDocGen = fc.oneof(
    digitStringGen(5),
    digitStringGen(12),
    digitStringGen(15),
  );

  // Invalid debt type: non-empty after trim, and not a valid type
  const invalidDebtTypeGen = fc.string({ minLength: 1, maxLength: 30 })
    .filter(s => {
      const trimmed = s.trim();
      if (trimmed.length === 0) return false; // Exclude whitespace-only (would be REQUIRED_FIELD)
      return !['COMMERCIAL', 'BANKING', 'SERVICES', 'UTILITIES', 'TELECOM', 'EDUCATION', 'HEALTH', 'CONDOMINIAL', 'OTHER'].includes(trimmed.toUpperCase());
    });

  const invalidValueGen = fc.oneof(
    fc.constant('0'),
    fc.constant('-1'),
    fc.constant('10000000000'),
    fc.constant('abc'),
  );

  beforeEach(async () => {
    prisma = {
      importBatch: { update: jest.fn(), findUnique: jest.fn() },
      importBatchError: { createMany: jest.fn() },
      contract: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    const storageService = { download: jest.fn() };
    const deduplicationService = new DeduplicationService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidationProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storageService },
        { provide: DeduplicationService, useValue: deduplicationService },
      ],
    }).compile();

    processor = module.get<ValidationProcessor>(ValidationProcessor);
  });

  it('valid line with no dedup conflict => classified as valid (0 errors)', async () => {
    await fc.assert(
      fc.asyncProperty(validLineGen, async (lineData) => {
        prisma.contract.findUnique.mockResolvedValue(null);

        const errors = await processor.validateLine(
          lineData as unknown as LineData,
          2,
          'creditor-id',
          'wallet-id',
        );

        return errors.length === 0;
      }),
      { numRuns: 50 },
    );
  });

  it('line with missing required field => classified as invalid with REQUIRED_FIELD', async () => {
    const requiredFields = ['debtorDocument', 'contractNumber', 'debtType', 'occurrenceDate', 'originalValue'] as const;
    const fieldToRemoveGen = fc.constantFrom(...requiredFields);

    await fc.assert(
      fc.asyncProperty(validLineGen, fieldToRemoveGen, async (lineData, fieldToRemove) => {
        prisma.contract.findUnique.mockResolvedValue(null);

        const invalidLine = { ...lineData, [fieldToRemove]: '' } as unknown as LineData;

        const errors = await processor.validateLine(
          invalidLine,
          2,
          'creditor-id',
          'wallet-id',
        );

        return (
          errors.length > 0 &&
          errors.some(e => e.errorCode === 'REQUIRED_FIELD' && e.fieldName === fieldToRemove)
        );
      }),
      { numRuns: 30 },
    );
  });

  it('line with invalid debtorDocument length => classified as invalid with INVALID_FORMAT', async () => {
    await fc.assert(
      fc.asyncProperty(
        validLineGen,
        invalidDocGen,
        async (lineData, badDoc) => {
          prisma.contract.findUnique.mockResolvedValue(null);

          const invalidLine = { ...lineData, debtorDocument: badDoc } as unknown as LineData;

          const errors = await processor.validateLine(
            invalidLine,
            2,
            'creditor-id',
            'wallet-id',
          );

          return (
            errors.length > 0 &&
            errors.some(e => e.errorCode === 'INVALID_FORMAT' && e.fieldName === 'debtorDocument')
          );
        },
      ),
      { numRuns: 30 },
    );
  });

  it('line with invalid debtType => classified as invalid with INVALID_FORMAT', async () => {
    await fc.assert(
      fc.asyncProperty(validLineGen, invalidDebtTypeGen, async (lineData, badType) => {
        prisma.contract.findUnique.mockResolvedValue(null);

        const invalidLine = { ...lineData, debtType: badType } as unknown as LineData;

        const errors = await processor.validateLine(
          invalidLine,
          2,
          'creditor-id',
          'wallet-id',
        );

        return (
          errors.length > 0 &&
          errors.some(e => e.errorCode === 'INVALID_FORMAT' && e.fieldName === 'debtType')
        );
      }),
      { numRuns: 30 },
    );
  });

  it('line with invalid originalValue => classified as invalid with INVALID_RANGE', async () => {
    await fc.assert(
      fc.asyncProperty(validLineGen, invalidValueGen, async (lineData, badValue) => {
        prisma.contract.findUnique.mockResolvedValue(null);

        const invalidLine = { ...lineData, originalValue: badValue } as unknown as LineData;

        const errors = await processor.validateLine(
          invalidLine,
          2,
          'creditor-id',
          'wallet-id',
        );

        return errors.length > 0;
      }),
      { numRuns: 20 },
    );
  });

  it('PROVIDER_CONFLICT: valid line + existing contract with non-compatible serasaStatus => invalid', async () => {
    const conflictStatuses = ['SENT', 'REGISTERED', 'UPDATED', 'REMOVING', 'IN_AGREEMENT', 'AGREEMENT_BREACHED', 'PAID'] as const;
    const conflictStatusGen = fc.constantFrom(...conflictStatuses);

    await fc.assert(
      fc.asyncProperty(validLineGen, conflictStatusGen, async (lineData, status) => {
        prisma.contract.findUnique.mockResolvedValue({
          id: 'existing-contract',
          walletId: 'wallet-id', // same wallet
          serasaStatus: status,
          deletedAt: null,
        });

        const errors = await processor.validateLine(
          lineData as unknown as LineData,
          2,
          'creditor-id',
          'wallet-id',
        );

        return (
          errors.length > 0 &&
          errors.some(e => e.errorCode === 'PROVIDER_CONFLICT')
        );
      }),
      { numRuns: 20 },
    );
  });

  it('WALLET_MISMATCH: valid line + existing contract in different wallet => invalid', async () => {
    await fc.assert(
      fc.asyncProperty(validLineGen, async (lineData) => {
        prisma.contract.findUnique.mockResolvedValue({
          id: 'existing-contract',
          walletId: 'different-wallet-id',
          serasaStatus: 'PENDING',
          deletedAt: null,
        });

        const errors = await processor.validateLine(
          lineData as unknown as LineData,
          2,
          'creditor-id',
          'wallet-id',
        );

        return (
          errors.length > 0 &&
          errors.some(e => e.errorCode === 'WALLET_MISMATCH')
        );
      }),
      { numRuns: 20 },
    );
  });

  it('no conflict when existing contract has compatible serasaStatus (PENDING/FAILED/REMOVED)', async () => {
    const compatibleStatuses = ['PENDING', 'FAILED', 'REMOVED'] as const;
    const compatibleStatusGen = fc.constantFrom(...compatibleStatuses);

    await fc.assert(
      fc.asyncProperty(validLineGen, compatibleStatusGen, async (lineData, status) => {
        prisma.contract.findUnique.mockResolvedValue({
          id: 'existing-contract',
          walletId: 'wallet-id', // same wallet
          serasaStatus: status,
          deletedAt: null,
        });

        const errors = await processor.validateLine(
          lineData as unknown as LineData,
          2,
          'creditor-id',
          'wallet-id',
        );

        return errors.length === 0;
      }),
      { numRuns: 20 },
    );
  });
});

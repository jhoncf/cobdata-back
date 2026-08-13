import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ContractsService } from '../contracts.service';
import { DeduplicationService } from '../deduplication.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConflictException } from '@nestjs/common';
import { DebtType } from '@prisma/client';

/**
 * Property 10: Deduplication Idempotent Upsert
 *
 * **Validates: Requirements 11.3, 11.5**
 *
 * - Same key + same wallet → update (no duplicate created)
 * - Same key + different wallet → 409
 */
describe('Property 10: Deduplication Idempotent Upsert', () => {
  let service: ContractsService;
  let prisma: any;

  const mockAccountId = '11111111-1111-1111-1111-111111111111';
  const mockCreditorId = '33333333-3333-3333-3333-333333333333';

  beforeEach(async () => {
    prisma = {
      wallet: {
        findFirst: jest.fn(),
      },
      contract: {
        findUnique: jest.fn(),
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
  });

  // Generator for 11-digit or 14-digit numeric strings
  const digitStringArb = (len: number) =>
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: len, maxLength: len })
      .map((digits) => digits.join(''));

  const documentArb = fc.oneof(digitStringArb(11), digitStringArb(14));

  // Generator for valid contract DTOs
  const contractDtoArb = fc.record({
    walletId: fc.uuid(),
    debtorDocument: documentArb,
    contractNumber: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    debtType: fc.constantFrom(...Object.values(DebtType)),
    occurrenceDate: fc.constant('2024-01-15'),
    originalValue: fc.double({ min: 0.01, max: 999999999.99, noNaN: true }),
  });

  it('same dedup key + same wallet → update (no duplicate created)', async () => {
    await fc.assert(
      fc.asyncProperty(contractDtoArb, async (dto) => {
        const walletId = dto.walletId;

        prisma.wallet.findFirst.mockResolvedValue({
          id: walletId,
          accountId: mockAccountId,
          creditorId: mockCreditorId,
          status: 'ACTIVE',
          deletedAt: null,
        });

        // Existing contract in SAME wallet
        prisma.contract.findUnique.mockResolvedValue({
          id: 'existing-id',
          walletId: walletId,
          debtorDocument: dto.debtorDocument,
          contractNumber: dto.contractNumber,
        });

        prisma.contract.update.mockResolvedValue({
          id: 'existing-id',
          walletId,
        });

        await service.createOrUpdate(dto as any, mockAccountId);

        // Should call update, not create
        expect(prisma.contract.update).toHaveBeenCalled();
        expect(prisma.contract.create).not.toHaveBeenCalled();

        jest.clearAllMocks();
      }),
      { numRuns: 50 },
    );
  });

  it('same dedup key + different wallet → 409 Conflict', async () => {
    await fc.assert(
      fc.asyncProperty(contractDtoArb, fc.uuid(), async (dto, differentWalletId) => {
        fc.pre(dto.walletId !== differentWalletId);

        prisma.wallet.findFirst.mockResolvedValue({
          id: dto.walletId,
          accountId: mockAccountId,
          creditorId: mockCreditorId,
          status: 'ACTIVE',
          deletedAt: null,
        });

        // Existing contract in DIFFERENT wallet
        prisma.contract.findUnique.mockResolvedValue({
          id: 'existing-id',
          walletId: differentWalletId,
        });

        await expect(
          service.createOrUpdate(dto as any, mockAccountId),
        ).rejects.toThrow(ConflictException);

        jest.clearAllMocks();
      }),
      { numRuns: 50 },
    );
  });
});

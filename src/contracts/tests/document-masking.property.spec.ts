import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ContractsService } from '../contracts.service';
import { DeduplicationService } from '../deduplication.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Property 30: Document Masking for VIEWER
 *
 * **Validates: Requirements 11.4**
 *
 * - VIEWER sees last 4 chars only (masked as ***XXXX)
 * - ADMIN/OPERATIONAL see full document
 */
describe('Property 30: Document Masking for VIEWER', () => {
  let service: ContractsService;
  let prisma: any;

  const mockAccountId = '11111111-1111-1111-1111-111111111111';
  const mockWalletId = '22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    prisma = {
      wallet: {
        findFirst: jest.fn(),
      },
      contract: {
        findMany: jest.fn(),
        count: jest.fn(),
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

  it('VIEWER sees only last 4 chars of document (masked)', async () => {
    await fc.assert(
      fc.asyncProperty(documentArb, async (document) => {
        const contracts = [
          {
            id: 'c1',
            debtorDocument: document,
            walletId: mockWalletId,
            accountId: mockAccountId,
          },
        ];

        prisma.contract.findMany.mockResolvedValue(contracts);
        prisma.contract.count.mockResolvedValue(1);

        const result = await service.list(
          { page: 1, limit: 20 },
          mockAccountId,
          'VIEWER',
          [mockWalletId],
        );

        const maskedDoc = result.data[0].debtorDocument;
        const last4 = document.slice(-4);

        // Must show only last 4 chars prefixed with ***
        expect(maskedDoc).toBe(`***${last4}`);
        // Must NOT contain the full document
        expect(maskedDoc).not.toBe(document);
        // The masked version length should be 7 (***XXXX)
        expect(maskedDoc.length).toBe(7);

        jest.clearAllMocks();
      }),
      { numRuns: 100 },
    );
  });

  it('ADMIN sees full document (no masking)', async () => {
    await fc.assert(
      fc.asyncProperty(documentArb, async (document) => {
        const contracts = [
          {
            id: 'c1',
            debtorDocument: document,
            walletId: mockWalletId,
            accountId: mockAccountId,
          },
        ];

        prisma.contract.findMany.mockResolvedValue(contracts);
        prisma.contract.count.mockResolvedValue(1);

        const result = await service.list(
          { page: 1, limit: 20 },
          mockAccountId,
          'ADMIN',
        );

        expect(result.data[0].debtorDocument).toBe(document);

        jest.clearAllMocks();
      }),
      { numRuns: 100 },
    );
  });

  it('OPERATIONAL sees full document (no masking)', async () => {
    await fc.assert(
      fc.asyncProperty(documentArb, async (document) => {
        const contracts = [
          {
            id: 'c1',
            debtorDocument: document,
            walletId: mockWalletId,
            accountId: mockAccountId,
          },
        ];

        prisma.contract.findMany.mockResolvedValue(contracts);
        prisma.contract.count.mockResolvedValue(1);

        const result = await service.list(
          { page: 1, limit: 20 },
          mockAccountId,
          'OPERATIONAL',
        );

        expect(result.data[0].debtorDocument).toBe(document);

        jest.clearAllMocks();
      }),
      { numRuns: 100 },
    );
  });
});

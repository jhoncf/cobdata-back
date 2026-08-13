import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ContractsService } from '../contracts.service';
import { DeduplicationService } from '../deduplication.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConflictException } from '@nestjs/common';
import { ContractStatus } from '@prisma/client';

/**
 * Property 12: Internal Status Transitions
 *
 * **Validates: Requirements 11.8b**
 *
 * - Only ACTIVE↔SUSPENDED, ACTIVE→CANCELLED, SUSPENDED→CANCELLED
 * - All other transitions rejected
 */
describe('Property 12: Internal Status Transitions', () => {
  let service: ContractsService;
  let prisma: any;

  const mockAccountId = '11111111-1111-1111-1111-111111111111';
  const mockWalletId = '22222222-2222-2222-2222-222222222222';

  const ALL_STATUSES: ContractStatus[] = ['ACTIVE', 'SUSPENDED', 'CANCELLED'];

  // Allowed transitions: ACTIVE↔SUSPENDED, ACTIVE→CANCELLED, SUSPENDED→CANCELLED
  const ALLOWED_TRANSITIONS: Array<[ContractStatus, ContractStatus]> = [
    ['ACTIVE', 'SUSPENDED'],
    ['ACTIVE', 'CANCELLED'],
    ['SUSPENDED', 'ACTIVE'],
    ['SUSPENDED', 'CANCELLED'],
  ];

  // Invalid transitions: CANCELLED→ACTIVE, CANCELLED→SUSPENDED
  const INVALID_TRANSITIONS: Array<[ContractStatus, ContractStatus]> = [
    ['CANCELLED', 'ACTIVE'],
    ['CANCELLED', 'SUSPENDED'],
  ];

  beforeEach(async () => {
    prisma = {
      wallet: {
        findFirst: jest.fn(),
      },
      contract: {
        findFirst: jest.fn(),
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

  it('allowed transitions succeed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALLOWED_TRANSITIONS),
        async ([fromStatus, toStatus]) => {
          const contract = {
            id: 'contract-id',
            accountId: mockAccountId,
            walletId: mockWalletId,
            providerStatus: 'PENDING',
            status: fromStatus,
            deletedAt: null,
          };

          prisma.contract.findFirst.mockResolvedValue(contract);
          prisma.contract.update.mockResolvedValue({
            ...contract,
            status: toStatus,
          });

          const result = await service.update(
            'contract-id',
            { status: toStatus },
            mockAccountId,
          );

          expect(result.status).toBe(toStatus);

          jest.clearAllMocks();
        },
      ),
      { numRuns: 20 },
    );
  });

  it('disallowed transitions are rejected with 409', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...INVALID_TRANSITIONS),
        async ([fromStatus, toStatus]) => {
          const contract = {
            id: 'contract-id',
            accountId: mockAccountId,
            walletId: mockWalletId,
            providerStatus: 'PENDING',
            status: fromStatus,
            deletedAt: null,
          };

          prisma.contract.findFirst.mockResolvedValue(contract);

          await expect(
            service.update(
              'contract-id',
              { status: toStatus },
              mockAccountId,
            ),
          ).rejects.toThrow(ConflictException);

          jest.clearAllMocks();
        },
      ),
      { numRuns: 20 },
    );
  });

  it('same status (no actual transition) does not throw', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_STATUSES),
        async (status) => {
          const contract = {
            id: 'contract-id',
            accountId: mockAccountId,
            walletId: mockWalletId,
            providerStatus: 'PENDING',
            status,
            deletedAt: null,
          };

          prisma.contract.findFirst.mockResolvedValue(contract);
          prisma.contract.update.mockResolvedValue(contract);

          const result = await service.update(
            'contract-id',
            { status },
            mockAccountId,
          );
          expect(result).toBeDefined();

          jest.clearAllMocks();
        },
      ),
      { numRuns: 10 },
    );
  });
});

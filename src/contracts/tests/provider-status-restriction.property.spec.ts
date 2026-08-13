import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ContractsService } from '../contracts.service';
import { DeduplicationService } from '../deduplication.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConflictException } from '@nestjs/common';
import { ProviderStatus } from '@prisma/client';

/**
 * Property 11: ProviderStatus Edit Restriction
 *
 * **Validates: Requirements 11.8, 11.9**
 *
 * - PATCH succeeds only when providerStatus in {PENDING, FAILED, REMOVED}
 * - All other statuses → 409
 */
describe('Property 11: ProviderStatus Edit Restriction', () => {
  let service: ContractsService;
  let prisma: any;

  const mockAccountId = '11111111-1111-1111-1111-111111111111';
  const mockWalletId = '22222222-2222-2222-2222-222222222222';

  const EDITABLE_STATUSES: ProviderStatus[] = ['PENDING', 'FAILED', 'REMOVED'];
  const NON_EDITABLE_STATUSES: ProviderStatus[] = [
    'SENT',
    'REGISTERED',
    'UPDATED',
    'REMOVING',
    'IN_AGREEMENT',
    'AGREEMENT_BREACHED',
    'PAID',
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

  it('PATCH succeeds when providerStatus is in {PENDING, FAILED, REMOVED}', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...EDITABLE_STATUSES),
        fc.double({ min: 0.01, max: 999999999.99, noNaN: true }),
        async (providerStatus, newValue) => {
          const contract = {
            id: 'contract-id',
            accountId: mockAccountId,
            walletId: mockWalletId,
            providerStatus,
            status: 'ACTIVE',
            deletedAt: null,
          };

          prisma.contract.findFirst.mockResolvedValue(contract);
          prisma.contract.update.mockResolvedValue({
            ...contract,
            originalValue: newValue,
          });

          const result = await service.update(
            'contract-id',
            { originalValue: newValue },
            mockAccountId,
          );

          expect(result).toBeDefined();
          expect(prisma.contract.update).toHaveBeenCalled();

          jest.clearAllMocks();
        },
      ),
      { numRuns: 30 },
    );
  });

  it('PATCH rejects with 409 when providerStatus is NOT in {PENDING, FAILED, REMOVED}', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...NON_EDITABLE_STATUSES),
        fc.double({ min: 0.01, max: 999999999.99, noNaN: true }),
        async (providerStatus, newValue) => {
          const contract = {
            id: 'contract-id',
            accountId: mockAccountId,
            walletId: mockWalletId,
            providerStatus,
            status: 'ACTIVE',
            deletedAt: null,
          };

          prisma.contract.findFirst.mockResolvedValue(contract);

          await expect(
            service.update(
              'contract-id',
              { originalValue: newValue },
              mockAccountId,
            ),
          ).rejects.toThrow(ConflictException);

          jest.clearAllMocks();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('DELETE succeeds when providerStatus is in {PENDING, FAILED, REMOVED}', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...EDITABLE_STATUSES),
        async (providerStatus) => {
          const contract = {
            id: 'contract-id',
            accountId: mockAccountId,
            walletId: mockWalletId,
            providerStatus,
            status: 'ACTIVE',
            deletedAt: null,
          };

          prisma.contract.findFirst.mockResolvedValue(contract);
          prisma.contract.update.mockResolvedValue({
            ...contract,
            deletedAt: new Date(),
          });

          const result = await service.softDelete('contract-id', mockAccountId);
          expect(result).toBeDefined();
          expect(result.deletedAt).toBeDefined();

          jest.clearAllMocks();
        },
      ),
      { numRuns: 30 },
    );
  });

  it('DELETE rejects with 409 when providerStatus is NOT in {PENDING, FAILED, REMOVED}', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...NON_EDITABLE_STATUSES),
        async (providerStatus) => {
          const contract = {
            id: 'contract-id',
            accountId: mockAccountId,
            walletId: mockWalletId,
            providerStatus,
            status: 'ACTIVE',
            deletedAt: null,
          };

          prisma.contract.findFirst.mockResolvedValue(contract);

          await expect(
            service.softDelete('contract-id', mockAccountId),
          ).rejects.toThrow(ConflictException);

          jest.clearAllMocks();
        },
      ),
      { numRuns: 50 },
    );
  });
});

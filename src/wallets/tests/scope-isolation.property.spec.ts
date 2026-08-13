import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { WalletsService } from '../wallets.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';

/**
 * Property 7: Scope-based data isolation
 *
 * **Validates: Requirements 8.3, 8.4, 8.5, 8.6**
 *
 * VIEWER with scopes S: listings return only resources in S.
 * Access to wallet NOT in S returns 403.
 */
describe('Property 7: Scope-based data isolation', () => {
  let service: WalletsService;
  let prisma: any;

  const accountId = 'account-uuid-1';

  beforeEach(async () => {
    prisma = {
      creditor: { findFirst: jest.fn() },
      wallet: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      contract: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WalletsService>(WalletsService);
  });

  it('VIEWER listing only returns wallets within assigned scopes', () => {
    return fc.assert(
      fc.asyncProperty(
        // Generate a universe of wallet IDs (1..20 wallets)
        fc.array(fc.uuid(), { minLength: 1, maxLength: 20 }),
        // Generate viewer scopes as a subset of the universe
        fc.array(fc.uuid(), { minLength: 0, maxLength: 10 }),
        async (allWalletIds, scopeWalletIds) => {
          // Ensure scopes is a subset of allWalletIds
          const uniqueAll = [...new Set(allWalletIds)];
          const scopes = scopeWalletIds.filter((id) => uniqueAll.includes(id));

          // Simulate: wallets in DB are allWalletIds, viewer has `scopes`
          const walletsInDb = uniqueAll.map((id) => ({
            id,
            accountId,
            creditorId: 'cred-1',
            name: `Wallet ${id.slice(0, 4)}`,
            status: 'ACTIVE',
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }));

          // Mock: findMany returns only wallets where id is in the provided scope filter
          prisma.wallet.findMany.mockImplementation(({ where }: any) => {
            if (where?.id?.in) {
              return Promise.resolve(
                walletsInDb.filter((w) => where.id.in.includes(w.id)),
              );
            }
            return Promise.resolve(walletsInDb);
          });

          prisma.wallet.count.mockImplementation(({ where }: any) => {
            if (where?.id?.in) {
              return Promise.resolve(
                walletsInDb.filter((w) => where.id.in.includes(w.id)).length,
              );
            }
            return Promise.resolve(walletsInDb.length);
          });

          // Act: list with viewer scopes
          const result = await service.list({ page: 1, limit: 100 }, accountId, scopes);

          // Property: every returned wallet must be in scopes
          for (const wallet of result.data) {
            expect(scopes).toContain(wallet.id);
          }

          // Property: no wallet outside scopes is returned
          const returnedIds = result.data.map((w) => w.id);
          const outsideScope = uniqueAll.filter((id) => !scopes.includes(id));
          for (const outId of outsideScope) {
            expect(returnedIds).not.toContain(outId);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('VIEWER access to wallet NOT in scopes returns 403', () => {
    return fc.assert(
      fc.asyncProperty(
        // walletId that the viewer wants to access
        fc.uuid(),
        // scopes that do NOT include the requested wallet
        fc.array(fc.uuid(), { minLength: 0, maxLength: 10 }),
        async (requestedWalletId, scopeWalletIds) => {
          // Ensure the requested wallet is NOT in the scopes
          const scopes = scopeWalletIds.filter((id) => id !== requestedWalletId);

          // Wallet exists in DB
          const walletInDb = {
            id: requestedWalletId,
            accountId,
            creditorId: 'cred-1',
            name: 'Some Wallet',
            status: 'ACTIVE',
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          prisma.wallet.findFirst.mockResolvedValue(walletInDb);

          // Act & Assert: should throw ForbiddenException
          await expect(
            service.findById(requestedWalletId, accountId, scopes),
          ).rejects.toThrow(ForbiddenException);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('VIEWER with empty scopes gets empty list', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 10 }),
        async (allWalletIds) => {
          const emptyScopes: string[] = [];

          prisma.wallet.findMany.mockImplementation(({ where }: any) => {
            if (where?.id?.in) {
              return Promise.resolve([]);
            }
            return Promise.resolve(
              allWalletIds.map((id) => ({ id, accountId, name: 'W' })),
            );
          });

          prisma.wallet.count.mockResolvedValue(0);

          const result = await service.list({ page: 1, limit: 100 }, accountId, emptyScopes);

          // Property: empty scopes → empty results
          expect(result.data).toHaveLength(0);
          expect(result.meta.total).toBe(0);
        },
      ),
      { numRuns: 30 },
    );
  });
});

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ContractsService } from '../contracts.service';
import { DeduplicationService } from '../deduplication.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Property 15: Tag AND Filter Logic
 *
 * **Validates: Requirements 12.5**
 *
 * For filter tags T, every result has ALL tags in T.
 * No contract missing any tag from T appears in results.
 */
describe('Property 15: Tag AND Filter Logic', () => {
  let service: ContractsService;
  let prisma: any;

  const mockAccountId = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    prisma = {
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

  it('when tags filter is applied, the Prisma where clause contains AND conditions for every tag', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
          { minLength: 1, maxLength: 5 },
        ),
        async (filterTags) => {
          prisma.contract.findMany.mockResolvedValue([]);
          prisma.contract.count.mockResolvedValue(0);

          await service.list(
            { page: 1, limit: 20, tags: filterTags },
            mockAccountId,
            'ADMIN',
          );

          // Verify the where clause passed to findMany
          const findManyCall = prisma.contract.findMany.mock.calls[0][0];
          const whereClause = findManyCall.where;

          // The AND array must exist and contain one entry per normalized unique tag
          const normalizedTags = [...new Set(filterTags.map((t) => t.toLowerCase().trim()))];
          expect(whereClause.AND).toBeDefined();
          expect(whereClause.AND.length).toBe(normalizedTags.length);

          // Each AND condition must filter by tag: { some: { tag: normalizedTag } }
          for (let i = 0; i < normalizedTags.length; i++) {
            expect(whereClause.AND[i]).toEqual({
              tags: { some: { tag: normalizedTags[i] } },
            });
          }

          jest.clearAllMocks();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('contracts returned from DB all satisfy the AND filter (mock verification)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
          { minLength: 1, maxLength: 3 },
        ),
        async (filterTags) => {
          const normalizedFilter = [...new Set(filterTags.map((t) => t.toLowerCase().trim()))];

          // Simulate contracts that match — they have all filter tags
          const mockContracts = [
            {
              id: 'c1',
              accountId: mockAccountId,
              debtorDocument: '12345678901',
              tags: normalizedFilter.map((t) => ({ tag: t })),
            },
            {
              id: 'c2',
              accountId: mockAccountId,
              debtorDocument: '98765432100',
              tags: [...normalizedFilter.map((t) => ({ tag: t })), { tag: 'extra' }],
            },
          ];

          prisma.contract.findMany.mockResolvedValue(mockContracts);
          prisma.contract.count.mockResolvedValue(2);

          const result = await service.list(
            { page: 1, limit: 20, tags: filterTags },
            mockAccountId,
            'ADMIN',
          );

          // Every returned contract must have ALL the filter tags
          for (const contract of result.data) {
            for (const filterTag of normalizedFilter) {
              expect(contract.tags).toContain(filterTag);
            }
          }

          jest.clearAllMocks();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('without tags filter, no AND clause is added to the where condition', async () => {
    prisma.contract.findMany.mockResolvedValue([]);
    prisma.contract.count.mockResolvedValue(0);

    await service.list(
      { page: 1, limit: 20 },
      mockAccountId,
      'ADMIN',
    );

    const findManyCall = prisma.contract.findMany.mock.calls[0][0];
    expect(findManyCall.where.AND).toBeUndefined();
  });
});

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { TagsService } from '../tags.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Property 16: Tag Limit Enforcement
 *
 * **Validates: Requirements 12.2**
 *
 * Adding M tags when N exist and N + M (after dedup with existing) > 20 → 422.
 * Existing tags remain unchanged (createMany is never called).
 */
describe('Property 16: Tag Limit Enforcement', () => {
  let service: TagsService;
  let prisma: any;

  const mockAccountId = '11111111-1111-1111-1111-111111111111';
  const mockContractId = '22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    prisma = {
      contract: {
        findFirst: jest.fn(),
      },
      contractTag: {
        count: jest.fn(),
        findMany: jest.fn(),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TagsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<TagsService>(TagsService);
  });

  it('rejects with 422 when existing + new unique tags would exceed 20', async () => {
    await fc.assert(
      fc.asyncProperty(
        // existingCount: 0..20
        fc.nat({ max: 20 }),
        // newTagCount: 1..20
        fc.integer({ min: 1, max: 20 }),
        async (existingCount, newTagCount) => {
          // Generate existing tags
          const existingTags = Array.from({ length: existingCount }, (_, i) => `existing-${i}`);

          // Generate new tags that are ALL unique (not in existing)
          const newTags = Array.from({ length: newTagCount }, (_, i) => `new-${i}`);

          // Only test when total would exceed 20
          if (existingCount + newTagCount <= 20) {
            return; // Skip — this case should succeed
          }

          prisma.contract.findFirst.mockResolvedValue({
            id: mockContractId,
            accountId: mockAccountId,
          });
          prisma.contractTag.count.mockResolvedValue(existingCount);
          prisma.contractTag.findMany.mockResolvedValue(
            existingTags.map((t) => ({ tag: t })),
          );

          await expect(
            service.addTags(mockContractId, newTags, mockAccountId),
          ).rejects.toThrow(UnprocessableEntityException);

          // createMany should never be called — existing tags unchanged
          expect(prisma.contractTag.createMany).not.toHaveBeenCalled();

          jest.clearAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('allows adding tags when existing + new unique tags is at most 20', async () => {
    await fc.assert(
      fc.asyncProperty(
        // existingCount: 0..19
        fc.nat({ max: 19 }),
        // newTagCount: 1..20
        fc.integer({ min: 1, max: 20 }),
        async (existingCount, newTagCount) => {
          // Generate existing tags
          const existingTags = Array.from({ length: existingCount }, (_, i) => `existing-${i}`);
          // Generate new tags that are unique
          const newTags = Array.from({ length: newTagCount }, (_, i) => `new-${i}`);

          // Only test when total would NOT exceed 20
          if (existingCount + newTagCount > 20) {
            return; // Skip — this case should fail
          }

          prisma.contract.findFirst.mockResolvedValue({
            id: mockContractId,
            accountId: mockAccountId,
          });
          prisma.contractTag.count.mockResolvedValue(existingCount);
          prisma.contractTag.findMany
            .mockResolvedValueOnce(existingTags.map((t) => ({ tag: t })))
            .mockResolvedValueOnce([
              ...existingTags.map((t) => ({ tag: t })),
              ...newTags.map((t) => ({ tag: t })),
            ]);
          prisma.contractTag.createMany.mockResolvedValue({ count: newTagCount });

          const result = await service.addTags(
            mockContractId,
            newTags,
            mockAccountId,
          );

          expect(result.contractId).toBe(mockContractId);
          expect(prisma.contractTag.createMany).toHaveBeenCalled();

          jest.clearAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('deduplication with existing tags reduces new unique count correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Number of existing tags (15..19 to be near limit)
        fc.integer({ min: 15, max: 19 }),
        // Number of tags to add that overlap with existing
        fc.integer({ min: 1, max: 5 }),
        // Number of truly new tags
        fc.integer({ min: 1, max: 5 }),
        async (existingCount, overlapCount, trulyNewCount) => {
          const existingTags = Array.from({ length: existingCount }, (_, i) => `tag-${i}`);

          // Some tags overlap with existing, some are new
          const actualOverlap = Math.min(overlapCount, existingCount);
          const overlappingTags = existingTags.slice(0, actualOverlap);
          const trulyNewTags = Array.from({ length: trulyNewCount }, (_, i) => `brand-new-${i}`);
          const tagsToAdd = [...overlappingTags, ...trulyNewTags];

          const totalAfterAdd = existingCount + trulyNewCount;

          prisma.contract.findFirst.mockResolvedValue({
            id: mockContractId,
            accountId: mockAccountId,
          });
          prisma.contractTag.count.mockResolvedValue(existingCount);
          prisma.contractTag.findMany.mockResolvedValueOnce(
            existingTags.map((t) => ({ tag: t })),
          );

          if (totalAfterAdd > 20) {
            await expect(
              service.addTags(mockContractId, tagsToAdd, mockAccountId),
            ).rejects.toThrow(UnprocessableEntityException);
            expect(prisma.contractTag.createMany).not.toHaveBeenCalled();
          } else {
            prisma.contractTag.findMany.mockResolvedValueOnce(
              [...existingTags, ...trulyNewTags].map((t) => ({ tag: t })),
            );
            prisma.contractTag.createMany.mockResolvedValue({ count: trulyNewCount });

            const result = await service.addTags(
              mockContractId,
              tagsToAdd,
              mockAccountId,
            );
            expect(result.contractId).toBe(mockContractId);
          }

          jest.clearAllMocks();
        },
      ),
      { numRuns: 50 },
    );
  });
});

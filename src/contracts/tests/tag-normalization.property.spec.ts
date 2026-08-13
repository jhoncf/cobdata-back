import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { TagsService } from '../tags.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Property 14: Tag Normalization Idempotence
 *
 * **Validates: Requirements 12.3**
 *
 * Storing a tag produces lowercase(trim(tag)).
 * Tags differing only in case/whitespace are treated as the same tag.
 */
describe('Property 14: Tag Normalization Idempotence', () => {
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

  it('normalizeTag produces lowercase(trim(tag)) for any string input', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        (rawTag) => {
          const normalized = service.normalizeTag(rawTag);
          // Must equal lowercase + trim
          expect(normalized).toBe(rawTag.toLowerCase().trim());
        },
      ),
      { numRuns: 200 },
    );
  });

  it('normalization is idempotent: normalizing an already-normalized tag produces the same result', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        (rawTag) => {
          const once = service.normalizeTag(rawTag);
          const twice = service.normalizeTag(once);
          expect(twice).toBe(once);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('tags differing only in case/whitespace normalize to the same value and are deduplicated', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
        fc.nat({ max: 5 }),
        fc.nat({ max: 5 }),
        (baseTag, leadingSpaces, trailingSpaces) => {
          const padded = ' '.repeat(leadingSpaces) + baseTag + ' '.repeat(trailingSpaces);
          const upper = padded.toUpperCase();
          const lower = padded.toLowerCase();
          const mixed = padded
            .split('')
            .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
            .join('');

          const result = service.normalizeTags([padded, upper, lower, mixed]);

          // All variants should produce exactly one unique normalized tag
          expect(result.length).toBe(1);
          expect(result[0]).toBe(baseTag.toLowerCase().trim());
        },
      ),
      { numRuns: 100 },
    );
  });

  it('addTags stores only normalized (lowercase+trimmed) tags', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          { minLength: 1, maxLength: 5 },
        ),
        async (rawTags) => {
          prisma.contract.findFirst.mockResolvedValue({
            id: mockContractId,
            accountId: mockAccountId,
          });
          prisma.contractTag.count.mockResolvedValue(0);
          prisma.contractTag.findMany
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(
              service.normalizeTags(rawTags).map((t) => ({ tag: t })),
            );
          prisma.contractTag.createMany.mockResolvedValue({ count: rawTags.length });

          await service.addTags(mockContractId, rawTags, mockAccountId);

          // Verify that createMany was called with normalized tags only
          const createCall = prisma.contractTag.createMany.mock.calls[0][0];
          for (const item of createCall.data) {
            expect(item.tag).toBe(item.tag.toLowerCase().trim());
          }

          jest.clearAllMocks();
        },
      ),
      { numRuns: 50 },
    );
  });
});

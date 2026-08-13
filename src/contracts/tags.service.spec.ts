import { Test, TestingModule } from '@nestjs/testing';
import { TagsService } from './tags.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';

describe('TagsService', () => {
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
        groupBy: jest.fn(),
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

  describe('normalizeTag', () => {
    it('converts to lowercase and trims', () => {
      expect(service.normalizeTag('  Hello World  ')).toBe('hello world');
      expect(service.normalizeTag('TAG')).toBe('tag');
      expect(service.normalizeTag('  MiXeD  ')).toBe('mixed');
    });
  });

  describe('normalizeTags', () => {
    it('normalizes and deduplicates', () => {
      const result = service.normalizeTags(['TAG', 'tag', '  Tag  ', 'other']);
      expect(result).toEqual(['tag', 'other']);
    });
  });

  describe('addTags', () => {
    it('throws NotFoundException when contract does not exist', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);

      await expect(
        service.addTags(mockContractId, ['test'], mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 422 when adding tags would exceed 20 limit', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        id: mockContractId,
        accountId: mockAccountId,
      });
      prisma.contractTag.count.mockResolvedValue(18);
      prisma.contractTag.findMany.mockResolvedValue([
        { tag: 'existing1' },
        { tag: 'existing2' },
      ]);

      await expect(
        service.addTags(mockContractId, ['new1', 'new2', 'new3'], mockAccountId),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('successfully adds tags within limit', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        id: mockContractId,
        accountId: mockAccountId,
      });
      prisma.contractTag.count.mockResolvedValue(5);
      prisma.contractTag.findMany
        .mockResolvedValueOnce([{ tag: 'existing1' }])
        .mockResolvedValueOnce([{ tag: 'existing1' }, { tag: 'newtag' }]);
      prisma.contractTag.createMany.mockResolvedValue({ count: 1 });

      const result = await service.addTags(
        mockContractId,
        ['  NewTag  '],
        mockAccountId,
      );

      expect(result.contractId).toBe(mockContractId);
      expect(result.tags).toContain('newtag');
      expect(prisma.contractTag.createMany).toHaveBeenCalledWith({
        data: [{ contractId: mockContractId, tag: 'newtag' }],
        skipDuplicates: true,
      });
    });

    it('deduplicates tags that differ only in case/whitespace', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        id: mockContractId,
        accountId: mockAccountId,
      });
      prisma.contractTag.count.mockResolvedValue(0);
      prisma.contractTag.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ tag: 'urgent' }]);
      prisma.contractTag.createMany.mockResolvedValue({ count: 1 });

      const result = await service.addTags(
        mockContractId,
        ['URGENT', '  urgent  ', 'Urgent'],
        mockAccountId,
      );

      // Should only create one tag record since they normalize to the same value
      expect(prisma.contractTag.createMany).toHaveBeenCalledWith({
        data: [{ contractId: mockContractId, tag: 'urgent' }],
        skipDuplicates: true,
      });
    });
  });

  describe('removeTags', () => {
    it('throws NotFoundException when contract does not exist', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);

      await expect(
        service.removeTags(mockContractId, ['test'], mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });

    it('removes normalized tags', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        id: mockContractId,
        accountId: mockAccountId,
      });
      prisma.contractTag.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeTags(
        mockContractId,
        ['  URGENT  '],
        mockAccountId,
      );

      expect(prisma.contractTag.deleteMany).toHaveBeenCalledWith({
        where: {
          contractId: mockContractId,
          tag: { in: ['urgent'] },
        },
      });
    });
  });

  describe('listDistinctTags', () => {
    it('returns empty array for VIEWER with no scopes', async () => {
      const result = await service.listDistinctTags(mockAccountId, 'VIEWER', []);
      expect(result).toEqual([]);
    });

    it('returns distinct tags with counts for ADMIN', async () => {
      prisma.contractTag.groupBy.mockResolvedValue([
        { tag: 'urgent', _count: { tag: 5 } },
        { tag: 'vip', _count: { tag: 3 } },
      ]);

      const result = await service.listDistinctTags(mockAccountId, 'ADMIN');

      expect(result).toEqual([
        { tag: 'urgent', count: 5 },
        { tag: 'vip', count: 3 },
      ]);
    });

    it('filters by wallet scopes for VIEWER', async () => {
      const scopes = ['wallet-1', 'wallet-2'];
      prisma.contractTag.groupBy.mockResolvedValue([
        { tag: 'scoped-tag', _count: { tag: 2 } },
      ]);

      const result = await service.listDistinctTags(mockAccountId, 'VIEWER', scopes);

      expect(result).toEqual([{ tag: 'scoped-tag', count: 2 }]);
      expect(prisma.contractTag.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            contract: {
              accountId: mockAccountId,
              deletedAt: null,
              walletId: { in: scopes },
            },
          },
        }),
      );
    });
  });
});

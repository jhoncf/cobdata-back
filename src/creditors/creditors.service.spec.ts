import { Test, TestingModule } from '@nestjs/testing';
import { CreditorsService } from './creditors.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

describe('CreditorsService', () => {
  let service: CreditorsService;
  let prisma: jest.Mocked<PrismaService>;

  const mockAccountId = 'account-uuid-1';

  const mockCreditor = {
    id: 'creditor-uuid-1',
    accountId: mockAccountId,
    name: 'Test Creditor',
    cnpj: '11222333000181',
    contacts: [{ type: 'EMAIL', value: 'test@example.com' }],
    address: { city: 'São Paulo', state: 'SP' },
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrisma = {
      creditor: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      contract: {
        count: jest.fn(),
      },
      wallet: {
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditorsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CreditorsService>(CreditorsService);
    prisma = module.get(PrismaService);
  });

  describe('create', () => {
    it('should create a creditor without CNPJ', async () => {
      const dto = { name: 'New Creditor' };
      (prisma.creditor.create as jest.Mock).mockResolvedValue({
        ...mockCreditor,
        name: dto.name,
        cnpj: null,
      });

      const result = await service.create(dto, mockAccountId);

      expect(result.name).toBe(dto.name);
      expect(prisma.creditor.create).toHaveBeenCalledWith({
        data: {
          accountId: mockAccountId,
          name: dto.name,
          cnpj: null,
          contacts: null,
          address: null,
        },
      });
    });

    it('should create a creditor with CNPJ when unique', async () => {
      const dto = { name: 'New Creditor', cnpj: '11222333000181' };
      (prisma.creditor.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.creditor.create as jest.Mock).mockResolvedValue({
        ...mockCreditor,
        name: dto.name,
      });

      const result = await service.create(dto, mockAccountId);

      expect(result.name).toBe(dto.name);
      expect(prisma.creditor.findFirst).toHaveBeenCalledWith({
        where: { cnpj: dto.cnpj, deletedAt: null },
      });
    });

    it('should throw ConflictException when CNPJ already in use', async () => {
      const dto = { name: 'New Creditor', cnpj: '11222333000181' };
      (prisma.creditor.findFirst as jest.Mock).mockResolvedValue(mockCreditor);

      await expect(service.create(dto, mockAccountId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should create a creditor with contacts and address', async () => {
      const dto = {
        name: 'Full Creditor',
        contacts: [{ type: 'EMAIL' as const, value: 'a@b.com' }],
        address: { city: 'Rio', state: 'RJ' },
      };
      (prisma.creditor.create as jest.Mock).mockResolvedValue({
        ...mockCreditor,
        ...dto,
      });

      const result = await service.create(dto as any, mockAccountId);

      expect(prisma.creditor.create).toHaveBeenCalledWith({
        data: {
          accountId: mockAccountId,
          name: dto.name,
          cnpj: null,
          contacts: dto.contacts,
          address: dto.address,
        },
      });
      expect(result.name).toBe(dto.name);
    });
  });

  describe('list', () => {
    it('should return paginated creditors', async () => {
      const query = { page: 1, limit: 20 };
      (prisma.creditor.findMany as jest.Mock).mockResolvedValue([mockCreditor]);
      (prisma.creditor.count as jest.Mock).mockResolvedValue(1);

      const result = await service.list(query, mockAccountId);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });

    it('should filter by search term on name and cnpj', async () => {
      const query = { page: 1, limit: 20, search: 'test' };
      (prisma.creditor.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creditor.count as jest.Mock).mockResolvedValue(0);

      await service.list(query, mockAccountId);

      expect(prisma.creditor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { contains: 'test', mode: 'insensitive' } },
              { cnpj: { contains: 'test', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('should exclude soft-deleted creditors', async () => {
      const query = { page: 1, limit: 20 };
      (prisma.creditor.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creditor.count as jest.Mock).mockResolvedValue(0);

      await service.list(query, mockAccountId);

      expect(prisma.creditor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
          }),
        }),
      );
    });

    it('should filter creditors by VIEWER scopes', async () => {
      const query = { page: 1, limit: 20 };
      const userScopes = ['wallet-1', 'wallet-2'];
      (prisma.wallet.findMany as jest.Mock).mockResolvedValue([
        { creditorId: 'creditor-uuid-1' },
        { creditorId: 'creditor-uuid-2' },
      ]);
      (prisma.creditor.findMany as jest.Mock).mockResolvedValue([mockCreditor]);
      (prisma.creditor.count as jest.Mock).mockResolvedValue(1);

      const result = await service.list(query, mockAccountId, userScopes);

      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: userScopes },
          deletedAt: null,
        },
        select: { creditorId: true },
        distinct: ['creditorId'],
      });
      expect(prisma.creditor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['creditor-uuid-1', 'creditor-uuid-2'] },
          }),
        }),
      );
      expect(result.data).toHaveLength(1);
    });

    it('should return empty when VIEWER has no scopes', async () => {
      const query = { page: 1, limit: 20 };
      const userScopes: string[] = [];
      (prisma.creditor.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creditor.count as jest.Mock).mockResolvedValue(0);

      const result = await service.list(query, mockAccountId, userScopes);

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('findById', () => {
    it('should return creditor when found and not deleted', async () => {
      (prisma.creditor.findFirst as jest.Mock).mockResolvedValue(mockCreditor);

      const result = await service.findById('creditor-uuid-1', mockAccountId);

      expect(result).toEqual(mockCreditor);
    });

    it('should throw NotFoundException when creditor not found', async () => {
      (prisma.creditor.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findById('nonexistent-id', mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for soft-deleted creditor', async () => {
      (prisma.creditor.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findById('deleted-id', mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update only provided fields', async () => {
      (prisma.creditor.findFirst as jest.Mock).mockResolvedValue(mockCreditor);
      (prisma.creditor.update as jest.Mock).mockResolvedValue({
        ...mockCreditor,
        name: 'Updated Name',
      });

      const result = await service.update(
        'creditor-uuid-1',
        { name: 'Updated Name' },
        mockAccountId,
      );

      expect(prisma.creditor.update).toHaveBeenCalledWith({
        where: { id: 'creditor-uuid-1' },
        data: { name: 'Updated Name' },
      });
      expect(result.name).toBe('Updated Name');
    });

    it('should check CNPJ uniqueness when CNPJ changes', async () => {
      const newCnpj = '22333444000155';
      (prisma.creditor.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockCreditor) // findById
        .mockResolvedValueOnce(null); // checkCnpjUniqueness
      (prisma.creditor.update as jest.Mock).mockResolvedValue({
        ...mockCreditor,
        cnpj: newCnpj,
      });

      await service.update('creditor-uuid-1', { cnpj: newCnpj }, mockAccountId);

      expect(prisma.creditor.findFirst).toHaveBeenCalledTimes(2);
    });

    it('should throw ConflictException when updated CNPJ already in use', async () => {
      const newCnpj = '22333444000155';
      (prisma.creditor.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockCreditor) // findById
        .mockResolvedValueOnce({ id: 'other-id', cnpj: newCnpj }); // checkCnpjUniqueness

      await expect(
        service.update('creditor-uuid-1', { cnpj: newCnpj }, mockAccountId),
      ).rejects.toThrow(ConflictException);
    });

    it('should not check CNPJ uniqueness when CNPJ unchanged', async () => {
      (prisma.creditor.findFirst as jest.Mock).mockResolvedValueOnce(mockCreditor);
      (prisma.creditor.update as jest.Mock).mockResolvedValue(mockCreditor);

      await service.update(
        'creditor-uuid-1',
        { cnpj: mockCreditor.cnpj },
        mockAccountId,
      );

      // findFirst called only once (for findById), not for uniqueness check
      expect(prisma.creditor.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundException if creditor not found', async () => {
      (prisma.creditor.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { name: 'X' }, mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('should soft-delete creditor and cascade to wallets when no contracts exist', async () => {
      (prisma.creditor.findFirst as jest.Mock).mockResolvedValue(mockCreditor);
      (prisma.contract.count as jest.Mock).mockResolvedValue(0);
      (prisma.$transaction as jest.Mock).mockResolvedValue([{}, {}]);

      await service.softDelete('creditor-uuid-1', mockAccountId);

      expect(prisma.contract.count).toHaveBeenCalledWith({
        where: {
          wallet: {
            creditorId: 'creditor-uuid-1',
            deletedAt: null,
          },
          deletedAt: null,
        },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should throw ConflictException when creditor has wallets with contracts', async () => {
      (prisma.creditor.findFirst as jest.Mock).mockResolvedValue(mockCreditor);
      (prisma.contract.count as jest.Mock).mockResolvedValue(3);

      await expect(
        service.softDelete('creditor-uuid-1', mockAccountId),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.softDelete('creditor-uuid-1', mockAccountId),
      ).rejects.toThrow('Creditor has wallets with contracts');
    });

    it('should throw NotFoundException when creditor not found', async () => {
      (prisma.creditor.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.softDelete('nonexistent-id', mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for already soft-deleted creditor', async () => {
      (prisma.creditor.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.softDelete('deleted-id', mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

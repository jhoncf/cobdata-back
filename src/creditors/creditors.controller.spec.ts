import { Test, TestingModule } from '@nestjs/testing';
import { CreditorsController } from './creditors.controller';
import { CreditorsService } from './creditors.service';
import { AuthenticatedUser } from '../common/interfaces';

describe('CreditorsController', () => {
  let controller: CreditorsController;
  let service: jest.Mocked<CreditorsService>;

  const mockUser: AuthenticatedUser = {
    id: 'user-uuid-1',
    accountId: 'account-uuid-1',
    role: 'ADMIN',
    sessionId: 'session-uuid-1',
  };

  const mockCreditor = {
    id: 'creditor-uuid-1',
    accountId: mockUser.accountId,
    name: 'Test Creditor',
    cnpj: '11222333000181',
    contacts: null,
    address: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockService = {
      create: jest.fn(),
      list: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CreditorsController],
      providers: [{ provide: CreditorsService, useValue: mockService }],
    }).compile();

    controller = module.get<CreditorsController>(CreditorsController);
    service = module.get(CreditorsService);
  });

  describe('create', () => {
    it('should create a creditor and pass accountId from user', async () => {
      const dto = { name: 'New Creditor' };
      service.create.mockResolvedValue(mockCreditor as any);

      const result = await controller.create(dto as any, mockUser);

      expect(service.create).toHaveBeenCalledWith(dto, mockUser.accountId);
      expect(result).toEqual(mockCreditor);
    });
  });

  describe('list', () => {
    it('should return paginated creditors', async () => {
      const query = { page: 1, limit: 20 };
      const paginatedResult = {
        data: [mockCreditor],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      };
      service.list.mockResolvedValue(paginatedResult as any);
      const req = { userScopes: undefined } as any;

      const result = await controller.list(query as any, mockUser, req);

      expect(service.list).toHaveBeenCalledWith(query, mockUser.accountId, undefined);
      expect(result).toEqual(paginatedResult);
    });

    it('should pass userScopes from request for VIEWER filtering', async () => {
      const query = { page: 1, limit: 20 };
      const userScopes = ['wallet-1', 'wallet-2'];
      service.list.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } } as any);
      const req = { userScopes } as any;

      await controller.list(query as any, mockUser, req);

      expect(service.list).toHaveBeenCalledWith(query, mockUser.accountId, userScopes);
    });

    it('should pass search parameter to service', async () => {
      const query = { page: 1, limit: 20, search: 'test' };
      service.list.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } } as any);
      const req = { userScopes: undefined } as any;

      await controller.list(query as any, mockUser, req);

      expect(service.list).toHaveBeenCalledWith(query, mockUser.accountId, undefined);
    });
  });

  describe('findById', () => {
    it('should return a creditor by id', async () => {
      service.findById.mockResolvedValue(mockCreditor as any);

      const result = await controller.findById('creditor-uuid-1', mockUser);

      expect(service.findById).toHaveBeenCalledWith('creditor-uuid-1', mockUser.accountId);
      expect(result).toEqual(mockCreditor);
    });
  });

  describe('update', () => {
    it('should update creditor and pass accountId', async () => {
      const dto = { name: 'Updated' };
      service.update.mockResolvedValue({ ...mockCreditor, name: 'Updated' } as any);

      const result = await controller.update('creditor-uuid-1', dto as any, mockUser);

      expect(service.update).toHaveBeenCalledWith('creditor-uuid-1', dto, mockUser.accountId);
      expect(result.name).toBe('Updated');
    });
  });

  describe('softDelete', () => {
    it('should call softDelete on the service and return success message', async () => {
      service.softDelete.mockResolvedValue(undefined);

      const result = await controller.softDelete('creditor-uuid-1', mockUser);

      expect(service.softDelete).toHaveBeenCalledWith('creditor-uuid-1', mockUser.accountId);
      expect(result).toEqual({ message: 'Creditor deleted successfully' });
    });
  });
});

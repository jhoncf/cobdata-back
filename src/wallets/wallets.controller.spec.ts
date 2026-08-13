import { Test, TestingModule } from '@nestjs/testing';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { AuthenticatedUser } from '../common/interfaces';

describe('WalletsController', () => {
  let controller: WalletsController;
  let service: any;

  const mockUser: AuthenticatedUser = {
    id: 'user-uuid-1',
    accountId: 'account-uuid-1',
    role: 'ADMIN',
    sessionId: 'session-uuid-1',
  };

  const mockWallet = {
    id: 'wallet-uuid-1',
    accountId: 'account-uuid-1',
    creditorId: 'creditor-uuid-1',
    name: 'Test Wallet',
    status: 'ACTIVE',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      list: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WalletsController],
      providers: [
        { provide: WalletsService, useValue: service },
      ],
    }).compile();

    controller = module.get<WalletsController>(WalletsController);
  });

  describe('create', () => {
    it('should create a wallet', async () => {
      service.create.mockResolvedValue(mockWallet);

      const result = await controller.create(
        'creditor-uuid-1',
        { name: 'Test Wallet' },
        mockUser,
      );

      expect(result).toEqual(mockWallet);
      expect(service.create).toHaveBeenCalledWith(
        'creditor-uuid-1',
        { name: 'Test Wallet' },
        mockUser.accountId,
      );
    });
  });

  describe('list', () => {
    it('should list wallets without scopes for ADMIN', async () => {
      const paginatedResult = {
        data: [mockWallet],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      };
      service.list.mockResolvedValue(paginatedResult);

      const req = { userScopes: undefined } as any;
      const result = await controller.list({ page: 1, limit: 20 }, mockUser, req);

      expect(result).toEqual(paginatedResult);
      expect(service.list).toHaveBeenCalledWith(
        { page: 1, limit: 20 },
        mockUser.accountId,
        undefined,
      );
    });

    it('should pass userScopes for VIEWER', async () => {
      const scopes = ['wallet-1', 'wallet-2'];
      service.list.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });

      const req = { userScopes: scopes } as any;
      const viewerUser: AuthenticatedUser = { ...mockUser, role: 'VIEWER' };
      const result = await controller.list({ page: 1, limit: 20 }, viewerUser, req);

      expect(service.list).toHaveBeenCalledWith(
        { page: 1, limit: 20 },
        viewerUser.accountId,
        scopes,
      );
    });
  });

  describe('findById', () => {
    it('should return wallet with summary', async () => {
      const walletWithSummary = {
        ...mockWallet,
        summary: { totalContracts: 5, contractsByStatus: { PENDING: 5 }, totalValue: 1000 },
      };
      service.findById.mockResolvedValue(walletWithSummary);

      const req = { userScopes: undefined } as any;
      const result = await controller.findById('wallet-uuid-1', mockUser, req);

      expect(result).toEqual(walletWithSummary);
      expect(service.findById).toHaveBeenCalledWith(
        'wallet-uuid-1',
        mockUser.accountId,
        undefined,
      );
    });

    it('should pass userScopes for VIEWER access check', async () => {
      const scopes = ['wallet-uuid-1'];
      const walletWithSummary = {
        ...mockWallet,
        summary: { totalContracts: 0, contractsByStatus: {}, totalValue: 0 },
      };
      service.findById.mockResolvedValue(walletWithSummary);

      const req = { userScopes: scopes } as any;
      const result = await controller.findById('wallet-uuid-1', mockUser, req);

      expect(service.findById).toHaveBeenCalledWith(
        'wallet-uuid-1',
        mockUser.accountId,
        scopes,
      );
    });
  });

  describe('update', () => {
    it('should update a wallet', async () => {
      const updated = { ...mockWallet, name: 'Updated' };
      service.update.mockResolvedValue(updated);

      const result = await controller.update('wallet-uuid-1', { name: 'Updated' }, mockUser);

      expect(result).toEqual(updated);
      expect(service.update).toHaveBeenCalledWith(
        'wallet-uuid-1',
        { name: 'Updated' },
        mockUser.accountId,
      );
    });
  });

  describe('softDelete', () => {
    it('should soft-delete a wallet and return success message', async () => {
      service.softDelete.mockResolvedValue(undefined);

      const result = await controller.softDelete('wallet-uuid-1', mockUser);

      expect(result).toEqual({ message: 'Wallet deleted successfully' });
      expect(service.softDelete).toHaveBeenCalledWith('wallet-uuid-1', mockUser.accountId);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProvidersService } from './providers.service';
import { CryptoService } from './crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderType, ProviderEnv } from '@prisma/client';

describe('ProvidersService', () => {
  let service: ProvidersService;
  let prisma: any;
  let crypto: any;

  const mockAccountId = 'account-uuid-1';

  beforeEach(async () => {
    prisma = {
      provider: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    crypto = {
      encrypt: jest.fn().mockReturnValue('encrypted-credentials'),
      decrypt: jest.fn().mockReturnValue('{"apiKey":"decrypted"}'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvidersService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: crypto },
      ],
    }).compile();

    service = module.get<ProvidersService>(ProvidersService);
  });

  describe('create', () => {
    it('should create a provider with encrypted credentials', async () => {
      prisma.provider.findUnique.mockResolvedValue(null);
      prisma.provider.create.mockResolvedValue({
        id: 'provider-1',
        accountId: mockAccountId,
        type: ProviderType.SERASA_LNOP,
        environment: ProviderEnv.HOMOLOGATION,
        credentials: 'encrypted-credentials',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.create(
        {
          type: ProviderType.SERASA_LNOP,
          environment: ProviderEnv.HOMOLOGATION,
          credentials: { apiKey: 'secret' },
        },
        mockAccountId,
      );

      expect(crypto.encrypt).toHaveBeenCalledWith(JSON.stringify({ apiKey: 'secret' }));
      expect(result.id).toBe('provider-1');
      expect(result.type).toBe(ProviderType.SERASA_LNOP);
      // Credentials should not be in response
      expect((result as any).credentials).toBeUndefined();
    });

    it('should throw 409 if provider type already exists', async () => {
      prisma.provider.findUnique.mockResolvedValue({ id: 'existing-provider' });

      await expect(
        service.create(
          {
            type: ProviderType.SERASA_LNOP,
            environment: ProviderEnv.PRODUCTION,
            credentials: { apiKey: 'key' },
          },
          mockAccountId,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('list', () => {
    it('should return providers without credentials', async () => {
      prisma.provider.findMany.mockResolvedValue([
        {
          id: 'provider-1',
          accountId: mockAccountId,
          type: ProviderType.SERASA_LNOP,
          environment: ProviderEnv.HOMOLOGATION,
          credentials: 'encrypted-data',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.list(mockAccountId);

      expect(result).toHaveLength(1);
      const first = result[0]!;
      expect(first.id).toBe('provider-1');
      expect((first as any).credentials).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update environment and credentials', async () => {
      prisma.provider.findFirst.mockResolvedValue({
        id: 'provider-1',
        accountId: mockAccountId,
        type: ProviderType.SERASA_LNOP,
        environment: ProviderEnv.HOMOLOGATION,
        credentials: 'old-encrypted',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prisma.provider.update.mockResolvedValue({
        id: 'provider-1',
        accountId: mockAccountId,
        type: ProviderType.SERASA_LNOP,
        environment: ProviderEnv.PRODUCTION,
        credentials: 'encrypted-credentials',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.update(
        'provider-1',
        {
          environment: ProviderEnv.PRODUCTION,
          credentials: { apiKey: 'new-key' },
        },
        mockAccountId,
      );

      expect(crypto.encrypt).toHaveBeenCalledWith(JSON.stringify({ apiKey: 'new-key' }));
      expect(result.environment).toBe(ProviderEnv.PRODUCTION);
      expect((result as any).credentials).toBeUndefined();
    });

    it('should throw 404 if provider not found', async () => {
      prisma.provider.findFirst.mockResolvedValue(null);

      await expect(
        service.update(
          'nonexistent-id',
          { environment: ProviderEnv.PRODUCTION },
          mockAccountId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

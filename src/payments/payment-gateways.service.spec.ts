import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PaymentGatewaysService } from './payment-gateways.service';
import { CryptoService } from '../providers/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentProviderType,
  PaymentMethod,
  PaymentGatewayEnvironment,
} from './enums';
import { CreatePaymentGatewayDto } from './dto/create-payment-gateway.dto';
import { UpdatePaymentGatewayDto } from './dto/update-payment-gateway.dto';

describe('PaymentGatewaysService', () => {
  let service: PaymentGatewaysService;
  let prisma: any;
  let crypto: any;

  const mockAccountId = 'account-uuid-1';
  const mockGatewayId = 'gateway-uuid-1';

  const mockGatewayRecord = {
    id: mockGatewayId,
    accountId: mockAccountId,
    name: 'BB Sandbox',
    providerType: 'BANCO_DO_BRASIL',
    environment: 'SANDBOX',
    enabled: true,
    supportedMethods: ['PIX', 'BOLETO'],
    pixKey: 'encrypted-pix-key',
    encryptedCredentials: 'encrypted-credentials-blob',
    timeoutMs: 30000,
    maxRetries: 3,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
  };

  beforeEach(async () => {
    prisma = {
      paymentGateway: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    crypto = {
      encrypt: jest.fn().mockReturnValue('encrypted-value'),
      decrypt: jest.fn().mockReturnValue(
        JSON.stringify({
          clientId: 'cid',
          clientSecret: 'csecret',
          developerKey: 'dkey',
          certificateBase64: 'cert-b64',
          certificatePassword: 'cert-pass',
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentGatewaysService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: crypto },
      ],
    }).compile();

    service = module.get<PaymentGatewaysService>(PaymentGatewaysService);
  });

  describe('create', () => {
    it('should encrypt credentials and pixKey, then return DTO without secrets', async () => {
      prisma.paymentGateway.create.mockResolvedValue(mockGatewayRecord);

      const dto: CreatePaymentGatewayDto = {
        name: 'BB Sandbox',
        providerType: PaymentProviderType.BANCO_DO_BRASIL,
        environment: PaymentGatewayEnvironment.SANDBOX,
        enabled: true,
        supportedMethods: [PaymentMethod.PIX, PaymentMethod.BOLETO],
        credentials: {
          clientId: 'my-client-id',
          clientSecret: 'my-secret',
          developerKey: 'my-dev-key',
          pixKey: 'my-pix-key',
          certificateBase64: 'base64cert',
          certificatePassword: 'certpass',
        },
      };

      const result = await service.create(mockAccountId, dto);

      // Verify pixKey was encrypted separately
      expect(crypto.encrypt).toHaveBeenCalledWith('my-pix-key');

      // Verify credentials (without pixKey) were encrypted as JSON
      expect(crypto.encrypt).toHaveBeenCalledWith(
        JSON.stringify({
          clientId: 'my-client-id',
          clientSecret: 'my-secret',
          developerKey: 'my-dev-key',
          certificateBase64: 'base64cert',
          certificatePassword: 'certpass',
        }),
      );

      // Response should not contain credentials
      expect(result.id).toBe(mockGatewayId);
      expect(result.name).toBe('BB Sandbox');
      expect(result.hasCredentials).toBe(true);
      expect(result.hasPixKey).toBe(true);
      expect((result as any).encryptedCredentials).toBeUndefined();
      expect((result as any).pixKey).toBeUndefined();
      expect((result as any).credentials).toBeUndefined();
    });

    it('should handle null pixKey gracefully', async () => {
      prisma.paymentGateway.create.mockResolvedValue({
        ...mockGatewayRecord,
        pixKey: null,
      });

      const dto: CreatePaymentGatewayDto = {
        name: 'BB Sandbox',
        providerType: PaymentProviderType.BANCO_DO_BRASIL,
        environment: PaymentGatewayEnvironment.SANDBOX,
        supportedMethods: [PaymentMethod.PIX],
        credentials: {
          clientId: 'cid',
          clientSecret: 'cs',
          developerKey: 'dk',
        },
      };

      const result = await service.create(mockAccountId, dto);

      expect(result.hasPixKey).toBe(false);
    });
  });

  describe('findAll', () => {
    it('should return all gateways for account without credentials', async () => {
      prisma.paymentGateway.findMany.mockResolvedValue([mockGatewayRecord]);

      const result = await service.findAll(mockAccountId);

      expect(result).toHaveLength(1);
      const first = result[0] as any;
      expect(first.id).toBe(mockGatewayId);
      expect(first.hasCredentials).toBe(true);
      expect(first.encryptedCredentials).toBeUndefined();
    });

    it('should return empty array when no gateways exist', async () => {
      prisma.paymentGateway.findMany.mockResolvedValue([]);

      const result = await service.findAll(mockAccountId);

      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return a single gateway without credentials', async () => {
      prisma.paymentGateway.findFirst.mockResolvedValue(mockGatewayRecord);

      const result = await service.findOne(mockGatewayId, mockAccountId);

      expect(result.id).toBe(mockGatewayId);
      expect(result.name).toBe('BB Sandbox');
      expect((result as any).encryptedCredentials).toBeUndefined();
    });

    it('should throw NotFoundException when gateway does not exist', async () => {
      prisma.paymentGateway.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('nonexistent-id', mockAccountId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should verify ownership by filtering on accountId', async () => {
      prisma.paymentGateway.findFirst.mockResolvedValue(mockGatewayRecord);

      await service.findOne(mockGatewayId, mockAccountId);

      expect(prisma.paymentGateway.findFirst).toHaveBeenCalledWith({
        where: { id: mockGatewayId, accountId: mockAccountId },
      });
    });
  });

  describe('update', () => {
    it('should re-encrypt credentials when provided', async () => {
      prisma.paymentGateway.findFirst.mockResolvedValue(mockGatewayRecord);
      prisma.paymentGateway.update.mockResolvedValue({
        ...mockGatewayRecord,
        name: 'BB Produção',
      });

      const dto: UpdatePaymentGatewayDto = {
        name: 'BB Produção',
        credentials: {
          clientId: 'new-cid',
          clientSecret: 'new-secret',
          developerKey: 'new-dk',
          pixKey: 'new-pix',
        },
      };

      const result = await service.update(mockGatewayId, mockAccountId, dto);

      // Credentials JSON (without pixKey) should be encrypted
      expect(crypto.encrypt).toHaveBeenCalledWith(
        JSON.stringify({
          clientId: 'new-cid',
          clientSecret: 'new-secret',
          developerKey: 'new-dk',
        }),
      );
      // pixKey encrypted separately
      expect(crypto.encrypt).toHaveBeenCalledWith('new-pix');
      expect(result.name).toBe('BB Produção');
      expect((result as any).credentials).toBeUndefined();
    });

    it('should keep existing credentials when not provided in update', async () => {
      prisma.paymentGateway.findFirst.mockResolvedValue(mockGatewayRecord);
      prisma.paymentGateway.update.mockResolvedValue({
        ...mockGatewayRecord,
        enabled: false,
      });

      const dto: UpdatePaymentGatewayDto = { enabled: false };

      await service.update(mockGatewayId, mockAccountId, dto);

      // encrypt should not be called since credentials were not provided
      expect(crypto.encrypt).not.toHaveBeenCalled();
      expect(prisma.paymentGateway.update).toHaveBeenCalledWith({
        where: { id: mockGatewayId },
        data: { enabled: false },
      });
    });

    it('should throw NotFoundException when gateway does not exist', async () => {
      prisma.paymentGateway.findFirst.mockResolvedValue(null);

      await expect(
        service.update('nonexistent-id', mockAccountId, { name: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolveDefault', () => {
    it('should return the active gateway for account/provider/environment', async () => {
      prisma.paymentGateway.findFirst.mockResolvedValue(mockGatewayRecord);

      const result = await service.resolveDefault(
        mockAccountId,
        PaymentProviderType.BANCO_DO_BRASIL,
        PaymentGatewayEnvironment.SANDBOX,
      );

      expect(result).toEqual(mockGatewayRecord);
      expect(prisma.paymentGateway.findFirst).toHaveBeenCalledWith({
        where: {
          accountId: mockAccountId,
          providerType: PaymentProviderType.BANCO_DO_BRASIL,
          environment: PaymentGatewayEnvironment.SANDBOX,
          enabled: true,
        },
      });
    });

    it('should throw NotFoundException when no matching gateway is found', async () => {
      prisma.paymentGateway.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveDefault(
          mockAccountId,
          PaymentProviderType.BANCO_DO_BRASIL,
          PaymentGatewayEnvironment.PRODUCTION,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('decryptCredentials', () => {
    it('should decrypt credentials and pixKey from gateway entity', () => {
      crypto.decrypt
        .mockReturnValueOnce(
          JSON.stringify({
            clientId: 'cid',
            clientSecret: 'csecret',
            developerKey: 'dkey',
            certificateBase64: 'cert-b64',
            certificatePassword: 'cert-pass',
          }),
        )
        .mockReturnValueOnce('decrypted-pix-key');

      const config = service.decryptCredentials(mockGatewayRecord);

      expect(config.clientId).toBe('cid');
      expect(config.clientSecret).toBe('csecret');
      expect(config.developerKey).toBe('dkey');
      expect(config.certificateBase64).toBe('cert-b64');
      expect(config.certificatePassword).toBe('cert-pass');
      expect(config.pixKey).toBe('decrypted-pix-key');
      expect(config.environment).toBe(PaymentGatewayEnvironment.SANDBOX);
      expect(config.timeoutMs).toBe(30000);
      expect(config.maxRetries).toBe(3);
    });

    it('should return undefined pixKey when gateway has no pixKey', () => {
      crypto.decrypt.mockReturnValueOnce(
        JSON.stringify({
          clientId: 'cid',
          clientSecret: 'csecret',
          developerKey: 'dkey',
        }),
      );

      const config = service.decryptCredentials({
        ...mockGatewayRecord,
        pixKey: null,
      });

      expect(config.pixKey).toBeUndefined();
    });
  });

  describe('getDecryptedConfig', () => {
    it('should decrypt credentials and pixKey for adapter use', async () => {
      prisma.paymentGateway.findUnique.mockResolvedValue(mockGatewayRecord);
      crypto.decrypt
        .mockReturnValueOnce(
          JSON.stringify({
            clientId: 'cid',
            clientSecret: 'csecret',
            developerKey: 'dkey',
            certificateBase64: 'cert-b64',
            certificatePassword: 'cert-pass',
          }),
        )
        .mockReturnValueOnce('decrypted-pix-key');

      const config = await service.getDecryptedConfig(mockGatewayId);

      expect(config.clientId).toBe('cid');
      expect(config.clientSecret).toBe('csecret');
      expect(config.developerKey).toBe('dkey');
      expect(config.certificateBase64).toBe('cert-b64');
      expect(config.certificatePassword).toBe('cert-pass');
      expect(config.pixKey).toBe('decrypted-pix-key');
      expect(config.environment).toBe(PaymentGatewayEnvironment.SANDBOX);
      expect(config.timeoutMs).toBe(30000);
      expect(config.maxRetries).toBe(3);
    });

    it('should return undefined pixKey when gateway has no pixKey', async () => {
      prisma.paymentGateway.findUnique.mockResolvedValue({
        ...mockGatewayRecord,
        pixKey: null,
      });

      const config = await service.getDecryptedConfig(mockGatewayId);

      expect(config.pixKey).toBeUndefined();
    });

    it('should throw NotFoundException when gateway does not exist', async () => {
      prisma.paymentGateway.findUnique.mockResolvedValue(null);

      await expect(
        service.getDecryptedConfig('nonexistent-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

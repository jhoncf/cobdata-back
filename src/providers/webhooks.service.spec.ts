import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhooksService, WebhookPayload } from './webhooks.service';
import { SerasaLnopAdapter } from './adapters/serasa-lnop.adapter';
import { PrismaService } from '../prisma/prisma.service';
import {
  WebhookStatus,
  OperationItemStatus,
  SerasaStatus,
  ProviderType,
} from '@prisma/client';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let prisma: any;
  let configService: any;
  let serasaAdapter: any;

  const mockProvider = {
    id: 'provider-id',
    accountId: 'account-id',
    type: ProviderType.SERASA_LNOP,
    environment: 'PRODUCTION',
  };

  const mockOperationItem = {
    id: 'item-id',
    operationId: 'op-id',
    contractId: 'contract-id',
    batchIndex: 0,
    status: 'WAITING_PROVIDER_EVENT',
    transactionId: 'tx-123',
    debtId: null,
    contract: {
      id: 'contract-id',
      serasaStatus: 'SENT',
      debtId: null,
    },
  };

  const validSecret = 'test-secret';

  beforeEach(async () => {
    prisma = {
      provider: { findUnique: jest.fn() },
      webhookEvent: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      providerOperationItem: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      contract: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    configService = {
      get: jest.fn().mockReturnValue(validSecret),
    };

    serasaAdapter = {
      validateWebhookSignature: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
        { provide: SerasaLnopAdapter, useValue: serasaAdapter },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
  });

  describe('handleWebhook', () => {
    const headers = { 'x-serasa-signature': 'valid-sig' };
    const rawBody = Buffer.from('{"eventType":"DebtCreatedEvent","transactionId":"tx-123","status":201}');

    it('should reject invalid signature with 401', async () => {
      serasaAdapter.validateWebhookSignature.mockReturnValue(false);

      const payload: WebhookPayload = {
        eventType: 'DebtCreatedEvent',
        transactionId: 'tx-123',
        status: 201,
      };

      await expect(
        service.handleWebhook(headers, rawBody, payload),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject when SERASA_WEBHOOK_SECRET is not configured', async () => {
      configService.get.mockReturnValue(undefined);

      const payload: WebhookPayload = {
        eventType: 'DebtCreatedEvent',
        transactionId: 'tx-123',
        status: 201,
      };

      await expect(
        service.handleWebhook(headers, rawBody, payload),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return 200 for duplicate events without reprocessing', async () => {
      serasaAdapter.validateWebhookSignature.mockReturnValue(true);
      prisma.provider.findUnique.mockResolvedValue(mockProvider);
      prisma.webhookEvent.findUnique.mockResolvedValue({ id: 'existing-event' });

      const payload: WebhookPayload = {
        eventType: 'DebtCreatedEvent',
        transactionId: 'tx-123',
        status: 201,
      };

      const result = await service.handleWebhook(headers, rawBody, payload);

      expect(result.status).toBe(200);
      expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    });

    it('should mark event as UNMATCHED when transactionId has no matching item', async () => {
      serasaAdapter.validateWebhookSignature.mockReturnValue(true);
      prisma.provider.findUnique.mockResolvedValue(mockProvider);
      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockResolvedValue({ id: 'new-event-id' });
      prisma.providerOperationItem.findFirst.mockResolvedValue(null);
      prisma.webhookEvent.update.mockResolvedValue({});

      const payload: WebhookPayload = {
        eventType: 'DebtCreatedEvent',
        transactionId: 'unknown-tx',
        status: 201,
      };

      const result = await service.handleWebhook(headers, rawBody, payload);

      expect(result.status).toBe(200);
      expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: WebhookStatus.UNMATCHED }),
        }),
      );
    });

    it('should process valid DebtCreatedEvent successfully', async () => {
      serasaAdapter.validateWebhookSignature.mockReturnValue(true);
      prisma.provider.findUnique.mockResolvedValue(mockProvider);
      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockResolvedValue({ id: 'new-event-id' });
      prisma.providerOperationItem.findFirst.mockResolvedValue(mockOperationItem);
      prisma.$transaction.mockResolvedValue([]);
      prisma.webhookEvent.update.mockResolvedValue({});

      const payload: WebhookPayload = {
        eventType: 'DebtCreatedEvent',
        transactionId: 'tx-123',
        status: 201,
        debtId: 'debt-001',
      };

      const result = await service.handleWebhook(headers, rawBody, payload);

      expect(result.status).toBe(200);
      expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: WebhookStatus.PROCESSED }),
        }),
      );
    });

    it('should process an agreement event matched only by debtId', async () => {
      serasaAdapter.validateWebhookSignature.mockReturnValue(true);
      prisma.provider.findUnique.mockResolvedValue(mockProvider);
      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockResolvedValue({ id: 'new-event-id' });
      prisma.providerOperationItem.findFirst.mockResolvedValue(null);
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-id' });
      prisma.contract.update.mockResolvedValue({});
      prisma.webhookEvent.update.mockResolvedValue({});

      const payload: WebhookPayload = {
        eventType: 'ClosedAgreementEvent',
        debtIds: ['debt-001'],
        agreementId: 'agreement-001',
        totalInstallments: 2,
      };

      const result = await service.handleWebhook(headers, Buffer.from(JSON.stringify(payload)), payload);

      expect(result.status).toBe(200);
      expect(prisma.contract.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'contract-id' },
        data: expect.objectContaining({ paymentStatus: 'INSTALLMENT', agreementReference: 'agreement-001' }),
      }));
      expect(prisma.webhookEvent.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: WebhookStatus.PROCESSED }),
      }));
    });
  });

  describe('processDebtCreatedEvent', () => {
    it('should call $transaction for status 201 (REGISTERED)', async () => {
      await service.processDebtCreatedEvent(
        { eventType: 'DebtCreatedEvent', transactionId: 'tx-1', status: 201, debtId: 'debt-1' },
        mockOperationItem,
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should call $transaction for status 204 (UPDATED)', async () => {
      await service.processDebtCreatedEvent(
        { eventType: 'DebtCreatedEvent', transactionId: 'tx-1', status: 204 },
        mockOperationItem,
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should set FAILED on error status', async () => {
      await service.processDebtCreatedEvent(
        { eventType: 'DebtCreatedEvent', transactionId: 'tx-1', status: 400, errorCode: 'VALIDATION_ERROR' },
        mockOperationItem,
      );

      expect(prisma.providerOperationItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: OperationItemStatus.FAILED }),
        }),
      );
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { serasaStatus: SerasaStatus.FAILED },
        }),
      );
    });
  });

  describe('processDebtRemovedEvent', () => {
    it('should call $transaction for status 200 (REMOVED)', async () => {
      await service.processDebtRemovedEvent(
        { eventType: 'DebtRemovedEvent', transactionId: 'tx-1', status: 200 },
        mockOperationItem,
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should set item FAILED but keep contract as REMOVING on error', async () => {
      await service.processDebtRemovedEvent(
        { eventType: 'DebtRemovedEvent', transactionId: 'tx-1', status: 500 },
        mockOperationItem,
      );

      expect(prisma.providerOperationItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: OperationItemStatus.FAILED }),
        }),
      );
      expect(prisma.contract.update).not.toHaveBeenCalled();
    });
  });

  describe('processAgreementEvent', () => {
    it('should set IN_AGREEMENT for ClosedAgreementEvent', async () => {
      await service.processAgreementEvent(
        'ClosedAgreementEvent',
        { eventType: 'ClosedAgreementEvent', transactionId: 'tx-1' },
        mockOperationItem,
      );

      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'contract-id' },
        data: { serasaStatus: SerasaStatus.IN_AGREEMENT },
      });
    });

    it('should set AGREEMENT_BREACHED for BreachedAgreementEvent', async () => {
      await service.processAgreementEvent(
        'BreachedAgreementEvent',
        { eventType: 'BreachedAgreementEvent', transactionId: 'tx-1' },
        mockOperationItem,
      );

      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'contract-id' },
        data: { serasaStatus: SerasaStatus.AGREEMENT_BREACHED },
      });
    });

    it('should set PAID for PaidAgreementEvent', async () => {
      await service.processAgreementEvent(
        'PaidAgreementEvent',
        { eventType: 'PaidAgreementEvent', transactionId: 'tx-1' },
        mockOperationItem,
      );

      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'contract-id' },
        data: { serasaStatus: SerasaStatus.PAID },
      });
    });

    it('should increment paidInstallments for PaidInstallmentEvent', async () => {
      await service.processAgreementEvent(
        'PaidInstallmentEvent',
        { eventType: 'PaidInstallmentEvent', transactionId: 'tx-1' },
        mockOperationItem,
      );

      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'contract-id' },
        data: { paidInstallments: { increment: 1 } },
      });
    });
  });
});

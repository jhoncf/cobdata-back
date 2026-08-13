import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhooksService, WebhookPayload } from '../webhooks.service';
import { SerasaLnopAdapter } from '../adapters/serasa-lnop.adapter';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhookStatus } from '@prisma/client';

/**
 * Property 22: Webhook Idempotence
 *
 * **Validates: Requirements 19.7**
 *
 * For any webhook event received with a (transactionId, eventType) pair that
 * already exists in WebhookEvent, the system SHALL return HTTP 200 without
 * modifying any contract or operation item state.
 */
describe('Property 22: Webhook Idempotence', () => {
  let service: WebhooksService;
  let prisma: any;
  let configService: any;
  let serasaAdapter: any;

  const mockProvider = {
    id: 'provider-id',
    type: 'SERASA_LNOP',
  };

  beforeEach(async () => {
    prisma = {
      provider: { findUnique: jest.fn().mockResolvedValue(mockProvider) },
      webhookEvent: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      providerOperationItem: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      contract: { update: jest.fn() },
      $transaction: jest.fn(),
    };

    configService = {
      get: jest.fn().mockReturnValue('test-secret'),
    };

    serasaAdapter = {
      validateWebhookSignature: jest.fn().mockReturnValue(true),
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

  const eventTypeArb = fc.constantFrom(
    'DebtCreatedEvent',
    'DebtRemovedEvent',
    'ClosedAgreementEvent',
    'BreachedAgreementEvent',
    'PaidAgreementEvent',
    'PaidInstallmentEvent',
  );

  const transactionIdArb = fc.uuid();

  it('duplicate (transactionId, eventType) returns 200 without modifying state', async () => {
    await fc.assert(
      fc.asyncProperty(
        transactionIdArb,
        eventTypeArb,
        async (transactionId, eventType) => {
          // Simulate existing event in DB (dedup hit)
          prisma.webhookEvent.findUnique.mockResolvedValue({
            id: 'existing-event',
            transactionId,
            eventType,
            status: WebhookStatus.PROCESSED,
          });

          const payload: WebhookPayload = {
            eventType,
            transactionId,
            status: 201,
          };
          const rawBody = Buffer.from(JSON.stringify(payload));
          const headers = { 'x-serasa-signature': 'valid' };

          const result = await service.handleWebhook(headers, rawBody, payload);

          // Must return 200
          expect(result.status).toBe(200);

          // Must NOT create a new event
          expect(prisma.webhookEvent.create).not.toHaveBeenCalled();

          // Must NOT modify contract or operation item
          expect(prisma.contract.update).not.toHaveBeenCalled();
          expect(prisma.providerOperationItem.update).not.toHaveBeenCalled();
          expect(prisma.$transaction).not.toHaveBeenCalled();

          jest.clearAllMocks();
          // Re-set mocks for next iteration
          prisma.provider.findUnique.mockResolvedValue(mockProvider);
          serasaAdapter.validateWebhookSignature.mockReturnValue(true);
          configService.get.mockReturnValue('test-secret');
        },
      ),
      { numRuns: 50 },
    );
  });
});

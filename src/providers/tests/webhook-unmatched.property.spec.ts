import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhooksService, WebhookPayload } from '../webhooks.service';
import { SerasaLnopAdapter } from '../adapters/serasa-lnop.adapter';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhookStatus } from '@prisma/client';

/**
 * Property 25: Unmatched Webhook Graceful Handling
 *
 * **Validates: Requirements 19.9**
 *
 * For any webhook event whose transactionId does not match any existing
 * ProviderOperationItem, the system SHALL persist the event with status UNMATCHED
 * and return HTTP 200.
 */
describe('Property 25: Unmatched Webhook Graceful Handling', () => {
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
        findUnique: jest.fn().mockResolvedValue(null), // no duplicate
        create: jest.fn(),
        update: jest.fn(),
      },
      providerOperationItem: {
        findFirst: jest.fn().mockResolvedValue(null), // no match
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

  it('unmatched transactionId → event persisted as UNMATCHED, returns 200', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // random transactionId that won't match
        fc.constantFrom(
          'DebtCreatedEvent',
          'DebtRemovedEvent',
          'ClosedAgreementEvent',
          'BreachedAgreementEvent',
          'PaidAgreementEvent',
          'PaidInstallmentEvent',
        ),
        fc.integer({ min: 200, max: 500 }),
        async (transactionId, eventType, httpStatus) => {
          jest.clearAllMocks();

          // Re-set mocks for each iteration
          prisma.provider.findUnique.mockResolvedValue(mockProvider);
          prisma.webhookEvent.findUnique.mockResolvedValue(null);
          prisma.providerOperationItem.findFirst.mockResolvedValue(null);
          serasaAdapter.validateWebhookSignature.mockReturnValue(true);
          configService.get.mockReturnValue('test-secret');

          const eventId = 'webhook-event-id';
          prisma.webhookEvent.create.mockResolvedValue({ id: eventId });
          prisma.webhookEvent.update.mockResolvedValue({});

          const payload: WebhookPayload = {
            eventType,
            transactionId,
            status: httpStatus,
          };
          const rawBody = Buffer.from(JSON.stringify(payload));
          const headers = { 'x-serasa-signature': 'valid-sig' };

          const result = await service.handleWebhook(headers, rawBody, payload);

          // Must return 200
          expect(result.status).toBe(200);

          // Event was persisted
          expect(prisma.webhookEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                eventType,
                transactionId,
                status: WebhookStatus.RECEIVED,
              }),
            }),
          );

          // Event marked as UNMATCHED
          expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
            expect.objectContaining({
              where: { id: eventId },
              data: expect.objectContaining({
                status: WebhookStatus.UNMATCHED,
              }),
            }),
          );

          // No contract or item state modified
          expect(prisma.contract.update).not.toHaveBeenCalled();
          expect(prisma.providerOperationItem.update).not.toHaveBeenCalled();
          expect(prisma.$transaction).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 50 },
    );
  });
});

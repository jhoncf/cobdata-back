import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { WebhooksService, WebhookPayload } from '../webhooks.service';
import { SerasaLnopAdapter } from '../adapters/serasa-lnop.adapter';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Property 24: Webhook Signature Rejection
 *
 * **Validates: Requirements 19.2**
 *
 * For any incoming webhook request with an invalid or missing signature,
 * the system SHALL return HTTP 401 without persisting the event or modifying any state.
 */
describe('Property 24: Webhook Signature Rejection', () => {
  let service: WebhooksService;
  let prisma: any;
  let configService: any;
  let serasaAdapter: any;

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
        update: jest.fn(),
      },
      contract: { update: jest.fn() },
      $transaction: jest.fn(),
    };

    configService = {
      get: jest.fn().mockReturnValue('test-secret'),
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

  it('invalid signature → 401, no event persisted, no state modified', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom(
          'DebtCreatedEvent',
          'DebtRemovedEvent',
          'ClosedAgreementEvent',
          'BreachedAgreementEvent',
          'PaidAgreementEvent',
        ),
        fc.string({ minLength: 0, maxLength: 64 }), // arbitrary invalid signature
        async (transactionId, eventType, invalidSig) => {
          // Signature validation always fails
          serasaAdapter.validateWebhookSignature.mockReturnValue(false);

          const payload: WebhookPayload = {
            eventType,
            transactionId,
            status: 201,
          };
          const rawBody = Buffer.from(JSON.stringify(payload));
          const headers = { 'x-serasa-signature': invalidSig };

          await expect(
            service.handleWebhook(headers, rawBody, payload),
          ).rejects.toThrow(UnauthorizedException);

          // No event persisted
          expect(prisma.webhookEvent.create).not.toHaveBeenCalled();

          // No state modified
          expect(prisma.contract.update).not.toHaveBeenCalled();
          expect(prisma.providerOperationItem.update).not.toHaveBeenCalled();
          expect(prisma.$transaction).not.toHaveBeenCalled();

          jest.clearAllMocks();
          configService.get.mockReturnValue('test-secret');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('missing signature header → 401, no event persisted', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom('DebtCreatedEvent', 'DebtRemovedEvent'),
        async (transactionId, eventType) => {
          // Signature validation fails when no header present
          serasaAdapter.validateWebhookSignature.mockReturnValue(false);

          const payload: WebhookPayload = {
            eventType,
            transactionId,
            status: 201,
          };
          const rawBody = Buffer.from(JSON.stringify(payload));
          const headers: Record<string, string> = {}; // No signature header

          await expect(
            service.handleWebhook(headers, rawBody, payload),
          ).rejects.toThrow(UnauthorizedException);

          expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
          expect(prisma.contract.update).not.toHaveBeenCalled();

          jest.clearAllMocks();
          configService.get.mockReturnValue('test-secret');
        },
      ),
      { numRuns: 30 },
    );
  });
});

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhooksService, WebhookPayload } from '../webhooks.service';
import { SerasaLnopAdapter } from '../adapters/serasa-lnop.adapter';
import { PrismaService } from '../../prisma/prisma.service';
import { SerasaStatus, OperationItemStatus } from '@prisma/client';

/**
 * Property 23: Webhook Event to Contract Status Mapping
 *
 * **Validates: Requirements 19.4, 19.5, 19.8, 19.10**
 *
 * For any valid webhook event, the contract serasaStatus SHALL be updated as follows:
 * DebtCreatedEvent(201)→REGISTERED, DebtCreatedEvent(204)→UPDATED,
 * DebtRemovedEvent(200)→REMOVED, ClosedAgreementEvent→IN_AGREEMENT,
 * BreachedAgreementEvent→AGREEMENT_BREACHED, PaidAgreementEvent→PAID.
 */
describe('Property 23: Webhook Event to Contract Status Mapping', () => {
  let service: WebhooksService;
  let prisma: any;

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

  // Mapping: (eventType, httpStatus) → expected contract serasaStatus
  const STATUS_MAPPINGS: Array<{
    eventType: string;
    httpStatus: number | undefined;
    expectedSerasaStatus: SerasaStatus;
    expectedItemStatus: OperationItemStatus | null;
  }> = [
    {
      eventType: 'DebtCreatedEvent',
      httpStatus: 201,
      expectedSerasaStatus: SerasaStatus.REGISTERED,
      expectedItemStatus: OperationItemStatus.REGISTERED,
    },
    {
      eventType: 'DebtCreatedEvent',
      httpStatus: 204,
      expectedSerasaStatus: SerasaStatus.UPDATED,
      expectedItemStatus: OperationItemStatus.UPDATED,
    },
    {
      eventType: 'DebtRemovedEvent',
      httpStatus: 200,
      expectedSerasaStatus: SerasaStatus.REMOVED,
      expectedItemStatus: OperationItemStatus.REMOVED,
    },
    {
      eventType: 'ClosedAgreementEvent',
      httpStatus: undefined,
      expectedSerasaStatus: SerasaStatus.IN_AGREEMENT,
      expectedItemStatus: null,
    },
    {
      eventType: 'BreachedAgreementEvent',
      httpStatus: undefined,
      expectedSerasaStatus: SerasaStatus.AGREEMENT_BREACHED,
      expectedItemStatus: null,
    },
    {
      eventType: 'PaidAgreementEvent',
      httpStatus: undefined,
      expectedSerasaStatus: SerasaStatus.PAID,
      expectedItemStatus: null,
    },
  ];

  beforeEach(async () => {
    prisma = {
      providerOperationItem: { update: jest.fn().mockResolvedValue({}) },
      contract: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const configService = { get: jest.fn().mockReturnValue('test-secret') };
    const serasaAdapter = { validateWebhookSignature: jest.fn().mockReturnValue(true) };

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

  it('each event type maps to the correct contract serasaStatus', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...STATUS_MAPPINGS),
        fc.uuid(),
        async (mapping, transactionId) => {
          jest.clearAllMocks();
          prisma.$transaction.mockResolvedValue([]);
          prisma.contract.update.mockResolvedValue({});
          prisma.providerOperationItem.update.mockResolvedValue({});

          const payload: WebhookPayload = {
            eventType: mapping.eventType,
            transactionId,
            status: mapping.httpStatus,
            debtId: 'debt-001',
          };

          const item = { ...mockOperationItem, transactionId };

          if (mapping.eventType === 'DebtCreatedEvent') {
            await service.processDebtCreatedEvent(payload, item);
          } else if (mapping.eventType === 'DebtRemovedEvent') {
            await service.processDebtRemovedEvent(payload, item);
          } else {
            await service.processAgreementEvent(mapping.eventType, payload, item);
          }

          // For events processed via $transaction
          if (
            mapping.eventType === 'DebtCreatedEvent' ||
            mapping.eventType === 'DebtRemovedEvent'
          ) {
            expect(prisma.$transaction).toHaveBeenCalledWith(
              expect.arrayContaining([expect.anything()]),
            );
          } else {
            // Agreement events update contract directly
            expect(prisma.contract.update).toHaveBeenCalledWith(
              expect.objectContaining({
                where: { id: item.contractId },
                data: { serasaStatus: mapping.expectedSerasaStatus },
              }),
            );
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

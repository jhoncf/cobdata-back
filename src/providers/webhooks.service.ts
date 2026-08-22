import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { SerasaLnopAdapter } from './adapters/serasa-lnop.adapter';
import {
  WebhookStatus,
  OperationItemStatus,
  SerasaStatus,
  PaymentStatus,
  ProviderType,
} from '@prisma/client';

export interface WebhookPayload {
  eventType: string;
  transactionId: string;
  status?: number;
  debtId?: string;
  errorCode?: string;
  errorMessage?: string;
  [key: string]: unknown;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly serasaAdapter: SerasaLnopAdapter,
  ) {}

  /**
   * Main webhook handler. Validates signature, deduplicates, persists, and processes.
   */
  async handleWebhook(
    headers: Record<string, string>,
    rawBody: Buffer,
    payload: WebhookPayload,
  ): Promise<{ status: number; message: string }> {
    // 1. Validate HMAC signature
    const secret = this.configService.get<string>('SERASA_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error('SERASA_WEBHOOK_SECRET not configured');
      throw new UnauthorizedException('Webhook signature validation failed');
    }

    const isValid = this.serasaAdapter.validateWebhookSignature(
      headers,
      rawBody,
      secret,
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // 2. Find provider
    const provider = await this.prisma.provider.findUnique({
      where: { type: ProviderType.SERASA_LNOP },
    });

    if (!provider) {
      this.logger.warn('No Serasa LNOP provider configured, ignoring webhook');
      return { status: 200, message: 'OK' };
    }

    const { eventType, transactionId } = payload;

    // 3. Dedup check: (transactionId, eventType)
    if (transactionId && eventType) {
      const existing = await this.prisma.webhookEvent.findUnique({
        where: {
          transactionId_eventType: {
            transactionId,
            eventType,
          },
        },
      });

      if (existing) {
        this.logger.debug(
          `Duplicate webhook: transactionId=${transactionId}, eventType=${eventType}`,
        );
        return { status: 200, message: 'Duplicate event, ignored' };
      }
    }

    // 4. Persist WebhookEvent
    const webhookEvent = await this.prisma.webhookEvent.create({
      data: {
        providerId: provider.id,
        eventType: eventType || 'UNKNOWN',
        transactionId: transactionId || null,
        payload: payload as any,
        status: WebhookStatus.RECEIVED,
      },
    });

    // 5. Find matching ProviderOperationItem by transactionId
    if (!transactionId) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: WebhookStatus.UNMATCHED, processedAt: new Date() },
      });
      return { status: 200, message: 'No transactionId, marked as UNMATCHED' };
    }

    const operationItem = await this.prisma.providerOperationItem.findFirst({
      where: { transactionId },
      include: { contract: true },
    });

    if (!operationItem) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: WebhookStatus.UNMATCHED, processedAt: new Date() },
      });
      return { status: 200, message: 'Unmatched transactionId' };
    }

    // 6. Process event based on type
    try {
      await this.processEvent(eventType, payload, operationItem);

      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: WebhookStatus.PROCESSED, processedAt: new Date() },
      });
    } catch (error) {
      this.logger.error(
        `Error processing webhook event ${webhookEvent.id}: ${error}`,
      );
    }

    return { status: 200, message: 'OK' };
  }

  /**
   * Routes event processing based on event type.
   */
  private async processEvent(
    eventType: string,
    payload: WebhookPayload,
    operationItem: any,
  ): Promise<void> {
    switch (eventType) {
      case 'DebtCreatedEvent':
        await this.processDebtCreatedEvent(payload, operationItem);
        break;
      case 'DebtRemovedEvent':
        await this.processDebtRemovedEvent(payload, operationItem);
        break;
      case 'ClosedAgreementEvent':
      case 'BreachedAgreementEvent':
      case 'PaidAgreementEvent':
      case 'PaidInstallmentEvent':
        await this.processAgreementEvent(eventType, payload, operationItem);
        break;
      default:
        this.logger.warn(`Unknown event type: ${eventType}`);
    }
  }

  /**
   * Process DebtCreatedEvent:
   * - Status 201: item → REGISTERED, contract → REGISTERED
   * - Status 204: item → UPDATED, contract → UPDATED
   * - Status 400/401/500: item → FAILED
   */
  async processDebtCreatedEvent(
    payload: WebhookPayload,
    operationItem: any,
  ): Promise<void> {
    const httpStatus = payload.status || 0;

    if (httpStatus === 201) {
      await this.prisma.$transaction([
        this.prisma.providerOperationItem.update({
          where: { id: operationItem.id },
          data: {
            status: OperationItemStatus.REGISTERED,
            debtId: payload.debtId || operationItem.debtId,
          },
        }),
        this.prisma.contract.update({
          where: { id: operationItem.contractId },
          data: {
            serasaStatus: SerasaStatus.REGISTERED,
            debtId: payload.debtId || operationItem.contract?.debtId,
          },
        }),
      ]);
    } else if (httpStatus === 204) {
      await this.prisma.$transaction([
        this.prisma.providerOperationItem.update({
          where: { id: operationItem.id },
          data: {
            status: OperationItemStatus.UPDATED,
            debtId: payload.debtId || operationItem.debtId,
          },
        }),
        this.prisma.contract.update({
          where: { id: operationItem.contractId },
          data: {
            serasaStatus: SerasaStatus.UPDATED,
            debtId: payload.debtId || operationItem.contract?.debtId,
          },
        }),
      ]);
    } else {
      // Error status (400, 401, 500, etc.)
      await this.prisma.providerOperationItem.update({
        where: { id: operationItem.id },
        data: {
          status: OperationItemStatus.FAILED,
          errorCode: payload.errorCode || `HTTP_${httpStatus}`,
          errorMessage:
            payload.errorMessage || `Provider returned status ${httpStatus}`,
        },
      });

      await this.prisma.contract.update({
        where: { id: operationItem.contractId },
        data: { serasaStatus: SerasaStatus.FAILED },
      });
    }
  }

  /**
   * Process DebtRemovedEvent:
   * - Status 200: item → REMOVED, contract → REMOVED
   * - Error status: item → FAILED, contract stays REMOVING
   */
  async processDebtRemovedEvent(
    payload: WebhookPayload,
    operationItem: any,
  ): Promise<void> {
    const httpStatus = payload.status || 0;

    if (httpStatus === 200) {
      await this.prisma.$transaction([
        this.prisma.providerOperationItem.update({
          where: { id: operationItem.id },
          data: { status: OperationItemStatus.REMOVED },
        }),
        this.prisma.contract.update({
          where: { id: operationItem.contractId },
          data: { serasaStatus: SerasaStatus.REMOVED },
        }),
      ]);
    } else {
      // Error — item FAILED, contract stays REMOVING
      await this.prisma.providerOperationItem.update({
        where: { id: operationItem.id },
        data: {
          status: OperationItemStatus.FAILED,
          errorCode: payload.errorCode || `HTTP_${httpStatus}`,
          errorMessage:
            payload.errorMessage || `Provider returned status ${httpStatus}`,
        },
      });
      // Contract serasaStatus stays as REMOVING (no update needed)
    }
  }

  /**
   * Process Agreement events:
   * - ClosedAgreementEvent: contract → IN_AGREEMENT
   * - BreachedAgreementEvent: contract → AGREEMENT_BREACHED
   * - PaidAgreementEvent: contract → PAID
   * - PaidInstallmentEvent: increment paidInstallments
   */
  async processAgreementEvent(
    eventType: string,
    payload: WebhookPayload,
    operationItem: any,
  ): Promise<void> {
    switch (eventType) {
      case 'ClosedAgreementEvent':
        await this.prisma.contract.update({
          where: { id: operationItem.contractId },
          data: { paymentStatus: PaymentStatus.IN_AGREEMENT },
        });
        break;

      case 'BreachedAgreementEvent':
        await this.prisma.contract.update({
          where: { id: operationItem.contractId },
          data: { paymentStatus: PaymentStatus.AGREEMENT_BREACHED },
        });
        break;

      case 'PaidAgreementEvent':
        await this.prisma.contract.update({
          where: { id: operationItem.contractId },
          data: { paymentStatus: PaymentStatus.PAID },
        });
        break;

      case 'PaidInstallmentEvent':
        await this.prisma.contract.update({
          where: { id: operationItem.contractId },
          data: { paidInstallments: { increment: 1 } },
        });
        break;
    }
  }
}

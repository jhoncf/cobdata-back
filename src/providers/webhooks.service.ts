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
import { SettlementProcessorService } from '../payments/settlement/settlement-processor.service';

export interface WebhookPayload {
  eventType?: string;
  transactionId?: string;
  status?: number;
  debtId?: string;
  debtIds?: string[];
  agreementId?: string;
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
    private readonly settlementProcessor: SettlementProcessorService,
  ) {}

  /**
   * Main webhook handler. Validates signature, deduplicates, persists, and processes.
   */
  async handleWebhook(
    headers: Record<string, string>,
    rawBody: Buffer,
    payload: WebhookPayload,
    suppliedToken?: string,
  ): Promise<{ status: number; message: string }> {
    // 1. Validate the shared URL token when configured. The Serasa portal
    // allows a full webhook URL, so this is supported even when no HMAC header
    // is provided by the provider. The legacy HMAC validation remains supported.
    const webhookToken = this.configService.get<string>('SERASA_WEBHOOK_TOKEN');
    const secret = this.configService.get<string>('SERASA_WEBHOOK_SECRET');
    const tokenIsValid = !!webhookToken && suppliedToken === webhookToken;
    const signatureIsValid = !!secret && this.serasaAdapter.validateWebhookSignature(headers, rawBody, secret);
    if (!tokenIsValid && !signatureIsValid) {
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

    const eventType = payload.eventType || 'UNKNOWN';
    const transactionId = payload.transactionId;

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

    const operationItem = transactionId ? await this.prisma.providerOperationItem.findFirst({
      where: { transactionId },
      include: { contract: true },
    }) : null;

    const debtIds = [payload.debtId, ...(payload.debtIds ?? [])].filter((id): id is string => !!id);
    const contract = operationItem?.contract ?? (debtIds.length > 0
      ? await this.prisma.contract.findFirst({ where: { debtId: { in: debtIds }, deletedAt: null } })
      : null);

    if (!operationItem && !contract) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: WebhookStatus.UNMATCHED, processedAt: new Date() },
      });
      return { status: 200, message: 'Unmatched transactionId' };
    }

    // 6. Process event based on type
    try {
      if (operationItem) {
        await this.processEvent(eventType, payload, operationItem);
      } else if (contract) {
        await this.processContractEvent(eventType, payload, contract.id);
      }

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

  /** Processes v3 events received outside a CRM-created operation. */
  private async processContractEvent(eventType: string, payload: WebhookPayload, contractId: string): Promise<void> {
    switch (eventType) {
      case 'DebtCreatedEvent':
      case 'DebtUpdatedEvent':
        if ((payload.status ?? 201) >= 200 && (payload.status ?? 201) < 300) {
          await this.prisma.contract.update({ where: { id: contractId }, data: {
            serasaStatus: eventType === 'DebtUpdatedEvent' || payload.status === 204 ? SerasaStatus.UPDATED : SerasaStatus.REGISTERED,
            debtId: payload.debtId ?? payload.debtIds?.[0],
          } });
        } else {
          await this.prisma.contract.update({ where: { id: contractId }, data: { serasaStatus: SerasaStatus.FAILED } });
        }
        break;
      case 'DebtRemovedEvent':
        if ((payload.status ?? 200) >= 200 && (payload.status ?? 200) < 300) {
          await this.prisma.contract.update({ where: { id: contractId }, data: { serasaStatus: SerasaStatus.REMOVED } });
        }
        break;
      case 'ClosedAgreementEvent':
        await this.updateAgreementStatus(contractId, payload);
        break;
      case 'BreachedAgreementEvent':
        await this.prisma.contract.update({ where: { id: contractId }, data: { paymentStatus: PaymentStatus.AGREEMENT_BREACHED, ...this.agreementProjection(payload) } });
        break;
      case 'PaidAgreementEvent':
        await this.recordSerasaPayment(contractId, eventType, payload);
        await this.prisma.contract.update({ where: { id: contractId }, data: { paymentStatus: PaymentStatus.PAID, ...this.agreementProjection(payload) } });
        break;
      case 'PaidInstallmentEvent':
        await this.recordSerasaPayment(contractId, eventType, payload);
        await this.markInstallmentPaid(contractId, payload);
        break;
    }
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
          errorMessage: this.providerErrorMessage(payload, httpStatus),
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
          errorMessage: this.providerErrorMessage(payload, httpStatus),
        },
      });
      // Contract serasaStatus stays as REMOVING (no update needed)
    }
  }

  /** Extract Serasa's validation error from its webhook payload. */
  private providerErrorMessage(payload: WebhookPayload, httpStatus: number): string {
    if (payload.errorMessage) return payload.errorMessage;
    const errors = payload.error;
    if (Array.isArray(errors)) {
      const messages = errors
        .map((error) => {
          if (typeof error === 'string') return error;
          if (error && typeof error === 'object' && 'message' in error) {
            const message = (error as { message?: unknown }).message;
            return typeof message === 'string' ? message : undefined;
          }
          return undefined;
        })
        .filter((message): message is string => typeof message === 'string' && message.trim().length > 0);
      if (messages.length) return messages.join('; ');
    }
    return `Provider returned status ${httpStatus}`;
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
        await this.updateAgreementStatus(operationItem.contractId, payload);
        break;

      case 'BreachedAgreementEvent':
        await this.prisma.contract.update({
          where: { id: operationItem.contractId },
          data: { paymentStatus: PaymentStatus.AGREEMENT_BREACHED, ...this.agreementProjection(payload) },
        });
        break;

      case 'PaidAgreementEvent':
        await this.recordSerasaPayment(operationItem.contractId, eventType, payload);
        await this.prisma.contract.update({
          where: { id: operationItem.contractId },
          data: { paymentStatus: PaymentStatus.PAID, ...this.agreementProjection(payload) },
        });
        break;

      case 'PaidInstallmentEvent':
        await this.recordSerasaPayment(operationItem.contractId, eventType, payload);
        await this.markInstallmentPaid(operationItem.contractId, payload);
        break;
    }
  }

  /** Normalizes agreement fields across the Serasa webhook payload variants. */
  private agreementProjection(payload: WebhookPayload): Record<string, unknown> {
    const agreement = this.asRecord(payload.agreement) ?? payload;
    const reference = this.asString(agreement.agreementId ?? agreement.id ?? payload.agreementId);
    const totalInstallments = this.asPositiveInt(
      agreement.totalInstallments
      ?? agreement.installmentsAmount
      ?? agreement.installments
      ?? agreement.installmentCount
      ?? payload.totalInstallments
      ?? payload.installmentsAmount,
    );
    const totalAmount = this.asAmount(agreement.totalAmount ?? agreement.agreementValue ?? agreement.amount ?? payload.agreementTotalAmount);
    return {
      ...(reference ? { agreementReference: reference } : {}),
      ...(totalInstallments ? { totalInstallments } : {}),
      ...(totalAmount !== undefined ? { agreementTotalAmount: totalAmount } : {}),
    };
  }

  private async recordSerasaPayment(contractId: string, eventType: string, payload: WebhookPayload): Promise<void> {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId }, select: { accountId: true } });
    if (!contract || !payload.transactionId) return;
    const payment = this.asRecord(payload.payment) ?? this.asRecord(payload.installment) ?? payload;
    const amount = this.asAmount(payment.amount ?? payment.paidAmount ?? payload.amount ?? payload.paidAmount);
    if (amount === undefined) return;
    const installmentNumber = this.asPositiveInt(payment.installmentNumber ?? payment.number ?? payload.installmentNumber);
    const projection = this.agreementProjection(payload);
    await this.settlementProcessor.processEvent({
      provider: 'SERASA_LNOP', eventType: eventType === 'PaidInstallmentEvent' ? 'PAID_INSTALLMENT' : 'PAID_AGREEMENT',
      externalEventId: payload.transactionId,
      externalTransactionId: payload.transactionId,
      contractReference: contractId,
      agreementReference: projection.agreementReference as string | undefined,
      installmentNumber,
      amount: String(amount),
      paidAt: new Date(), status: 'CONFIRMED', providerPayload: payload as Record<string, unknown>,
    }, contract.accountId);
  }

  /** Saves a new agreement and distinguishes a one-off agreement from installments. */
  private async updateAgreementStatus(contractId: string, payload: WebhookPayload): Promise<void> {
    const projection = this.agreementProjection(payload);
    const totalInstallments = projection.totalInstallments as number | undefined;
    await this.prisma.contract.update({
      where: { id: contractId },
      data: {
        paymentStatus: totalInstallments && totalInstallments > 1
          ? PaymentStatus.INSTALLMENT
          : PaymentStatus.IN_AGREEMENT,
        ...projection,
      },
    });
  }

  /** Uses Serasa's installment number when supplied, avoiding double-counting retries. */
  private async markInstallmentPaid(contractId: string, payload: WebhookPayload): Promise<void> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { paidInstallments: true, paymentStatus: true },
    });
    if (!contract) return;
    const payment = this.asRecord(payload.payment) ?? this.asRecord(payload.installment) ?? payload;
    const installmentNumber = this.asPositiveInt(payment.installmentNumber ?? payment.number ?? payload.installmentNumber);
    const paidInstallments = installmentNumber
      ? Math.max(contract.paidInstallments, installmentNumber)
      : contract.paidInstallments + 1;
    await this.prisma.contract.update({
      where: { id: contractId },
      data: {
        paymentStatus: contract.paymentStatus === PaymentStatus.IN_AGREEMENT
          ? PaymentStatus.IN_AGREEMENT
          : PaymentStatus.INSTALLMENT,
        paidInstallments,
        ...this.agreementProjection(payload),
      },
    });
  }

  private asRecord(value: unknown): Record<string, any> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
  }
  private asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
  private asPositiveInt(value: unknown): number | undefined {
    const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  private asAmount(value: unknown): number | undefined {
    const parsed = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
}

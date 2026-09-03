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
  InteractionChannel,
  InteractionStatus,
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
    // Agreement webhooks documented by Serasa do not carry transactionId.
    // Persist a deterministic key so provider retries are idempotent too.
    const transactionId = this.asString(payload.transactionId)
      ?? this.serasaWebhookIdempotencyKey(eventType, payload);

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

    // 5. Correlate the event. Agreement lifecycle events from Serasa can omit
    // transactionId and identify the debt only through debtId/debtIds.
    // Prefer an operation item when a transaction is supplied, then fall back
    // to the debt reference stored on the contract.
    const operationItem = transactionId ? await this.prisma.providerOperationItem.findFirst({
      where: { transactionId },
      include: { contract: true },
    }) : null;

    const debtIds = [payload.debtId, ...(payload.debtIds ?? [])].filter((id): id is string => !!id);
    const agreementId = this.asString(payload.agreementId);
    const agreementLifecycleEvent = ['BreachedAgreementEvent', 'PaidAgreementEvent', 'PaidInstallmentEvent'].includes(eventType);
    let contract = operationItem?.contract ?? null;
    // The official Serasa payload documents agreementId as the strong key for
    // breach and payment events. debtIds may be absent (or deprecated on a
    // breach), so never depend on it for these lifecycle updates.
    if (!contract && agreementLifecycleEvent && agreementId) {
      contract = await this.prisma.contract.findFirst({ where: { agreementReference: agreementId, deletedAt: null } });
    }
    if (!contract && debtIds.length > 0) {
      contract = await this.prisma.contract.findFirst({ where: { debtId: { in: debtIds }, deletedAt: null } });
    }
    // ClosedAgreementEvent supplies debtIds while establishing a new
    // agreementReference, so agreementId remains a useful final fallback.
    if (!contract && agreementId) {
      contract = await this.prisma.contract.findFirst({ where: { agreementReference: agreementId, deletedAt: null } });
    }

    if (!operationItem && !contract) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: WebhookStatus.UNMATCHED, processedAt: new Date() },
      });
      return { status: 200, message: transactionId ? 'Unmatched transactionId' : 'Unmatched debt reference' };
    }

    // 6. Process event based on type
    try {
      if (operationItem) {
        await this.processEvent(eventType, payload, operationItem);
      } else if (contract) {
        await this.processContractEvent(eventType, payload, contract.id);
      }

      // A provider operation documents what the CRM sent. The interaction
      // records the provider's response, so the contract timeline is complete.
      if (contract) {
        await this.recordSerasaWebhookInteraction(contract.id, eventType, payload, transactionId);
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
        // Removal is idempotent: 404 means the debt is already absent from
        // Serasa and must not leave the CRM stuck in REMOVING.
        if (((payload.status ?? 200) >= 200 && (payload.status ?? 200) < 300) || payload.status === 404) {
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
        await this.markAgreementPaid(contractId, payload);
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
   * - Status 200/404: item → REMOVED, contract → REMOVED
   * - Error status: item → FAILED, contract stays REMOVING
   */
  async processDebtRemovedEvent(
    payload: WebhookPayload,
    operationItem: any,
  ): Promise<void> {
    const httpStatus = payload.status || 0;

    // A 404 from the remove endpoint means there is nothing left to remove;
    // treat it as a successful, idempotent removal.
    if (httpStatus === 200 || httpStatus === 404) {
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
        await this.markAgreementPaid(operationItem.contractId, payload);
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
    const installments = Array.isArray(agreement.installments)
      ? agreement.installments
      : Array.isArray(payload.installments)
        ? payload.installments
        : undefined;
    const totalInstallments = this.asPositiveInt(
      agreement.totalInstallments
      ?? agreement.installmentsAmount
      ?? agreement.installmentCount
      ?? payload.totalInstallments
      ?? payload.installmentsAmount,
    );
    const totalAmount = this.asAmount(agreement.totalAmount ?? agreement.agreementValue ?? agreement.amount ?? payload.agreementTotalAmount);
    const firstInstallment = installments?.[0] ? this.asRecord(installments[0]) : null;
    const dueAt = this.parseProviderDate(this.asString(firstInstallment?.dueDate ?? firstInstallment?.paymentLimitDate));
    const discountPercentage = this.asAmount(agreement.discountPercentage ?? payload.discountPercentage);
    return {
      ...(reference ? { agreementReference: reference } : {}),
      ...(totalInstallments ? { totalInstallments } : {}),
      ...(totalAmount !== undefined ? { agreementTotalAmount: totalAmount } : {}),
      ...(totalAmount !== undefined ? { agreedPaymentAmount: totalAmount } : {}),
      ...(installments ? { agreementInstallments: installments as any } : {}),
      ...(dueAt ? { agreementDueAt: dueAt } : {}),
      ...(discountPercentage !== undefined ? { acceptedDiscountPercent: discountPercentage } : {}),
    };
  }

  private async recordSerasaPayment(contractId: string, eventType: string, payload: WebhookPayload): Promise<void> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { accountId: true, agreementReference: true, agreementTotalAmount: true, agreementInstallments: true },
    });
    if (!contract) return;
    const payment = this.asRecord(payload.payment) ?? this.asRecord(payload.installment) ?? payload;
    const installmentNumber = this.asPositiveInt(payment.installmentNumber ?? payment.number ?? payload.installmentNumber);
    const amount = this.asAmount(payment.amount ?? payment.paidAmount ?? payload.amount ?? payload.paidAmount)
      ?? this.scheduledInstallmentAmount(contract.agreementInstallments, installmentNumber)
      ?? (eventType === 'PaidAgreementEvent' ? this.asAmount(contract.agreementTotalAmount) : undefined);
    if (amount === undefined) return;
    const projection = this.agreementProjection(payload);
    const agreementReference = projection.agreementReference as string | undefined ?? contract.agreementReference ?? undefined;
    const rawDate = this.asString(payload.paymentDate ?? payload.date ?? payload.paidAt);
    const paidAt = this.parseProviderDate(rawDate) ?? new Date();
    const eventReference = payload.transactionId
      ?? `${agreementReference ?? contractId}:${eventType}:${installmentNumber ?? 'FULL'}:${rawDate ?? 'undated'}`;
    await this.settlementProcessor.processEvent({
      provider: 'SERASA_LNOP', eventType: eventType === 'PaidInstallmentEvent' ? 'PAID_INSTALLMENT' : 'PAID_AGREEMENT',
      externalEventId: eventReference,
      externalTransactionId: payload.transactionId ?? undefined,
      contractReference: contractId,
      agreementReference,
      installmentNumber,
      amount: String(amount),
      paidAt, status: 'CONFIRMED', providerPayload: payload as Record<string, unknown>,
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

  /** A PaidAgreementEvent has the payment date but not necessarily its value.
   * The closed agreement snapshot is the authoritative value for a full quit.
   */
  private async markAgreementPaid(contractId: string, payload: WebhookPayload): Promise<void> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { agreementTotalAmount: true, totalPaidAmount: true, totalInstallments: true, paidInstallments: true },
    });
    if (!contract) return;
    const rawDate = this.asString(payload.date ?? payload.paymentDate ?? payload.paidAt);
    const paidAt = this.parseProviderDate(rawDate) ?? new Date();
    await this.prisma.contract.update({
      where: { id: contractId },
      data: {
        paymentStatus: PaymentStatus.PAID,
        lastPaymentAt: paidAt,
        totalPaidAmount: contract.agreementTotalAmount ?? contract.totalPaidAmount,
        paidInstallments: contract.totalInstallments ?? contract.paidInstallments,
        ...this.agreementProjection(payload),
      },
    });
  }

  /** Uses Serasa's installment number when supplied, avoiding double-counting retries. */
  private async markInstallmentPaid(contractId: string, payload: WebhookPayload): Promise<void> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { paidInstallments: true, paymentStatus: true, totalInstallments: true },
    });
    if (!contract) return;
    const payment = this.asRecord(payload.payment) ?? this.asRecord(payload.installment) ?? payload;
    const installmentNumber = this.asPositiveInt(payment.installmentNumber ?? payment.number ?? payload.installmentNumber);
    const paidInstallments = installmentNumber
      ? Math.max(contract.paidInstallments, installmentNumber)
      : contract.paidInstallments + 1;
    const projection = this.agreementProjection(payload);
    const totalInstallments = (projection.totalInstallments as number | undefined) ?? contract.totalInstallments;
    const isFullyPaid = !!totalInstallments && paidInstallments >= totalInstallments;
    await this.prisma.contract.update({
      where: { id: contractId },
      data: {
        paymentStatus: isFullyPaid
          ? PaymentStatus.PAID
          : contract.paymentStatus === PaymentStatus.IN_AGREEMENT
          ? PaymentStatus.IN_AGREEMENT
          : PaymentStatus.INSTALLMENT,
        paidInstallments,
        ...projection,
      },
    });
  }

  /** The official PaidInstallmentEvent does not include an amount. */
  private scheduledInstallmentAmount(schedule: unknown, installmentNumber?: number): number | undefined {
    if (!Array.isArray(schedule) || !installmentNumber) return undefined;
    const installment = schedule
      .map((item) => this.asRecord(item))
      .find((item) => this.asPositiveInt(item?.number ?? item?.installmentNumber) === installmentNumber);
    return this.asAmount(installment?.value ?? installment?.amount);
  }

  private parseProviderDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value.length === 10 ? `${value}T12:00:00.000Z` : value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private serasaWebhookIdempotencyKey(eventType: string, payload: WebhookPayload): string | undefined {
    const agreementId = this.asString(payload.agreementId);
    if (agreementId) {
      const installmentNumber = this.asPositiveInt(payload.installmentNumber);
      const eventDate = this.asString(payload.paymentDate ?? payload.date ?? payload.breachDate ?? payload.createdAt) ?? 'undated';
      return `SERASA:${eventType}:${agreementId}:${installmentNumber ?? 'FULL'}:${eventDate}`;
    }
    const debtId = this.asString(payload.debtId) ?? payload.debtIds?.[0];
    if (!debtId) return undefined;
    return `SERASA:${eventType}:${debtId}:${this.asString(payload.createdAt) ?? 'undated'}`;
  }

  /** Keeps the contract's visible interaction history aligned with Serasa webhooks. */
  private async recordSerasaWebhookInteraction(
    contractId: string,
    eventType: string,
    payload: WebhookPayload,
    transactionId?: string,
  ): Promise<void> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { accountId: true, walletId: true },
    });
    if (!contract) return;

    const httpStatus = Number(payload.status ?? 200);
    const failed = Number.isFinite(httpStatus) && httpStatus >= 400;
    const externalId = transactionId
      ?? this.asString(payload.agreementId)
      ?? this.asString(payload.debtId)
      ?? payload.debtIds?.[0]
      ?? null;

    await this.prisma.contractInteraction.create({
      data: {
        accountId: contract.accountId,
        walletId: contract.walletId,
        contractId,
        channel: InteractionChannel.SERASA,
        status: failed ? InteractionStatus.FAILED : InteractionStatus.COMPLETED,
        provider: 'SERASA_LNOP',
        externalId,
        summary: this.serasaWebhookSummary(eventType, failed, payload),
        payload: payload as any,
      },
    });
  }

  private serasaWebhookSummary(eventType: string, failed: boolean, payload: WebhookPayload): string {
    if (failed) {
      const details = this.asString(payload.errorMessage) ?? this.asString(payload.errorCode);
      return `Serasa: retorno de ${eventType} com falha${details ? `: ${details}` : ''}.`;
    }
    const labels: Record<string, string> = {
      DebtCreatedEvent: 'Dívida incluída na Serasa.',
      DebtUpdatedEvent: 'Dívida atualizada na Serasa.',
      DebtRemovedEvent: 'Dívida removida da Serasa.',
      ClosedAgreementEvent: 'Acordo efetivado na Serasa.',
      BreachedAgreementEvent: 'Acordo quebrado na Serasa.',
      PaidInstallmentEvent: 'Parcela de acordo recebida pela Serasa.',
      PaidAgreementEvent: 'Acordo quitado pela Serasa.',
    };
    return labels[eventType] ?? `Webhook ${eventType} recebido da Serasa.`;
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

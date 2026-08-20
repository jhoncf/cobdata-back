import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGatewaysService } from './payment-gateways.service';
import { PaymentProviderFactory } from './adapters/payment-provider.factory';
import {
  PaymentChargeStatus,
  PaymentMethod,
  PaymentEventSource,
  PaymentSettlementSource,
  PaymentSettlementStatus,
} from './enums';
import { PaymentChargeEntity } from './entities/payment-charge.entity';
import {
  BbTimeoutError,
  BbRateLimitedError,
} from './adapters/banco-do-brasil/banco-do-brasil-payment.adapter';

// ─── Job Result Interface ──────────────────────────────────────────────────────

export interface ChargeLifecycleJobResult {
  processedCount: number;
  transitionedToPaid: number;
  transitionedToExpired: number;
  transitionedToIssued: number;
  transitionedToFailed: number;
  providerErrors: number;
}

// ─── Error Classification ──────────────────────────────────────────────────────

type AdapterErrorType = 'TIMEOUT' | 'RATE_LIMIT' | 'OTHER';

function classifyAdapterError(error: unknown): AdapterErrorType {
  if (error instanceof BbTimeoutError) return 'TIMEOUT';
  if (error instanceof BbRateLimitedError) return 'RATE_LIMIT';
  return 'OTHER';
}

// ─── Configuration ─────────────────────────────────────────────────────────────

const INTERVAL_MS = parseInt(process.env.CHARGE_LIFECYCLE_JOB_INTERVAL_MS ?? '300000', 10);
const BATCH_SIZE = parseInt(process.env.CHARGE_LIFECYCLE_JOB_BATCH_SIZE ?? '50', 10);
const PENDING_GRACE_MINUTES = 5;

// ─── Job Implementation ────────────────────────────────────────────────────────

/**
 * ChargeLifecycleJob — periodic reconciliation of payment charge statuses.
 *
 * Covers:
 * 1. PENDING charges that timed out during issuance (> 5 minutes old)
 * 2. Expired charges (PENDING/ISSUED past expiresAt or dueDate)
 *
 * Design:
 * - Uses optimistic locking (version field) to avoid race conditions with webhooks.
 * - Errors on individual charges don't stop batch processing.
 * - Provider unavailability results in skip + retry next cycle.
 * - Creates PaymentSettlement when charge transitions to PAID.
 */
@Injectable()
export class ChargeLifecycleJob {
  private readonly logger = new Logger(ChargeLifecycleJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentGatewaysService: PaymentGatewaysService,
    private readonly providerFactory: PaymentProviderFactory,
  ) {}

  @Interval(INTERVAL_MS)
  async execute(): Promise<ChargeLifecycleJobResult> {
    const result: ChargeLifecycleJobResult = {
      processedCount: 0,
      transitionedToPaid: 0,
      transitionedToExpired: 0,
      transitionedToIssued: 0,
      transitionedToFailed: 0,
      providerErrors: 0,
    };

    this.logger.log('ChargeLifecycleJob: cycle started');

    try {
      const now = new Date();

      // 6.2 — Fetch PENDING charges older than grace period
      const pendingCutoff = new Date(now.getTime() - PENDING_GRACE_MINUTES * 60 * 1_000);
      const pendingCharges = await this.prisma.paymentCharge.findMany({
        where: {
          status: PaymentChargeStatus.PENDING,
          createdAt: { lt: pendingCutoff },
        },
        take: BATCH_SIZE,
        orderBy: { createdAt: 'asc' },
      });

      // 6.3 — Fetch expired charges (PENDING or ISSUED past expiresAt/dueDate)
      const remainingSlots = BATCH_SIZE - pendingCharges.length;
      let expiredCharges: typeof pendingCharges = [];

      if (remainingSlots > 0) {
        expiredCharges = await this.prisma.paymentCharge.findMany({
          where: {
            status: { in: [PaymentChargeStatus.PENDING, PaymentChargeStatus.ISSUED] },
            OR: [
              { expiresAt: { lt: now, not: null } },
              { dueDate: { lt: now }, expiresAt: null },
            ],
            // Exclude charges already in the pending batch
            id: { notIn: pendingCharges.map((c) => c.id) },
          },
          take: remainingSlots,
          orderBy: { createdAt: 'asc' },
        });
      }

      // Merge and deduplicate by id
      const allCharges = [...pendingCharges, ...expiredCharges];
      const uniqueCharges = Array.from(
        new Map(allCharges.map((c) => [c.id, c])).values(),
      );

      // Process each charge individually
      for (const charge of uniqueCharges) {
        try {
          const isExpiredCandidate = this.isExpiredCandidate(charge, now);
          const isPendingCandidate = charge.status === PaymentChargeStatus.PENDING
            && charge.createdAt < pendingCutoff;

          await this.reconcileCharge(charge, isPendingCandidate, isExpiredCandidate, result);
          result.processedCount++;
        } catch (error) {
          // 6.4 — Individual errors don't stop batch
          const errorType = classifyAdapterError(error);
          result.providerErrors++;
          this.logger.warn(
            `ChargeLifecycleJob: error processing charge ${charge.id} [${errorType}]: ${error instanceof Error ? error.message : 'Unknown'}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `ChargeLifecycleJob: fatal error in cycle: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
    }

    this.logger.log(
      `ChargeLifecycleJob: cycle ended — processed=${result.processedCount}, paid=${result.transitionedToPaid}, expired=${result.transitionedToExpired}, issued=${result.transitionedToIssued}, failed=${result.transitionedToFailed}, providerErrors=${result.providerErrors}`,
    );

    return result;
  }

  // ─── Private: Reconcile a Single Charge ────────────────────────────────────

  private async reconcileCharge(
    charge: Record<string, any>,
    isPendingCandidate: boolean,
    isExpiredCandidate: boolean,
    result: ChargeLifecycleJobResult,
  ): Promise<void> {
    // Resolve gateway and adapter
    const gateway = await this.prisma.paymentGateway.findUnique({
      where: { id: charge.paymentGatewayId },
    });

    if (!gateway) {
      this.logger.warn(`ChargeLifecycleJob: gateway not found for charge ${charge.id}`);
      return;
    }

    const adapter = this.providerFactory.get(gateway.providerType as any);

    if (!adapter.fetchStatus) {
      this.logger.warn(`ChargeLifecycleJob: adapter does not support fetchStatus for charge ${charge.id}`);
      return;
    }

    const config = this.paymentGatewaysService.decryptCredentials(gateway);

    // Build entity for adapter
    const chargeEntity: PaymentChargeEntity = {
      id: charge.id,
      accountId: charge.accountId,
      contractId: charge.contractId,
      paymentGatewayId: charge.paymentGatewayId,
      method: charge.method as PaymentMethod,
      status: charge.status as PaymentChargeStatus,
      amount: charge.amount.toString(),
      dueDate: charge.dueDate,
      idempotencyKey: charge.idempotencyKey,
      externalId: charge.externalId,
      externalStatus: charge.externalStatus,
      ourNumber: charge.ourNumber,
      txid: charge.txid,
      digitableLine: charge.digitableLine,
      barcode: charge.barcode,
      pixCopyPaste: charge.pixCopyPaste,
      qrCodeUrl: charge.qrCodeUrl,
      documentUrl: charge.documentUrl,
      providerPayload: charge.providerPayload as Record<string, unknown> | null,
      failureCode: charge.failureCode,
      failureMessage: charge.failureMessage,
      issuedAt: charge.issuedAt,
      paidAt: charge.paidAt,
      expiresAt: charge.expiresAt,
      attributedChannel: charge.attributedChannel as any,
      version: charge.version,
      createdAt: charge.createdAt,
      updatedAt: charge.updatedAt,
    };

    let update;
    try {
      update = await adapter.fetchStatus(chargeEntity, config);
    } catch (error) {
      const errorType = classifyAdapterError(error);
      if (errorType === 'TIMEOUT' || errorType === 'RATE_LIMIT') {
        // Provider unavailable — skip, retry next cycle
        this.logger.warn(
          `ChargeLifecycleJob: provider unavailable for charge ${charge.id} [${errorType}], will retry next cycle`,
        );
        result.providerErrors++;
        return;
      }
      throw error;
    }

    // Determine transition based on provider response
    const previousStatus = charge.status as PaymentChargeStatus;

    if (update.status === PaymentChargeStatus.PAID) {
      // Provider confirms payment (late payment has precedence over expiration)
      await this.transitionToPaid(charge, update, result);
    } else if (isPendingCandidate && !isExpiredCandidate) {
      // PENDING reconciliation
      if (update.status === PaymentChargeStatus.ISSUED) {
        await this.transitionToIssued(charge, update, result);
      } else if (update.status === PaymentChargeStatus.FAILED) {
        await this.transitionToFailed(charge, update, result);
      }
      // If provider doesn't recognize, also mark as FAILED
      else if (update.externalStatus === undefined && update.status === previousStatus) {
        // Provider returned same status — no action needed
      }
    } else if (isExpiredCandidate) {
      // Expired reconciliation — provider says not paid
      if (update.status === PaymentChargeStatus.ISSUED || update.status === previousStatus) {
        await this.transitionToExpired(charge, result);
      }
    }
  }

  // ─── Private: Transition Helpers ───────────────────────────────────────────

  private async transitionToPaid(
    charge: Record<string, any>,
    update: { paidAt?: Date; externalStatus?: string; providerPayload?: Record<string, unknown> },
    result: ChargeLifecycleJobResult,
  ): Promise<void> {
    const paidAt = update.paidAt ?? new Date();

    await this.updateChargeWithOptimisticLock(charge, {
      status: PaymentChargeStatus.PAID,
      externalStatus: update.externalStatus ?? charge.externalStatus,
      paidAt,
      providerPayload: update.providerPayload
        ? (update.providerPayload as unknown as Prisma.InputJsonValue)
        : undefined,
    });

    await this.createPaymentEvent(
      charge.id,
      charge.status,
      PaymentChargeStatus.PAID,
    );

    await this.createSettlement(charge, paidAt);
    result.transitionedToPaid++;
  }

  private async transitionToIssued(
    charge: Record<string, any>,
    update: { externalStatus?: string; providerPayload?: Record<string, unknown> },
    result: ChargeLifecycleJobResult,
  ): Promise<void> {
    await this.updateChargeWithOptimisticLock(charge, {
      status: PaymentChargeStatus.ISSUED,
      externalStatus: update.externalStatus ?? charge.externalStatus,
      issuedAt: new Date(),
      providerPayload: update.providerPayload
        ? (update.providerPayload as unknown as Prisma.InputJsonValue)
        : undefined,
    });

    await this.createPaymentEvent(
      charge.id,
      charge.status,
      PaymentChargeStatus.ISSUED,
    );

    result.transitionedToIssued++;
  }

  private async transitionToFailed(
    charge: Record<string, any>,
    update: { failureCode?: string; failureMessage?: string; externalStatus?: string },
    result: ChargeLifecycleJobResult,
  ): Promise<void> {
    await this.updateChargeWithOptimisticLock(charge, {
      status: PaymentChargeStatus.FAILED,
      failureCode: update.failureCode ?? 'PROVIDER_NOT_PROCESSED',
      failureMessage: update.failureMessage ?? 'Provider did not process the charge',
      externalStatus: update.externalStatus ?? charge.externalStatus,
    });

    await this.createPaymentEvent(
      charge.id,
      charge.status,
      PaymentChargeStatus.FAILED,
    );

    result.transitionedToFailed++;
  }

  private async transitionToExpired(
    charge: Record<string, any>,
    result: ChargeLifecycleJobResult,
  ): Promise<void> {
    await this.updateChargeWithOptimisticLock(charge, {
      status: PaymentChargeStatus.EXPIRED,
    });

    await this.createPaymentEvent(
      charge.id,
      charge.status,
      PaymentChargeStatus.EXPIRED,
    );

    result.transitionedToExpired++;
  }

  // ─── Private: Optimistic Lock Update ───────────────────────────────────────

  /**
   * Updates a charge using optimistic locking via the version field.
   * If the version has changed (e.g., a webhook updated it concurrently),
   * the update will affect 0 rows and we log a warning.
   */
  private async updateChargeWithOptimisticLock(
    charge: Record<string, any>,
    data: Record<string, unknown>,
  ): Promise<void> {
    const updated = await this.prisma.paymentCharge.updateMany({
      where: {
        id: charge.id,
        version: charge.version,
      },
      data: {
        ...data,
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      this.logger.warn(
        `ChargeLifecycleJob: optimistic lock conflict for charge ${charge.id} — skipped (webhook likely updated it)`,
      );
    }
  }

  // ─── Private: Payment Event ────────────────────────────────────────────────

  private async createPaymentEvent(
    chargeId: string,
    fromStatus: string | null,
    toStatus: PaymentChargeStatus,
  ): Promise<void> {
    try {
      await this.prisma.paymentEvent.create({
        data: {
          paymentChargeId: chargeId,
          fromStatus,
          toStatus,
          source: PaymentEventSource.JOB,
        },
      });
    } catch (error) {
      this.logger.error(
        `ChargeLifecycleJob: failed to create payment event for charge ${chargeId}: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
    }
  }

  // ─── Private: Settlement Creation ──────────────────────────────────────────

  /**
   * Creates an idempotent PaymentSettlement when a charge transitions to PAID.
   * Best-effort: if the model or record already exists, logs and continues.
   */
  private async createSettlement(
    charge: Record<string, any>,
    paidAt: Date,
  ): Promise<void> {
    try {
      const prismaAny = this.prisma as any;
      if (!prismaAny.paymentSettlement) {
        this.logger.warn('ChargeLifecycleJob: PaymentSettlement model not available — skipping settlement creation');
        return;
      }

      // Check if settlement already exists
      const existing = await prismaAny.paymentSettlement.findFirst({
        where: { paymentChargeId: charge.id },
      });

      if (existing) {
        return;
      }

      await prismaAny.paymentSettlement.create({
        data: {
          accountId: charge.accountId,
          contractId: charge.contractId,
          paymentChargeId: charge.id,
          source: PaymentSettlementSource.PIX,
          status: PaymentSettlementStatus.CONFIRMED,
          amount: charge.amount.toString(),
          paidAt,
          externalPaymentId: charge.externalId ?? charge.txid ?? charge.id,
        },
      });
    } catch (error) {
      this.logger.warn(
        `ChargeLifecycleJob: failed to create settlement for charge ${charge.id}: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
    }
  }

  // ─── Private: Helpers ──────────────────────────────────────────────────────

  /**
   * Determines if a charge is a candidate for expiration reconciliation.
   */
  private isExpiredCandidate(charge: Record<string, any>, now: Date): boolean {
    const status = charge.status as PaymentChargeStatus;
    if (status !== PaymentChargeStatus.PENDING && status !== PaymentChargeStatus.ISSUED) {
      return false;
    }

    // Pix: check expiresAt
    if (charge.expiresAt && new Date(charge.expiresAt) < now) {
      return true;
    }

    // Boleto: check dueDate when no expiresAt
    if (!charge.expiresAt && charge.dueDate && new Date(charge.dueDate) < now) {
      return true;
    }

    return false;
  }
}

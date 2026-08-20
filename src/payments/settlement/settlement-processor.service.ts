import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentSettlementEvent } from './payment-settlement-event.interface';
import {
  PaymentSettlementSource,
  PaymentSettlementStatus,
} from '../enums';

/**
 * Maps provider string to PaymentSettlementSource enum.
 */
function mapProviderToSource(provider: string): PaymentSettlementSource {
  switch (provider) {
    case 'BANCO_DO_BRASIL':
      return PaymentSettlementSource.PIX;
    case 'SERASA_LNOP':
      return PaymentSettlementSource.SERASA;
    default:
      return PaymentSettlementSource.MANUAL;
  }
}

/**
 * Converts a Record to Prisma-compatible JSON input.
 */
function toJsonInput(
  payload: Record<string, unknown> | undefined | null,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (payload === null || payload === undefined) return Prisma.JsonNull;
  return payload as unknown as Prisma.InputJsonValue;
}

/**
 * SettlementProcessorService
 *
 * Responsible for processing canonical PaymentSettlementEvent records.
 * Creates immutable PaymentSettlement records (idempotent by source + externalEventId)
 * and updates Contract projections (totalPaidAmount, lastPaymentAt).
 *
 * This is the ONLY service that updates financial projections on Contract.
 */
@Injectable()
export class SettlementProcessorService {
  private readonly logger = new Logger(SettlementProcessorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Process a confirmed payment event.
   * - Creates PaymentSettlement record (idempotent by source + externalPaymentId)
   * - Updates Contract projections: totalPaidAmount (sum of settlements), lastPaymentAt
   * - Does NOT auto-settle contract unless totalPaidAmount >= agreement total
   * - Handles partial payments by creating distinct records
   */
  async processEvent(
    event: PaymentSettlementEvent,
    accountId: string,
  ): Promise<void> {
    const source = mapProviderToSource(event.provider);

    // Idempotency check: unique(source, externalPaymentId)
    const existing = await this.prisma.paymentSettlement.findUnique({
      where: {
        source_externalPaymentId: {
          source,
          externalPaymentId: event.externalEventId,
        },
      },
    });

    if (existing) {
      this.logger.debug(
        `Settlement already exists for source=${source}, externalPaymentId=${event.externalEventId}. Skipping.`,
      );
      return;
    }

    // Resolve contract by reference
    const contract = await this.prisma.contract.findFirst({
      where: {
        accountId,
        OR: [
          { contractNumber: event.contractReference },
          { debtId: event.contractReference },
        ],
      },
    });

    if (!contract) {
      this.logger.warn(
        `No contract found for reference=${event.contractReference}, accountId=${accountId}. Settlement not created.`,
      );
      return;
    }

    // Create the settlement record in a transaction with projection update
    await this.prisma.$transaction(async (tx) => {
      // Create immutable settlement record
      await tx.paymentSettlement.create({
        data: {
          accountId,
          contractId: contract.id,
          paymentChargeId: null,
          agreementReference: event.agreementReference ?? null,
          installmentNumber: event.installmentNumber ?? null,
          source,
          status: PaymentSettlementStatus.CONFIRMED,
          amount: new Prisma.Decimal(event.amount),
          paidAt: event.paidAt,
          externalPaymentId: event.externalEventId,
          channelEventId: event.externalTransactionId ?? null,
          debtReference: event.contractReference,
          metadata: Prisma.JsonNull,
          providerPayload: toJsonInput(event.providerPayload),
        },
      });

      // Update Contract projections: sum all CONFIRMED settlements
      const aggregation = await tx.paymentSettlement.aggregate({
        where: {
          contractId: contract.id,
          status: PaymentSettlementStatus.CONFIRMED,
        },
        _sum: { amount: true },
        _max: { paidAt: true },
      });

      await tx.contract.update({
        where: { id: contract.id },
        data: {
          totalPaidAmount: aggregation._sum.amount ?? new Prisma.Decimal(0),
          lastPaymentAt: aggregation._max.paidAt ?? event.paidAt,
        },
      });
    });

    this.logger.log(
      `Settlement created: source=${source}, externalPaymentId=${event.externalEventId}, contractId=${contract.id}, amount=${event.amount}`,
    );
  }

  /**
   * Process a reversal event.
   * - Creates a new PaymentSettlement with status=REVERSED referencing the original
   * - Never deletes original settlement
   * - Updates Contract projections accordingly (subtract from totalPaidAmount)
   */
  async processReversal(
    event: PaymentSettlementEvent,
    accountId: string,
  ): Promise<void> {
    const source = mapProviderToSource(event.provider);

    // Idempotency check for the reversal itself
    const existingReversal = await this.prisma.paymentSettlement.findUnique({
      where: {
        source_externalPaymentId: {
          source,
          externalPaymentId: event.externalEventId,
        },
      },
    });

    if (existingReversal) {
      this.logger.debug(
        `Reversal settlement already exists for source=${source}, externalPaymentId=${event.externalEventId}. Skipping.`,
      );
      return;
    }

    // Resolve contract by reference
    const contract = await this.prisma.contract.findFirst({
      where: {
        accountId,
        OR: [
          { contractNumber: event.contractReference },
          { debtId: event.contractReference },
        ],
      },
    });

    if (!contract) {
      this.logger.warn(
        `No contract found for reversal reference=${event.contractReference}, accountId=${accountId}. Reversal not created.`,
      );
      return;
    }

    // Create the reversal record and update projections
    await this.prisma.$transaction(async (tx) => {
      // Create reversal settlement (immutable, never deletes original)
      await tx.paymentSettlement.create({
        data: {
          accountId,
          contractId: contract.id,
          paymentChargeId: null,
          agreementReference: event.agreementReference ?? null,
          installmentNumber: event.installmentNumber ?? null,
          source,
          status: PaymentSettlementStatus.REVERSED,
          amount: new Prisma.Decimal(event.amount),
          paidAt: event.paidAt,
          externalPaymentId: event.externalEventId,
          channelEventId: event.externalTransactionId ?? null,
          debtReference: event.contractReference,
          metadata: Prisma.JsonNull,
          providerPayload: toJsonInput(event.providerPayload),
        },
      });

      // Recalculate projections: sum CONFIRMED minus REVERSED
      const confirmedAgg = await tx.paymentSettlement.aggregate({
        where: {
          contractId: contract.id,
          status: PaymentSettlementStatus.CONFIRMED,
        },
        _sum: { amount: true },
      });

      const reversedAgg = await tx.paymentSettlement.aggregate({
        where: {
          contractId: contract.id,
          status: PaymentSettlementStatus.REVERSED,
        },
        _sum: { amount: true },
      });

      const confirmedTotal = confirmedAgg._sum.amount ?? new Prisma.Decimal(0);
      const reversedTotal = reversedAgg._sum.amount ?? new Prisma.Decimal(0);
      const netTotal = confirmedTotal.sub(reversedTotal);

      // Find the last CONFIRMED payment date (reversals don't affect lastPaymentAt)
      const lastConfirmed = await tx.paymentSettlement.aggregate({
        where: {
          contractId: contract.id,
          status: PaymentSettlementStatus.CONFIRMED,
        },
        _max: { paidAt: true },
      });

      await tx.contract.update({
        where: { id: contract.id },
        data: {
          totalPaidAmount: netTotal.isNegative()
            ? new Prisma.Decimal(0)
            : netTotal,
          lastPaymentAt: lastConfirmed._max.paidAt ?? null,
        },
      });
    });

    this.logger.log(
      `Reversal settlement created: source=${source}, externalPaymentId=${event.externalEventId}, contractId=${contract.id}, amount=${event.amount}`,
    );
  }
}

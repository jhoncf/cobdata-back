import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationsService } from '../../providers/operations.service';
import {
  PaymentChargeStatus,
  PaymentEventSource,
  PaymentSettlementSource,
  PaymentSettlementStatus,
} from '../enums';

/**
 * Represents a single Pix entry from the BB webhook payload.
 */
export interface BbPixWebhookEntry {
  endToEndId: string;
  txid: string;
  valor: string;
  horario: string;
  componenteValor?: Record<string, unknown>;
}

/**
 * Represents the BB Pix webhook payload structure.
 */
export interface BbPixWebhookPayload {
  pix: BbPixWebhookEntry[];
}

@Injectable()
export class BbPixWebhookService {
  private readonly logger = new Logger(BbPixWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly operationsService: OperationsService,
  ) {}

  /**
   * Processes the BB Pix webhook payload.
   * For each pix entry:
   * 1. Finds the PaymentCharge by txid
   * 2. Transitions charge to PAID (with optimistic locking)
   * 3. Creates PaymentSettlement idempotently (dedup by source + externalPaymentId)
   * 4. Creates PaymentEvent with source=WEBHOOK
   *
   * Always returns void — the controller always responds 200.
   */
  async processPixWebhook(payload: BbPixWebhookPayload): Promise<void> {
    if (!payload?.pix || !Array.isArray(payload.pix)) {
      this.logger.warn('BB Pix webhook received with invalid or empty payload');
      return;
    }

    for (const entry of payload.pix) {
      try {
        await this.processPixEntry(entry);
      } catch (error) {
        // Log and continue processing remaining entries — never fail the webhook
        this.logger.error(
          `Error processing Pix entry endToEndId=${entry.endToEndId} txid=${entry.txid}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    }
  }

  /**
   * Processes a single Pix payment entry from the webhook.
   */
  private async processPixEntry(entry: BbPixWebhookEntry): Promise<void> {
    const { endToEndId, txid, valor, horario } = entry;

    if (!txid || !endToEndId) {
      this.logger.warn('Pix entry missing txid or endToEndId, skipping');
      return;
    }

    // 7.3 — Idempotent: check if settlement already exists for this endToEndId
    const existingSettlement = await this.findExistingSettlement(endToEndId);
    if (existingSettlement) {
      this.logger.debug(
        `Settlement already exists for endToEndId=${endToEndId}, skipping`,
      );
      return;
    }

    // Find charge by txid
    const charge = await this.prisma.paymentCharge.findFirst({
      where: { txid },
    });

    if (!charge) {
      this.logger.warn(`No PaymentCharge found for txid=${txid}, skipping`);
      return;
    }

    // If already PAID, skip (another source confirmed it first)
    if (charge.status === PaymentChargeStatus.PAID) {
      this.logger.debug(
        `Charge ${charge.id} already PAID, ensuring settlement exists`,
      );
      await this.ensureSettlement(charge, endToEndId, valor, horario);
      return;
    }

    const paidAt = new Date(horario);
    const previousStatus = charge.status;

    // 7.3 — Optimistic locking: use version field to avoid race conditions
    try {
      await this.prisma.paymentCharge.update({
        where: {
          id: charge.id,
          version: charge.version, // Optimistic lock
        },
        data: {
          status: PaymentChargeStatus.PAID,
          paidAt,
          externalStatus: 'CONCLUIDA',
          version: { increment: 1 },
        },
      });
    } catch (error: any) {
      // If optimistic lock fails (concurrent update), the charge was updated by
      // another process (job/sync). Check if it's now PAID and handle accordingly.
      if (error?.code === 'P2025') {
        this.logger.warn(
          `Optimistic lock conflict for charge ${charge.id} — another process updated it`,
        );
        // Re-fetch and ensure settlement
        const refreshed = await this.prisma.paymentCharge.findUnique({
          where: { id: charge.id },
        });
        if (refreshed?.status === PaymentChargeStatus.PAID) {
          await this.ensureSettlement(refreshed, endToEndId, valor, horario);
        }
        return;
      }
      throw error;
    }

    // Create PaymentEvent with source=WEBHOOK
    await this.createPaymentEvent(
      charge.id,
      previousStatus as PaymentChargeStatus,
      PaymentChargeStatus.PAID,
    );

    // Create PaymentSettlement idempotently
    await this.ensureSettlement(charge, endToEndId, valor, horario);

    this.logger.log(
      `Pix payment confirmed: chargeId=${charge.id} txid=${txid} endToEndId=${endToEndId} amount=${valor}`,
    );
  }

  /**
   * Checks if a settlement already exists for the given endToEndId (dedup).
   * Uses the unique index (source, externalPaymentId).
   */
  private async findExistingSettlement(
    endToEndId: string,
  ): Promise<any | null> {
    const prismaAny = this.prisma as any;
    if (!prismaAny.paymentSettlement) {
      return null;
    }

    return prismaAny.paymentSettlement.findFirst({
      where: {
        source: PaymentSettlementSource.PIX,
        externalPaymentId: endToEndId,
      },
    });
  }

  /**
   * Creates a PaymentSettlement if one doesn't already exist for the given endToEndId.
   * Idempotent — safe to call multiple times.
   */
  private async ensureSettlement(
    charge: Record<string, any>,
    endToEndId: string,
    valor: string,
    horario: string,
  ): Promise<void> {
    const prismaAny = this.prisma as any;
    if (!prismaAny.paymentSettlement) {
      this.logger.warn(
        'PaymentSettlement model not available — skipping settlement creation',
      );
      return;
    }

    // Check idempotency: unique(source, externalPaymentId)
    const existing = await prismaAny.paymentSettlement.findFirst({
      where: {
        source: PaymentSettlementSource.PIX,
        externalPaymentId: endToEndId,
      },
    });

    if (existing) {
      await this.refreshContractPaymentProjection(charge.contractId);
      return;
    }

    try {
      await prismaAny.paymentSettlement.create({
        data: {
          accountId: charge.accountId,
          contractId: charge.contractId,
          paymentChargeId: charge.id,
          source: PaymentSettlementSource.PIX,
          status: PaymentSettlementStatus.CONFIRMED,
          amount: valor,
          paidAt: new Date(horario),
          externalPaymentId: endToEndId,
        },
      });
      await this.refreshContractPaymentProjection(charge.contractId);
    } catch (error: any) {
      // Handle unique constraint violation (race condition between concurrent webhooks)
      if (error?.code === 'P2002') {
        this.logger.debug(
          `Settlement already exists for endToEndId=${endToEndId} (concurrent creation)`,
        );
        await this.refreshContractPaymentProjection(charge.contractId);
        return;
      }
      throw error;
    }
  }

  /**
   * Updates the contract projection consumed by the contracts list.
   * A contract is marked PAID only after its confirmed settlements cover the
   * current debt value, preserving partial-payment and installment flows.
   */
  private async refreshContractPaymentProjection(contractId: string): Promise<void> {
    const paidContract = await this.prisma.$transaction(async (tx) => {
      const [contract, aggregation, paidCharge] = await Promise.all([
        tx.contract.findUnique({ where: { id: contractId } }),
        tx.paymentSettlement.aggregate({
          where: {
            contractId,
            status: PaymentSettlementStatus.CONFIRMED,
          },
          _sum: { amount: true },
          _max: { paidAt: true },
        }),
        tx.paymentCharge.findFirst({ where: { contractId, status: PaymentChargeStatus.PAID }, orderBy: { paidAt: 'desc' }, select: { amount: true, discountPercent: true } }),
      ]);

      if (!contract) {
        this.logger.warn(`No Contract found for payment projection: ${contractId}`);
        return;
      }

      const totalPaid = aggregation._sum.amount ?? new Prisma.Decimal(0);
      const targetAmount = paidCharge?.amount ?? contract.updatedValue;
      const isFullyPaid = totalPaid.greaterThanOrEqualTo(targetAmount);

      await tx.contract.update({
        where: { id: contractId },
        data: {
          totalPaidAmount: totalPaid,
          lastPaymentAt: aggregation._max.paidAt ?? contract.lastPaymentAt,
          ...(paidCharge ? { agreedPaymentAmount: paidCharge.amount, acceptedDiscountPercent: paidCharge.discountPercent } : {}),
          ...(isFullyPaid ? { paymentStatus: 'PAID' } : {}),
        },
      });

      return isFullyPaid ? { id: contract.id, accountId: contract.accountId } : null;
    });

    // A payment completed outside Serasa must remove the debt there as well.
    // The operation is idempotent and only queues when the debt is still active.
    if (paidContract) {
      await this.operationsService.createAutomaticRemovalForPaidContract(
        paidContract.id,
        paidContract.accountId,
      );
    }
  }

  /**
   * Creates a PaymentEvent for the charge status transition.
   */
  private async createPaymentEvent(
    paymentChargeId: string,
    fromStatus: PaymentChargeStatus,
    toStatus: PaymentChargeStatus,
  ): Promise<void> {
    try {
      await this.prisma.paymentEvent.create({
        data: {
          paymentChargeId,
          fromStatus,
          toStatus,
          source: PaymentEventSource.WEBHOOK,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create payment event for charge ${paymentChargeId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }
}

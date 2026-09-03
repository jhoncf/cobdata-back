import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Marks unpaid first-installment agreements as breached after their commercial
 * deadline. Pix expiry is intentionally not used here: a new Pix may be issued
 * during the negotiated payment window without renewing the agreement.
 */
@Injectable()
export class AgreementLifecycleJob {
  private readonly logger = new Logger(AgreementLifecycleJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { timeZone: 'America/Sao_Paulo' })
  async markOverdueAgreementsAsBreached(): Promise<void> {
    const result = await this.prisma.contract.updateMany({
      where: {
        paymentStatus: PaymentStatus.IN_AGREEMENT,
        agreementDueAt: { lt: new Date() },
        deletedAt: null,
      },
      data: { paymentStatus: PaymentStatus.AGREEMENT_BREACHED },
    });

    this.logger.log(`AgreementLifecycleJob: ${result.count} agreement(s) marked as breached`);
  }
}

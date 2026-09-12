import { Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async today(accountId: string, creditorId?: string) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    const start = new Date(`${date}T00:00:00-03:00`);
    const end = new Date(`${date}T00:00:00-03:00`);
    end.setDate(end.getDate() + 1);

    const where: Prisma.ContractWhereInput = {
      accountId,
      deletedAt: null,
      agreementCreatedAt: { gte: start, lt: end },
      ...(creditorId ? { wallet: { creditorId } } : {}),
    };
    const [aggregate, breachedAgreements] = await Promise.all([
      this.prisma.contract.aggregate({
        where,
        _count: { id: true },
        _sum: { agreementTotalAmount: true },
      }),
      this.prisma.contract.count({
        where: {
          accountId,
          deletedAt: null,
          paymentStatus: PaymentStatus.AGREEMENT_BREACHED,
          ...(creditorId ? { wallet: { creditorId } } : {}),
        },
      }),
    ]);

    return {
      date,
      timezone: 'America/Sao_Paulo',
      agreements: {
        count: aggregate._count.id,
        amount: Number(aggregate._sum.agreementTotalAmount ?? 0),
      },
      breachedAgreements: {
        count: breachedAgreements,
      },
    };
  }
}

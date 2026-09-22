import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService implements OnModuleDestroy {
  private static readonly AGREEMENT_HISTORY_CACHE_TTL_SECONDS = 5 * 60;
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.redis = new Redis({
      host: config.get<string>('REDIS_HOST'),
      port: config.get<number>('REDIS_PORT'),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      lazyConnect: true,
    });
    this.redis.connect().catch(() => {
      // O Dashboard continua funcional mesmo se o cache estiver indisponível.
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

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
      this.prisma.contract.aggregate({
        where: {
          accountId,
          deletedAt: null,
          paymentStatus: PaymentStatus.AGREEMENT_BREACHED,
          ...(creditorId ? { wallet: { creditorId } } : {}),
        },
        _count: { id: true },
        _sum: { agreementTotalAmount: true },
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
        count: breachedAgreements._count.id,
        amount: Number(breachedAgreements._sum.agreementTotalAmount ?? 0),
      },
    };
  }

  async agreementHistory(accountId: string, creditorId?: string) {
    const cacheKey = `dashboard:agreement-history:${accountId}:${creditorId ?? 'all'}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {
      // O banco é a fonte de verdade quando o Redis não estiver disponível.
    }

    const creditorFilter = creditorId ? Prisma.sql`AND wallet."creditorId" = ${creditorId}` : Prisma.empty;
    const [agreementDailyTotals, paidAgreementDailyTotals, breachDailyTotals] = await Promise.all([
      this.prisma.$queryRaw<Array<{ date: string; count: bigint; amount: Prisma.Decimal }>>(Prisma.sql`
        SELECT TO_CHAR((contract."agreementCreatedAt" AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS date,
               COUNT(*)::bigint AS count,
               COALESCE(SUM(contract."agreementTotalAmount"), 0) AS amount
        FROM "Contract" contract
        INNER JOIN "Wallet" wallet ON wallet.id = contract."walletId"
        WHERE contract."accountId" = ${accountId}
          AND contract."deletedAt" IS NULL
          AND contract."status" = 'ACTIVE'
          AND contract."paymentStatus" IN ('IN_AGREEMENT', 'INSTALLMENT')
          ${creditorFilter}
          AND contract."agreementCreatedAt" >= (((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date - 29)::timestamp AT TIME ZONE 'America/Sao_Paulo')
          AND contract."agreementCreatedAt" < (((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
        GROUP BY (contract."agreementCreatedAt" AT TIME ZONE 'America/Sao_Paulo')::date
        ORDER BY (contract."agreementCreatedAt" AT TIME ZONE 'America/Sao_Paulo')::date
      `),
      this.prisma.$queryRaw<Array<{ date: string; count: bigint }>>(Prisma.sql`
        SELECT TO_CHAR((COALESCE(contract."lastPaymentAt", contract."updatedAt") AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS date,
               COUNT(*)::bigint AS count
        FROM "Contract" contract
        INNER JOIN "Wallet" wallet ON wallet.id = contract."walletId"
        WHERE contract."accountId" = ${accountId}
          AND contract."deletedAt" IS NULL
          AND contract."status" = 'ACTIVE'
          AND contract."paymentStatus" = 'PAID'
          AND contract."agreementCreatedAt" IS NOT NULL
          ${creditorFilter}
          AND COALESCE(contract."lastPaymentAt", contract."updatedAt") >= (((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date - 29)::timestamp AT TIME ZONE 'America/Sao_Paulo')
          AND COALESCE(contract."lastPaymentAt", contract."updatedAt") < (((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
        GROUP BY (COALESCE(contract."lastPaymentAt", contract."updatedAt") AT TIME ZONE 'America/Sao_Paulo')::date
        ORDER BY (COALESCE(contract."lastPaymentAt", contract."updatedAt") AT TIME ZONE 'America/Sao_Paulo')::date
      `),
      this.prisma.$queryRaw<Array<{ date: string; count: bigint }>>(Prisma.sql`
        SELECT TO_CHAR((COALESCE(breach."occurredAt", contract."updatedAt") AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS date,
               COUNT(*)::bigint AS count
        FROM "Contract" contract
        INNER JOIN "Wallet" wallet ON wallet.id = contract."walletId"
        LEFT JOIN LATERAL (
          SELECT interaction."occurredAt"
          FROM "ContractInteraction" interaction
          WHERE interaction."contractId" = contract.id
            AND interaction."channel" = 'SERASA'
            AND (
              interaction."payload"->>'eventType' = 'BreachedAgreementEvent'
              OR interaction."summary" = 'Acordo quebrado na Serasa.'
            )
          ORDER BY interaction."occurredAt" DESC
          LIMIT 1
        ) breach ON TRUE
        WHERE contract."accountId" = ${accountId}
          AND contract."deletedAt" IS NULL
          AND contract."status" = 'ACTIVE'
          AND contract."paymentStatus" = 'AGREEMENT_BREACHED'
          ${creditorFilter}
          AND COALESCE(breach."occurredAt", contract."updatedAt") >= (((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date - 29)::timestamp AT TIME ZONE 'America/Sao_Paulo')
          AND COALESCE(breach."occurredAt", contract."updatedAt") < (((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
        GROUP BY (COALESCE(breach."occurredAt", contract."updatedAt") AT TIME ZONE 'America/Sao_Paulo')::date
        ORDER BY (COALESCE(breach."occurredAt", contract."updatedAt") AT TIME ZONE 'America/Sao_Paulo')::date
      `),
    ]);

    const dailyByDate = new Map(agreementDailyTotals.map((item) => [item.date, {
      count: Number(item.count), amount: Number(item.amount),
    }]));
    const paidByDate = new Map(paidAgreementDailyTotals.map((item) => [item.date, Number(item.count)]));
    const breachesByDate = new Map(breachDailyTotals.map((item) => [item.date, Number(item.count)]));
    const data = Array.from({ length: 30 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (29 - index));
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(date);
      const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
      const key = `${part('year')}-${part('month')}-${part('day')}`;
      const daily = dailyByDate.get(key) ?? { count: 0, amount: 0 };
      return { date: key, ...daily, paidCount: paidByDate.get(key) ?? 0, breachCount: breachesByDate.get(key) ?? 0 };
    });
    const result = { data, cachedAt: new Date().toISOString(), cacheTtlSeconds: DashboardService.AGREEMENT_HISTORY_CACHE_TTL_SECONDS };

    try {
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', DashboardService.AGREEMENT_HISTORY_CACHE_TTL_SECONDS);
    } catch {
      // O cache é opcional.
    }
    return result;
  }
}

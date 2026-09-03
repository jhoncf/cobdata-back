import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { ListWalletsQueryDto } from './dto/list-wallets-query.dto';
import { PaginatedResponse } from '../common/dto';
import { Prisma, Wallet } from '@prisma/client';

export interface WalletSummary {
  totalContracts: number;
  contractsByPaymentStatus: Record<string, number>;
  paymentStatusTotals: Record<string, { count: number; amount: number }>;
  serasaTotal: { count: number; amount: number };
  totalValue: number;
  recoveredValue: number;
  repasseForecastValue: number;
  repasseRealizedValue: number;
  commissionForecastValue: number;
  commissionRealizedValue: number;
  discountsConcededValue: number;
  efficiencyRate: number;
}

@Injectable()
export class WalletsService implements OnModuleDestroy {
  private readonly redis: Redis;
  private static readonly LIST_CACHE_TTL_SECONDS = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST'),
      port: this.configService.get<number>('REDIS_PORT'),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      lazyConnect: true,
    });
    this.redis.connect().catch(() => {
      // A falha do cache nunca deve impedir a listagem das carteiras.
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  async create(
    creditorId: string,
    dto: CreateWalletDto,
    accountId: string,
  ): Promise<Wallet> {
    const creditor = await this.prisma.creditor.findFirst({
      where: { id: creditorId, accountId, deletedAt: null },
      include: { discountBands: { orderBy: { minAgingDays: 'asc' } } },
    });

    if (!creditor) {
      throw new NotFoundException('Creditor not found');
    }

    const wallet = await this.prisma.wallet.create({
      data: {
        accountId,
        creditorId,
        name: dto.name,
        status: 'ACTIVE',
        cobcomDiscountPercent: dto.cobcomDiscountPercent ?? 0,
        offerFirstInstallmentDays: dto.offerFirstInstallmentDays ?? 5,
        offerMinInstallmentValue: dto.offerMinInstallmentValue ?? 0.01,
        offerMaxInstallments: dto.offerMaxInstallments ?? 1,
        commissionPercent: creditor.commissionPercent,
        discountBands: { create: creditor.discountBands.map((band) => ({
          minAgingDays: band.minAgingDays,
          maxAgingDays: band.maxAgingDays,
          cashDiscountPercent: band.cashDiscountPercent,
          installmentDiscountPercent: band.installmentDiscountPercent,
          cashStrategyDiscountPercent: Math.min(Number(dto.cobcomDiscountPercent ?? 0), Number(band.cashDiscountPercent)),
          installmentStrategyDiscountPercent: Math.min(Number(dto.cobcomDiscountPercent ?? 0), Number(band.installmentDiscountPercent)),
        })) },
      },
    });
    return wallet;
  }

  async list(
    query: ListWalletsQueryDto,
    accountId: string,
    userScopes?: string[],
  ): Promise<PaginatedResponse<Wallet>> {
    const { page, limit, search, creditorId } = query;
    const cacheKey = this.getListCacheKey(accountId, query, userScopes);
    const cached = await this.getCachedList(cacheKey);
    if (cached) return cached;
    const skip = (page - 1) * limit;

    const where: any = {
      accountId,
      deletedAt: null,
    };

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    if (creditorId) {
      where.creditorId = creditorId;
    }

    // VIEWER scope filtering: only wallets in user's scopes
    if (userScopes) {
      where.id = { in: userScopes };
    }

    const [data, total] = await Promise.all([
      this.prisma.wallet.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          creditor: { select: { id: true, name: true } },
          _count: {
            select: {
              contracts: { where: { deletedAt: null } },
            },
          },
        },
      }),
      this.prisma.wallet.count({ where }),
    ]);

    const result = {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    await this.cacheList(cacheKey, result);
    return result;
  }

  private getListCacheKey(
    accountId: string,
    query: ListWalletsQueryDto,
    userScopes?: string[],
  ): string {
    const scope = userScopes ? [...userScopes].sort() : null;
    return `wallets:list:${JSON.stringify({ accountId, query, scope })}`;
  }

  private async getCachedList(cacheKey: string): Promise<PaginatedResponse<Wallet> | null> {
    try {
      const cached = await this.redis.get(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  }

  private async cacheList(cacheKey: string, value: PaginatedResponse<Wallet>): Promise<void> {
    try {
      await this.redis.set(cacheKey, JSON.stringify(value), 'EX', WalletsService.LIST_CACHE_TTL_SECONDS);
    } catch {
      // O banco continua como fonte de verdade quando o Redis estiver indisponível.
    }
  }

  async findById(
    id: string,
    accountId: string,
    userScopes?: string[],
  ): Promise<Wallet & { summary: WalletSummary }> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id, accountId, deletedAt: null },
      include: {
        discountBands: { orderBy: { minAgingDays: 'asc' } },
        creditor: {
          select: {
            id: true,
            name: true,
            commissionPercent: true,
            discountBands: { orderBy: { minAgingDays: 'asc' } },
          },
        },
      },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    if (userScopes && !userScopes.includes(wallet.id)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const summary = await this.getWalletSummary(wallet.id);

    return { ...wallet, summary };
  }

  async update(
    id: string,
    dto: UpdateWalletDto,
    accountId: string,
  ): Promise<Wallet> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id, accountId, deletedAt: null },
      include: { creditor: { include: { discountBands: { orderBy: { minAgingDays: 'asc' } } } } },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.cobcomDiscountPercent !== undefined) data.cobcomDiscountPercent = dto.cobcomDiscountPercent;
    if (dto.offerFirstInstallmentDays !== undefined) data.offerFirstInstallmentDays = dto.offerFirstInstallmentDays;
    if (dto.offerMinInstallmentValue !== undefined) data.offerMinInstallmentValue = dto.offerMinInstallmentValue;
    if (dto.offerMaxInstallments !== undefined) data.offerMaxInstallments = dto.offerMaxInstallments;

    if (dto.discountBands !== undefined) {
      this.validateWalletStrategyBands(dto.discountBands, wallet.creditor.discountBands);
      data.discountBands = {
        deleteMany: {},
        create: dto.discountBands.map((band) => {
          const ceiling = wallet.creditor.discountBands.find((creditorBand) =>
            creditorBand.minAgingDays === band.minAgingDays
            && creditorBand.maxAgingDays === (band.maxAgingDays ?? null),
          )!;
          return {
            minAgingDays: band.minAgingDays,
            maxAgingDays: band.maxAgingDays ?? null,
            // Keep the creditor ceiling as an auditable reference. The live
            // ceiling is still read from CreditorDiscountBand when pricing.
            cashDiscountPercent: ceiling.cashDiscountPercent,
            installmentDiscountPercent: ceiling.installmentDiscountPercent,
            cashStrategyDiscountPercent: band.cashDiscountPercent,
            installmentStrategyDiscountPercent: band.installmentDiscountPercent,
          };
        }),
      };
    }

    const updated = await this.prisma.wallet.update({
      where: { id },
      data,
    });
    return updated;
  }

  /** Reapplies this wallet's commercial rules to every unpaid active contract. */
  async recalculateOffers(id: string, accountId: string) {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id, accountId, deletedAt: null },
      include: { creditor: { select: { commissionPercent: true } } },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');

    // Set-based update: the former implementation fetched every contract and
    // created one UPDATE per row in one giant transaction. On large portfolios
    // that held connections for minutes and made the screen appear frozen.
    // One set-based query keeps recalculation safe for large portfolios. The
    // configured wallet discount is an operational strategy; creditor bands
    // are the commercial ceiling and can never be exceeded.
    const updated = await this.prisma.$executeRaw(Prisma.sql`
      WITH calculated AS (
        SELECT
          contract.id,
          COALESCE(
            (
              SELECT CASE WHEN ${wallet.offerMaxInstallments} > 1
                THEN band."installmentDiscountPercent"
                ELSE band."cashDiscountPercent" END
              FROM "CreditorDiscountBand" band
              WHERE band."creditorId" = ${wallet.creditorId}
                AND band."minAgingDays" <= contract."agingDays"
                AND (band."maxAgingDays" IS NULL OR band."maxAgingDays" >= contract."agingDays")
              ORDER BY band."minAgingDays" DESC
              LIMIT 1
            ),
            ${wallet.cobcomDiscountPercent}
          ) AS maximum_discount,
          COALESCE(
            (
              SELECT CASE WHEN ${wallet.offerMaxInstallments} > 1
                THEN band."installmentStrategyDiscountPercent"
                ELSE band."cashStrategyDiscountPercent" END
              FROM "WalletDiscountBand" band
              WHERE band."walletId" = ${wallet.id}
                AND band."minAgingDays" <= contract."agingDays"
                AND (band."maxAgingDays" IS NULL OR band."maxAgingDays" >= contract."agingDays")
              ORDER BY band."minAgingDays" DESC
              LIMIT 1
            ),
            ${wallet.cobcomDiscountPercent}
          ) AS strategy_discount,
          ${wallet.creditor.commissionPercent} AS commission_percent
        FROM "Contract" contract
        WHERE contract."walletId" = ${id}
          AND contract."deletedAt" IS NULL
          AND contract."status" = 'ACTIVE'
          AND contract."paymentStatus" <> 'PAID'
      ), priced AS (
        SELECT id,
          maximum_discount,
          LEAST(strategy_discount, maximum_discount) AS offer_discount,
          commission_percent
        FROM calculated
      )
      UPDATE "Contract" contract
      SET
        "offerDiscountPercent" = priced.offer_discount,
        "maximumDiscountPercent" = priced.maximum_discount,
        "offerValue" = ROUND(contract."updatedValue" * (1 - priced.offer_discount / 100), 2),
        "repasseValue" = ROUND(contract."updatedValue" * (1 - priced.maximum_discount / 100), 2),
        "commissionPercent" = priced.commission_percent,
        "commissionValue" = ROUND(
          ROUND(contract."updatedValue" * (1 - priced.maximum_discount / 100), 2)
          * priced.commission_percent / 100,
          2
        ),
        "offerFirstInstallmentDays" = ${wallet.offerFirstInstallmentDays},
        "offerMaxInstallments" = LEAST(
          ${wallet.offerMaxInstallments},
          GREATEST(1, FLOOR(
            ROUND(contract."updatedValue" * (1 - priced.offer_discount / 100), 2)
            / ${wallet.offerMinInstallmentValue}
          )::integer)
        )
      FROM priced
      WHERE contract.id = priced.id
    `);

    return { recalculatedCount: updated };
  }

  /** Refreshes persisted aging and offer snapshots during the weekly job. */
  async refreshAgingAndOffers(): Promise<{ agingUpdatedCount: number; walletsProcessed: number }> {
    const agingUpdatedCount = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "Contract"
      SET "agingDays" = GREATEST(
        0,
        ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date - ("occurrenceDate" AT TIME ZONE 'America/Sao_Paulo')::date)
      )
      WHERE "deletedAt" IS NULL
    `);

    const wallets = await this.prisma.wallet.findMany({
      where: { deletedAt: null },
      select: { id: true, accountId: true },
    });
    for (const wallet of wallets) {
      await this.recalculateOffers(wallet.id, wallet.accountId);
    }

    return { agingUpdatedCount, walletsProcessed: wallets.length };
  }

  async softDelete(id: string, accountId: string): Promise<void> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id, accountId, deletedAt: null },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    const contractCount = await this.prisma.contract.count({
      where: {
        walletId: wallet.id,
        deletedAt: null,
      },
    });

    if (contractCount > 0) {
      throw new ConflictException(
        'Wallet has contracts. They must be moved or deleted before removing the wallet.',
      );
    }

    await this.prisma.wallet.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private validateWalletStrategyBands(
    bands: Array<{ minAgingDays: number; maxAgingDays?: number | null; cashDiscountPercent: number; installmentDiscountPercent: number }>,
    creditorBands: Array<{ minAgingDays: number; maxAgingDays: number | null; cashDiscountPercent: Prisma.Decimal; installmentDiscountPercent: Prisma.Decimal }>,
  ) {
    const ordered = [...bands].sort((a, b) => a.minAgingDays - b.minAgingDays);
    for (let index = 0; index < ordered.length; index += 1) {
      const band = ordered[index]!;
      const max = band.maxAgingDays ?? null;
      if (max !== null && max < band.minAgingDays) {
        throw new ConflictException('Faixa da carteira possui fim menor que o início.');
      }
      const previous = ordered[index - 1];
      if (previous && (previous.maxAgingDays === undefined || previous.maxAgingDays === null || previous.maxAgingDays >= band.minAgingDays)) {
        throw new ConflictException('Faixas de desconto da carteira não podem se sobrepor.');
      }
      const creditorBand = creditorBands.find((item) => item.minAgingDays === band.minAgingDays && item.maxAgingDays === max);
      if (!creditorBand) {
        throw new ConflictException('Cada faixa da carteira deve corresponder a uma faixa vigente do credor.');
      }
      if (
        band.cashDiscountPercent > Number(creditorBand.cashDiscountPercent)
        || band.installmentDiscountPercent > Number(creditorBand.installmentDiscountPercent)
      ) {
        throw new ConflictException('O desconto da carteira não pode ultrapassar o limite comercial do credor.');
      }
    }
  }

  async getWalletSummary(walletId: string): Promise<WalletSummary> {
    const [statusTotals, overall] = await Promise.all([
      this.prisma.$queryRaw<Array<{ status: string; count: bigint; amount: Prisma.Decimal }>>(Prisma.sql`
        SELECT "paymentStatus" AS status,
               COUNT(*)::bigint AS count,
               COALESCE(SUM("updatedValue"), 0) AS amount
        FROM "Contract"
        WHERE "walletId" = ${walletId} AND "deletedAt" IS NULL
        GROUP BY "paymentStatus"
      `),
      this.prisma.$queryRaw<Array<{
        totalContracts: bigint;
        totalValue: Prisma.Decimal;
        serasaCount: bigint;
        serasaValue: Prisma.Decimal;
        recoveredValue: Prisma.Decimal;
        repasseForecastValue: Prisma.Decimal;
        repasseRealizedValue: Prisma.Decimal;
        commissionForecastValue: Prisma.Decimal;
        commissionRealizedValue: Prisma.Decimal;
        discountsConcededValue: Prisma.Decimal;
        eligibleValue: Prisma.Decimal;
      }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS "totalContracts",
               COALESCE(SUM("updatedValue"), 0) AS "totalValue",
               COUNT(*) FILTER (WHERE "serasaStatus" IN ('SENT', 'REGISTERED', 'UPDATED', 'REMOVING'))::bigint AS "serasaCount",
               COALESCE(SUM("updatedValue") FILTER (WHERE "serasaStatus" IN ('SENT', 'REGISTERED', 'UPDATED', 'REMOVING')), 0) AS "serasaValue",
               COALESCE(SUM(
                 CASE
                   WHEN "totalPaidAmount" > 0 THEN "totalPaidAmount"
                   WHEN "paymentStatus" = 'PAID' THEN COALESCE("agreedPaymentAmount", "offerValue", "updatedValue")
                   ELSE 0
                 END
               ), 0) AS "recoveredValue",
               COALESCE(SUM(COALESCE("repasseValue", "updatedValue")) FILTER (
                 WHERE "status" = 'ACTIVE' AND "paymentStatus" <> 'PAID'
               ), 0) AS "repasseForecastValue",
               COALESCE(SUM(COALESCE("repasseValue", "updatedValue")) FILTER (
                 WHERE "paymentStatus" = 'PAID'
               ), 0) AS "repasseRealizedValue",
               COALESCE(SUM(COALESCE("commissionValue", 0)) FILTER (
                 WHERE "status" = 'ACTIVE' AND "paymentStatus" <> 'PAID'
               ), 0) AS "commissionForecastValue",
               COALESCE(SUM(COALESCE("commissionValue", 0)) FILTER (
                 WHERE "paymentStatus" = 'PAID'
               ), 0) AS "commissionRealizedValue",
               COALESCE(SUM(GREATEST("updatedValue" - COALESCE("offerValue", "updatedValue"), 0)), 0) AS "discountsConcededValue",
               COALESCE(SUM("updatedValue") FILTER (WHERE "status" = 'ACTIVE'), 0) AS "eligibleValue"
        FROM "Contract"
        WHERE "walletId" = ${walletId} AND "deletedAt" IS NULL
      `),
    ]);

    const contractsByPaymentStatus: Record<string, number> = {};
    const paymentStatusTotals: Record<string, { count: number; amount: number }> = {};
    for (const group of statusTotals) {
      const count = Number(group.count);
      contractsByPaymentStatus[group.status] = count;
      paymentStatusTotals[group.status] = { count, amount: Number(group.amount) };
    }

    const result = overall[0] ?? {
      totalContracts: BigInt(0), totalValue: new Prisma.Decimal(0), serasaCount: BigInt(0), serasaValue: new Prisma.Decimal(0),
      recoveredValue: new Prisma.Decimal(0), repasseForecastValue: new Prisma.Decimal(0), repasseRealizedValue: new Prisma.Decimal(0),
      commissionForecastValue: new Prisma.Decimal(0), commissionRealizedValue: new Prisma.Decimal(0), discountsConcededValue: new Prisma.Decimal(0), eligibleValue: new Prisma.Decimal(0),
    };
    const totalContracts = Number(result.totalContracts);
    const totalValue = Number(result.totalValue);
    const recoveredValue = Number(result.recoveredValue);
    const eligibleValue = Number(result.eligibleValue);

    return {
      totalContracts,
      contractsByPaymentStatus,
      paymentStatusTotals,
      serasaTotal: { count: Number(result.serasaCount), amount: Number(result.serasaValue) },
      totalValue,
      recoveredValue,
      repasseForecastValue: Number(result.repasseForecastValue),
      repasseRealizedValue: Number(result.repasseRealizedValue),
      commissionForecastValue: Number(result.commissionForecastValue),
      commissionRealizedValue: Number(result.commissionRealizedValue),
      discountsConcededValue: Number(result.discountsConcededValue),
      efficiencyRate: eligibleValue > 0 ? Math.round((recoveredValue / eligibleValue) * 10_000) / 100 : 0,
    };
  }
}

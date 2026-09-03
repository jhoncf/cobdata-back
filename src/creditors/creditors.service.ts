import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCreditorDto } from './dto/create-creditor.dto';
import { UpdateCreditorDto } from './dto/update-creditor.dto';
import { ListCreditorsQueryDto } from './dto/list-creditors-query.dto';
import { PaginatedResponse } from '../common/dto';
import { Creditor } from '@prisma/client';
import { CreditorWebhookService } from './creditor-webhook.service';
import { UpsertCommercialRulesDto } from './dto/upsert-commercial-rules.dto';

@Injectable()
export class CreditorsService {
  constructor(private readonly prisma: PrismaService, private readonly webhook: CreditorWebhookService) {}

  async create(
    dto: CreateCreditorDto,
    accountId: string,
  ): Promise<any> {
    if (dto.cnpj) {
      await this.checkCnpjUniqueness(dto.cnpj);
    }

    const creditor = await this.prisma.$transaction(async (tx) => {
      const creditor = await tx.creditor.create({ data: {
        accountId,
        name: dto.name,
        cnpj: dto.cnpj ?? null,
        contacts: dto.contacts ? (dto.contacts as any) : null,
        address: dto.address ? (dto.address as any) : null,
        webhookUrl: dto.webhookUrl ?? null,
        webhookAuthKeyEncrypted: dto.webhookAuthKey ? this.webhook.encrypt(dto.webhookAuthKey) : null,
      } });
      await tx.wallet.create({ data: { accountId, creditorId: creditor.id, name: 'Entrada via API', isApiDefault: true } });
      return creditor;
    });
    return this.toResponse(creditor);
  }

  async list(
    query: ListCreditorsQueryDto,
    accountId: string,
    userScopes?: string[],
  ): Promise<PaginatedResponse<any>> {
    const { page, limit, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      accountId,
      deletedAt: null,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { cnpj: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Task 6.4: VIEWER scope filtering — only show creditors with wallets in user's scopes
    if (userScopes) {
      where.id = {
        in: await this.getCreditorIdsInScopes(userScopes),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.creditor.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.creditor.count({ where }),
    ]);

    return {
      data: data.map((creditor) => this.toResponse(creditor)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string, accountId: string): Promise<any> {
    const creditor = await this.prisma.creditor.findFirst({
      where: { id, accountId, deletedAt: null },
    });

    if (!creditor) {
      throw new NotFoundException('Creditor not found');
    }

    return this.toResponse(creditor);
  }

  async update(
    id: string,
    dto: UpdateCreditorDto,
    accountId: string,
  ): Promise<any> {
    const creditor = await this.findById(id, accountId);

    if (dto.cnpj && dto.cnpj !== creditor.cnpj) {
      await this.checkCnpjUniqueness(dto.cnpj, id);
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.cnpj !== undefined) data.cnpj = dto.cnpj;
    if (dto.contacts !== undefined) data.contacts = dto.contacts as any;
    if (dto.address !== undefined) data.address = dto.address as any;
    if (dto.webhookUrl !== undefined) data.webhookUrl = dto.webhookUrl || null;
    if (dto.webhookAuthKey !== undefined) data.webhookAuthKeyEncrypted = dto.webhookAuthKey ? this.webhook.encrypt(dto.webhookAuthKey) : null;

    const updated = await this.prisma.creditor.update({
      where: { id },
      data,
    });
    return this.toResponse(updated);
  }

  async softDelete(id: string, accountId: string): Promise<void> {
    const creditor = await this.findById(id, accountId);

    // Check if any wallets of this creditor have non-soft-deleted contracts
    const walletsWithContracts = await this.prisma.contract.count({
      where: {
        wallet: {
          creditorId: creditor.id,
          deletedAt: null,
        },
        deletedAt: null,
      },
    });

    if (walletsWithContracts > 0) {
      throw new ConflictException(
        'Creditor has wallets with contracts',
      );
    }

    const now = new Date();

    // Soft-delete creditor and cascade to wallets in a transaction
    await this.prisma.$transaction([
      this.prisma.creditor.update({
        where: { id: creditor.id },
        data: { deletedAt: now },
      }),
      this.prisma.wallet.updateMany({
        where: { creditorId: creditor.id, deletedAt: null },
        data: { deletedAt: now },
      }),
    ]);
  }

  async getCommercialRules(id: string, accountId: string) {
    await this.findById(id, accountId);
    return this.prisma.creditor.findUniqueOrThrow({
      where: { id },
      select: {
        discountBands: { orderBy: { minAgingDays: 'asc' } },
        commissionPercent: true,
      },
    });
  }

  async upsertCommercialRules(id: string, dto: UpsertCommercialRulesDto, accountId: string) {
    await this.findById(id, accountId);
    this.validateBands(dto.discountBands, 'desconto');

    await this.prisma.$transaction(async (tx) => {
      const wallets = await tx.wallet.findMany({
        where: { creditorId: id, deletedAt: null },
        include: { discountBands: true },
      });
      await tx.creditorDiscountBand.deleteMany({ where: { creditorId: id } });
      await tx.creditor.update({ where: { id }, data: { commissionPercent: dto.commissionPercent } });
      if (dto.discountBands.length) {
        await tx.creditorDiscountBand.createMany({ data: dto.discountBands.map((band) => ({
          creditorId: id,
          minAgingDays: band.minAgingDays,
          maxAgingDays: band.maxAgingDays ?? null,
          cashDiscountPercent: band.cashDiscountPercent,
          installmentDiscountPercent: band.installmentDiscountPercent,
        })) });
      }
      // A carteira conserva sua estratégia quando a mesma faixa continuar
      // existindo. Se o credor mudar a faixa, ela nasce com o desconto global
      // da carteira, sempre limitado pelo novo teto comercial.
      for (const wallet of wallets) {
        await tx.walletDiscountBand.deleteMany({ where: { walletId: wallet.id } });
        if (dto.discountBands.length) {
          await tx.walletDiscountBand.createMany({ data: dto.discountBands.map((band) => {
            const previous = wallet.discountBands.find((item) => item.minAgingDays === band.minAgingDays && item.maxAgingDays === (band.maxAgingDays ?? null));
            const cashStrategy = Math.min(Number(previous?.cashStrategyDiscountPercent ?? wallet.cobcomDiscountPercent), band.cashDiscountPercent);
            const installmentStrategy = Math.min(Number(previous?.installmentStrategyDiscountPercent ?? wallet.cobcomDiscountPercent), band.installmentDiscountPercent);
            return {
              walletId: wallet.id,
              minAgingDays: band.minAgingDays,
              maxAgingDays: band.maxAgingDays ?? null,
              cashDiscountPercent: band.cashDiscountPercent,
              installmentDiscountPercent: band.installmentDiscountPercent,
              cashStrategyDiscountPercent: cashStrategy,
              installmentStrategyDiscountPercent: installmentStrategy,
            };
          }) });
        }
      }
    });
    return this.getCommercialRules(id, accountId);
  }

  private validateBands(bands: Array<{ minAgingDays: number; maxAgingDays?: number | null }>, label: string) {
    const ordered = [...bands].sort((a, b) => a.minAgingDays - b.minAgingDays);
    for (let index = 0; index < ordered.length; index++) {
      const band = ordered[index]!;
      if (band.maxAgingDays !== undefined && band.maxAgingDays !== null && band.maxAgingDays < band.minAgingDays) {
        throw new ConflictException(`Faixa de ${label} possui fim menor que o início.`);
      }
      const previous = ordered[index - 1];
      if (previous && (previous.maxAgingDays === undefined || previous.maxAgingDays === null || previous.maxAgingDays >= band.minAgingDays)) {
        throw new ConflictException(`Faixas de ${label} não podem se sobrepor.`);
      }
    }
  }

  private async getCreditorIdsInScopes(walletIds: string[]): Promise<string[]> {
    if (walletIds.length === 0) return [];

    const wallets = await this.prisma.wallet.findMany({
      where: {
        id: { in: walletIds },
        deletedAt: null,
      },
      select: { creditorId: true },
      distinct: ['creditorId'],
    });

    return wallets.map((w) => w.creditorId);
  }

  private async checkCnpjUniqueness(
    cnpj: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.creditor.findFirst({
      where: {
        cnpj,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (existing) {
      throw new ConflictException('CNPJ already in use by another creditor');
    }
  }

  private toResponse(creditor: Creditor) {
    const { webhookAuthKeyEncrypted, ...safe } = creditor as Creditor & { webhookAuthKeyEncrypted?: string | null };
    return { ...safe, hasWebhookAuthKey: !!webhookAuthKeyEncrypted };
  }
}

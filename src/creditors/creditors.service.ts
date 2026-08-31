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

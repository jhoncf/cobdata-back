import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { ListWalletsQueryDto } from './dto/list-wallets-query.dto';
import { PaginatedResponse } from '../common/dto';
import { Wallet } from '@prisma/client';
import { SerasaWalletsService } from '../providers/serasa-wallets.service';

export interface WalletSummary {
  totalContracts: number;
  contractsByPaymentStatus: Record<string, number>;
  totalValue: number;
}

@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serasaWallets: SerasaWalletsService,
  ) {}

  async create(
    creditorId: string,
    dto: CreateWalletDto,
    accountId: string,
  ): Promise<Wallet> {
    const creditor = await this.prisma.creditor.findFirst({
      where: { id: creditorId, accountId, deletedAt: null },
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
      },
    });
    if (dto.serasaWalletId) {
      await this.serasaWallets.linkCrmWallet(wallet.id, dto.serasaWalletId, accountId);
    }
    return wallet;
  }

  async list(
    query: ListWalletsQueryDto,
    accountId: string,
    userScopes?: string[],
  ): Promise<PaginatedResponse<Wallet>> {
    const { page, limit, search, creditorId } = query;
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

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(
    id: string,
    accountId: string,
    userScopes?: string[],
  ): Promise<Wallet & { summary: WalletSummary }> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id, accountId, deletedAt: null },
      include: { creditor: { select: { id: true, name: true } } },
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
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.status !== undefined) data.status = dto.status;

    const updated = await this.prisma.wallet.update({
      where: { id },
      data,
    });
    if (dto.serasaWalletId !== undefined) {
      await this.serasaWallets.linkCrmWallet(id, dto.serasaWalletId, accountId);
    }
    return updated;
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

  async getWalletSummary(walletId: string): Promise<WalletSummary> {
    const [statusCounts, valueAgg] = await Promise.all([
      this.prisma.contract.groupBy({
        by: ['paymentStatus'],
        where: { walletId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.contract.aggregate({
        where: { walletId, deletedAt: null },
        _count: { _all: true },
        _sum: { originalValue: true },
      }),
    ]);

    const contractsByPaymentStatus: Record<string, number> = {};
    for (const group of statusCounts) {
      contractsByPaymentStatus[group.paymentStatus] = group._count._all;
    }

    const totalContracts = valueAgg._count._all;
    const totalValue = Number(valueAgg._sum.originalValue || 0);

    return { totalContracts, contractsByPaymentStatus, totalValue };
  }
}

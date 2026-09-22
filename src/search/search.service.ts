import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  SearchResultDto,
  CreditorSearchItem,
  WalletSearchItem,
  ContractSearchItem,
} from './dto/search-result.dto';

const MAX_RESULTS_PER_CATEGORY = 5;

export interface SearchUser {
  accountId: string;
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    term: string,
    user: SearchUser,
    userScopes?: string[],
  ): Promise<SearchResultDto> {
    const activeScopes = userScopes?.length ? userScopes : undefined;

    const [creditors, wallets, contracts] = await Promise.all([
      this.searchCreditors(term, user.accountId, activeScopes),
      this.searchWallets(term, user.accountId, activeScopes),
      this.searchContracts(term, user.accountId, activeScopes),
    ]);

    return { creditors, wallets, contracts };
  }

  private async searchCreditors(
    term: string,
    accountId: string,
    scopes?: string[],
  ): Promise<CreditorSearchItem[]> {
    const digitsOnly = term.replace(/\D/g, '');

    const orConditions: any[] = [
      { name: { contains: term, mode: 'insensitive' } },
    ];

    if (digitsOnly.length > 0) {
      orConditions.push({ cnpj: { contains: digitsOnly } });
    }

    const whereClause: any = {
      accountId,
      deletedAt: null,
      OR: orConditions,
    };

    // Scope filtering: only return creditors that own at least one wallet in scope
    if (scopes) {
      whereClause.wallets = { some: { id: { in: scopes } } };
    }

    const creditors = await this.prisma.creditor.findMany({
      where: whereClause,
      take: MAX_RESULTS_PER_CATEGORY,
      orderBy: { name: 'asc' },
    });

    return creditors.map((c) => ({
      id: c.id,
      name: c.name,
      cnpj: c.cnpj ?? '',
    }));
  }

  private async searchWallets(
    term: string,
    accountId: string,
    scopes?: string[],
  ): Promise<WalletSearchItem[]> {
    const whereClause: any = {
      accountId,
      deletedAt: null,
      name: { contains: term, mode: 'insensitive' },
    };

    // Scope filtering: only return wallets whose ID is in scope
    if (scopes) {
      whereClause.id = { in: scopes };
    }

    const wallets = await this.prisma.wallet.findMany({
      where: whereClause,
      include: {
        creditor: { select: { name: true } },
      },
      take: MAX_RESULTS_PER_CATEGORY,
      orderBy: { name: 'asc' },
    });

    return wallets.map((w) => ({
      id: w.id,
      name: w.name,
      creditorName: w.creditor.name,
    }));
  }

  private async searchContracts(
    term: string,
    accountId: string,
    scopes?: string[],
  ): Promise<ContractSearchItem[]> {
    const digitsOnly = term.replace(/\D/g, '');

    const contractConditions: any[] = [
      { contractNumber: { contains: term, mode: 'insensitive' } },
    ];

    // CPF and CNPJ lookups remain exact (and use the hash when available),
    // while a contract number supports the normal partial search used by the
    // header. Both document types are stored in debtorDocument.
    if (digitsOnly.length === 11 || digitsOnly.length === 14) {
      const hash = createHash('sha256').update(digitsOnly).digest('hex');
      contractConditions.push(
        { debtorDocumentHash: hash },
        { debtorDocument: digitsOnly },
      );
    }

    const whereClause: any = {
      accountId,
      deletedAt: null,
      OR: contractConditions,
    };

    // Scope filtering: only return contracts from wallets in scope
    if (scopes) {
      whereClause.walletId = { in: scopes };
    }

    const contracts = await this.prisma.contract.findMany({
      where: whereClause,
      include: {
        wallet: {
          include: {
            creditor: { select: { name: true } },
          },
        },
      },
      take: MAX_RESULTS_PER_CATEGORY,
      orderBy: { createdAt: 'desc' },
    });

    return contracts.map((c) => ({
      id: c.id,
      contractNumber: c.contractNumber,
      debtorName: c.debtorName,
      originalValue: Number(c.originalValue),
      updatedValue: Number(c.updatedValue),
      creditorName: c.wallet.creditor.name,
    }));
  }
}

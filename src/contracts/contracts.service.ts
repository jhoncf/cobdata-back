import {
  Injectable,
  UnprocessableEntityException,
  ConflictException,
  NotFoundException,
  BadGatewayException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DeduplicationService } from './deduplication.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { ListContractsQueryDto } from './dto/list-contracts-query.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { BulkTransferContractsDto } from './dto/bulk-transfer-contracts.dto';
import { Contract, ContractStatus, Prisma } from '@prisma/client';
import { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { calculateOffer } from './offer-calculator';

/**
 * Allowed serasaStatus values that permit editing/deleting a contract.
 */
const EDITABLE_PROVIDER_STATUSES = ['NOT_ENABLED', 'PENDING', 'FAILED', 'REMOVED'];

/**
 * Allowed internal status transitions.
 * Map of: currentStatus -> set of valid target statuses.
 */
const ALLOWED_STATUS_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  ACTIVE: ['SUSPENDED', 'CANCELLED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED'],
  CANCELLED: [],
};

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deduplicationService: DeduplicationService,
  ) {}

  private calculateAgingDays(occurrenceDate: Date): number {
    const dateParts = (date: Date) => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(date);
      const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
      return Date.UTC(part('year'), part('month') - 1, part('day'));
    };
    return Math.max(0, Math.floor((dateParts(new Date()) - dateParts(occurrenceDate)) / 86_400_000));
  }

  private applyNumericComparison(
    where: Prisma.ContractWhereInput,
    field: 'updatedValue' | 'offerValue',
    operator?: 'gt' | 'lt' | 'eq',
    value?: number,
  ): void {
    if (!operator || value === undefined) return;
    (where as any)[field] = {
      [operator === 'eq' ? 'equals' : operator]: value,
    };
  }

  /** Applies the persisted weekly aging snapshot. */
  private applyAgingComparison(
    where: Prisma.ContractWhereInput,
    operator?: 'gt' | 'lt' | 'eq',
    aging?: number,
  ): void {
    if (!operator || aging === undefined) return;

    (where as any).agingDays = {
      [operator === 'eq' ? 'equals' : operator]: aging,
    };
  }

  async createOrUpdate(
    dto: CreateContractDto,
    accountId: string,
  ): Promise<Contract> {
    // 1. Validate wallet exists, is ACTIVE, not deleted
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: dto.walletId, accountId, deletedAt: null },
      include: {
        discountBands: { orderBy: { minAgingDays: 'asc' } },
        creditor: { include: { discountBands: { orderBy: { minAgingDays: 'asc' } } } },
      },
    });

    if (!wallet) {
      throw new UnprocessableEntityException('Wallet not found or not accessible');
    }

    if (wallet.status === 'INACTIVE') {
      throw new UnprocessableEntityException(
        'Wallet is INACTIVE. Cannot create contracts in an inactive wallet.',
      );
    }

    // 2. Validate occurrenceDate is not future
    const occurrenceDate = new Date(dto.occurrenceDate);
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    if (occurrenceDate > todayEnd) {
      throw new UnprocessableEntityException(
        'occurrenceDate must not be a future date',
      );
    }

    // 3. Resolve creditorId from wallet
    const creditorId = wallet.creditorId;

    // 5. Compute deduplication key
    const deduplicationKey = this.deduplicationService.computeDeduplicationKey({
      creditorId,
      debtorDocument: dto.debtorDocument,
      contractNumber: dto.contractNumber,
      debtOriginDocument: dto.debtOrigin,
    });

    // 6. Check for existing contract with same dedup key
    const existingContract = await this.prisma.contract.findUnique({
      where: { deduplicationKey },
    });

    // 7. Compute document hash for search
    const debtorDocumentHash = this.deduplicationService.sha256(dto.debtorDocument);
    const debtOriginDocHash = dto.debtOrigin
      ? this.deduplicationService.sha256(dto.debtOrigin)
      : null;

    // Parse dueDate
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    const cancelledAt = dto.cancelledAt ? new Date(dto.cancelledAt) : null;
    const agingDays = this.calculateAgingDays(occurrenceDate);
    const ceilingBand = wallet.creditor.discountBands.find((band) =>
      band.minAgingDays <= agingDays && (band.maxAgingDays === null || band.maxAgingDays >= agingDays),
    );
    const strategyBand = wallet.discountBands.find((band) =>
      band.minAgingDays <= agingDays && (band.maxAgingDays === null || band.maxAgingDays >= agingDays),
    );
    const maximumDiscountPercent = Number(ceilingBand
      ? (wallet.offerMaxInstallments > 1 ? ceilingBand.installmentDiscountPercent : ceilingBand.cashDiscountPercent)
      : wallet.cobcomDiscountPercent);
    const strategyDiscountPercent = Number(strategyBand
      ? (wallet.offerMaxInstallments > 1 ? strategyBand.installmentStrategyDiscountPercent : strategyBand.cashStrategyDiscountPercent)
      : wallet.cobcomDiscountPercent);
    const offerDiscountPercent = Math.min(strategyDiscountPercent, maximumDiscountPercent);
    const calculatedOffer = {
      ...calculateOffer(dto.updatedValue, wallet),
      offerDiscountPercent,
      offerValue: Math.round(dto.updatedValue * (1 - offerDiscountPercent / 100) * 100) / 100,
      maximumDiscountPercent,
      repasseValue: Math.round(dto.updatedValue * (1 - maximumDiscountPercent / 100) * 100) / 100,
      commissionPercent: wallet.creditor.commissionPercent,
      commissionValue: Math.round(
        (dto.updatedValue * (1 - maximumDiscountPercent / 100))
        * Number(wallet.creditor.commissionPercent),
      ) / 100,
    };

    if (existingContract) {
      // 6a. If exists in SAME wallet → UPDATE (preserve unset fields)
      if (existingContract.walletId === dto.walletId) {
        const updateData: any = {
          debtorDocument: dto.debtorDocument,
          ...(dto.debtorName !== undefined ? { debtorName: dto.debtorName } : {}),
          debtorDocumentHash,
          contractNumber: dto.contractNumber,
          debtType: dto.debtType,
          occurrenceDate,
          agingDays,
          originalValue: dto.originalValue,
          dueDate,
        };

        updateData.updatedValue = dto.updatedValue;
        // A settled contract is a financial record. Its offer snapshot must
        // never be replaced by a later import/upsert.
        if (existingContract.paymentStatus !== 'PAID') {
          Object.assign(updateData, calculatedOffer);
        }
        if (dto.debtOrigin !== undefined) {
          updateData.debtOrigin = dto.debtOrigin;
          updateData.debtOriginDocHash = debtOriginDocHash;
        }
        if (dto.offer !== undefined) {
          updateData.offer = dto.offer;
        }
        if (dto.productName !== undefined) {
          updateData.productName = dto.productName;
        }
        if (dto.debtorStreet !== undefined) {
          updateData.debtorStreet = dto.debtorStreet;
        }
        if (dto.debtorCity !== undefined) {
          updateData.debtorCity = dto.debtorCity;
        }
        if (dto.debtorPhone !== undefined) {
          updateData.debtorPhone = dto.debtorPhone;
        }
        if (dto.debtorEmail !== undefined) {
          updateData.debtorEmail = dto.debtorEmail;
        }
        if (dto.isNegativated !== undefined) {
          updateData.isNegativated = dto.isNegativated;
        }
        if (cancelledAt !== null) {
          updateData.cancelledAt = cancelledAt;
        }

        return this.prisma.contract.update({
          where: { id: existingContract.id },
          data: updateData,
        });
      }

      // 6b. If exists in DIFFERENT wallet → 409 Conflict
      throw new ConflictException(
        'Contract with same deduplication key already exists in another wallet. Use PATCH to move it explicitly.',
      );
    }

    // 6c. If not exists → CREATE outside Serasa by default, status=ACTIVE
    return this.prisma.contract.create({
      data: {
        accountId,
        walletId: dto.walletId,
        debtorDocument: dto.debtorDocument,
        debtorName: dto.debtorName ?? '',
        debtorDocumentHash,
        contractNumber: dto.contractNumber,
        debtType: dto.debtType,
        occurrenceDate,
        agingDays,
        dueDate,
        originalValue: dto.originalValue,
        updatedValue: dto.updatedValue,
        ...calculatedOffer,
        debtOrigin: dto.debtOrigin ?? null,
        debtOriginDocHash,
        productName: dto.productName ?? null,
        debtorStreet: dto.debtorStreet ?? null,
        debtorCity: dto.debtorCity ?? null,
        debtorPhone: dto.debtorPhone ?? null,
        debtorEmail: dto.debtorEmail ?? null,
        isNegativated: dto.isNegativated ?? false,
        cancelledAt,
        offer: dto.offer
          ? (dto.offer as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        deduplicationKey,
        serasaStatus: 'NOT_ENABLED',
        paymentStatus: 'OPEN',
        status: 'ACTIVE',
      },
    });
  }

  /** Transfer every contract matched by the filters from one wallet to another. */
  async bulkTransfer(dto: BulkTransferContractsDto, accountId: string) {
    if (dto.sourceWalletId === dto.destinationWalletId) {
      throw new UnprocessableEntityException('A carteira de destino deve ser diferente da carteira de origem.');
    }

    const [sourceWallet, destinationWallet] = await Promise.all([
      this.prisma.wallet.findFirst({ where: { id: dto.sourceWalletId, accountId, deletedAt: null } }),
      this.prisma.wallet.findFirst({ where: { id: dto.destinationWalletId, accountId, deletedAt: null } }),
    ]);

    if (!sourceWallet) throw new NotFoundException('Carteira de origem não encontrada.');
    if (!destinationWallet) throw new UnprocessableEntityException('Carteira de destino não encontrada ou inacessível.');
    if (destinationWallet.status === 'INACTIVE') throw new UnprocessableEntityException('A carteira de destino está inativa.');
    if (sourceWallet.creditorId !== destinationWallet.creditorId) {
      throw new UnprocessableEntityException('A transferência só é permitida entre carteiras do mesmo credor.');
    }

    const filters = dto.filters ?? {};
    const where: Prisma.ContractWhereInput = {
      accountId,
      walletId: dto.sourceWalletId,
      deletedAt: null,
      serasaStatus: { in: EDITABLE_PROVIDER_STATUSES as any },
      ...(filters.paymentStatus ? { paymentStatus: filters.paymentStatus } : {}),
      ...(filters.serasaStatus ? { serasaStatus: filters.serasaStatus } : {}),
      ...(filters.installmentOnly ? { totalInstallments: { gt: 1 } } : {}),
    };

    if (filters.minOriginalValue !== undefined || filters.maxOriginalValue !== undefined) {
      where.originalValue = {
        ...(filters.minOriginalValue !== undefined ? { gte: filters.minOriginalValue } : {}),
        ...(filters.maxOriginalValue !== undefined ? { lte: filters.maxOriginalValue } : {}),
      };
    }
    if (filters.minUpdatedValue !== undefined || filters.maxUpdatedValue !== undefined) {
      where.updatedValue = {
        ...(filters.minUpdatedValue !== undefined ? { gte: filters.minUpdatedValue } : {}),
        ...(filters.maxUpdatedValue !== undefined ? { lte: filters.maxUpdatedValue } : {}),
      };
    }
    this.applyNumericComparison(where, 'updatedValue', filters.updatedValueOperator, filters.updatedValue);
    this.applyNumericComparison(where, 'offerValue', filters.offerValueOperator, filters.offerValue);
    this.applyAgingComparison(where, filters.agingOperator, filters.aging);

    const [matchedCount, transferred] = await this.prisma.$transaction([
      this.prisma.contract.count({ where }),
      this.prisma.contract.updateMany({ where, data: { walletId: dto.destinationWalletId } }),
    ]);

    return { matchedCount, transferredCount: transferred.count };
  }

  /**
   * Find a single contract by ID with wallet and creditor relations.
   */
  async findById(
    id: string,
    accountId: string,
    userRole: string,
    userScopes?: string[],
    creditorId?: string | null,
  ) {
    const where: any = { id, accountId, deletedAt: null };
    if (creditorId) where.wallet = { creditorId };

    // VIEWER scope filtering
    if (userRole === 'VIEWER' && userScopes && userScopes.length > 0) {
      where.walletId = { in: userScopes };
    }

    const contract = await this.prisma.contract.findFirst({
      where,
      include: {
        wallet: {
          include: {
            creditor: { select: { id: true, name: true, cnpj: true } },
          },
        },
        tags: { select: { tag: true } },
      },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    // Mask document for VIEWER
    const { tags, ...rest } = contract;
    const result: any = {
      ...rest,
      tags: tags.map((t) => t.tag),
    };

    if (userRole === 'VIEWER') {
      result.debtorDocument = this.maskDocument(rest.debtorDocument);
    }

    return result;
  }

  /** List the communication history associated with a contract. */
  async listInteractions(
    id: string,
    accountId: string,
    userRole: string,
    userScopes?: string[],
  ) {
    const contractWhere: any = { id, accountId, deletedAt: null };
    if (userRole === 'VIEWER' && userScopes && userScopes.length > 0) {
      contractWhere.walletId = { in: userScopes };
    }
    const contract = await this.prisma.contract.findFirst({ where: contractWhere, select: { id: true } });
    if (!contract) throw new NotFoundException('Contract not found');

    const [interactions, serasaOperations] = await Promise.all([
      this.prisma.contractInteraction.findMany({
        where: { contractId: id, accountId },
        orderBy: { occurredAt: 'desc' },
      }),
      this.prisma.providerOperationItem.findMany({
        where: {
          contractId: id,
          operation: { accountId, provider: { type: 'SERASA_LNOP' } },
        },
        include: { operation: { select: { action: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const serasaHistory = serasaOperations.map((item) => ({
      id: `serasa-${item.id}`,
      channel: 'SERASA',
      status: item.status === 'FAILED'
        ? 'FAILED'
        : item.status === 'WAITING_PROVIDER_EVENT' || item.status === 'PENDING'
          ? 'SENT'
          : 'COMPLETED',
      provider: 'SERASA_LNOP',
      externalId: item.debtId ?? item.transactionId,
      contact: null,
      summary: this.serasaOperationSummary(item.operation.action, item.status, item.errorMessage),
      conversation: null,
      recordingUrl: null,
      payload: null,
      occurredAt: item.updatedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    return [...interactions, ...serasaHistory].sort(
      (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime(),
    );
  }

  private serasaOperationSummary(
    action: 'CREATE_OR_UPDATE' | 'REMOVE',
    status: string,
    errorMessage: string | null,
  ): string {
    if (status === 'FAILED') {
      return `Falha ao ${action === 'REMOVE' ? 'remover' : 'sincronizar'} com a Serasa${errorMessage ? `: ${errorMessage}` : ''}`;
    }
    if (status === 'WAITING_PROVIDER_EVENT' || status === 'PENDING') {
      return `${action === 'REMOVE' ? 'Remoção' : 'Sincronização'} enviada à Serasa; aguardando confirmação.`;
    }
    if (status === 'REMOVED') return 'Dívida removida da Serasa.';
    if (status === 'UPDATED') return 'Dívida atualizada na Serasa.';
    return 'Dívida incluída na Serasa.';
  }

  /** Proxy a LigueLead recording only after validating the caller's contract scope. */
  async getInteractionRecording(
    contractId: string,
    interactionId: string,
    accountId: string,
    userRole: string,
    userScopes?: string[],
  ) {
    const contractWhere: any = { id: contractId, accountId, deletedAt: null };
    if (userRole === 'VIEWER' && userScopes && userScopes.length > 0) {
      contractWhere.walletId = { in: userScopes };
    }
    const contract = await this.prisma.contract.findFirst({ where: contractWhere, select: { id: true } });
    if (!contract) throw new NotFoundException('Contract not found');

    const interaction = await this.prisma.contractInteraction.findFirst({
      where: { id: interactionId, contractId, accountId, recordingUrl: { not: null } },
      select: { recordingUrl: true },
    });
    if (!interaction?.recordingUrl) throw new NotFoundException('Recording not found');

    let recordingUrl: URL;
    try {
      recordingUrl = new URL(interaction.recordingUrl);
    } catch {
      throw new NotFoundException('Recording not found');
    }
    if (recordingUrl.protocol !== 'https:' || recordingUrl.hostname !== 'll-api-files.s3.us-east-1.amazonaws.com') {
      throw new NotFoundException('Recording not found');
    }

    let response: Response;
    try {
      response = await fetch(recordingUrl, { redirect: 'error' });
    } catch {
      throw new BadGatewayException('Não foi possível baixar a gravação');
    }
    if (!response.ok) throw new BadGatewayException('Não foi possível baixar a gravação');
    return {
      data: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || 'audio/wav',
      fileName: `ligacao-${interactionId}.wav`,
    };
  }

  /**
   * List contracts with pagination, filters, tag AND logic, and document masking for VIEWER.
   */
  async list(
    query: ListContractsQueryDto,
    accountId: string,
    userRole: string,
    userScopes?: string[],
    portalCreditorId?: string | null,
  ): Promise<PaginatedResponse<any>> {
    const { page, limit, walletId, creditorId, status, serasaStatus, paymentStatus, installmentOnly, minOriginalValue, maxOriginalValue, minUpdatedValue, maxUpdatedValue, updatedValueOperator, updatedValue, offerValueOperator, offerValue, agingOperator, aging, dateFrom, dateTo, debtorDocument, search, tags, sortBy, sortDirection } = query;

    const where: Prisma.ContractWhereInput = {
      accountId,
      deletedAt: null,
    };
    if (portalCreditorId) where.wallet = { creditorId: portalCreditorId };

    // The creditor portal is intentionally a lookup tool, not a browsable
    // portfolio. Require a complete CPF before returning any contract data.
    if (portalCreditorId && (debtorDocument?.replace(/\D/g, '').length !== 11)) {
      return {
        data: [],
        meta: { total: 0, page, limit, totalPages: 0 },
      };
    }
    // Cancelled contracts are no longer part of the creditor's active
    // portfolio and must not be returned by the portal lookup.
    if (portalCreditorId && !status) where.status = 'ACTIVE';

    // A creditor portal account is restricted by creditorId. It is not a
    // wallet-scoped VIEWER, so an empty UserScope list must not hide all of
    // its own contracts.
    if (userRole === 'VIEWER' && !portalCreditorId) {
      if (!userScopes || userScopes.length === 0) {
        return {
          data: [],
          meta: { total: 0, page, limit, totalPages: 0 },
        };
      }
      where.walletId = { in: userScopes };
    }

    // Apply filters
    if (walletId) {
      // If VIEWER, ensure the walletId is in their scopes
      if (userRole === 'VIEWER' && userScopes && !userScopes.includes(walletId)) {
        return {
          data: [],
          meta: { total: 0, page, limit, totalPages: 0 },
        };
      }
      if (portalCreditorId) {
        const existingAnd = Array.isArray(where.AND)
          ? where.AND
          : where.AND ? [where.AND] : [];
        where.AND = [...existingAnd, { walletId }];
      } else {
        where.walletId = walletId;
      }
    }

    // Never let a portal request override its creditor restriction.
    if (creditorId && !portalCreditorId) {
      where.wallet = { creditorId };
    }

    if (status) {
      where.status = status;
    }

    if (serasaStatus) {
      // Serasa returns 201 (created) and 204 (updated) for the same
      // operational state: the debt is synchronized and active there.
      where.serasaStatus = serasaStatus === 'SYNCED'
        ? { in: ['REGISTERED', 'UPDATED'] }
        : serasaStatus;
    }

    if (paymentStatus) {
      where.paymentStatus = paymentStatus;
    }

    if (installmentOnly) {
      where.totalInstallments = { gt: 1 };
    }

    if (minOriginalValue !== undefined || maxOriginalValue !== undefined) {
      where.originalValue = {
        ...(minOriginalValue !== undefined ? { gte: minOriginalValue } : {}),
        ...(maxOriginalValue !== undefined ? { lte: maxOriginalValue } : {}),
      };
    }

    if (minUpdatedValue !== undefined || maxUpdatedValue !== undefined) {
      where.updatedValue = {
        ...(minUpdatedValue !== undefined ? { gte: minUpdatedValue } : {}),
        ...(maxUpdatedValue !== undefined ? { lte: maxUpdatedValue } : {}),
      };
    }

    this.applyNumericComparison(where, 'updatedValue', updatedValueOperator, updatedValue);
    this.applyNumericComparison(where, 'offerValue', offerValueOperator, offerValue);
    this.applyAgingComparison(where, agingOperator, aging);

    if (dateFrom || dateTo) {
      where.occurrenceDate = { ...((where.occurrenceDate as object | undefined) ?? {}) };
      if (dateFrom) {
        (where.occurrenceDate as any).gte = new Date(dateFrom);
      }
      if (dateTo) {
        (where.occurrenceDate as any).lte = new Date(dateTo);
      }
    }

    if (debtorDocument) {
      const hash = this.deduplicationService.sha256(debtorDocument);
      where.debtorDocumentHash = hash;
    }

    if (search?.trim()) {
      const term = search.trim();
      const document = term.replace(/\D/g, '');
      const searchConditions: Prisma.ContractWhereInput[] = [
        { contractNumber: { contains: term, mode: 'insensitive' } },
      ];

      if (document.length > 0) {
        searchConditions.push({
          debtorDocumentHash: this.deduplicationService.sha256(document),
        });
      }

      const existingAnd = Array.isArray(where.AND)
        ? where.AND
        : where.AND ? [where.AND] : [];
      where.AND = [...existingAnd, { OR: searchConditions }];
    }

    // Tag AND filter: contract must have ALL specified tags
    if (tags && tags.length > 0) {
      const normalizedTags = tags.map((t) => t.toLowerCase().trim());
      // Use AND logic: contract must have every tag
      const tagConditions = normalizedTags.map((tag) => ({
        tags: {
          some: { tag },
        },
      }));
      const existingAnd = Array.isArray(where.AND)
        ? where.AND
        : where.AND ? [where.AND] : [];
      where.AND = [...existingAnd, ...tagConditions];
    }

    const skip = (page - 1) * limit;

    const [contracts, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        skip,
        take: limit,
        orderBy: sortBy
          ? [{ [sortBy]: sortDirection ?? 'asc' }, { createdAt: 'desc' }]
          : { createdAt: 'desc' },
        include: { tags: { select: { tag: true } } },
      }),
      this.prisma.contract.count({ where }),
    ]);

    // Mask document for VIEWER and flatten tags
    const data = contracts.map((contract) => {
      const { tags: contractTags, ...rest } = contract;
      const mapped: any = {
        ...rest,
        tags: contractTags.map((t) => t.tag),
      };
      if (userRole === 'VIEWER') {
        mapped.debtorDocument = this.maskDocument(rest.debtorDocument);
      }
      return mapped;
    });

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      meta: { total, page, limit, totalPages },
    };
  }

  /**
   * Update a contract with serasaStatus and status transition guards.
   */
  async update(
    id: string,
    dto: UpdateContractDto,
    accountId: string,
  ): Promise<Contract> {
    // 1. Find the contract
    const contract = await this.prisma.contract.findFirst({
      where: { id, accountId, deletedAt: null },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    // 2. Check serasaStatus guard
    if (!EDITABLE_PROVIDER_STATUSES.includes(contract.serasaStatus)) {
      throw new ConflictException(
        'Contract must be removed from the provider before any changes. Current serasaStatus does not allow editing.',
      );
    }

    // 3. Validate status transition if provided
    if (dto.status && dto.status !== contract.status) {
      const allowedTargets = ALLOWED_STATUS_TRANSITIONS[contract.status];
      if (!allowedTargets.includes(dto.status)) {
        throw new ConflictException(
          `Invalid status transition from ${contract.status} to ${dto.status}. Allowed: ${allowedTargets.join(', ') || 'none'}`,
        );
      }
    }

    // 4. Validate walletId change if provided
    if (dto.walletId && dto.walletId !== contract.walletId) {
      const destWallet = await this.prisma.wallet.findFirst({
        where: { id: dto.walletId, accountId, deletedAt: null },
      });

      if (!destWallet) {
        throw new UnprocessableEntityException(
          'Destination wallet not found or not accessible',
        );
      }

      if (destWallet.status === 'INACTIVE') {
        throw new UnprocessableEntityException(
          'Destination wallet is INACTIVE. Cannot move contract to an inactive wallet.',
        );
      }
    }

    const offerWalletId = dto.walletId ?? contract.walletId;
    const mustRecalculateOffer = dto.updatedValue !== undefined || dto.walletId !== undefined || dto.occurrenceDate !== undefined || dto.offerDiscountPercent !== undefined;
    const offerWallet = mustRecalculateOffer
      ? await this.prisma.wallet.findFirst({
        where: { id: offerWalletId, accountId, deletedAt: null },
        include: {
          discountBands: { orderBy: { minAgingDays: 'asc' } },
          creditor: { include: { discountBands: { orderBy: { minAgingDays: 'asc' } } } },
        },
      })
      : null;

    // 5. Build update data (partial — only fields provided)
    const updateData: any = {};

    if (dto.originalValue !== undefined) {
      updateData.originalValue = dto.originalValue;
    }
    if (dto.updatedValue !== undefined) {
      updateData.updatedValue = dto.updatedValue;
    }

    if (dto.occurrenceDate !== undefined) {
      updateData.occurrenceDate = new Date(dto.occurrenceDate);
    }
    if (dto.dueDate !== undefined) {
      updateData.dueDate = new Date(dto.dueDate);
    }
    if (dto.debtType !== undefined) {
      updateData.debtType = dto.debtType;
    }
    if (dto.walletId !== undefined) {
      updateData.walletId = dto.walletId;
    }
    if (dto.status !== undefined) {
      updateData.status = dto.status;
    }
    if (dto.debtOrigin !== undefined) {
      updateData.debtOrigin = dto.debtOrigin;
      updateData.debtOriginDocHash = dto.debtOrigin
        ? this.deduplicationService.sha256(dto.debtOrigin)
        : null;
    }
    if (dto.debtorName !== undefined) {
      updateData.debtorName = dto.debtorName;
    }
    if (dto.productName !== undefined) {
      updateData.productName = dto.productName;
    }
    if (dto.debtorStreet !== undefined) {
      updateData.debtorStreet = dto.debtorStreet;
    }
    if (dto.debtorCity !== undefined) {
      updateData.debtorCity = dto.debtorCity;
    }
    if (dto.debtorPhone !== undefined) {
      updateData.debtorPhone = dto.debtorPhone;
    }
    if (dto.debtorEmail !== undefined) {
      updateData.debtorEmail = dto.debtorEmail;
    }
    if (dto.isNegativated !== undefined) {
      updateData.isNegativated = dto.isNegativated;
    }
    if (dto.cancelledAt !== undefined) {
      updateData.cancelledAt = new Date(dto.cancelledAt);
    }
    if (dto.offer !== undefined && contract.paymentStatus !== 'PAID') {
      updateData.offer = dto.offer;
    }
    if (offerWallet && contract.paymentStatus !== 'PAID') {
      Object.assign(updateData, calculateOffer(
        dto.updatedValue ?? Number(contract.updatedValue),
        offerWallet,
      ));
    }
    if (dto.offerDiscountPercent !== undefined) {
      if (contract.paymentStatus === 'PAID') {
        throw new ConflictException('Não é possível alterar o desconto de um contrato pago.');
      }
      if (!offerWallet) throw new UnprocessableEntityException('Carteira comercial não encontrada.');

      const occurrenceDate = dto.occurrenceDate ? new Date(dto.occurrenceDate) : contract.occurrenceDate;
      const agingDays = this.calculateAgingDays(occurrenceDate);
      const band = offerWallet.creditor.discountBands.find((item) =>
        item.minAgingDays <= agingDays && (item.maxAgingDays === null || item.maxAgingDays >= agingDays),
      );
      const maximumDiscountPercent = Number(band
        ? (offerWallet.offerMaxInstallments > 1 ? band.installmentDiscountPercent : band.cashDiscountPercent)
        : offerWallet.cobcomDiscountPercent);
      if (dto.offerDiscountPercent > maximumDiscountPercent) {
        throw new UnprocessableEntityException(`O desconto informado excede o limite comercial de ${maximumDiscountPercent}%.`);
      }

      const updatedValue = dto.updatedValue ?? Number(contract.updatedValue);
      const offerValue = Math.round(updatedValue * (1 - dto.offerDiscountPercent / 100) * 100) / 100;
      const repasseValue = Math.round(updatedValue * (1 - maximumDiscountPercent / 100) * 100) / 100;
      Object.assign(updateData, {
        agingDays,
        offerDiscountPercent: dto.offerDiscountPercent,
        maximumDiscountPercent,
        offerValue,
        repasseValue,
        commissionPercent: offerWallet.creditor.commissionPercent,
        commissionValue: Math.round(repasseValue * Number(offerWallet.creditor.commissionPercent) / 100 * 100) / 100,
        offerFirstInstallmentDays: offerWallet.offerFirstInstallmentDays,
        offerMaxInstallments: Math.min(
          offerWallet.offerMaxInstallments,
          Math.max(1, Math.floor(offerValue / Number(offerWallet.offerMinInstallmentValue))),
        ),
      });
    }

    // serasaStatus is NEVER editable via PATCH — ignored if present in body

    return this.prisma.contract.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Soft-delete a contract if serasaStatus allows it.
   */
  async softDelete(id: string, accountId: string): Promise<Contract> {
    const contract = await this.prisma.contract.findFirst({
      where: { id, accountId, deletedAt: null },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    if (!EDITABLE_PROVIDER_STATUSES.includes(contract.serasaStatus)) {
      throw new ConflictException(
        'Contract must be removed from the provider before deletion. Current serasaStatus does not allow deletion.',
      );
    }

    return this.prisma.contract.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Mask a document showing only last 4 characters.
   * Format: ***...XXXX
   */
  maskDocument(document: string): string {
    if (!document || document.length <= 4) {
      return document;
    }
    const last4 = document.slice(-4);
    return `***${last4}`;
  }
}

import {
  Injectable,
  Logger,
  UnprocessableEntityException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES } from '../common/constants/queues';
import {
  OperationAction,
  OperationStatus,
  OperationItemStatus,
  ContractStatus,
  SerasaStatus,
  PaymentStatus,
} from '@prisma/client';

// Each Serasa request is deliberately isolated to one debt. Besides making a
// failure recoverable per contract, it gives every request its own
// transactionId and therefore an unambiguous webhook correlation.
const BATCH_SIZE = 1;

/** SerasaStatus values eligible for CREATE_OR_UPDATE operations */
const ELIGIBLE_FOR_CREATE: SerasaStatus[] = [
  SerasaStatus.NOT_ENABLED,
  SerasaStatus.PENDING,
  SerasaStatus.FAILED,
  // A remoção confirmada pela Serasa libera o mesmo contrato para um novo envio.
  SerasaStatus.REMOVED,
];

/** SerasaStatus values eligible for REMOVE operations */
const ELIGIBLE_FOR_REMOVE: SerasaStatus[] = [
  SerasaStatus.REGISTERED,
  SerasaStatus.UPDATED,
];

export interface CreateOperationParams {
  walletId: string;
  action: OperationAction;
  userId: string;
  accountId: string;
  filters?: OperationContractFilters;
}

export interface OperationContractFilters {
  contractStatus?: ContractStatus;
  serasaStatus?: SerasaStatus;
  paymentStatus?: PaymentStatus;
  installmentOnly?: boolean;
  minOriginalValue?: number;
  maxOriginalValue?: number;
  minUpdatedValue?: number;
  maxUpdatedValue?: number;
  updatedValueOperator?: 'gt' | 'lt' | 'eq';
  updatedValue?: number;
  offerValueOperator?: 'gt' | 'lt' | 'eq';
  offerValue?: number;
  agingOperator?: 'gt' | 'lt' | 'eq';
  aging?: number;
  dateFrom?: string;
  dateTo?: string;
}

export interface OperationBatchJobData {
  operationId: string;
  batchIndex: number;
  providerId: string;
  action: OperationAction;
}

@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.PROVIDER_OPERATION)
    private readonly operationQueue: Queue,
  ) {}

  private applyAgingComparison(where: any, operator?: 'gt' | 'lt' | 'eq', aging?: number) {
    if (!operator || aging === undefined) return;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
    const today = new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
    const day = (offset: number) => new Date(today.getTime() + offset * 86_400_000);
    const condition = operator === 'gt'
      ? { lt: day(-aging) }
      : operator === 'lt'
        ? { gte: day(-(aging - 1)) }
        : { gte: day(-aging), lt: day(-(aging - 1)) };
    where.occurrenceDate = { ...(where.occurrenceDate ?? {}), ...condition };
  }

  /**
   * Preview eligible contracts for a provider operation without creating one.
   * Returns count and batch information.
   */
  async preview(walletId: string, action: OperationAction, accountId: string, filters: OperationContractFilters = {}) {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, accountId, deletedAt: null },
    });

    if (!wallet) {
      throw new UnprocessableEntityException('Wallet não encontrada');
    }
    await this.getSerasaProvider(accountId);

    const eligibleStatuses = this.getEligibleStatuses(action);
    const contracts = await this.selectEligibleContracts(walletId, action, eligibleStatuses, filters);

    return {
      walletId,
      action,
      eligibleCount: contracts.length,
      batchCount: Math.ceil(contracts.length / BATCH_SIZE),
    };
  }

  /**
   * Creates a new provider operation by selecting eligible contracts,
   * dividing into batches, and scheduling BullMQ jobs.
   */
  async create(params: CreateOperationParams) {
    const { walletId, action, userId, accountId, filters = {} } = params;

    // Validate wallet and configured Serasa provider.
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, accountId, deletedAt: null },
    });

    if (!wallet) {
      throw new UnprocessableEntityException('Wallet não encontrada');
    }
    const provider = await this.getSerasaProvider(accountId);
    const providerId = provider.id;

    // Select eligible contracts
    const eligibleStatuses = this.getEligibleStatuses(action);
    const eligibleContracts = await this.selectEligibleContracts(
      walletId,
      action,
      eligibleStatuses,
      filters,
    );

    if (eligibleContracts.length === 0) {
      throw new UnprocessableEntityException(
        'Nenhum contrato elegível encontrado para esta operação',
      );
    }

    // Create operation and items in a transaction
    const totalItems = eligibleContracts.length;
    const totalBatches = Math.ceil(totalItems / BATCH_SIZE);

    const operation = await this.prisma.$transaction(async (tx) => {
      // Create the operation
      const op = await tx.providerOperation.create({
        data: {
          accountId,
          providerId,
          walletId,
          userId,
          action,
          status: OperationStatus.PENDING,
          totalItems,
        },
      });

      // Create operation items with batch indices
      const itemsData = eligibleContracts.map((contract, index) => ({
        operationId: op.id,
        contractId: contract.id,
        batchIndex: Math.floor(index / BATCH_SIZE),
        status: 'PENDING' as const,
      }));

      await tx.providerOperationItem.createMany({
        data: itemsData,
      });

      // Reflect the submitted action immediately in the CRM list while the
      // provider processes the asynchronous request.
      await tx.contract.updateMany({
        where: { id: { in: eligibleContracts.map((contract) => contract.id) } },
        data: {
          serasaStatus: action === OperationAction.REMOVE
            ? SerasaStatus.REMOVING
            : SerasaStatus.SENT,
        },
      });

      return op;
    });

    // Schedule one BullMQ job per batch
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const jobData: OperationBatchJobData = {
        operationId: operation.id,
        batchIndex,
        providerId,
        action,
      };

      await this.operationQueue.add(
        `operation-batch-${operation.id}-${batchIndex}`,
        jobData,
        { attempts: 1 },
      );
    }

    this.logger.log(
      `Operation ${operation.id} created: ${totalItems} items in ${totalBatches} batches`,
    );

    return {
      id: operation.id,
      status: operation.status,
      action: operation.action,
      totalItems,
      totalBatches,
      walletId,
      createdAt: operation.createdAt,
    };
  }

  /** Queues a single inclusion/update or removal operation for a contract. */
  async createForContract(
    contractId: string,
    userId: string,
    accountId: string,
    action: OperationAction = OperationAction.CREATE_OR_UPDATE,
  ) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, accountId, deletedAt: null, status: ContractStatus.ACTIVE },
      include: { wallet: { select: { id: true } } },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    const provider = await this.getSerasaProvider(accountId);
    const eligibleStatuses = action === OperationAction.REMOVE
      ? [...ELIGIBLE_FOR_REMOVE, SerasaStatus.SENT]
      : ELIGIBLE_FOR_CREATE;
    if (!eligibleStatuses.includes(contract.serasaStatus)) {
      throw new ConflictException(
        action === OperationAction.REMOVE
          ? 'Este contrato não está elegível para remoção da Serasa'
          : 'Este contrato já está sincronizado ou não é elegível para envio à Serasa',
      );
    }
    if (action === OperationAction.REMOVE && !contract.debtId) {
      throw new ConflictException('Não foi encontrada a identificação da dívida na Serasa para removê-la');
    }

    const operation = await this.prisma.$transaction(async (tx) => {
      const op = await tx.providerOperation.create({
        data: {
          accountId,
          providerId: provider.id,
          walletId: contract.walletId,
          userId,
          action,
          status: OperationStatus.PENDING,
          totalItems: 1,
        },
      });
      await tx.providerOperationItem.create({
        data: { operationId: op.id, contractId: contract.id, batchIndex: 0, status: OperationItemStatus.PENDING },
      });
      await tx.contract.update({
        where: { id: contract.id },
        data: {
          serasaStatus: action === OperationAction.REMOVE
            ? SerasaStatus.REMOVING
            : SerasaStatus.SENT,
        },
      });
      return op;
    });

    await this.operationQueue.add(
      `operation-contract-${operation.id}`,
      { operationId: operation.id, batchIndex: 0, providerId: provider.id, action },
      { attempts: 1 },
    );
    return { id: operation.id, status: operation.status, contractId: contract.id };
  }

  /**
   * Replays only the contracts from a prior creation operation that were
   * accepted by Serasa but never confirmed by webhook. It intentionally does
   * not use the normal eligibility list: those contracts remain SENT while
   * confirmation is pending. Each replay is queued as its own request.
   */
  async retryUnconfirmedCreateOperation(
    sourceOperationId: string,
    userId: string,
    accountId: string,
  ) {
    const source = await this.prisma.providerOperation.findFirst({
      where: { id: sourceOperationId, accountId, action: OperationAction.CREATE_OR_UPDATE },
      select: {
        providerId: true,
        walletId: true,
        items: {
          where: {
            status: OperationItemStatus.WAITING_PROVIDER_EVENT,
            contract: { status: ContractStatus.ACTIVE, paymentStatus: { not: PaymentStatus.PAID }, serasaStatus: SerasaStatus.SENT },
          },
          select: { contractId: true },
        },
      },
    });

    if (!source) throw new NotFoundException('Operação de inclusão não encontrada');
    if (source.items.length === 0) {
      throw new UnprocessableEntityException('Não há contratos sem confirmação para reenviar');
    }

    const operation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.providerOperation.create({
        data: {
          accountId,
          providerId: source.providerId,
          walletId: source.walletId,
          userId,
          action: OperationAction.CREATE_OR_UPDATE,
          status: OperationStatus.PENDING,
          totalItems: source.items.length,
        },
      });
      await tx.providerOperationItem.createMany({
        data: source.items.map((item, batchIndex) => ({
          operationId: created.id,
          contractId: item.contractId,
          batchIndex,
          status: OperationItemStatus.PENDING,
        })),
      });
      return created;
    });

    for (let batchIndex = 0; batchIndex < source.items.length; batchIndex++) {
      await this.operationQueue.add(
        `operation-retry-${operation.id}-${batchIndex}`,
        { operationId: operation.id, batchIndex, providerId: source.providerId, action: OperationAction.CREATE_OR_UPDATE },
        { attempts: 1 },
      );
    }

    this.logger.log(`Operation ${operation.id} replays ${source.items.length} unconfirmed Serasa contracts individually`);
    return { id: operation.id, status: operation.status, totalItems: source.items.length };
  }

  /**
   * Cancels a contract at the creditor's request. A cancellation makes the
   * contract unavailable in CobCom channels immediately and, when it has an
   * active Serasa debt, queues the provider removal before changing the local
   * administrative status.
   */
  async cancelContract(
    contractId: string,
    userId: string,
    accountId: string,
    creditorId?: string | null,
  ) {
    const contract = await this.prisma.contract.findFirst({
      where: {
        id: contractId,
        accountId,
        deletedAt: null,
        ...(creditorId ? { wallet: { creditorId } } : {}),
      },
      select: { id: true, status: true, serasaStatus: true, debtId: true },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    if (contract.status === ContractStatus.CANCELLED) {
      throw new ConflictException('Este contrato já está cancelado');
    }

    let serasaRemovalQueued = false;
    if (
      contract.debtId &&
      [...ELIGIBLE_FOR_REMOVE, SerasaStatus.SENT].includes(contract.serasaStatus)
    ) {
      try {
        await this.createForContract(contractId, userId, accountId, OperationAction.REMOVE);
        serasaRemovalQueued = true;
      } catch (error) {
        // The local cancellation must still stop CobCom channels immediately.
        // The failed provider removal remains visible in the application log.
        this.logger.error(`Unable to queue Serasa removal for cancelled contract ${contractId}`, error);
      }
    }

    await this.prisma.contract.update({
      where: { id: contractId },
      data: { status: ContractStatus.CANCELLED, cancelledAt: new Date() },
    });

    return {
      contractId,
      status: ContractStatus.CANCELLED,
      serasaRemovalQueued,
    };
  }

  private async getSerasaProvider(accountId: string) {
    const provider = await this.prisma.provider.findFirst({
      where: { accountId, type: 'SERASA_LNOP' },
      select: { id: true },
    });
    if (!provider) {
      throw new UnprocessableEntityException('A integração da Serasa não está ativa para esta conta');
    }
    return provider;
  }

  /** Removes a Serasa debt after it was paid through another payment channel. */
  async createAutomaticRemovalForPaidContract(contractId: string, accountId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, accountId, deletedAt: null, debtId: { not: null }, serasaStatus: { in: [SerasaStatus.SENT, SerasaStatus.REGISTERED, SerasaStatus.UPDATED] } },
    });
    if (!contract) return;

    const inProgress = await this.prisma.providerOperationItem.findFirst({
      where: {
        contractId,
        operation: { action: OperationAction.REMOVE, status: { in: [OperationStatus.PENDING, OperationStatus.PROCESSING] } },
      },
    });
    if (inProgress) return;

    const user = await this.prisma.user.findFirst({
      where: { accountId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) {
      this.logger.warn(`Unable to auto-remove Serasa debt for contract ${contractId}: no active account user`);
      return;
    }
    await this.createForContract(contractId, user.id, accountId, OperationAction.REMOVE);
  }

  /**
   * Lists operations with pagination and scope filtering.
   */
  async findAll(
    query: { page: number; limit: number; walletId?: string; status?: OperationStatus },
    accountId: string,
    userScopes?: string[],
  ) {
    const { page, limit, walletId, status } = query;
    const skip = (page - 1) * limit;

    const where: any = { accountId };

    if (walletId) {
      where.walletId = walletId;
    }

    if (status) {
      where.status = status;
    }

    // VIEWER scope filtering
    if (userScopes) {
      if (walletId && !userScopes.includes(walletId)) {
        return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
      }
      if (!walletId) {
        where.walletId = { in: userScopes };
      }
    }

    const [operations, total] = await Promise.all([
      this.prisma.providerOperation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          walletId: true,
          providerId: true,
          action: true,
          status: true,
          totalItems: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, name: true, email: true } },
          wallet: { select: { id: true, name: true } },
        },
      }),
      this.prisma.providerOperation.count({ where }),
    ]);

    const data = await this.withItemCounts(operations);

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

  /**
   * Finds a single operation by ID with its items.
   */
  async findOne(operationId: string, accountId: string, userScopes?: string[]) {
    const operation = await this.prisma.providerOperation.findFirst({
      where: { id: operationId, accountId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        wallet: { select: { id: true, name: true } },
        items: {
          select: {
            id: true,
            contractId: true,
            batchIndex: true,
            status: true,
            transactionId: true,
            debtId: true,
            errorCode: true,
            errorMessage: true,
            attempts: true,
            lastAttemptAt: true,
          },
          orderBy: [{ batchIndex: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!operation) {
      throw new NotFoundException('Operação não encontrada');
    }

    // Scope check for VIEWER
    if (userScopes && !userScopes.includes(operation.walletId)) {
      throw new NotFoundException('Operação não encontrada');
    }

    const [result] = await this.withItemCounts([operation]);
    return result;
  }

  async findItems(
    operationId: string,
    query: { page?: number; limit?: number },
    accountId: string,
    userScopes?: string[],
  ) {
    const operation = await this.prisma.providerOperation.findFirst({
      where: { id: operationId, accountId },
      select: { walletId: true },
    });

    if (!operation || (userScopes && !userScopes.includes(operation.walletId))) {
      throw new NotFoundException('Operação não encontrada');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { operationId };
    const [data, total] = await Promise.all([
      this.prisma.providerOperationItem.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ batchIndex: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          operationId: true,
          contractId: true,
          status: true,
          errorCode: true,
          errorMessage: true,
        },
      }),
      this.prisma.providerOperationItem.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  private async withItemCounts<T extends { id: string }>(operations: T[]) {
    if (operations.length === 0) return [];

    const grouped = await this.prisma.providerOperationItem.groupBy({
      by: ['operationId', 'status'],
      where: { operationId: { in: operations.map((operation) => operation.id) } },
      _count: { _all: true },
    });

    const counts = new Map<string, { processedItems: number; failedItems: number }>();
    for (const item of grouped) {
      const current = counts.get(item.operationId) ?? { processedItems: 0, failedItems: 0 };
      if (item.status === OperationItemStatus.FAILED) {
        current.failedItems += item._count._all;
      } else if (
        item.status === OperationItemStatus.REGISTERED ||
        item.status === OperationItemStatus.UPDATED ||
        item.status === OperationItemStatus.REMOVED
      ) {
        current.processedItems += item._count._all;
      }
      counts.set(item.operationId, current);
    }

    return operations.map((operation) => ({
      ...operation,
      ...(counts.get(operation.id) ?? { processedItems: 0, failedItems: 0 }),
    }));
  }

  /**
   * Cancels a pending operation.
   */
  async cancel(operationId: string, accountId: string) {
    const operation = await this.prisma.providerOperation.findFirst({
      where: { id: operationId, accountId },
    });

    if (!operation) {
      throw new NotFoundException('Operação não encontrada');
    }

    if (operation.status !== OperationStatus.PENDING) {
      throw new ConflictException(
        `Não é possível cancelar uma operação com status ${operation.status}`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Cancel all PENDING items
      await tx.providerOperationItem.updateMany({
        where: {
          operationId,
          status: 'PENDING',
        },
        data: { status: 'FAILED', errorCode: 'CANCELLED', errorMessage: 'Operação cancelada pelo usuário' },
      });

      return tx.providerOperation.update({
        where: { id: operationId },
        data: { status: OperationStatus.CANCELLED },
      });
    });

    return { id: updated.id, status: updated.status };
  }

  /**
   * Selects contracts eligible for a provider operation.
   * Public for testing purposes.
   */
  selectEligibleContracts(
    walletId: string,
    action: OperationAction,
    eligibleStatuses: SerasaStatus[],
    filters: OperationContractFilters = {},
  ) {
    const where: any = {
      walletId,
      status: ContractStatus.ACTIVE,
      deletedAt: null,
      serasaStatus: { in: eligibleStatuses },
    };

    // For REMOVE, debtId must exist
    if (action === OperationAction.REMOVE) {
      where.debtId = { not: null };
    } else {
      where.paymentStatus = { not: PaymentStatus.PAID };
    }

    if (filters.contractStatus && filters.contractStatus !== ContractStatus.ACTIVE) return Promise.resolve([]);
    if (filters.serasaStatus) {
      if (!eligibleStatuses.includes(filters.serasaStatus)) return Promise.resolve([]);
      where.serasaStatus = filters.serasaStatus;
    }
    if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
    if (filters.installmentOnly) where.totalInstallments = { gt: 1 };
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
    if (filters.updatedValueOperator && filters.updatedValue !== undefined) {
      where.updatedValue = { [filters.updatedValueOperator === 'eq' ? 'equals' : filters.updatedValueOperator]: filters.updatedValue };
    }
    if (filters.offerValueOperator && filters.offerValue !== undefined) {
      where.offerValue = { [filters.offerValueOperator === 'eq' ? 'equals' : filters.offerValueOperator]: filters.offerValue };
    }
    this.applyAgingComparison(where, filters.agingOperator, filters.aging);
    if (filters.dateFrom || filters.dateTo) {
      where.occurrenceDate = {
        ...(where.occurrenceDate ?? {}),
        ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
        ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
      };
    }

    return this.prisma.contract.findMany({
      where,
      select: {
        id: true,
        debtorDocument: true,
        contractNumber: true,
        debtType: true,
        occurrenceDate: true,
        originalValue: true,
        updatedValue: true,
        debtOrigin: true,
        debtId: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get the eligible provider statuses for an action.
   * Exported for testing.
   */
  getEligibleStatuses(action: OperationAction): SerasaStatus[] {
    if (action === OperationAction.CREATE_OR_UPDATE) {
      return ELIGIBLE_FOR_CREATE;
    }
    return ELIGIBLE_FOR_REMOVE;
  }
}

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

const BATCH_SIZE = 1000;

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
    if (!wallet.serasaWalletId) {
      throw new UnprocessableEntityException('Selecione e salve uma Carteira Serasa na carteira CRM antes de sincronizar contratos');
    }

    const walletMapping = await this.prisma.walletMapping.findFirst({
      where: { walletId },
    });

    if (!walletMapping) {
      throw new UnprocessableEntityException('Wallet não possui mapeamento com provedor');
    }

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

    // Validate wallet exists and has an active provider mapping
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, accountId, deletedAt: null },
    });

    if (!wallet) {
      throw new UnprocessableEntityException('Wallet não encontrada');
    }
    if (!wallet.serasaWalletId) {
      throw new UnprocessableEntityException('Selecione e salve uma Carteira Serasa na carteira CRM antes de sincronizar contratos');
    }

    // Find provider with mapping for this wallet
    const walletMapping = await this.prisma.walletMapping.findFirst({
      where: { walletId },
      include: { provider: true },
    });

    if (!walletMapping) {
      throw new UnprocessableEntityException(
        'Wallet não possui mapeamento com provedor',
      );
    }

    const providerId = walletMapping.providerId;

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
      include: { wallet: { select: { serasaWalletId: true } } },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    if (!contract.wallet.serasaWalletId) {
      throw new UnprocessableEntityException(
        'Selecione e salve uma Carteira Serasa na carteira CRM antes de sincronizar contratos',
      );
    }
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

    const mapping = await this.prisma.walletMapping.findFirst({
      where: { walletId: contract.walletId },
      include: { provider: true },
    });
    if (!mapping || mapping.provider.type !== 'SERASA_LNOP') {
      throw new UnprocessableEntityException('A carteira CRM não possui uma carteira Serasa vinculada');
    }

    const operation = await this.prisma.$transaction(async (tx) => {
      const op = await tx.providerOperation.create({
        data: {
          accountId,
          providerId: mapping.providerId,
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
      { operationId: operation.id, batchIndex: 0, providerId: mapping.providerId, action },
      { attempts: 1 },
    );
    return { id: operation.id, status: operation.status, contractId: contract.id };
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
    if (filters.dateFrom || filters.dateTo) {
      where.occurrenceDate = {
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

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
  ContractStatus,
  ProviderStatus,
} from '@prisma/client';

const BATCH_SIZE = 1000;

/** ProviderStatus values eligible for CREATE_OR_UPDATE operations */
const ELIGIBLE_FOR_CREATE: ProviderStatus[] = [
  ProviderStatus.PENDING,
  ProviderStatus.FAILED,
];

/** ProviderStatus values eligible for REMOVE operations */
const ELIGIBLE_FOR_REMOVE: ProviderStatus[] = [
  ProviderStatus.REGISTERED,
  ProviderStatus.UPDATED,
];

export interface CreateOperationParams {
  walletId: string;
  action: OperationAction;
  userId: string;
  accountId: string;
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
  async preview(walletId: string, action: OperationAction, accountId: string) {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, accountId, deletedAt: null },
    });

    if (!wallet) {
      throw new UnprocessableEntityException('Wallet não encontrada');
    }

    const walletMapping = await this.prisma.walletMapping.findFirst({
      where: { walletId },
    });

    if (!walletMapping) {
      throw new UnprocessableEntityException('Wallet não possui mapeamento com provedor');
    }

    const eligibleStatuses = this.getEligibleStatuses(action);
    const contracts = await this.selectEligibleContracts(walletId, action, eligibleStatuses);

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
    const { walletId, action, userId, accountId } = params;

    // Validate wallet exists and has an active provider mapping
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, accountId, deletedAt: null },
    });

    if (!wallet) {
      throw new UnprocessableEntityException('Wallet não encontrada');
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

    const [data, total] = await Promise.all([
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
        },
      }),
      this.prisma.providerOperation.count({ where }),
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

  /**
   * Finds a single operation by ID with its items.
   */
  async findOne(operationId: string, accountId: string, userScopes?: string[]) {
    const operation = await this.prisma.providerOperation.findFirst({
      where: { id: operationId, accountId },
      include: {
        user: { select: { id: true, name: true, email: true } },
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

    return operation;
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
    eligibleStatuses: ProviderStatus[],
  ) {
    const where: any = {
      walletId,
      status: ContractStatus.ACTIVE,
      deletedAt: null,
      providerStatus: { in: eligibleStatuses },
    };

    // For REMOVE, debtId must exist
    if (action === OperationAction.REMOVE) {
      where.debtId = { not: null };
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
  getEligibleStatuses(action: OperationAction): ProviderStatus[] {
    if (action === OperationAction.CREATE_OR_UPDATE) {
      return ELIGIBLE_FOR_CREATE;
    }
    return ELIGIBLE_FOR_REMOVE;
  }
}

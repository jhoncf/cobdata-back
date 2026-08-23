import {
  Injectable,
  UnprocessableEntityException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DeduplicationService } from './deduplication.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { ListContractsQueryDto } from './dto/list-contracts-query.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { Contract, ContractStatus, Prisma } from '@prisma/client';
import { PaginatedResponse } from '../common/dto/paginated-response.dto';

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

  async createOrUpdate(
    dto: CreateContractDto,
    accountId: string,
  ): Promise<Contract> {
    // 1. Validate wallet exists, is ACTIVE, not deleted
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: dto.walletId, accountId, deletedAt: null },
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

    // 3. Validate updatedValue >= originalValue (if provided)
    if (
      dto.updatedValue !== undefined &&
      dto.updatedValue < dto.originalValue
    ) {
      throw new UnprocessableEntityException(
        'updatedValue must be greater than or equal to originalValue',
      );
    }

    // 4. Resolve creditorId from wallet
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

    if (existingContract) {
      // 6a. If exists in SAME wallet → UPDATE (preserve unset fields)
      if (existingContract.walletId === dto.walletId) {
        const updateData: any = {
          debtorDocument: dto.debtorDocument,
          debtorName: dto.debtorName,
          debtorDocumentHash,
          contractNumber: dto.contractNumber,
          debtType: dto.debtType,
          occurrenceDate,
          originalValue: dto.originalValue,
          dueDate,
        };

        if (dto.updatedValue !== undefined) {
          updateData.updatedValue = dto.updatedValue;
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
        debtorName: dto.debtorName,
        debtorDocumentHash,
        contractNumber: dto.contractNumber,
        debtType: dto.debtType,
        occurrenceDate,
        dueDate,
        originalValue: dto.originalValue,
        updatedValue: dto.updatedValue ?? null,
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

  /**
   * Find a single contract by ID with wallet and creditor relations.
   */
  async findById(
    id: string,
    accountId: string,
    userRole: string,
    userScopes?: string[],
  ) {
    const where: any = { id, accountId, deletedAt: null };

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

    return this.prisma.contractInteraction.findMany({
      where: { contractId: id, accountId },
      orderBy: { occurredAt: 'desc' },
    });
  }

  /**
   * List contracts with pagination, filters, tag AND logic, and document masking for VIEWER.
   */
  async list(
    query: ListContractsQueryDto,
    accountId: string,
    userRole: string,
    userScopes?: string[],
  ): Promise<PaginatedResponse<any>> {
    const { page, limit, walletId, creditorId, status, serasaStatus, dateFrom, dateTo, debtorDocument, tags } = query;

    const where: Prisma.ContractWhereInput = {
      accountId,
      deletedAt: null,
    };

    // VIEWER scope filtering: only wallets in user scopes
    if (userRole === 'VIEWER') {
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
      where.walletId = walletId;
    }

    if (creditorId) {
      where.wallet = { creditorId };
    }

    if (status) {
      where.status = status;
    }

    if (serasaStatus) {
      where.serasaStatus = serasaStatus;
    }

    if (dateFrom || dateTo) {
      where.occurrenceDate = {};
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

    // Tag AND filter: contract must have ALL specified tags
    if (tags && tags.length > 0) {
      const normalizedTags = tags.map((t) => t.toLowerCase().trim());
      // Use AND logic: contract must have every tag
      where.AND = normalizedTags.map((tag) => ({
        tags: {
          some: { tag },
        },
      }));
    }

    const skip = (page - 1) * limit;

    const [contracts, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
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
    if (dto.offer !== undefined) {
      updateData.offer = dto.offer;
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

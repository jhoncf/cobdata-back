import {
  Injectable,
  Logger,
  UnprocessableEntityException,
  NotFoundException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { QUEUES } from '../common/constants/queues';
import { randomUUID } from 'crypto';
import * as XLSX from 'xlsx';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_EXTENSIONS = ['.csv', '.xlsx'];

/** Statuses that allow confirmation */
const CONFIRMABLE_STATUSES = ['VALIDATED', 'VALIDATED_WITH_ERRORS'];

/** Statuses that are idempotent (already confirmed/applied) */
const IDEMPOTENT_STATUSES = ['APPLYING', 'APPLIED'];

/** Statuses that conflict with confirmation */
const CONFLICT_STATUSES = [
  'PENDING_VALIDATION',
  'VALIDATING',
  'CANCELLED',
  'FAILED',
  'VALIDATION_FAILED',
];

export interface UploadImportParams {
  file: Express.Multer.File;
  walletId: string;
  columnMapping: Record<string, string>;
  userId: string;
  accountId: string;
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    @InjectQueue(QUEUES.IMPORT_VALIDATION)
    private readonly validationQueue: Queue,
    @InjectQueue(QUEUES.IMPORT_APPLICATION)
    private readonly applicationQueue: Queue,
  ) {}

  async upload(params: UploadImportParams) {
    const { file, walletId, columnMapping, userId, accountId } = params;

    // Validate file exists
    if (!file) {
      throw new UnprocessableEntityException('Arquivo é obrigatório');
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      throw new PayloadTooLargeException(
        `O tamanho do arquivo excede o limite máximo permitido de 100MB`,
      );
    }

    // Validate file extension
    const extension = this.getFileExtension(file.originalname);
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      throw new UnprocessableEntityException(
        'Formato de arquivo não aceito. Use .csv ou .xlsx',
      );
    }

    // Validate wallet
    const wallet = await this.prisma.wallet.findFirst({
      where: {
        id: walletId,
        accountId,
        deletedAt: null,
      },
    });

    if (!wallet) {
      throw new UnprocessableEntityException('Wallet inválida');
    }

    if (wallet.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Wallet inválida');
    }

    // Count lines
    const totalLines = await this.countLines(file.buffer, extension);
    if (totalLines === 0) {
      throw new UnprocessableEntityException(
        'O arquivo não contém registros para importação',
      );
    }

    // Upload to S3
    const s3Key = `imports/${accountId}/${randomUUID()}${extension}`;
    await this.storageService.upload(s3Key, file.buffer, file.mimetype);

    // Create ImportBatch
    const batch = await this.prisma.importBatch.create({
      data: {
        accountId,
        walletId,
        userId,
        fileName: file.originalname,
        fileUrl: s3Key,
        columnMapping: columnMapping as any,
        totalLines,
        status: 'PENDING_VALIDATION',
      },
    });

    // Schedule validation job
    await this.validationQueue.add(
      'validate',
      { batchId: batch.id },
      { attempts: 1 },
    );

    return {
      id: batch.id,
      status: batch.status,
      totalLines: batch.totalLines,
    };
  }

  async findAll(
    query: { page: number; limit: number; walletId?: string; status?: string },
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
      where.status = status as any;
    }

    // VIEWER scope filtering
    if (userScopes) {
      where.walletId = { in: userScopes };
      if (walletId) {
        // If specific walletId requested, ensure it's in the user's scopes
        if (!userScopes.includes(walletId)) {
          return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
        }
        where.walletId = walletId;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.importBatch.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          walletId: true,
          fileName: true,
          totalLines: true,
          validLines: true,
          invalidLines: true,
          createdCount: true,
          updatedCount: true,
          ignoredCount: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.importBatch.count({ where }),
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

  async findOne(batchId: string, accountId: string) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, accountId },
      include: {
        wallet: {
          select: {
            id: true,
            name: true,
            creditorId: true,
            creditor: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException('Lote de importação não encontrado');
    }

    return batch;
  }

  async findErrors(
    batchId: string,
    query: { page: number; limit: number },
    accountId: string,
  ) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, accountId },
    });

    if (!batch) {
      throw new NotFoundException('Lote de importação não encontrado');
    }

    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.importBatchError.findMany({
        where: { batchId },
        skip,
        take: limit,
        orderBy: { lineNumber: 'asc' },
        select: {
          lineNumber: true,
          errorCode: true,
          fieldName: true,
          message: true,
          fieldValue: true,
        },
      }),
      this.prisma.importBatchError.count({ where: { batchId } }),
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

  async cancel(batchId: string, accountId: string) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, accountId },
    });

    if (!batch) {
      throw new NotFoundException('Lote de importação não encontrado');
    }

    const cancellableStatuses = [
      'PENDING_VALIDATION',
      'VALIDATING',
      'VALIDATED',
      'VALIDATED_WITH_ERRORS',
    ];

    if (!cancellableStatuses.includes(batch.status)) {
      throw new ConflictException(
        `Não é possível cancelar um lote com status ${batch.status}`,
      );
    }

    const updated = await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: 'CANCELLED' },
    });

    return { id: updated.id, status: updated.status };
  }

  /**
   * Confirm an import batch for application.
   * Only batches with status VALIDATED or VALIDATED_WITH_ERRORS can be confirmed.
   * If already APPLYING/APPLIED, return current state (idempotent).
   * If PENDING_VALIDATION/VALIDATING/CANCELLED/FAILED/VALIDATION_FAILED: 409.
   */
  async confirm(batchId: string, accountId: string) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, accountId },
    });

    if (!batch) {
      throw new NotFoundException('Lote de importação não encontrado');
    }

    // Idempotent: if already confirmed/applied, return current state
    if (IDEMPOTENT_STATUSES.includes(batch.status)) {
      return { id: batch.id, status: batch.status };
    }

    // Conflict: statuses that cannot be confirmed
    if (CONFLICT_STATUSES.includes(batch.status)) {
      throw new ConflictException(
        `Não é possível confirmar um lote com status ${batch.status}`,
      );
    }

    // Confirmable: VALIDATED or VALIDATED_WITH_ERRORS
    if (!CONFIRMABLE_STATUSES.includes(batch.status)) {
      throw new ConflictException(
        `Não é possível confirmar um lote com status ${batch.status}`,
      );
    }

    // Set status to APPLYING
    const updated = await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: 'APPLYING' },
    });

    // Schedule application job with retry configuration
    await this.applicationQueue.add(
      'apply',
      { batchId: batch.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
      },
    );

    this.logger.log(`Batch ${batchId} confirmed and application job scheduled`);

    return { id: updated.id, status: updated.status };
  }

  /**
   * Count data lines in a file buffer (excluding header).
   * For CSV: count newlines minus 1 (header).
   * For XLSX: returns a stub count (real parsing done in worker).
   */
  async countLines(buffer: Buffer, extension: string): Promise<number> {
    if (extension === '.csv') {
      const content = buffer.toString('utf-8');
      const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
      // Subtract 1 for header row
      return Math.max(0, lines.length - 1);
    }
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!worksheet) return 0;

    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, blankrows: false });
    return Math.max(0, rows.length - 1);
  }

  private getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1) return '';
    return filename.substring(lastDot).toLowerCase();
  }
}

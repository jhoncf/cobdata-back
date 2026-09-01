import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { DeduplicationService } from '../../contracts/deduplication.service';
import { QUEUES } from '../../common/constants/queues';
import { Readable } from 'stream';
import { Decimal } from '@prisma/client/runtime/library';
import * as XLSX from 'xlsx';
import { normalizeColumnMapping, normalizeImportLine } from '../utils/import-line.util';

export interface ApplicationJobData {
  batchId: string;
}

interface LineData {
  [key: string]: string;
}

/**
 * Determines if two values are considered "identical" for the purpose
 * of deciding whether to UPDATE or IGNORE a matched contract.
 */
function valuesAreDifferent(
  existing: {
    debtType: string;
    occurrenceDate: Date;
    originalValue: Decimal;
    updatedValue: Decimal;
    debtOrigin: string | null;
    debtorName: string;
    dueDate: Date | null;
    productName: string | null;
    debtorStreet: string | null;
    debtorAddressNumber: string | null;
    debtorAddressComplement: string | null;
    debtorNeighborhood: string | null;
    debtorCity: string | null;
    debtorState: string | null;
    debtorZipCode: string | null;
    debtorPhone: string | null;
    debtorEmail: string | null;
    cancelledAt: Date | null;
  },
  incoming: {
    debtType: string;
    occurrenceDate: Date;
    originalValue: number;
    updatedValue: number;
    debtOrigin: string | null;
    debtorName: string;
    dueDate: Date | null;
    productName: string | null;
    debtorStreet: string | null;
    debtorAddressNumber: string | null;
    debtorAddressComplement: string | null;
    debtorNeighborhood: string | null;
    debtorCity: string | null;
    debtorState: string | null;
    debtorZipCode: string | null;
    debtorPhone: string | null;
    debtorEmail: string | null;
    cancelledAt: Date | null;
  },
): boolean {
  if (existing.debtType !== incoming.debtType) return true;

  const existingDate = existing.occurrenceDate.toISOString().split('T')[0];
  const incomingDate = incoming.occurrenceDate.toISOString().split('T')[0];
  if (existingDate !== incomingDate) return true;

  if (existing.originalValue.toNumber() !== incoming.originalValue) return true;

  const existingUpdated = existing.updatedValue.toNumber();
  if (existingUpdated !== incoming.updatedValue) return true;

  if ((existing.debtOrigin || null) !== (incoming.debtOrigin || null)) return true;

  const sameDate = (left: Date | null, right: Date | null) =>
    (left?.toISOString().split('T')[0] ?? null) === (right?.toISOString().split('T')[0] ?? null);
  if (!sameDate(existing.dueDate, incoming.dueDate) || !sameDate(existing.cancelledAt, incoming.cancelledAt)) return true;

  for (const field of [
    'debtorName', 'productName', 'debtorStreet', 'debtorAddressNumber',
    'debtorAddressComplement', 'debtorNeighborhood', 'debtorCity', 'debtorState',
    'debtorZipCode', 'debtorPhone', 'debtorEmail',
  ] as const) {
    if ((existing[field] || null) !== (incoming[field] || null)) return true;
  }

  return false;
}

// The apply worker runs long, CPU-bound reconciliations over large portfolios
// (hundreds of thousands of rows). BullMQ's default 30s lock is far too short:
// synchronous parsing/processing blocks the lock-renewal timer and the job is
// wrongly flagged as stalled. A generous lock keeps a single worker owning the
// job while it commits progress in idempotent chunks.
@Processor(QUEUES.IMPORT_APPLICATION, {
  lockDuration: 300_000,
  stalledInterval: 300_000,
  maxStalledCount: 3,
})
export class ApplicationProcessor extends WorkerHost {
  private readonly logger = new Logger(ApplicationProcessor.name);
  private static readonly TRANSACTION_BATCH_SIZE = 250;

  /**
   * Converts a raw import value into a valid Date, or null when the value is
   * empty or cannot be parsed. Dirty portfolio files occasionally carry
   * malformed dates (e.g. "0000-00-00" or partial strings); those must never
   * reach Prisma as an Invalid Date, which would abort the whole batch.
   */
  private static toValidDate(value: unknown): Date | null {
    const raw = typeof value === 'string' ? value.trim() : value;
    if (!raw) return null;
    const parsed = new Date(raw as string);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly deduplicationService: DeduplicationService,
  ) {
    super();
  }

  async process(job: Job<ApplicationJobData>): Promise<void> {
    const { batchId } = job.data;
    this.logger.log(`Starting application for batch ${batchId}`);

    try {
      const batch = await this.prisma.importBatch.findUnique({
        where: { id: batchId },
        include: {
          wallet: { select: { id: true, creditorId: true } },
        },
      });

      if (!batch) {
        this.logger.error(`Batch ${batchId} not found`);
        return;
      }

      // Download and parse file
      const fileStream = await this.storageService.download(batch.fileUrl);
      const fileContent = await this.streamToBuffer(fileStream);
      const columnMapping = batch.columnMapping as Record<string, string>;
      const lines = batch.fileName.toLowerCase().endsWith('.xlsx')
        ? this.parseXlsxLines(fileContent, columnMapping)
        : this.parseCsvLines(fileContent.toString('utf-8'), columnMapping);

      let createdCount = 0;
      let updatedCount = 0;
      let ignoredCount = 0;

      const creditorId = batch.wallet.creditorId;
      const walletId = batch.walletId;
      const accountId = batch.accountId;

      // Large portfolios must not be held in a single interactive transaction:
      // it exceeds the transaction timeout and any restart discards all work.
      // Each committed chunk is idempotent, so BullMQ can safely retry a job.
      const validLines = lines.filter((line) => this.isLineValid(line));
      for (let offset = 0; offset < validLines.length; offset += ApplicationProcessor.TRANSACTION_BATCH_SIZE) {
        const chunk = validLines.slice(offset, offset + ApplicationProcessor.TRANSACTION_BATCH_SIZE);
        await this.prisma.$transaction(async (tx) => {
          for (const line of chunk) {

          // Extract mapped fields
          const debtorDoc = (line['debtorDocument'] || '').replace(/\D/g, '');
          const debtorName = line['debtorName']?.trim() || '';
          const contractNumber = line['contractNumber'] || '';
          const debtType = (line['debtType'] || '').toUpperCase();
          const occurrenceDate = ApplicationProcessor.toValidDate(line['occurrenceDate']);
          const dueDate = ApplicationProcessor.toValidDate(line['dueDate']);
          const originalValue = parseFloat(line['originalValue'] || '0');          const updatedValue = parseFloat(line['updatedValue'] || '');
          const debtOrigin = line['debtOrigin'] || null;
          const productName = line['productName']?.trim() || null;
          const debtorStreet = line['debtorStreet']?.trim() || null;
          const debtorAddressNumber = line['debtorAddressNumber']?.trim() || null;
          const debtorAddressComplement = line['debtorAddressComplement']?.trim() || null;
          const debtorNeighborhood = line['debtorNeighborhood']?.trim() || null;
          const debtorCity = line['debtorCity']?.trim() || null;
          const debtorState = line['debtorState']?.trim() || null;
          const debtorZipCode = line['debtorZipCode']?.trim() || null;
          const debtorPhone = line['debtorPhone']?.trim() || null;
          const debtorEmail = line['debtorEmail']?.trim() || null;
          const cancelledAt = ApplicationProcessor.toValidDate(line['cancelledAt']);

          // occurrenceDate is a required column. A row whose occurrence date
          // cannot be parsed is unusable; skip it instead of aborting the
          // whole batch with a Prisma "Invalid Date" error.
          if (!occurrenceDate) {
            ignoredCount++;
            continue;
          }

          // Compute deduplication key
          const deduplicationKey =
            this.deduplicationService.computeDeduplicationKey({
              creditorId,
              debtorDocument: debtorDoc,
              contractNumber,
              debtOriginDocument: debtOrigin || undefined,
            });
          const debtorDocumentHash =
            this.deduplicationService.sha256(debtorDoc);
          const debtOriginDocHash = debtOrigin
            ? this.deduplicationService.sha256(debtOrigin)
            : null;

          // CPF/CNPJ + contract number + due date identify the same contract.
          // The selected wallet is intentionally not part of this identity: a
          // newer import is allowed to move the contract to another wallet.
          const existingContract = dueDate
            ? await tx.contract.findFirst({
            where: {
              accountId,
              debtorDocumentHash,
              contractNumber,
              dueDate,
              deletedAt: null,
            },
            orderBy: { updatedAt: 'desc' },
            select: {
              id: true,
              walletId: true,
              debtType: true,
              occurrenceDate: true,
              originalValue: true,
              updatedValue: true,
              debtOrigin: true,
              debtorName: true,
              dueDate: true,
              productName: true,
              debtorStreet: true,
              debtorAddressNumber: true,
              debtorAddressComplement: true,
              debtorNeighborhood: true,
              debtorCity: true,
              debtorState: true,
              debtorZipCode: true,
              debtorPhone: true,
              debtorEmail: true,
              cancelledAt: true,
              status: true,
              deletedAt: true,
            },
          })
            : await tx.contract.findUnique({
              where: { deduplicationKey },
              select: {
                id: true, walletId: true, debtType: true, occurrenceDate: true,
                originalValue: true, updatedValue: true, debtOrigin: true,
                debtorName: true, dueDate: true, productName: true, debtorStreet: true,
                debtorAddressNumber: true, debtorAddressComplement: true,
                debtorNeighborhood: true, debtorCity: true, debtorState: true,
                debtorZipCode: true, debtorPhone: true, debtorEmail: true,
                cancelledAt: true, status: true, deletedAt: true,
              },
            });

          if (!existingContract || existingContract.deletedAt) {
            // CREATE: no existing match
            await tx.contract.create({
              data: {
                accountId,
                walletId,
                debtorDocument: debtorDoc,
                debtorDocumentHash,
                debtorName,
                contractNumber,
                debtType: debtType as any,
                occurrenceDate,
                dueDate,
                originalValue,
                updatedValue,
                debtOrigin,
                debtOriginDocHash,
                productName,
                debtorStreet,
                debtorAddressNumber,
                debtorAddressComplement,
                debtorNeighborhood,
                debtorCity,
                debtorState,
                debtorZipCode,
                debtorPhone,
                debtorEmail,
                cancelledAt,
                deduplicationKey,
                serasaStatus: 'NOT_ENABLED',
                paymentStatus: 'OPEN',
                status: 'ACTIVE',
              },
            });
            createdCount++;
          } else if (existingContract.walletId === walletId) {
            // Same wallet: check if values differ
            const incoming = {
              debtType,
              occurrenceDate,
              originalValue,
              updatedValue,
              debtOrigin,
              debtorName,
              dueDate,
              productName,
              debtorStreet,
              debtorAddressNumber,
              debtorAddressComplement,
              debtorNeighborhood,
              debtorCity,
              debtorState,
              debtorZipCode,
              debtorPhone,
              debtorEmail,
              cancelledAt,
            };

            if (
              valuesAreDifferent(
                {
                  debtType: existingContract.debtType,
                  occurrenceDate: existingContract.occurrenceDate,
                  originalValue: existingContract.originalValue,
                  updatedValue: existingContract.updatedValue,
                debtOrigin: existingContract.debtOrigin,
                debtorName: existingContract.debtorName,
                dueDate: existingContract.dueDate,
                productName: existingContract.productName,
                debtorStreet: existingContract.debtorStreet,
                debtorAddressNumber: existingContract.debtorAddressNumber,
                debtorAddressComplement: existingContract.debtorAddressComplement,
                debtorNeighborhood: existingContract.debtorNeighborhood,
                debtorCity: existingContract.debtorCity,
                debtorState: existingContract.debtorState,
                debtorZipCode: existingContract.debtorZipCode,
                debtorPhone: existingContract.debtorPhone,
                debtorEmail: existingContract.debtorEmail,
                cancelledAt: existingContract.cancelledAt,
              },
              incoming,
              )
            ) {
              // UPDATE: match with different values
              const updateData: any = {
                walletId,
                debtorDocument: debtorDoc,
                debtorDocumentHash,
                debtorName,
                contractNumber,
                debtType: debtType as any,
                occurrenceDate,
                dueDate,
                originalValue,
                updatedValue,
                debtOrigin,
                debtOriginDocHash,
                deduplicationKey,
                productName,
                debtorStreet,
                debtorAddressNumber,
                debtorAddressComplement,
                debtorNeighborhood,
                debtorCity,
                debtorState,
                debtorZipCode,
                debtorPhone,
                debtorEmail,
                cancelledAt,
              };

              // Reactivate SUSPENDED/CANCELLED contracts on update
              if (
                existingContract.status === 'SUSPENDED' ||
                existingContract.status === 'CANCELLED'
              ) {
                updateData.status = 'ACTIVE';
              }

              await tx.contract.update({
                where: { id: existingContract.id },
                data: updateData,
              });
              updatedCount++;
            } else {
              // IGNORE: match with identical values
              // Still reactivate if SUSPENDED/CANCELLED
              if (
                existingContract.status === 'SUSPENDED' ||
                existingContract.status === 'CANCELLED'
              ) {
                await tx.contract.update({
                  where: { id: existingContract.id },
                  data: { status: 'ACTIVE' },
                });
                updatedCount++;
              } else {
                ignoredCount++;
              }
            }
          } else {
            // Same identity in another wallet: the latest file is authoritative.
            const updateData: any = {
              walletId,
              debtorDocument: debtorDoc,
              debtorDocumentHash,
              debtorName,
              contractNumber,
              debtType: debtType as any,
              occurrenceDate,
              dueDate,
              originalValue,
              updatedValue,
              debtOrigin,
              debtOriginDocHash,
              productName,
              debtorStreet,
              debtorAddressNumber,
              debtorAddressComplement,
              debtorNeighborhood,
              debtorCity,
              debtorState,
              debtorZipCode,
              debtorPhone,
              debtorEmail,
              cancelledAt,
              deduplicationKey,
            };
            await tx.contract.update({ where: { id: existingContract.id }, data: updateData });
            updatedCount++;
          }
          }
        }, {
          maxWait: 10_000,
          timeout: 120_000,
        });

        // Persist progress after every committed chunk. If a worker is
        // restarted, already committed contracts are reconciled idempotently.
        await this.prisma.importBatch.update({
          where: { id: batchId },
          data: { createdCount, updatedCount, ignoredCount },
        });
      }

      // Update batch counters and set status to APPLIED
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: {
          createdCount,
          updatedCount,
          ignoredCount,
          status: 'APPLIED',
        },
      });

      this.logger.log(
        `Batch ${batchId} application complete: created=${createdCount}, updated=${updatedCount}, ignored=${ignoredCount}`,
      );
    } catch (error) {
      this.logger.error(`Application failed for batch ${batchId}`, error);

      // If all retries exhausted, set status to FAILED
      if (job.attemptsMade >= (job.opts?.attempts ?? 3) - 1) {
        await this.prisma.importBatch.update({
          where: { id: batchId },
          data: { status: 'FAILED' },
        });
      }

      throw error; // Re-throw for BullMQ retry
    }
  }

  /**
   * Check if a line has all required fields (basic validity check).
   * Lines that were marked invalid during validation are excluded.
   */
  private isLineValid(line: LineData): boolean {
    const debtorDoc = (line['debtorDocument'] || '').replace(/\D/g, '');
    if (debtorDoc.length !== 11 && debtorDoc.length !== 14) return false;

    const contractNumber = line['contractNumber'] || '';
    if (!contractNumber.trim()) return false;

    const debtType = (line['debtType'] || '').toUpperCase();
    const validTypes = [
      'COMMERCIAL',
      'BANKING',
      'SERVICES',
      'UTILITIES',
      'TELECOM',
      'EDUCATION',
      'HEALTH',
      'CONDOMINIAL',
      'OTHER',
    ];
    if (!validTypes.includes(debtType)) return false;

    const dateStr = line['occurrenceDate'] || '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;

    const originalValue = parseFloat(line['originalValue'] || '');
    if (isNaN(originalValue) || originalValue < 0.01) return false;

    const updatedValue = parseFloat(line['updatedValue'] || '');
    return !isNaN(updatedValue) && updatedValue >= 0.01;
  }

  /**
   * Parse CSV content into line data objects using column mapping.
   */
  private parseCsvLines(
    content: string,
    columnMapping: Record<string, string>,
  ): LineData[] {
    const rows = content.split(/\r?\n/).filter((row) => row.trim().length > 0);
    if (rows.length < 2) return [];

    const headerRow = rows[0]!;
    const delimiter = this.detectCsvDelimiter(headerRow);
    const headers = this.parseCsvRow(headerRow, delimiter).map((header) =>
      header.replace(/^\uFEFF/, '').trim(),
    );
    const normalizedMapping = normalizeColumnMapping(columnMapping, headers);

    const lines: LineData[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const values = this.parseCsvRow(row, delimiter);
      const lineData: LineData = {};

      for (const [targetField, sourceColumn] of Object.entries(normalizedMapping)) {
        const colIndex = headers.findIndex(
          (h) => h.trim().toLowerCase() === sourceColumn.trim().toLowerCase(),
        );
        if (colIndex !== -1 && colIndex < values.length) {
          lineData[targetField] = (values[colIndex] || '').trim();
        } else {
          lineData[targetField] = '';
        }
      }

      lines.push(normalizeImportLine(lineData));
    }

    return lines;
  }

  private parseXlsxLines(
    buffer: Buffer,
    columnMapping: Record<string, string>,
  ): LineData[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheetName = workbook.SheetNames[0];
    const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!worksheet) return [];

    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      blankrows: false,
      raw: false,
    });
    if (rows.length < 2) return [];

    const headers = (rows[0] ?? []).map((value) => String(value ?? '').trim());
    const normalizedMapping = normalizeColumnMapping(columnMapping, headers);
    const lines: LineData[] = [];

    for (const row of rows.slice(1)) {
      const values = row.map((value) => String(value ?? '').trim());
      if (values.every((value) => value === '')) continue;

      const lineData: LineData = {};
      for (const [targetField, sourceColumn] of Object.entries(normalizedMapping)) {
        const columnIndex = headers.findIndex(
          (header) => header.toLowerCase() === sourceColumn.trim().toLowerCase(),
        );
        lineData[targetField] = columnIndex === -1 ? '' : (values[columnIndex] ?? '');
      }
      lines.push(normalizeImportLine(lineData));
    }

    return lines;
  }

  /**
   * Simple CSV row parser (handles basic quoting).
   */
  private detectCsvDelimiter(headerRow: string): string {
    return [';', ',', '\t', '|'].reduce((best, delimiter) =>
      headerRow.split(delimiter).length > headerRow.split(best).length ? delimiter : best,
    ',');
  }

  private parseCsvRow(row: string, delimiter = ','): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < row.length; i++) {
      const char = row[i]!;
      if (char === '"') {
        if (inQuotes && i + 1 < row.length && row[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}

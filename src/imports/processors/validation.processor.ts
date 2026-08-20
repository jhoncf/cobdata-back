import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { DeduplicationService } from '../../contracts/deduplication.service';
import { QUEUES } from '../../common/constants/queues';
import { Readable } from 'stream';
import * as XLSX from 'xlsx';
import { isValidCpf, isValidCnpj } from '../../common/utils';
import { normalizeColumnMapping, normalizeImportLine } from '../utils/import-line.util';

/** Personal data fields that should be masked in error reports */
const PII_FIELDS = ['debtorDocument', 'cpf', 'cnpj', 'documento'];

/** Required contract fields */
const REQUIRED_FIELDS = [
  'debtorDocument',
  'contractNumber',
  'debtType',
  'occurrenceDate',
  'originalValue',
];

const VALID_DEBT_TYPES = [
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

const CHECK_CANCEL_INTERVAL = 500;

export interface ValidationJobData {
  batchId: string;
}

export interface LineData {
  [key: string]: string;
}

export interface ValidationError {
  lineNumber: number;
  errorCode: string;
  fieldName: string;
  message: string;
  fieldValue?: string;
}

@Processor(QUEUES.IMPORT_VALIDATION)
export class ValidationProcessor extends WorkerHost {
  private readonly logger = new Logger(ValidationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly deduplicationService: DeduplicationService,
  ) {
    super();
  }

  async process(job: Job<ValidationJobData>): Promise<void> {
    const { batchId } = job.data;
    this.logger.log(`Starting validation for batch ${batchId}`);

    try {
      // Update batch to VALIDATING
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: { status: 'VALIDATING' },
      });

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

      // Download file from S3
      const fileStream = await this.storageService.download(batch.fileUrl);
      const fileContent = await this.streamToBuffer(fileStream);
      const columnMapping = batch.columnMapping as Record<string, string>;
      const lines = batch.fileName.toLowerCase().endsWith('.xlsx')
        ? await this.parseXlsxLines(fileContent, columnMapping)
        : this.parseCsvLines(fileContent.toString('utf-8'), columnMapping);

      let validLines = 0;
      let invalidLines = 0;
      const errors: ValidationError[] = [];

      for (let i = 0; i < lines.length; i++) {
        // Check cancel every 500 lines
        if (i > 0 && i % CHECK_CANCEL_INTERVAL === 0) {
          const currentBatch = await this.prisma.importBatch.findUnique({
            where: { id: batchId },
            select: { status: true },
          });
          if (currentBatch?.status === 'CANCELLED') {
            this.logger.log(`Batch ${batchId} cancelled, aborting at line ${i}`);
            break;
          }
        }

        const lineNumber = i + 2; // +2 because 1-indexed and header is line 1
        const currentLine = lines[i];
        if (!currentLine) continue;

        const lineErrors = await this.validateLine(
          currentLine,
          lineNumber,
          batch.wallet.creditorId,
          batch.walletId,
        );

        if (lineErrors.length === 0) {
          validLines++;
        } else {
          invalidLines++;
          errors.push(...lineErrors);
        }
      }

      // Store errors in batch
      if (errors.length > 0) {
        await this.prisma.importBatchError.createMany({
          data: errors.map((err) => ({
            batchId,
            lineNumber: err.lineNumber,
            errorCode: err.errorCode,
            fieldName: err.fieldName,
            message: err.message,
            fieldValue: err.fieldValue
              ? this.maskFieldValue(err.fieldName, err.fieldValue)
              : null,
          })),
        });
      }

      // Check final status (might have been cancelled during processing)
      const finalBatch = await this.prisma.importBatch.findUnique({
        where: { id: batchId },
        select: { status: true },
      });

      if (finalBatch?.status === 'CANCELLED') {
        // Preserve partial results but don't change status
        await this.prisma.importBatch.update({
          where: { id: batchId },
          data: { validLines, invalidLines },
        });
        return;
      }

      // Update batch with results
      const finalStatus = invalidLines > 0 ? 'VALIDATED_WITH_ERRORS' : 'VALIDATED';
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: {
          validLines,
          invalidLines,
          status: finalStatus,
        },
      });

      this.logger.log(
        `Batch ${batchId} validation complete: ${validLines} valid, ${invalidLines} invalid`,
      );
    } catch (error) {
      this.logger.error(`Validation failed for batch ${batchId}`, error);
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: { status: 'VALIDATION_FAILED' },
      });
    }
  }

  /**
   * Validate a single import line.
   * Returns an array of errors (empty means line is valid).
   */
  async validateLine(
    line: LineData,
    lineNumber: number,
    creditorId: string,
    batchWalletId: string,
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    // Check required fields
    for (const field of REQUIRED_FIELDS) {
      const value = line[field] || '';
      if (value.trim() === '') {
        errors.push({
          lineNumber,
          errorCode: 'REQUIRED_FIELD',
          fieldName: field,
          message: `Campo obrigatório '${field}' não informado`,
          fieldValue: line[field],
        });
      }
    }

    // If required fields are missing, skip further validation
    if (errors.length > 0) {
      return errors;
    }

    // Validate debtorDocument (CPF: 11 digits, CNPJ: 14 digits)
    const debtorDoc = line['debtorDocument'] || '';
    const doc = debtorDoc.replace(/\D/g, '');
    if (doc.length !== 11 && doc.length !== 14) {
      errors.push({
        lineNumber,
        errorCode: 'INVALID_FORMAT',
        fieldName: 'debtorDocument',
        message: 'Documento do devedor deve ter 11 (CPF) ou 14 (CNPJ) dígitos',
        fieldValue: line['debtorDocument'],
      });
    } else if (doc.length === 11 && !isValidCpf(doc)) {
      errors.push({
        lineNumber,
        errorCode: 'INVALID_FORMAT',
        fieldName: 'debtorDocument',
        message: 'CPF com dígito verificador inválido',
        fieldValue: line['debtorDocument'],
      });
    } else if (doc.length === 14 && !isValidCnpj(doc)) {
      errors.push({
        lineNumber,
        errorCode: 'INVALID_FORMAT',
        fieldName: 'debtorDocument',
        message: 'CNPJ com dígito verificador inválido',
        fieldValue: line['debtorDocument'],
      });
    }

    // Validate contractNumber (max 100 chars)
    const contractNumber = line['contractNumber'] || '';
    if (contractNumber.length > 100) {
      errors.push({
        lineNumber,
        errorCode: 'INVALID_FORMAT',
        fieldName: 'contractNumber',
        message: 'Número do contrato deve ter no máximo 100 caracteres',
        fieldValue: line['contractNumber'],
      });
    }

    // Validate debtType
    const debtType = line['debtType'] || '';
    if (!VALID_DEBT_TYPES.includes(debtType.toUpperCase())) {
      errors.push({
        lineNumber,
        errorCode: 'INVALID_FORMAT',
        fieldName: 'debtType',
        message: `Tipo de dívida inválido. Valores aceitos: ${VALID_DEBT_TYPES.join(', ')}`,
        fieldValue: line['debtType'],
      });
    }

    // Validate occurrenceDate (ISO 8601, not future)
    const dateStr = line['occurrenceDate'] || '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      errors.push({
        lineNumber,
        errorCode: 'INVALID_FORMAT',
        fieldName: 'occurrenceDate',
        message: 'Data de ocorrência em formato inválido',
        fieldValue: line['occurrenceDate'],
      });
    } else if (date > new Date()) {
      errors.push({
        lineNumber,
        errorCode: 'INVALID_RANGE',
        fieldName: 'occurrenceDate',
        message: 'Data de ocorrência não pode ser futura',
        fieldValue: line['occurrenceDate'],
      });
    }

    // Validate originalValue (0.01 to 999999999.99)
    const originalValueStr = line['originalValue'] || '';
    const originalValue = parseFloat(originalValueStr);
    if (isNaN(originalValue) || originalValue < 0.01 || originalValue > 999999999.99) {
      errors.push({
        lineNumber,
        errorCode: 'INVALID_RANGE',
        fieldName: 'originalValue',
        message: 'Valor original deve estar entre 0.01 e 999.999.999,99',
        fieldValue: line['originalValue'],
      });
    }

    // Validate updatedValue if present
    const updatedValueStr = line['updatedValue'] || '';
    if (updatedValueStr.trim() !== '') {
      const updatedValue = parseFloat(updatedValueStr);
      if (isNaN(updatedValue) || updatedValue < 0.01 || updatedValue > 999999999.99) {
        errors.push({
          lineNumber,
          errorCode: 'INVALID_RANGE',
          fieldName: 'updatedValue',
          message: 'Valor atualizado deve estar entre 0.01 e 999.999.999,99',
          fieldValue: line['updatedValue'],
        });
      } else if (updatedValue < originalValue) {
        errors.push({
          lineNumber,
          errorCode: 'INVALID_RANGE',
          fieldName: 'updatedValue',
          message: 'Valor atualizado deve ser maior ou igual ao valor original',
          fieldValue: line['updatedValue'],
        });
      }
    }

    // Stop if format/range errors found before checking dedup
    if (errors.length > 0) {
      return errors;
    }

    // Check deduplication conflicts
    const deduplicationKey = this.deduplicationService.computeDeduplicationKey({
      creditorId,
      debtorDocument: doc,
      contractNumber,
      debtOriginDocument: line['debtOrigin'] || undefined,
    });

    const existingContract = await this.prisma.contract.findUnique({
      where: { deduplicationKey },
      select: { id: true, walletId: true, providerStatus: true, deletedAt: true },
    });

    if (existingContract && !existingContract.deletedAt) {
      // Check WALLET_MISMATCH
      if (existingContract.walletId !== batchWalletId) {
        errors.push({
          lineNumber,
          errorCode: 'WALLET_MISMATCH',
          fieldName: 'walletId',
          message: 'Contrato já existe em outra wallet',
          fieldValue: existingContract.walletId,
        });
      }
      // Check PROVIDER_CONFLICT
      else {
        const nonConflictStatuses = ['PENDING', 'FAILED', 'REMOVED'];
        if (!nonConflictStatuses.includes(existingContract.providerStatus)) {
          errors.push({
            lineNumber,
            errorCode: 'PROVIDER_CONFLICT',
            fieldName: 'providerStatus',
            message: `Contrato existente possui providerStatus '${existingContract.providerStatus}' incompatível com importação`,
            fieldValue: existingContract.providerStatus,
          });
        }
      }
    }

    return errors;
  }

  /**
   * Parse CSV content into line data objects using column mapping.
   */
  parseCsvLines(content: string, columnMapping: Record<string, string>): LineData[] {
    const rows = content.split(/\r?\n/).filter((row) => row.trim().length > 0);
    if (rows.length < 2) return []; // Only header or empty

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

  async parseXlsxLines(buffer: Buffer, columnMapping: Record<string, string>): Promise<LineData[]> {
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
          i++; // skip next quote
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

  /**
   * Mask field value for PII fields (show only last 4 characters).
   */
  private maskFieldValue(fieldName: string, value: string): string {
    const isPii = PII_FIELDS.some(
      (f) => fieldName.toLowerCase().includes(f.toLowerCase()),
    );
    if (isPii && value.length > 4) {
      return '****' + value.slice(-4);
    }
    return value;
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}

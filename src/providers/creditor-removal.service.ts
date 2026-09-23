import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Contract, ContractStatus, CreditorRemovalBatchStatus, PaymentStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import * as XLSX from 'xlsx';
import { QUEUES } from '../common/constants/queues';
import { StorageService } from '../common/storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { OperationsService } from './operations.service';

type RemovalRow = { line: number; contractNumber: string; debtorDocument: string };
type Mapping = Record<'contractNumber' | 'debtorDocument', string>;
type RemovalJob = { batchId: string };

@Injectable()
export class CreditorRemovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operations: OperationsService,
    private readonly storage: StorageService,
    @InjectQueue(QUEUES.CREDITOR_REMOVAL) private readonly queue: Queue<RemovalJob>,
  ) {}

  private parseMapping(raw?: string): Mapping {
    try {
      const mapping = JSON.parse(raw ?? '{}'); const fields = ['contractNumber', 'debtorDocument'] as const;
      if (fields.some((field) => typeof mapping[field] !== 'string' || !mapping[field].trim())) throw new Error();
      return mapping;
    } catch { throw new UnprocessableEntityException('Mapeie número do contrato e CPF/CNPJ.'); }
  }

  private rows(buffer: Buffer, fileName: string, mapping: Mapping): { rows: RemovalRow[]; invalidLines: number } {
    if (!buffer.length) throw new UnprocessableEntityException('Selecione um arquivo CSV ou XLSX.');
    if (!/\.(csv|xlsx)$/i.test(fileName)) throw new UnprocessableEntityException('Use um arquivo CSV ou XLSX.');
    let sheet: XLSX.WorkSheet;
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true });
      const name = workbook.SheetNames[0]; if (!name || !workbook.Sheets[name]) throw new Error();
      sheet = workbook.Sheets[name];
    } catch { throw new UnprocessableEntityException('Não foi possível ler o arquivo.'); }
    const ref = sheet['!ref']; if (!ref) throw new UnprocessableEntityException('O arquivo não possui dados.');
    const range = XLSX.utils.decode_range(ref);
    const valueAt = (row: number, column: number) => sheet[XLSX.utils.encode_cell({ r: row, c: column })]?.v ?? '';
    const index = (field: keyof Mapping) => {
      for (let column = range.s.c; column <= range.e.c; column += 1) if (String(valueAt(range.s.r, column)).trim() === mapping[field].trim()) return column;
      return -1;
    };
    const indexes = { contractNumber: index('contractNumber'), debtorDocument: index('debtorDocument') };
    if (Object.values(indexes).some((value) => value < 0)) throw new UnprocessableEntityException('O mapeamento não corresponde ao cabeçalho do arquivo.');
    const rows: RemovalRow[] = []; let invalidLines = 0;
    for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
      const contractNumber = String(valueAt(row, indexes.contractNumber) ?? '').trim();
      const debtorDocument = String(valueAt(row, indexes.debtorDocument) ?? '').replace(/\D/g, '');
      if (!contractNumber || ![11, 14].includes(debtorDocument.length)) { invalidLines += 1; continue; }
      rows.push({ line: row + 1, contractNumber, debtorDocument });
    }
    return { rows, invalidLines };
  }

  private async resolve(rows: RemovalRow[], accountId: string, creditorId: string) {
    const pairs = [...new Map(rows.map((row) => [`${row.contractNumber}|${row.debtorDocument}`, row])).values()];
    const contracts: Array<Pick<Contract, 'id' | 'contractNumber' | 'debtorDocument' | 'status' | 'paymentStatus'>> = [];
    for (let offset = 0; offset < pairs.length; offset += 2000) {
      const batch = pairs.slice(offset, offset + 2000);
      contracts.push(...await this.prisma.contract.findMany({ where: {
        accountId, deletedAt: null, wallet: { creditorId },
        contractNumber: { in: [...new Set(batch.map((row) => row.contractNumber))] },
        debtorDocument: { in: [...new Set(batch.map((row) => row.debtorDocument))] },
      }, select: { id: true, contractNumber: true, debtorDocument: true, status: true, paymentStatus: true } }));
    }
    const byKey = new Map(contracts.map((contract) => [`${contract.contractNumber}|${contract.debtorDocument}`, contract]));
    const matched = new Map<string, Pick<Contract, 'id' | 'contractNumber' | 'debtorDocument'>>(); let unmatched = 0; let blocked = 0; let duplicateLines = 0;
    for (const row of rows) {
      const contract = byKey.get(`${row.contractNumber}|${row.debtorDocument}`);
      if (!contract) { unmatched += 1; continue; }
      if (contract.status === ContractStatus.CANCELLED || contract.paymentStatus === PaymentStatus.PAID) { blocked += 1; continue; }
      if (matched.has(contract.id)) { duplicateLines += 1; continue; }
      matched.set(contract.id, contract);
    }
    return { matched: [...matched.values()], unmatched, blocked, duplicateLines };
  }

  async createPreview(file: Express.Multer.File, mappingRaw: string | undefined, accountId: string, userId: string, creditorId?: string | null) {
    if (!creditorId) throw new UnprocessableEntityException('Este recurso está disponível somente para usuários de credor.');
    if (!file?.buffer?.length || file.size > 100 * 1024 * 1024) throw new UnprocessableEntityException('Selecione um arquivo de até 100 MB.');
    const mapping = this.parseMapping(mappingRaw);
    if (!/\.(csv|xlsx)$/i.test(file.originalname)) throw new UnprocessableEntityException('Use um arquivo CSV ou XLSX.');
    const fileUrl = `creditor-removals/${accountId}/${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await this.storage.upload(fileUrl, file.buffer, file.mimetype);
    const batch = await this.prisma.creditorRemovalBatch.create({ data: { accountId, creditorId, userId, fileName: file.originalname, fileUrl, columnMapping: mapping } });
    await this.queue.add('validate', { batchId: batch.id }, { attempts: 2, backoff: { type: 'exponential', delay: 5000 } });
    return this.view(batch);
  }

  async list(accountId: string, creditorId?: string | null) {
    if (!creditorId) throw new UnprocessableEntityException('Este recurso está disponível somente para usuários de credor.');
    const batches = await this.prisma.creditorRemovalBatch.findMany({ where: { accountId, creditorId }, orderBy: { createdAt: 'desc' }, take: 30 });
    return batches.map((batch) => this.view(batch));
  }

  async confirm(batchId: string, accountId: string, creditorId?: string | null) {
    if (!creditorId) throw new UnprocessableEntityException('Este recurso está disponível somente para usuários de credor.');
    const batch = await this.prisma.creditorRemovalBatch.findFirst({ where: { id: batchId, accountId, creditorId } });
    if (!batch) throw new NotFoundException('Lote não encontrado.');
    if (batch.status === CreditorRemovalBatchStatus.APPLYING || batch.status === CreditorRemovalBatchStatus.COMPLETED) return this.view(batch);
    if (batch.status !== CreditorRemovalBatchStatus.READY) throw new ConflictException('Aguarde a conferência do arquivo terminar antes de confirmar.');
    const updated = await this.prisma.creditorRemovalBatch.update({ where: { id: batch.id }, data: { status: CreditorRemovalBatchStatus.APPLYING, errorMessage: null } });
    await this.queue.add('apply', { batchId }, { attempts: 3, backoff: { type: 'exponential', delay: 10000 } });
    return this.view(updated);
  }

  async validateInBackground(batchId: string) {
    await this.prisma.creditorRemovalBatch.update({ where: { id: batchId }, data: { status: CreditorRemovalBatchStatus.VALIDATING, errorMessage: null } });
    const batch = await this.prisma.creditorRemovalBatch.findUniqueOrThrow({ where: { id: batchId } });
    try {
      const stream = await this.storage.download(batch.fileUrl); const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const parsed = this.rows(Buffer.concat(chunks), batch.fileName, batch.columnMapping as Mapping);
      const result = await this.resolve(parsed.rows, batch.accountId, batch.creditorId);
      await this.prisma.creditorRemovalBatch.update({ where: { id: batchId }, data: {
        status: CreditorRemovalBatchStatus.READY, totalLines: parsed.rows.length + parsed.invalidLines, validLines: parsed.rows.length, invalidLines: parsed.invalidLines,
        matchedCount: result.matched.length, unmatchedCount: result.unmatched, blockedCount: result.blocked, duplicateLines: result.duplicateLines,
        contractIds: result.matched.map((contract) => contract.id),
      } });
    } catch (error) {
      await this.prisma.creditorRemovalBatch.update({ where: { id: batchId }, data: { status: CreditorRemovalBatchStatus.FAILED, errorMessage: error instanceof Error ? error.message : 'Não foi possível conferir o arquivo.' } });
      throw error;
    }
  }

  async applyInBackground(batchId: string) {
    const batch = await this.prisma.creditorRemovalBatch.findUniqueOrThrow({ where: { id: batchId } });
    const contractIds = Array.isArray(batch.contractIds) ? batch.contractIds.filter((id): id is string => typeof id === 'string') : [];
    let cancelledCount = batch.cancelledCount; let queuedForSerasaRemoval = batch.queuedForSerasaRemoval;
    try {
      for (let index = cancelledCount; index < contractIds.length; index += 1) {
        const contractId = contractIds[index];
        if (!contractId) continue;
        const cancelled = await this.operations.cancelContract(contractId, batch.userId, batch.accountId, batch.creditorId);
        cancelledCount += 1; if (cancelled.serasaRemovalQueued) queuedForSerasaRemoval += 1;
        if (cancelledCount % 25 === 0 || cancelledCount === contractIds.length) await this.prisma.creditorRemovalBatch.update({ where: { id: batchId }, data: { cancelledCount, queuedForSerasaRemoval } });
      }
      await this.prisma.creditorRemovalBatch.update({ where: { id: batchId }, data: { status: CreditorRemovalBatchStatus.COMPLETED, cancelledCount, queuedForSerasaRemoval } });
    } catch (error) {
      await this.prisma.creditorRemovalBatch.update({ where: { id: batchId }, data: { status: CreditorRemovalBatchStatus.FAILED, cancelledCount, queuedForSerasaRemoval, errorMessage: error instanceof Error ? error.message : 'Falha ao remover contratos.' } });
      throw error;
    }
  }

  private view(batch: { id: string; status: CreditorRemovalBatchStatus; fileName: string; totalLines: number; validLines: number; invalidLines: number; matchedCount: number; unmatchedCount: number; blockedCount: number; duplicateLines: number; cancelledCount: number; queuedForSerasaRemoval: number; errorMessage: string | null; createdAt: Date; updatedAt: Date }) {
    return { id: batch.id, status: batch.status, fileName: batch.fileName, totalLines: batch.totalLines, validLines: batch.validLines, invalidLines: batch.invalidLines, matchedCount: batch.matchedCount, unmatchedCount: batch.unmatchedCount, blockedCount: batch.blockedCount, duplicateLines: batch.duplicateLines, cancelledCount: batch.cancelledCount, queuedForSerasaRemoval: batch.queuedForSerasaRemoval, errorMessage: batch.errorMessage, createdAt: batch.createdAt, updatedAt: batch.updatedAt };
  }
}

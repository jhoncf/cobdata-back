import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Contract, ContractStatus, PaymentStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { OperationsService } from './operations.service';

type RemovalRow = { line: number; contractNumber: string; debtorDocument: string; value: number; occurrenceDate: string };
type Mapping = Record<'contractNumber' | 'debtorDocument' | 'value' | 'occurrenceDate', string>;

@Injectable()
export class CreditorRemovalService {
  constructor(private readonly prisma: PrismaService, private readonly operations: OperationsService) {}

  private parseMapping(raw?: string): Mapping {
    try {
      const mapping = JSON.parse(raw ?? '{}');
      const fields = ['contractNumber', 'debtorDocument', 'value', 'occurrenceDate'] as const;
      if (fields.some((field) => typeof mapping[field] !== 'string' || !mapping[field].trim())) throw new Error();
      return mapping;
    } catch { throw new UnprocessableEntityException('Mapeie número do contrato, CPF, valor da dívida e data da dívida.'); }
  }

  private date(value: unknown): string | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    const text = String(value ?? '').trim();
    const br = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    return null;
  }

  private amount(value: unknown): number | null {
    const text = String(value ?? '').replace(/R\$/gi, '').trim();
    if (!text) return null;
    const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
  }

  private rows(file: Express.Multer.File, mapping: Mapping): { rows: RemovalRow[]; invalidLines: number } {
    if (!file?.buffer?.length) throw new UnprocessableEntityException('Selecione um arquivo CSV ou XLSX.');
    if (!/\.(csv|xlsx)$/i.test(file.originalname)) throw new UnprocessableEntityException('Use um arquivo CSV ou XLSX.');
    if (file.size > 100 * 1024 * 1024) throw new UnprocessableEntityException('O arquivo excede o limite de 100 MB.');
    let sheet: unknown[][];
    try {
      const workbook = XLSX.read(file.buffer, { type: 'buffer', cellDates: true, raw: false });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error();
      const firstSheet = workbook.Sheets[sheetName];
      if (!firstSheet) throw new Error();
      sheet = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: '' });
    } catch { throw new UnprocessableEntityException('Não foi possível ler o arquivo.'); }
    const [headers = [], ...data] = sheet;
    const index = (field: keyof Mapping) => headers.findIndex((header) => String(header).trim() === mapping[field].trim());
    const indexes = { contractNumber: index('contractNumber'), debtorDocument: index('debtorDocument'), value: index('value'), occurrenceDate: index('occurrenceDate') };
    if (Object.values(indexes).some((value) => value < 0)) throw new UnprocessableEntityException('O mapeamento não corresponde ao cabeçalho do arquivo.');
    let invalidLines = 0;
    const rows = data.flatMap((row, offset) => {
      const contractNumber = String(row[indexes.contractNumber] ?? '').trim();
      const debtorDocument = String(row[indexes.debtorDocument] ?? '').replace(/\D/g, '');
      const value = this.amount(row[indexes.value]);
      const occurrenceDate = this.date(row[indexes.occurrenceDate]);
      if (!contractNumber || ![11, 14].includes(debtorDocument.length) || value === null || !occurrenceDate) { invalidLines++; return []; }
      return [{ line: offset + 2, contractNumber, debtorDocument, value, occurrenceDate }];
    });
    return { rows, invalidLines };
  }

  private async resolve(rows: RemovalRow[], accountId: string, creditorId: string) {
    const pairs = [...new Map(rows.map((row) => [`${row.contractNumber}|${row.debtorDocument}`, row])).values()];
    const contracts: Array<Pick<Contract, 'id' | 'contractNumber' | 'debtorDocument' | 'updatedValue' | 'occurrenceDate' | 'status' | 'paymentStatus'>> = [];
    for (let offset = 0; offset < pairs.length; offset += 200) {
      contracts.push(...await this.prisma.contract.findMany({
        where: { accountId, deletedAt: null, wallet: { creditorId }, OR: pairs.slice(offset, offset + 200).map((row) => ({ contractNumber: row.contractNumber, debtorDocument: row.debtorDocument })) },
        select: { id: true, contractNumber: true, debtorDocument: true, updatedValue: true, occurrenceDate: true, status: true, paymentStatus: true },
      }));
    }
    const contractByKey = new Map(contracts.map((contract) => [`${contract.contractNumber}|${contract.debtorDocument}`, contract]));
    const matched = new Map<string, Contract>();
    let unmatched = 0; let blocked = 0; let duplicateLines = 0;
    for (const row of rows) {
      const contract = contractByKey.get(`${row.contractNumber}|${row.debtorDocument}`);
      const equal = contract && Number(contract.updatedValue) === row.value && contract.occurrenceDate.toISOString().slice(0, 10) === row.occurrenceDate;
      if (!equal) { unmatched++; continue; }
      if (contract.status === ContractStatus.CANCELLED || contract.paymentStatus === PaymentStatus.PAID) { blocked++; continue; }
      if (matched.has(contract.id)) { duplicateLines++; continue; }
      matched.set(contract.id, contract as Contract);
    }
    return { matched: [...matched.values()], unmatched, blocked, duplicateLines };
  }

  async preview(file: Express.Multer.File, mappingRaw: string | undefined, accountId: string, creditorId?: string | null) {
    if (!creditorId) throw new UnprocessableEntityException('Este recurso está disponível somente para usuários de credor.');
    const { rows, invalidLines } = this.rows(file, this.parseMapping(mappingRaw));
    const result = await this.resolve(rows, accountId, creditorId);
    return { totalLines: rows.length + invalidLines, validLines: rows.length, invalidLines, matchedCount: result.matched.length, unmatchedCount: result.unmatched, blockedCount: result.blocked, duplicateLines: result.duplicateLines, samples: result.matched.slice(0, 5).map((contract) => ({ contractNumber: contract.contractNumber, debtorDocument: contract.debtorDocument, updatedValue: contract.updatedValue, occurrenceDate: contract.occurrenceDate })) };
  }

  async confirm(file: Express.Multer.File, mappingRaw: string | undefined, accountId: string, userId: string, creditorId?: string | null) {
    if (!creditorId) throw new UnprocessableEntityException('Este recurso está disponível somente para usuários de credor.');
    const { rows, invalidLines } = this.rows(file, this.parseMapping(mappingRaw));
    const result = await this.resolve(rows, accountId, creditorId);
    let cancelledCount = 0; let queuedForSerasaRemoval = 0;
    for (const contract of result.matched) {
      const cancelled = await this.operations.cancelContract(contract.id, userId, accountId, creditorId);
      cancelledCount++;
      if (cancelled.serasaRemovalQueued) queuedForSerasaRemoval++;
    }
    return { totalLines: rows.length + invalidLines, cancelledCount, queuedForSerasaRemoval, unmatchedCount: result.unmatched, blockedCount: result.blocked, duplicateLines: result.duplicateLines, invalidLines };
  }
}

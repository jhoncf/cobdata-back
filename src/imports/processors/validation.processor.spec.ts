import { Test, TestingModule } from '@nestjs/testing';
import { ValidationProcessor, LineData } from './validation.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { DeduplicationService } from '../../contracts/deduplication.service';
import * as XLSX from 'xlsx';

describe('ValidationProcessor', () => {
  let processor: ValidationProcessor;
  let prisma: any;
  let storageService: any;
  let deduplicationService: any;

  beforeEach(async () => {
    prisma = {
      importBatch: {
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      importBatchError: {
        createMany: jest.fn(),
      },
      contract: {
        findUnique: jest.fn(),
      },
    };

    storageService = {
      download: jest.fn(),
    };

    deduplicationService = {
      computeDeduplicationKey: jest.fn().mockReturnValue('dedup-key-123'),
      sha256: jest.fn().mockReturnValue('hash-value'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidationProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storageService },
        { provide: DeduplicationService, useValue: deduplicationService },
      ],
    }).compile();

    processor = module.get<ValidationProcessor>(ValidationProcessor);
  });

  describe('validateLine', () => {
    const validLine: LineData = {
      debtorDocument: '12345678901',
      contractNumber: 'C001',
      debtType: 'COMMERCIAL',
      occurrenceDate: '2023-01-01',
      originalValue: '100.00',
    };

    it('should return empty errors for a valid line', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      const errors = await processor.validateLine(
        validLine,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors).toHaveLength(0);
    });

    it('should return REQUIRED_FIELD error when debtorDocument is missing', async () => {
      const line = { ...validLine, debtorDocument: '' };

      const errors = await processor.validateLine(
        line,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]!.errorCode).toBe('REQUIRED_FIELD');
      expect(errors[0]!.fieldName).toBe('debtorDocument');
    });

    it('should return REQUIRED_FIELD error when contractNumber is missing', async () => {
      const line = { ...validLine, contractNumber: '' };

      const errors = await processor.validateLine(
        line,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]!.errorCode).toBe('REQUIRED_FIELD');
      expect(errors[0]!.fieldName).toBe('contractNumber');
    });

    it('should return REQUIRED_FIELD error when debtType is missing', async () => {
      const line = { ...validLine, debtType: '' };

      const errors = await processor.validateLine(
        line,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]!.errorCode).toBe('REQUIRED_FIELD');
      expect(errors[0]!.fieldName).toBe('debtType');
    });

    it('should return INVALID_FORMAT for document with wrong length', async () => {
      const line = { ...validLine, debtorDocument: '123' };

      const errors = await processor.validateLine(
        line,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors.some((e) => e.errorCode === 'INVALID_FORMAT' && e.fieldName === 'debtorDocument')).toBe(true);
    });

    it('should accept 11-digit CPF', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);
      const line = { ...validLine, debtorDocument: '12345678901' };

      const errors = await processor.validateLine(
        line,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors).toHaveLength(0);
    });

    it('should accept 14-digit CNPJ', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);
      const line = { ...validLine, debtorDocument: '12345678000195' };

      const errors = await processor.validateLine(
        line,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors).toHaveLength(0);
    });

    it('should return INVALID_FORMAT for invalid debtType', async () => {
      const line = { ...validLine, debtType: 'UNKNOWN_TYPE' };

      const errors = await processor.validateLine(
        line,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors.some((e) => e.errorCode === 'INVALID_FORMAT' && e.fieldName === 'debtType')).toBe(true);
    });

    it('should return INVALID_FORMAT for invalid date', async () => {
      const line = { ...validLine, occurrenceDate: 'not-a-date' };

      const errors = await processor.validateLine(
        line,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors.some((e) => e.errorCode === 'INVALID_FORMAT' && e.fieldName === 'occurrenceDate')).toBe(true);
    });

    it('should return INVALID_RANGE for future date', async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      const line = { ...validLine, occurrenceDate: futureDate.toISOString() };

      const errors = await processor.validateLine(
        line,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors.some((e) => e.errorCode === 'INVALID_RANGE' && e.fieldName === 'occurrenceDate')).toBe(true);
    });

    it('should return INVALID_RANGE for originalValue below 0.01', async () => {
      const line = { ...validLine, originalValue: '0' };

      const errors = await processor.validateLine(
        line,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors.some((e) => e.errorCode === 'INVALID_RANGE' && e.fieldName === 'originalValue')).toBe(true);
    });

    it('should return INVALID_RANGE for originalValue above limit', async () => {
      const line = { ...validLine, originalValue: '9999999999.99' };

      const errors = await processor.validateLine(
        line,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors.some((e) => e.errorCode === 'INVALID_RANGE' && e.fieldName === 'originalValue')).toBe(true);
    });

    it('should return INVALID_RANGE when updatedValue < originalValue', async () => {
      const line = { ...validLine, originalValue: '200.00', updatedValue: '100.00' };

      const errors = await processor.validateLine(
        line,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors.some((e) => e.errorCode === 'INVALID_RANGE' && e.fieldName === 'updatedValue')).toBe(true);
    });

    it('should return WALLET_MISMATCH when contract exists in different wallet', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'contract-1',
        walletId: 'other-wallet',
        providerStatus: 'PENDING',
        deletedAt: null,
      });

      const errors = await processor.validateLine(
        validLine,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]!.errorCode).toBe('WALLET_MISMATCH');
    });

    it('should return PROVIDER_CONFLICT when contract has non-compatible providerStatus', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'contract-1',
        walletId: 'wallet-id',
        providerStatus: 'REGISTERED',
        deletedAt: null,
      });

      const errors = await processor.validateLine(
        validLine,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]!.errorCode).toBe('PROVIDER_CONFLICT');
    });

    it('should not conflict when existing contract has PENDING status', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'contract-1',
        walletId: 'wallet-id',
        providerStatus: 'PENDING',
        deletedAt: null,
      });

      const errors = await processor.validateLine(
        validLine,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors).toHaveLength(0);
    });

    it('should not conflict when existing contract has FAILED status', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'contract-1',
        walletId: 'wallet-id',
        providerStatus: 'FAILED',
        deletedAt: null,
      });

      const errors = await processor.validateLine(
        validLine,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors).toHaveLength(0);
    });

    it('should not conflict when existing contract has REMOVED status', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'contract-1',
        walletId: 'wallet-id',
        providerStatus: 'REMOVED',
        deletedAt: null,
      });

      const errors = await processor.validateLine(
        validLine,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors).toHaveLength(0);
    });

    it('should ignore soft-deleted existing contracts', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'contract-1',
        walletId: 'other-wallet',
        providerStatus: 'REGISTERED',
        deletedAt: new Date(),
      });

      const errors = await processor.validateLine(
        validLine,
        2,
        'creditor-id',
        'wallet-id',
      );

      expect(errors).toHaveLength(0);
    });
  });

  describe('parseCsvLines', () => {
    it('should parse CSV with column mapping', () => {
      const content = 'cpf,numero,tipo,data,valor\n12345678901,C001,COMMERCIAL,2023-01-01,100.00\n';
      const mapping = {
        debtorDocument: 'cpf',
        contractNumber: 'numero',
        debtType: 'tipo',
        occurrenceDate: 'data',
        originalValue: 'valor',
      };

      const lines = processor.parseCsvLines(content, mapping);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.debtorDocument).toBe('12345678901');
      expect(lines[0]!.contractNumber).toBe('C001');
      expect(lines[0]!.debtType).toBe('COMMERCIAL');
    });

    it('should return empty array for header-only CSV', () => {
      const content = 'cpf,numero\n';
      const mapping = { debtorDocument: 'cpf', contractNumber: 'numero' };

      const lines = processor.parseCsvLines(content, mapping);
      expect(lines).toHaveLength(0);
    });

    it('should handle case-insensitive column matching', () => {
      const content = 'CPF,Numero\n12345678901,C001\n';
      const mapping = { debtorDocument: 'cpf', contractNumber: 'numero' };

      const lines = processor.parseCsvLines(content, mapping);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.debtorDocument).toBe('12345678901');
    });

    it('should handle quoted fields in CSV', () => {
      const content = 'cpf,nome\n12345678901,"Nome, com virgula"\n';
      const mapping = { debtorDocument: 'cpf', name: 'nome' };

      const lines = processor.parseCsvLines(content, mapping);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.name).toBe('Nome, com virgula');
    });
  });

  describe('parseXlsxLines', () => {
    it('should parse XLSX rows using the front-end column mapping direction', async () => {
      const worksheet = XLSX.utils.aoa_to_sheet([['CPF', 'NUM_ADM'], ['12345678901', 'C001']]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Contracts');
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      const lines = await processor.parseXlsxLines(buffer, {
        CPF: 'debtorDocument',
        NUM_ADM: 'contractNumber',
      });

      expect(lines).toEqual([{ debtorDocument: '12345678901', contractNumber: 'C001' }]);
    });
  });
});

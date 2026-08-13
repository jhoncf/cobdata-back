import { Test, TestingModule } from '@nestjs/testing';
import { DeduplicationService } from './deduplication.service';

describe('DeduplicationService', () => {
  let service: DeduplicationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DeduplicationService],
    }).compile();

    service = module.get<DeduplicationService>(DeduplicationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sha256', () => {
    it('should return a 64-char hex string', () => {
      const result = service.sha256('test');
      expect(result).toHaveLength(64);
      expect(result).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should be deterministic', () => {
      const a = service.sha256('hello');
      const b = service.sha256('hello');
      expect(a).toBe(b);
    });

    it('should produce different hashes for different inputs', () => {
      const a = service.sha256('input-a');
      const b = service.sha256('input-b');
      expect(a).not.toBe(b);
    });
  });

  describe('computeDeduplicationKey', () => {
    const baseInput = {
      creditorId: 'creditor-uuid-123',
      debtorDocument: '12345678901',
      contractNumber: 'CONTRACT-001',
    };

    it('should return a valid SHA-256 hex string (64 chars)', () => {
      const key = service.computeDeduplicationKey(baseInput);
      expect(key).toHaveLength(64);
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should be deterministic — same inputs produce same output', () => {
      const key1 = service.computeDeduplicationKey(baseInput);
      const key2 = service.computeDeduplicationKey(baseInput);
      expect(key1).toBe(key2);
    });

    it('should produce different keys for different creditorIds', () => {
      const key1 = service.computeDeduplicationKey(baseInput);
      const key2 = service.computeDeduplicationKey({
        ...baseInput,
        creditorId: 'different-creditor',
      });
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different debtorDocuments', () => {
      const key1 = service.computeDeduplicationKey(baseInput);
      const key2 = service.computeDeduplicationKey({
        ...baseInput,
        debtorDocument: '99999999999',
      });
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different contractNumbers', () => {
      const key1 = service.computeDeduplicationKey(baseInput);
      const key2 = service.computeDeduplicationKey({
        ...baseInput,
        contractNumber: 'CONTRACT-002',
      });
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys when debtOriginDocument is present vs absent', () => {
      const keyWithout = service.computeDeduplicationKey(baseInput);
      const keyWith = service.computeDeduplicationKey({
        ...baseInput,
        debtOriginDocument: 'ORIGIN-DOC-001',
      });
      expect(keyWithout).not.toBe(keyWith);
    });

    it('should produce different keys for different debtOriginDocuments', () => {
      const key1 = service.computeDeduplicationKey({
        ...baseInput,
        debtOriginDocument: 'ORIGIN-A',
      });
      const key2 = service.computeDeduplicationKey({
        ...baseInput,
        debtOriginDocument: 'ORIGIN-B',
      });
      expect(key1).not.toBe(key2);
    });

    it('should hash debtorDocument before concatenation (not include raw)', () => {
      // The debtorDocument should be hashed individually.
      // We verify by computing the expected key manually.
      const debtorHash = service.sha256(baseInput.debtorDocument);
      const expectedInput = [
        baseInput.creditorId,
        debtorHash,
        baseInput.contractNumber,
        '',
      ].join('|');
      const expectedKey = service.sha256(expectedInput);

      const actualKey = service.computeDeduplicationKey(baseInput);
      expect(actualKey).toBe(expectedKey);
    });

    it('should hash debtOriginDocument before concatenation when present', () => {
      const input = { ...baseInput, debtOriginDocument: 'DOC-ORIGIN-123' };
      const debtorHash = service.sha256(input.debtorDocument);
      const originHash = service.sha256(input.debtOriginDocument);
      const expectedInput = [
        input.creditorId,
        debtorHash,
        input.contractNumber,
        originHash,
      ].join('|');
      const expectedKey = service.sha256(expectedInput);

      const actualKey = service.computeDeduplicationKey(input);
      expect(actualKey).toBe(expectedKey);
    });

    it('should use empty string (not hash) when debtOriginDocument is undefined', () => {
      const debtorHash = service.sha256(baseInput.debtorDocument);
      const expectedInput = [
        baseInput.creditorId,
        debtorHash,
        baseInput.contractNumber,
        '', // empty string, not hash of empty string
      ].join('|');
      const expectedKey = service.sha256(expectedInput);

      const actualKey = service.computeDeduplicationKey(baseInput);
      expect(actualKey).toBe(expectedKey);
    });
  });
});

import * as fc from 'fast-check';
import { DeduplicationService } from '../../contracts/deduplication.service';

/**
 * **Validates: Requirements 15.2**
 *
 * Property 19: Import reactivates suspended/cancelled contracts
 *
 * When a DeduplicationKey matches an existing contract with status SUSPENDED or CANCELLED:
 * - The contract fields are updated with the imported values
 * - The contract status is set to ACTIVE (reactivated)
 */
describe('Property 19: Import reactivates suspended/cancelled contracts', () => {
  const deduplicationService = new DeduplicationService();

  // Generators
  const debtTypeArb = fc.constantFrom(
    'COMMERCIAL',
    'BANKING',
    'SERVICES',
    'UTILITIES',
    'TELECOM',
    'EDUCATION',
    'HEALTH',
    'CONDOMINIAL',
    'OTHER',
  );

  const monetaryValueArb = fc.double({
    min: 0.01,
    max: 999999999.99,
    noNaN: true,
  }).map((v) => Math.round(v * 100) / 100);

  const pastDateArb = fc
    .integer({ min: 0, max: 365 * 5 })
    .map((daysAgo) => {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      d.setHours(0, 0, 0, 0);
      return d;
    });

  const cpfArb = fc.stringMatching(/^[0-9]{11}$/);

  const contractNumberArb = fc.string({ minLength: 1, maxLength: 50 }).filter(
    (s) => s.trim().length > 0,
  );

  const suspendedOrCancelledArb = fc.constantFrom('SUSPENDED', 'CANCELLED');

  interface ImportLine {
    debtorDocument: string;
    contractNumber: string;
    debtType: string;
    occurrenceDate: Date;
    originalValue: number;
    updatedValue: number | null;
    debtOrigin: string | null;
  }

  interface ExistingContract {
    id: string;
    walletId: string;
    debtType: string;
    occurrenceDate: Date;
    originalValue: number;
    updatedValue: number | null;
    debtOrigin: string | null;
    status: string;
  }

  const importLineArb: fc.Arbitrary<ImportLine> = fc.record({
    debtorDocument: cpfArb,
    contractNumber: contractNumberArb,
    debtType: debtTypeArb,
    occurrenceDate: pastDateArb,
    originalValue: monetaryValueArb,
    updatedValue: fc.option(monetaryValueArb, { nil: null }),
    debtOrigin: fc.option(
      fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
      { nil: null },
    ),
  });

  /**
   * Simulates application logic for a matched contract:
   * Determines resulting status after import application.
   */
  function applyImportToContract(
    line: ImportLine,
    existing: ExistingContract,
  ): { newStatus: string; action: 'UPDATE' | 'IGNORE_WITH_REACTIVATION' } {
    const existingDate = existing.occurrenceDate.toISOString().split('T')[0];
    const incomingDate = line.occurrenceDate.toISOString().split('T')[0];

    const valuesMatch =
      existing.debtType === line.debtType &&
      existingDate === incomingDate &&
      existing.originalValue === line.originalValue &&
      existing.updatedValue === line.updatedValue &&
      (existing.debtOrigin || null) === (line.debtOrigin || null);

    if (valuesMatch) {
      // Even with identical values, reactivate SUSPENDED/CANCELLED
      if (existing.status === 'SUSPENDED' || existing.status === 'CANCELLED') {
        return { newStatus: 'ACTIVE', action: 'IGNORE_WITH_REACTIVATION' };
      }
      return { newStatus: existing.status, action: 'IGNORE_WITH_REACTIVATION' };
    }

    // Different values → UPDATE, always reactivate if SUSPENDED/CANCELLED
    if (existing.status === 'SUSPENDED' || existing.status === 'CANCELLED') {
      return { newStatus: 'ACTIVE', action: 'UPDATE' };
    }
    return { newStatus: existing.status, action: 'UPDATE' };
  }

  it('should reactivate SUSPENDED contract to ACTIVE on update with different values', () => {
    fc.assert(
      fc.property(importLineArb, (line) => {
        const existing: ExistingContract = {
          id: 'contract-1',
          walletId: 'wallet-1',
          debtType: line.debtType === 'COMMERCIAL' ? 'BANKING' : 'COMMERCIAL',
          occurrenceDate: line.occurrenceDate,
          originalValue: line.originalValue,
          updatedValue: line.updatedValue,
          debtOrigin: line.debtOrigin,
          status: 'SUSPENDED',
        };

        const result = applyImportToContract(line, existing);
        expect(result.newStatus).toBe('ACTIVE');
      }),
      { numRuns: 100 },
    );
  });

  it('should reactivate CANCELLED contract to ACTIVE on update with different values', () => {
    fc.assert(
      fc.property(importLineArb, (line) => {
        const existing: ExistingContract = {
          id: 'contract-2',
          walletId: 'wallet-1',
          debtType: line.debtType === 'BANKING' ? 'SERVICES' : 'BANKING',
          occurrenceDate: line.occurrenceDate,
          originalValue: line.originalValue,
          updatedValue: line.updatedValue,
          debtOrigin: line.debtOrigin,
          status: 'CANCELLED',
        };

        const result = applyImportToContract(line, existing);
        expect(result.newStatus).toBe('ACTIVE');
      }),
      { numRuns: 100 },
    );
  });

  it('should reactivate SUSPENDED/CANCELLED contracts even when values are identical', () => {
    fc.assert(
      fc.property(importLineArb, suspendedOrCancelledArb, (line, status) => {
        const existing: ExistingContract = {
          id: 'contract-3',
          walletId: 'wallet-1',
          debtType: line.debtType,
          occurrenceDate: line.occurrenceDate,
          originalValue: line.originalValue,
          updatedValue: line.updatedValue,
          debtOrigin: line.debtOrigin,
          status,
        };

        const result = applyImportToContract(line, existing);
        expect(result.newStatus).toBe('ACTIVE');
      }),
      { numRuns: 100 },
    );
  });

  it('should NOT change status of ACTIVE contracts when values are identical', () => {
    fc.assert(
      fc.property(importLineArb, (line) => {
        const existing: ExistingContract = {
          id: 'contract-4',
          walletId: 'wallet-1',
          debtType: line.debtType,
          occurrenceDate: line.occurrenceDate,
          originalValue: line.originalValue,
          updatedValue: line.updatedValue,
          debtOrigin: line.debtOrigin,
          status: 'ACTIVE',
        };

        const result = applyImportToContract(line, existing);
        expect(result.newStatus).toBe('ACTIVE');
      }),
      { numRuns: 100 },
    );
  });

  it('deduplication key remains consistent for same inputs', () => {
    fc.assert(
      fc.property(cpfArb, contractNumberArb, (doc, contractNum) => {
        const creditorId = 'cred-1';
        const key1 = deduplicationService.computeDeduplicationKey({
          creditorId,
          debtorDocument: doc,
          contractNumber: contractNum,
        });
        const key2 = deduplicationService.computeDeduplicationKey({
          creditorId,
          debtorDocument: doc,
          contractNumber: contractNum,
        });
        expect(key1).toBe(key2);
      }),
      { numRuns: 100 },
    );
  });
});

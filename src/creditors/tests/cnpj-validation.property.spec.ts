import * as fc from 'fast-check';
import { isValidCnpj } from '../../common/utils/cnpj.util';

// Feature: cobdata-backend-mvp, Property 9: CNPJ Validation Correctness
// **Validates: Requirements 9.5**
describe('Property 9: CNPJ Validation Correctness', () => {
  // Generator for valid CNPJs (compute check digits algorithmically)
  const arbCnpj = fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: 12, maxLength: 12 })
    .map((digits) => {
      const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const computeCheckDigit = (base: number[], weights: number[]) => {
        const remainder =
          base.reduce((sum, d, i) => sum + d * weights[i]!, 0) % 11;
        return remainder < 2 ? 0 : 11 - remainder;
      };
      const d1 = computeCheckDigit(digits, weights1);
      const d2 = computeCheckDigit([...digits, d1], weights2);
      return [...digits, d1, d2].join('');
    });

  it('should accept any algorithmically valid CNPJ', () => {
    fc.assert(
      fc.property(arbCnpj, (cnpj) => {
        // Skip all-same-digits (edge case rejected by implementation)
        if (/^(\d)\1{13}$/.test(cnpj)) return;
        expect(isValidCnpj(cnpj)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should reject any CNPJ with corrupted check digits', () => {
    fc.assert(
      fc.property(
        arbCnpj,
        fc.integer({ min: 12, max: 13 }), // position to corrupt
        fc.integer({ min: 1, max: 9 }), // delta to add
        (cnpj, pos, delta) => {
          if (/^(\d)\1{13}$/.test(cnpj)) return;
          const digits = cnpj.split('');
          const original = parseInt(digits[pos]!, 10);
          digits[pos] = String((original + delta) % 10);
          const corrupted = digits.join('');
          if (corrupted === cnpj) return; // Same after corruption (skip)
          expect(isValidCnpj(corrupted)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject strings that are not exactly 14 digits', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (s) => !/^\d{14}$/.test(s),
        ),
        (input) => {
          expect(isValidCnpj(input)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject all-same-digit CNPJs', () => {
    for (let d = 0; d <= 9; d++) {
      const cnpj = String(d).repeat(14);
      expect(isValidCnpj(cnpj)).toBe(false);
    }
  });
});

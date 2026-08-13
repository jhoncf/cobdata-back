import * as fc from 'fast-check';
import { PasswordService } from '../services/password.service';

/**
 * Feature: cobdata-backend-mvp, Property 29: Password Complexity Enforcement
 *
 * **Validates: Requirements 4.2, 5.1**
 *
 * For any password submission (activation, change, reset), the system SHALL accept
 * the password if and only if it contains at minimum 8 characters, at least one
 * uppercase letter, one lowercase letter, and one digit.
 */
describe('Property 29: Password Complexity Enforcement', () => {
  const service = new PasswordService();

  const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const LOWER = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const DIGIT = '0123456789'.split('');
  const ALL_CHARS = [...UPPER, ...LOWER, ...DIGIT];

  /**
   * Generator for valid passwords that always satisfy all complexity rules:
   * - >= 8 characters
   * - at least 1 uppercase letter
   * - at least 1 lowercase letter
   * - at least 1 digit
   */
  const arbValidPassword: fc.Arbitrary<string> = fc
    .tuple(
      fc.constantFrom(...UPPER),
      fc.constantFrom(...LOWER),
      fc.constantFrom(...DIGIT),
      fc.array(fc.constantFrom(...ALL_CHARS), { minLength: 5, maxLength: 47 }),
    )
    .map(([upper, lower, digit, rest]) => `${upper}${lower}${digit}${rest.join('')}`);

  /**
   * Generator for passwords shorter than 8 characters
   */
  const arbTooShort: fc.Arbitrary<string> = fc
    .array(fc.constantFrom(...ALL_CHARS), { minLength: 1, maxLength: 7 })
    .map((chars) => chars.join(''));

  /**
   * Generator for passwords >= 8 chars without uppercase letters
   */
  const arbNoUppercase: fc.Arbitrary<string> = fc
    .tuple(
      fc.constantFrom(...LOWER),
      fc.constantFrom(...DIGIT),
      fc.array(fc.constantFrom(...LOWER, ...DIGIT), { minLength: 6, maxLength: 28 }),
    )
    .map(([lower, digit, rest]) => `${lower}${digit}${rest.join('')}`);

  /**
   * Generator for passwords >= 8 chars without lowercase letters
   */
  const arbNoLowercase: fc.Arbitrary<string> = fc
    .tuple(
      fc.constantFrom(...UPPER),
      fc.constantFrom(...DIGIT),
      fc.array(fc.constantFrom(...UPPER, ...DIGIT), { minLength: 6, maxLength: 28 }),
    )
    .map(([upper, digit, rest]) => `${upper}${digit}${rest.join('')}`);

  /**
   * Generator for passwords >= 8 chars without digits
   */
  const arbNoDigit: fc.Arbitrary<string> = fc
    .tuple(
      fc.constantFrom(...UPPER),
      fc.constantFrom(...LOWER),
      fc.array(fc.constantFrom(...UPPER, ...LOWER), { minLength: 6, maxLength: 28 }),
    )
    .map(([upper, lower, rest]) => `${upper}${lower}${rest.join('')}`);

  it('should accept any password with >= 8 chars, uppercase, lowercase, and digit', () => {
    fc.assert(
      fc.property(arbValidPassword, (password: string) => {
        const result = service.validateComplexity(password);
        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('should reject any password shorter than 8 characters', () => {
    fc.assert(
      fc.property(arbTooShort, (password: string) => {
        const result = service.validateComplexity(password);
        expect(result).not.toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('should reject passwords without uppercase letters', () => {
    fc.assert(
      fc.property(arbNoUppercase, (password: string) => {
        const result = service.validateComplexity(password);
        expect(result).not.toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('should reject passwords without lowercase letters', () => {
    fc.assert(
      fc.property(arbNoLowercase, (password: string) => {
        const result = service.validateComplexity(password);
        expect(result).not.toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('should reject passwords without digits', () => {
    fc.assert(
      fc.property(arbNoDigit, (password: string) => {
        const result = service.validateComplexity(password);
        expect(result).not.toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});

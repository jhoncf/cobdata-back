import { isValidCnpj } from './cnpj.util';

describe('isValidCnpj', () => {
  describe('valid CNPJs', () => {
    it('should return true for a known valid CNPJ (11222333000181)', () => {
      expect(isValidCnpj('11222333000181')).toBe(true);
    });

    it('should return true for another known valid CNPJ (11444777000161)', () => {
      expect(isValidCnpj('11444777000161')).toBe(true);
    });

    it('should return true for CNPJ 27865757000102', () => {
      expect(isValidCnpj('27865757000102')).toBe(true);
    });
  });

  describe('invalid check digits', () => {
    it('should return false when first check digit is wrong', () => {
      // 11222333000181 is valid; changing digit 13 (index 12) from 8 to 9
      expect(isValidCnpj('11222333000191')).toBe(false);
    });

    it('should return false when second check digit is wrong', () => {
      // 11222333000181 is valid; changing last digit from 1 to 2
      expect(isValidCnpj('11222333000182')).toBe(false);
    });
  });

  describe('format validation', () => {
    it('should return false for strings with less than 14 digits', () => {
      expect(isValidCnpj('1122233300018')).toBe(false);
    });

    it('should return false for strings with more than 14 digits', () => {
      expect(isValidCnpj('112223330001810')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidCnpj('')).toBe(false);
    });

    it('should return false for string with non-numeric characters', () => {
      expect(isValidCnpj('11.222.333/0001-81')).toBe(false);
    });

    it('should return false for alphabetic characters', () => {
      expect(isValidCnpj('1122233300018a')).toBe(false);
    });
  });

  describe('all same digits rejected', () => {
    it('should return false for 00000000000000', () => {
      expect(isValidCnpj('00000000000000')).toBe(false);
    });

    it('should return false for 11111111111111', () => {
      expect(isValidCnpj('11111111111111')).toBe(false);
    });

    it('should return false for 99999999999999', () => {
      expect(isValidCnpj('99999999999999')).toBe(false);
    });
  });
});

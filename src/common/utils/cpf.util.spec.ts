import { isValidCpf } from './cpf.util';

describe('isValidCpf', () => {
  describe('valid CPFs', () => {
    it('should return true for a known valid CPF (52998224725)', () => {
      expect(isValidCpf('52998224725')).toBe(true);
    });

    it('should return true for another known valid CPF (39153402359)', () => {
      expect(isValidCpf('39153402359')).toBe(true);
    });
  });

  describe('invalid check digits', () => {
    it('should return false when first check digit is wrong', () => {
      // 52998224725 is valid; changing digit at index 9 from 2 to 3
      expect(isValidCpf('52998224735')).toBe(false);
    });

    it('should return false when second check digit is wrong', () => {
      // 52998224725 is valid; changing last digit from 5 to 6
      expect(isValidCpf('52998224726')).toBe(false);
    });
  });

  describe('format validation', () => {
    it('should return false for strings with less than 11 digits', () => {
      expect(isValidCpf('5299822472')).toBe(false);
    });

    it('should return false for strings with more than 11 digits', () => {
      expect(isValidCpf('529982247250')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidCpf('')).toBe(false);
    });

    it('should return false for string with non-numeric characters', () => {
      expect(isValidCpf('529.982.247-25')).toBe(false);
    });
  });

  describe('all same digits rejected', () => {
    it('should return false for 00000000000', () => {
      expect(isValidCpf('00000000000')).toBe(false);
    });

    it('should return false for 11111111111', () => {
      expect(isValidCpf('11111111111')).toBe(false);
    });

    it('should return false for 99999999999', () => {
      expect(isValidCpf('99999999999')).toBe(false);
    });
  });
});

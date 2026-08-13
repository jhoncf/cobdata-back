/**
 * Validates a CNPJ string according to the Receita Federal algorithm.
 * @param cnpj - String with exactly 14 numeric digits
 * @returns true if the CNPJ is valid (check digits correct), false otherwise
 */
export function isValidCnpj(cnpj: string): boolean {
  // 1. Must be exactly 14 digits
  if (!/^\d{14}$/.test(cnpj)) return false;

  // 2. Reject all same digits (e.g., 11111111111111)
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const digits = cnpj.split('').map((d) => Number(d));

  // 3. Calculate first check digit
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += digits[i]! * weights1[i]!;
  }
  let remainder = sum % 11;
  const digit1 = remainder < 2 ? 0 : 11 - remainder;
  if (digits[12] !== digit1) return false;

  // 4. Calculate second check digit
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += digits[i]! * weights2[i]!;
  }
  remainder = sum % 11;
  const digit2 = remainder < 2 ? 0 : 11 - remainder;
  if (digits[13] !== digit2) return false;

  return true;
}

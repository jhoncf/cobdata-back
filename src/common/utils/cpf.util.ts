/**
 * Validates a CPF string according to the Receita Federal algorithm.
 * @param cpf - String with exactly 11 numeric digits
 * @returns true if the CPF is valid (check digits correct), false otherwise
 */
export function isValidCpf(cpf: string): boolean {
  // 1. Must be exactly 11 digits
  if (!/^\d{11}$/.test(cpf)) return false;

  // 2. Reject all same digits (e.g., 11111111111)
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split('').map((d) => Number(d));

  // 3. Calculate first check digit
  const weights1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += digits[i]! * weights1[i]!;
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (digits[9] !== remainder) return false;

  // 4. Calculate second check digit
  const weights2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += digits[i]! * weights2[i]!;
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (digits[10] !== remainder) return false;

  return true;
}

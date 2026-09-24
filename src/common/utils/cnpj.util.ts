/** Normalizes the printed CNPJ mask while preserving the official letters. */
export function normalizeCnpj(cnpj: string): string {
  return cnpj.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Validates the numeric and alphanumeric CNPJ formats defined by Receita
 * Federal. The first 12 positions are alphanumeric and the two check digits
 * remain numeric. Character values use ASCII - 48 in the modulo 11 formula.
 */
export function isValidCnpj(cnpj: string): boolean {
  const normalized = normalizeCnpj(cnpj);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(normalized)) return false;

  // Preserve the legacy numeric-CNPJ guard.
  if (/^(\d)\1{13}$/.test(normalized)) return false;

  const values = normalized.slice(0, 12).split('').map((character) => character.charCodeAt(0) - 48);

  // Calculate first check digit.
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += values[i]! * weights1[i]!;
  }
  let remainder = sum % 11;
  const digit1 = remainder < 2 ? 0 : 11 - remainder;
  if (Number(normalized[12]) !== digit1) return false;

  // Calculate second check digit.
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  const valuesWithFirstDigit = [...values, digit1];
  for (let i = 0; i < 13; i++) {
    sum += valuesWithFirstDigit[i]! * weights2[i]!;
  }
  remainder = sum % 11;
  const digit2 = remainder < 2 ? 0 : 11 - remainder;
  if (Number(normalized[13]) !== digit2) return false;

  return true;
}

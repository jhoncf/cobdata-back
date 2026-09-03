export interface OfferRules {
  cobcomDiscountPercent: number | string | { toString(): string };
  offerFirstInstallmentDays: number;
  offerMinInstallmentValue: number | string | { toString(): string };
  offerMaxInstallments: number;
}

export interface CalculatedOffer {
  offerValue: number;
  offerDiscountPercent: number;
  offerFirstInstallmentDays: number;
  offerMaxInstallments: number;
}

/**
 * Produces the immutable offer snapshot stored on a contract. The source value
 * is always the updated debt value; the original value is never altered.
 */
export function calculateOffer(updatedValue: number, rules: OfferRules): CalculatedOffer {
  const discount = Math.min(100, Math.max(0, Number(rules.cobcomDiscountPercent) || 0));
  const offerValue = Math.round(updatedValue * (1 - discount / 100) * 100) / 100;
  const minimumInstallment = Number(rules.offerMinInstallmentValue) || 0;
  const configuredMaximum = Math.max(1, Math.floor(Number(rules.offerMaxInstallments) || 1));
  const installmentsAllowedByValue = minimumInstallment > 0
    ? Math.max(1, Math.floor(offerValue / minimumInstallment))
    : configuredMaximum;

  return {
    offerValue,
    offerDiscountPercent: discount,
    offerFirstInstallmentDays: Math.max(1, Math.floor(Number(rules.offerFirstInstallmentDays) || 5)),
    offerMaxInstallments: Math.min(configuredMaximum, installmentsAllowedByValue),
  };
}

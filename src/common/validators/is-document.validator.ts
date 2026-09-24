import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidCpf } from '../utils/cpf.util';
import { isValidCnpj, normalizeCnpj } from '../utils/cnpj.util';

/**
 * Custom validator that checks CPF (11 digits) or CNPJ (14 positions)
 * including check digit validation using the Receita Federal algorithm.
 */
export function IsDocument(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isDocument',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          if (typeof value !== 'string') return false;
          // The usual punctuation is display-only. Do not silently accept
          // arbitrary symbols in a legal identification document.
          if (!/^[0-9A-Za-z.\-/\s]+$/.test(value)) return false;
          const document = normalizeCnpj(value);
          if (/^\d{11}$/.test(document)) return isValidCpf(document);
          if (document.length === 14) return isValidCnpj(document);
          return false;
        },
        defaultMessage() {
          return 'debtorDocument must be a valid CPF (11 digits) or CNPJ (14 alphanumeric characters) with valid check digits';
        },
      },
    });
  };
}

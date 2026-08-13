import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidCpf } from '../utils/cpf.util';
import { isValidCnpj } from '../utils/cnpj.util';

/**
 * Custom validator that checks CPF (11 digits) or CNPJ (14 digits)
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
          const digits = value.replace(/\D/g, '');
          if (digits.length === 11) return isValidCpf(digits);
          if (digits.length === 14) return isValidCnpj(digits);
          return false;
        },
        defaultMessage() {
          return 'debtorDocument must be a valid CPF (11 digits) or CNPJ (14 digits) with valid check digits';
        },
      },
    });
  };
}

import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidCnpj } from '../utils/cnpj.util';

export function IsCnpj(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCnpj',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          return typeof value === 'string' && isValidCnpj(value);
        },
        defaultMessage() {
          return 'CNPJ must be exactly 14 numeric digits with valid check digits';
        },
      },
    });
  };
}

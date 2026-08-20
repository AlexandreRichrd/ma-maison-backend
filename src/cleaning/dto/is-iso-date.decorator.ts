import { registerDecorator, ValidationOptions } from 'class-validator';

import { isValidIsoDate } from '../iso-date.util';

/** Validates the `2026-08-20` shape and that it's a real calendar date. */
export function IsIsoDate(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isIsoDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isValidIsoDate(value);
        },
      },
    });
  };
}

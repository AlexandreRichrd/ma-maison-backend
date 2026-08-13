import { registerDecorator, ValidationOptions } from 'class-validator';

import { isValidIsoWeek } from '../iso-week.util';

/** Validates the `2026-W32` shape and the 1-53 week bound via isValidIsoWeek. */
export function IsIsoWeek(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isIsoWeek',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isValidIsoWeek(value);
        },
      },
    });
  };
}

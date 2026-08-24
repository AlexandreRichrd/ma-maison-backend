import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';

import type { ApiFieldError } from './api-error';

/** class-validator constraint key -> stable machine-readable code. */
const CODE_BY_CONSTRAINT: Record<string, string> = {
  isEmail: 'invalid_email',
  isNotEmpty: 'required',
  minLength: 'too_short',
  isString: 'invalid_type',
  isUuid: 'invalid_id',
  matchesPassword: 'password_mismatch',
  isIsoWeek: 'invalid_iso_week',
  isIsoDate: 'invalid_iso_date',
  isIso8601: 'invalid_type',
  arrayMaxSize: 'invalid_type',
  arrayMinSize: 'at_least_one_required',
  isArray: 'invalid_type',
  isInt: 'invalid_type',
  min: 'too_small',
  isEnum: 'invalid_type',
};

function flatten(errors: ValidationError[]): ApiFieldError[] {
  return errors.flatMap((error) => {
    if (error.children?.length) {
      return flatten(error.children);
    }
    const constraintKey = Object.keys(error.constraints ?? {})[0];
    const code =
      CODE_BY_CONSTRAINT[constraintKey] ?? constraintKey ?? 'invalid';
    return [{ field: error.property, code }];
  });
}

/** Passed as ValidationPipe's exceptionFactory — same {statusCode, errors} shape as every other rejection. */
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  return new BadRequestException({ errors: flatten(errors) });
}

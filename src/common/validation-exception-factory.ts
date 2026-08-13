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
  isIso8601: 'invalid_type',
  arrayMaxSize: 'invalid_type',
  isArray: 'invalid_type',
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

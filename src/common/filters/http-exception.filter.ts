import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';

import type { ApiFieldError } from '../api-error';

function isFieldErrorList(
  value: unknown,
): value is { errors: ApiFieldError[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { errors?: unknown }).errors)
  );
}

function isSingleFieldError(value: unknown): value is ApiFieldError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { field?: unknown }).field === 'string' &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

/**
 * Every error response, whatever raised it (ApiError, the validation
 * pipe's BadRequestException, or an unhandled exception), comes out the
 * same shape: { statusCode, errors: [{ field, code }] }. No display copy —
 * `code` is machine-readable, per CLAUDE.md's API surface contract.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const errors: ApiFieldError[] = isFieldErrorList(body)
        ? body.errors
        : isSingleFieldError(body)
          ? [body]
          : [{ field: 'server', code: 'unknown_error' }];
      response.status(status).json({ statusCode: status, errors });
      return;
    }

    console.error(exception);
    response.status(500).json({
      statusCode: 500,
      errors: [{ field: 'server', code: 'internal_error' }],
    });
  }
}

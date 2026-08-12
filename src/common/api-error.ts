import { HttpException } from '@nestjs/common';

export type ApiFieldError = { field: string; code: string };

/**
 * Business-logic rejection carrying one machine-readable (field, code)
 * pair — never a display message. `HttpExceptionFilter` reshapes this (and
 * every other HttpException) into `{ statusCode, errors: [{ field, code }] }`.
 */
export class ApiError extends HttpException {
  constructor(status: number, field: string, code: string) {
    super({ field, code }, status);
  }
}

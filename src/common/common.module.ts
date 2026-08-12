import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

import { HttpExceptionFilter } from './filters/http-exception.filter';
import { validationExceptionFactory } from './validation-exception-factory';

/**
 * Global pipe/filter registered here (not in main.ts) so they also apply
 * when a test compiles AppModule directly via Test.createTestingModule —
 * no separate wiring needed in e2e test bootstrap.
 */
@Module({
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class CommonModule {}

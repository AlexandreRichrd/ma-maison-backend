import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { Public } from '../auth/public.decorator';
import { AlexaSignatureGuard } from './alexa-signature.guard';
import { AlexaService } from './alexa.service';
import type { RequestEnvelope, ResponseEnvelope } from './types/alexa.types';

// @Public() only opts this route out of the global JwtAuthGuard (which
// expects a user's JWT) — AlexaSignatureGuard still runs and requires a
// valid Amazon signature, same "public, unauthenticated-by-JWT, guarded
// some other way" idea as DeviceAuthGuard on /climate/measures.
@Controller('alexa')
export class AlexaController {
  constructor(private readonly alexa: AlexaService) {}

  // No DTO class: RequestEnvelope is a `type`, so it carries no
  // class-validator metadata and the global ValidationPipe passes it
  // through untouched (same as every other route's `Object`-typed param
  // would) — deliberate here, since Amazon's envelope is large and this
  // service only reads a few fields defensively; a validation 400 would
  // just look like a broken skill to Amazon, not a helpful error to a user.
  @Public()
  @UseGuards(AlexaSignatureGuard)
  @Post()
  handleRequest(@Body() envelope: RequestEnvelope): Promise<ResponseEnvelope> {
    return this.alexa.handleRequest(envelope);
  }
}

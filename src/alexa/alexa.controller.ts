import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';

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
  // @HttpCode(200): Nest's default for @Post() is 201 Created, but Alexa
  // requires a 200 response — anything else is treated as an invalid
  // response, even when the body is otherwise well-formed. Separate from
  // AlexaSignatureGuard's request-side signature check (see its own
  // history in CLAUDE.md's Alexa section): that guard runs before this
  // handler and rejects the *request*; this fixes what Amazon sees on the
  // *response* once a request has already been accepted.
  @Public()
  @UseGuards(AlexaSignatureGuard)
  @Post()
  @HttpCode(200)
  handleRequest(@Body() envelope: RequestEnvelope): Promise<ResponseEnvelope> {
    return this.alexa.handleRequest(envelope);
  }
}

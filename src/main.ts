import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAuthAdapter } from './auth/ws-auth.adapter';

async function bootstrap() {
  // rawBody: true makes request.rawBody (a Buffer) available alongside the
  // normal parsed request.body on every route — needed by AlexaSignatureGuard,
  // which must verify Amazon's signature against the exact bytes sent, not a
  // re-serialization of the parsed JSON (see CLAUDE.md's Alexa section). This
  // is the only effect of the flag; every other route's behavior is
  // unchanged since nothing else reads rawBody.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useWebSocketAdapter(new WsAuthAdapter(app));
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();

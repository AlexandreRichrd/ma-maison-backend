import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAuthAdapter } from './auth/ws-auth.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAuthAdapter(app));
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { AlexaModule } from './alexa/alexa.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CleaningModule } from './cleaning/cleaning.module';
import { ClimateModule } from './climate/climate.module';
import { CommonModule } from './common/common.module';
import { HouseholdsModule } from './households/households.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { RecipesModule } from './recipes/recipes.module';
import { RemindersModule } from './reminders/reminders.module';
import { SettingsModule } from './settings/settings.module';
import { ShoppingModule } from './shopping/shopping.module';
import { throttlerConfig } from './throttler.config';

@Module({
  imports: [
    CommonModule,
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot(throttlerConfig),
    PrismaModule,
    MailModule,
    AuthModule,
    HouseholdsModule,
    ShoppingModule,
    CleaningModule,
    RecipesModule,
    RemindersModule,
    SettingsModule,
    ClimateModule,
    AlexaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  // Registered here (not main.ts) so it also applies when a test compiles
  // AppModule directly via Test.createTestingModule — same reasoning as
  // CommonModule's APP_PIPE/APP_FILTER providers.
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(cookieParser()).forRoutes('*');
  }
}

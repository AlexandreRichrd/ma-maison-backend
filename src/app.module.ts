import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CleaningModule } from './cleaning/cleaning.module';
import { ClimateModule } from './climate/climate.module';
import { CommonModule } from './common/common.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { RecipesModule } from './recipes/recipes.module';
import { RemindersModule } from './reminders/reminders.module';
import { ShoppingModule } from './shopping/shopping.module';
import { throttlerConfig } from './throttler.config';

@Module({
  imports: [
    CommonModule,
    ThrottlerModule.forRoot(throttlerConfig),
    PrismaModule,
    MailModule,
    AuthModule,
    ShoppingModule,
    CleaningModule,
    RecipesModule,
    RemindersModule,
    ClimateModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

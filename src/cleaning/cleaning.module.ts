import { Module } from '@nestjs/common';

import { CleaningController } from './cleaning.controller';
import { CleaningService } from './cleaning.service';
import { RotationService } from './rotation.service';

@Module({
  controllers: [CleaningController],
  providers: [RotationService, CleaningService],
  exports: [RotationService],
})
export class CleaningModule {}

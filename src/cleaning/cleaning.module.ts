import { Module } from '@nestjs/common';

import { RotationService } from './rotation.service';

@Module({
  providers: [RotationService],
  exports: [RotationService],
})
export class CleaningModule {}

import { Module } from '@nestjs/common';

import { CleaningController } from './cleaning.controller';
import { CleaningService } from './cleaning.service';
import { HouseholdMembersService } from './household-members.service';
import { RotationService } from './rotation.service';

@Module({
  controllers: [CleaningController],
  providers: [RotationService, CleaningService, HouseholdMembersService],
  exports: [RotationService, HouseholdMembersService],
})
export class CleaningModule {}
